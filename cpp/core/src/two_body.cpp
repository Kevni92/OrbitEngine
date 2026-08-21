#include "orbit_engine/two_body.hpp"

#include "orbit_engine/time.hpp"

#include <algorithm>
#include <cmath>

namespace orbit_engine::two_body {
namespace {

constexpr double kSolverTolerance = 1e-13;
constexpr int kMaximumIterations = 128;

struct Stumpff {
  double c;
  double s;
};

bool finite_vec(frame::Vec3 value) noexcept {
  return std::isfinite(value.x) && std::isfinite(value.y) && std::isfinite(value.z);
}

double dot(frame::Vec3 left, frame::Vec3 right) noexcept {
  return left.x * right.x + left.y * right.y + left.z * right.z;
}

double norm(frame::Vec3 value) noexcept {
  return std::hypot(value.x, std::hypot(value.y, value.z));
}

Stumpff stumpff(double z, bool& ok) noexcept {
  if (!std::isfinite(z)) {
    ok = false;
    return {};
  }
  if (std::abs(z) < 0.1) {
    const double z2 = z * z;
    const double z3 = z2 * z;
    const double z4 = z3 * z;
    return {
      0.5 - z / 24.0 + z2 / 720.0 - z3 / 40'320.0 + z4 / 3'628'800.0,
      1.0 / 6.0 - z / 120.0 + z2 / 5'040.0 - z3 / 362'880.0 + z4 / 39'916'800.0,
    };
  }
  if (z > 0.0) {
    const double root = std::sqrt(z);
    const double cosine = std::cos(root);
    const double sine = std::sin(root);
    return {(1.0 - cosine) / z, (root - sine) / (root * z)};
  }
  const double root = std::sqrt(-z);
  if (root > 700.0) {
    ok = false;
    return {};
  }
  const double hyperbolicCosine = std::cosh(root);
  const double hyperbolicSine = std::sinh(root);
  return {(hyperbolicCosine - 1.0) / (-z), (hyperbolicSine - root) / (root * (-z))};
}

bool equation(
  double chi,
  double alpha,
  double radius,
  double radialFactor,
  double sqrtMu,
  double dt,
  double& value,
  double& derivative
) noexcept {
  const double z = alpha * chi * chi;
  bool ok = true;
  const auto stump = stumpff(z, ok);
  if (!ok || !std::isfinite(stump.c) || !std::isfinite(stump.s)) return false;
  const double chi2 = chi * chi;
  const double chi3 = chi2 * chi;
  const double zc = z * stump.c;
  const double zs = z * stump.s;
  value = radialFactor * chi2 * stump.c
    + (1.0 - alpha * radius) * chi3 * stump.s
    + radius * chi
    - sqrtMu * dt;
  derivative = chi2 * stump.c
    + radialFactor * chi * (1.0 - zs)
    + radius * (1.0 - zc);
  return std::isfinite(value) && std::isfinite(derivative) && derivative > 0.0;
}

bool solve_universal_anomaly(
  double alpha,
  double radius,
  double radialFactor,
  double sqrtMu,
  double dt,
  double& chi
) noexcept {
  const double initial = sqrtMu * dt / radius;
  double low = 0.0;
  double high = 0.0;
  double lowValue = 0.0;
  double highValue = 0.0;
  if (dt >= 0.0) {
    low = 0.0;
    high = std::max(1.0, std::abs(initial));
    if (!equation(low, alpha, radius, radialFactor, sqrtMu, dt, lowValue, highValue)) return false;
    for (int index = 0; index < kMaximumIterations; ++index) {
      if (!equation(high, alpha, radius, radialFactor, sqrtMu, dt, highValue, lowValue)) return false;
      if (highValue >= 0.0) break;
      high *= 2.0;
      if (!std::isfinite(high) || high > 1e154) return false;
      if (index == kMaximumIterations - 1) return false;
    }
  } else {
    high = 0.0;
    low = -std::max(1.0, std::abs(initial));
    if (!equation(high, alpha, radius, radialFactor, sqrtMu, dt, highValue, lowValue)) return false;
    for (int index = 0; index < kMaximumIterations; ++index) {
      if (!equation(low, alpha, radius, radialFactor, sqrtMu, dt, lowValue, highValue)) return false;
      if (lowValue <= 0.0) break;
      low *= 2.0;
      if (!std::isfinite(low) || low < -1e154) return false;
      if (index == kMaximumIterations - 1) return false;
    }
  }

  chi = std::clamp(initial, low, high);
  const double residualScale = std::max(1.0, std::abs(sqrtMu * dt));
  for (int index = 0; index < kMaximumIterations; ++index) {
    double value = 0.0;
    double derivative = 0.0;
    if (!equation(chi, alpha, radius, radialFactor, sqrtMu, dt, value, derivative)) return false;
    if (std::abs(value) <= kSolverTolerance * residualScale) return true;
    if (value > 0.0) high = chi;
    else low = chi;
    const double midpoint = low + (high - low) * 0.5;
    const double newton = chi - value / derivative;
    chi = std::isfinite(newton) && newton > low && newton < high ? newton : midpoint;
    if (std::abs(high - low) <= kSolverTolerance * std::max(1.0, std::abs(chi))) {
      return true;
    }
  }
  return false;
}

}  // namespace

bool is_valid_input(TwoBodyWire value) noexcept {
  if (!object::is_valid(object::object_id_from_wire({value.central_object_id_high, value.central_object_id_low}))) {
    return false;
  }
  if (!std::isfinite(value.mu) || value.mu < 0.0) return false;
  if ((value.anchor_frame_high == 0 && value.anchor_frame_low == 0)
      || (value.result_frame_high == 0 && value.result_frame_low == 0)
      || value.anchor_frame_high != value.result_frame_high
      || value.anchor_frame_low != value.result_frame_low) {
    return false;
  }
  const auto anchorEpoch = time::from_wire(value.anchor_epoch);
  const auto targetEpoch = time::from_wire(value.target_epoch);
  if (!anchorEpoch.has_value() || !targetEpoch.has_value()) return false;
  if (!std::isfinite(value.anchor_position_x) || !std::isfinite(value.anchor_position_y)
      || !std::isfinite(value.anchor_position_z) || !std::isfinite(value.anchor_velocity_x)
      || !std::isfinite(value.anchor_velocity_y) || !std::isfinite(value.anchor_velocity_z)) {
    return false;
  }
  return norm(frame::Vec3{value.anchor_position_x, value.anchor_position_y, value.anchor_position_z}) > 0.0;
}

TwoBodyWire evaluate(TwoBodyWire input) noexcept {
  input.result_code = static_cast<std::uint16_t>(ResultCode::invalid_input);
  input.result_frame_high = input.anchor_frame_high;
  input.result_frame_low = input.anchor_frame_low;
  input.result_epoch = input.target_epoch;
  if (!is_valid_input(input)) return input;
  if (input.mu == 0.0) {
    input.result_code = static_cast<std::uint16_t>(ResultCode::invalid_mu);
    return input;
  }
  const auto anchorEpoch = *time::from_wire(input.anchor_epoch);
  const auto targetEpoch = *time::from_wire(input.target_epoch);
  const auto duration = time::subtract(targetEpoch, anchorEpoch);
  if (!duration.has_value()) return input;
  const double dt = time::to_seconds(*duration);
  const frame::Vec3 position0{input.anchor_position_x, input.anchor_position_y, input.anchor_position_z};
  const frame::Vec3 velocity0{input.anchor_velocity_x, input.anchor_velocity_y, input.anchor_velocity_z};
  const double radius = norm(position0);
  const double speedSquared = dot(velocity0, velocity0);
  const double sqrtMu = std::sqrt(input.mu);
  const double alpha = 2.0 / radius - speedSquared / input.mu;
  const double radialFactor = dot(position0, velocity0) / sqrtMu;
  if (!std::isfinite(dt) || !std::isfinite(alpha) || !std::isfinite(radialFactor)) return input;
  if (dt == 0.0) {
    input.result_position_x = position0.x;
    input.result_position_y = position0.y;
    input.result_position_z = position0.z;
    input.result_velocity_x = velocity0.x;
    input.result_velocity_y = velocity0.y;
    input.result_velocity_z = velocity0.z;
    input.result_code = static_cast<std::uint16_t>(ResultCode::success);
    return input;
  }
  double chi = 0.0;
  if (!solve_universal_anomaly(alpha, radius, radialFactor, sqrtMu, dt, chi)) return input;
  const double z = alpha * chi * chi;
  bool stumpffOk = true;
  const auto stump = stumpff(z, stumpffOk);
  const double chi2 = chi * chi;
  const double chi3 = chi2 * chi;
  const double f = 1.0 - chi2 / radius * stump.c;
  const double g = dt - chi3 / sqrtMu * stump.s;
  const frame::Vec3 position{
    f * position0.x + g * velocity0.x,
    f * position0.y + g * velocity0.y,
    f * position0.z + g * velocity0.z,
  };
  const double resultRadius = norm(position);
  if (!stumpffOk || !std::isfinite(resultRadius) || resultRadius <= 0.0) return input;
  const double gDot = 1.0 - chi2 / resultRadius * stump.c;
  const double fDot = sqrtMu / (resultRadius * radius) * (alpha * chi3 * stump.s - chi);
  const frame::Vec3 velocity{
    fDot * position0.x + gDot * velocity0.x,
    fDot * position0.y + gDot * velocity0.y,
    fDot * position0.z + gDot * velocity0.z,
  };
  if (!finite_vec(position) || !finite_vec(velocity)) return input;
  input.result_position_x = position.x;
  input.result_position_y = position.y;
  input.result_position_z = position.z;
  input.result_velocity_x = velocity.x;
  input.result_velocity_y = velocity.y;
  input.result_velocity_z = velocity.z;
  input.result_code = static_cast<std::uint16_t>(ResultCode::success);
  return input;
}

}  // namespace orbit_engine::two_body
