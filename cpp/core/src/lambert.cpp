#include "orbit_engine/lambert.hpp"

#include "orbit_engine/object.hpp"

#include <algorithm>
#include <cmath>
#include <limits>
#include <numbers>

namespace orbit_engine::lambert {
namespace {

constexpr double kPi = std::numbers::pi_v<double>;
constexpr double kTwoPi = 2.0 * kPi;
constexpr double kGeometryTolerance = 1e-12;

bool finite(double value) noexcept { return std::isfinite(value); }

bool integer_word(double value, double minimum, double maximum) noexcept {
  return finite(value) && std::trunc(value) == value && value >= minimum && value <= maximum;
}

bool read_u32(std::span<const double> values, std::size_t& cursor, std::uint32_t& output) noexcept {
  if (cursor >= values.size() || !integer_word(values[cursor], 0.0, static_cast<double>(std::numeric_limits<std::uint32_t>::max()))) return false;
  output = static_cast<std::uint32_t>(values[cursor++]);
  return true;
}

bool read_u16(std::span<const double> values, std::size_t& cursor, std::uint16_t& output) noexcept {
  if (cursor >= values.size() || !integer_word(values[cursor], 0.0, static_cast<double>(std::numeric_limits<std::uint16_t>::max()))) return false;
  output = static_cast<std::uint16_t>(values[cursor++]);
  return true;
}

bool read_double(std::span<const double> values, std::size_t& cursor, double& output) noexcept {
  if (cursor >= values.size() || !finite(values[cursor])) return false;
  output = values[cursor++];
  return true;
}

bool read_vec(std::span<const double> values, std::size_t& cursor, frame::Vec3& output) noexcept {
  return read_double(values, cursor, output.x) && read_double(values, cursor, output.y) && read_double(values, cursor, output.z);
}

double dot(frame::Vec3 left, frame::Vec3 right) noexcept { return left.x * right.x + left.y * right.y + left.z * right.z; }

frame::Vec3 cross(frame::Vec3 left, frame::Vec3 right) noexcept {
  return {left.y * right.z - left.z * right.y, left.z * right.x - left.x * right.z, left.x * right.y - left.y * right.x};
}

frame::Vec3 add(frame::Vec3 left, frame::Vec3 right) noexcept { return {left.x + right.x, left.y + right.y, left.z + right.z}; }
frame::Vec3 subtract(frame::Vec3 left, frame::Vec3 right) noexcept { return {left.x - right.x, left.y - right.y, left.z - right.z}; }
frame::Vec3 multiply(frame::Vec3 value, double scalar) noexcept { return {value.x * scalar, value.y * scalar, value.z * scalar}; }

double norm(frame::Vec3 value) noexcept { return std::hypot(value.x, std::hypot(value.y, value.z)); }

bool finite_vec(frame::Vec3 value) noexcept { return finite(value.x) && finite(value.y) && finite(value.z); }

struct Stumpff {
  double c2 = 0.0;
  double c3 = 0.0;
};

Stumpff stumpff(double z, bool& valid) noexcept {
  if (!finite(z)) { valid = false; return {}; }
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
    return {(1.0 - std::cos(root)) / z, (root - std::sin(root)) / (root * z)};
  }
  const double root = std::sqrt(-z);
  if (root > 700.0) { valid = false; return {}; }
  return {(std::cosh(root) - 1.0) / (-z), (std::sinh(root) - root) / (root * (-z))};
}

struct EquationValue {
  double value = 0.0;
  double y = 0.0;
  bool valid = false;
};

EquationValue time_equation(double z, double r1, double r2, double a, double time_of_flight) noexcept {
  bool stumpff_valid = true;
  const auto stump = stumpff(z, stumpff_valid);
  if (!stumpff_valid || !finite(stump.c2) || !finite(stump.c3) || stump.c2 <= 0.0) return {};
  const double root_c2 = std::sqrt(stump.c2);
  const double y = r1 + r2 + a * (z * stump.c3 - 1.0) / root_c2;
  if (!finite(y) || y <= 0.0) return {};
  const double y_over_c2 = y / stump.c2;
  const double value = std::pow(y_over_c2, 1.5) * stump.c3 + a * std::sqrt(y) - time_of_flight;
  return {value, y, finite(value)};
}

bool solve_z(
  double r1,
  double r2,
  double a,
  double time_of_flight,
  double tolerance,
  std::uint32_t max_iterations,
  double& z,
  double& y,
  double& residual,
  std::uint32_t& iterations
) noexcept {
  double lower = -16.0 * kPi * kPi;
  double upper = 4.0 * kPi * kPi - 1e-10;
  z = 0.0;
  const double residual_scale = std::max(1.0, std::abs(time_of_flight));
  for (std::uint32_t index = 0; index < max_iterations; ++index) {
    iterations = index + 1;
    auto current = time_equation(z, r1, r2, a, time_of_flight);
    if (!current.valid) {
      z += 0.1;
      if (!finite(z) || z >= upper) return false;
      continue;
    }
    residual = std::abs(current.value) / residual_scale;
    if (residual <= tolerance) { y = current.y; return true; }
    if (current.value > 0.0) upper = z;
    else lower = z;
    if (!(lower < upper)) return false;

    const double step = std::max(1e-6, std::abs(z) * 1e-5);
    const auto left = time_equation(std::max(lower, z - step), r1, r2, a, time_of_flight);
    const auto right = time_equation(std::min(upper, z + step), r1, r2, a, time_of_flight);
    const double denominator = right.value - left.value;
    const double derivative = left.valid && right.valid && finite(denominator) && denominator != 0.0
      ? denominator / (std::min(upper, z + step) - std::max(lower, z - step)) : 0.0;
    const double newton = derivative != 0.0 ? z - current.value / derivative : std::numeric_limits<double>::quiet_NaN();
    z = finite(newton) && newton > lower && newton < upper ? newton : lower + (upper - lower) * 0.5;
  }
  const auto final = time_equation(z, r1, r2, a, time_of_flight);
  if (final.valid) { y = final.y; residual = std::abs(final.value) / residual_scale; }
  return false;
}

bool valid_input(const GeometryWire& value) noexcept {
  if (!object::is_valid(object::object_id_from_wire({value.central_body_high, value.central_body_low}))) return false;
  if (!frame::is_valid(frame::reference_frame_id_from_wire({value.planning_frame_high, value.planning_frame_low}))) return false;
  if (!finite(value.mu) || value.mu <= 0.0) return false;
  if (!finite(value.time_of_flight_seconds) || value.time_of_flight_seconds < 0.0 || value.time_of_flight_nanoseconds >= 1'000'000'000U) return false;
  if (value.time_of_flight_seconds == 0.0 && value.time_of_flight_nanoseconds == 0) return false;
  if (value.motion_sense < 1 || value.motion_sense > 2 || value.path < 1 || value.path > 2) return false;
  if (value.revolutions != 0) return false;
  if (!finite_vec(value.departure_position) || !finite_vec(value.arrival_position) || !finite_vec(value.reference_normal)) return false;
  if (!finite(value.relative_time_of_flight_tolerance) || value.relative_time_of_flight_tolerance <= 0.0
      || !finite(value.velocity_tolerance) || value.velocity_tolerance <= 0.0
      || value.max_iterations == 0 || value.max_iterations > 4096
      || !finite(value.minimum_geometry_scale) || value.minimum_geometry_scale <= 0.0) return false;
  if (value.provenance_present && value.provenance_high == 0 && value.provenance_low == 0) return false;
  return true;
}

}  // namespace

bool decode_packet(std::span<const double> values, GeometryWire& output) noexcept {
  if (values.size() != kInputWords) return false;
  std::size_t cursor = 0;
  if (!read_u32(values, cursor, output.central_body_high) || !read_u32(values, cursor, output.central_body_low)
      || !read_u32(values, cursor, output.planning_frame_high) || !read_u32(values, cursor, output.planning_frame_low)
      || !read_double(values, cursor, output.mu) || !read_double(values, cursor, output.time_of_flight_seconds)
      || !read_u32(values, cursor, output.time_of_flight_nanoseconds) || !read_vec(values, cursor, output.departure_position)
      || !read_vec(values, cursor, output.arrival_position) || !read_u16(values, cursor, output.motion_sense)
      || !read_u16(values, cursor, output.path) || !read_u16(values, cursor, output.revolutions)
      || !read_vec(values, cursor, output.reference_normal) || !read_double(values, cursor, output.relative_time_of_flight_tolerance)
      || !read_double(values, cursor, output.velocity_tolerance) || !read_u32(values, cursor, output.max_iterations)
      || !read_double(values, cursor, output.minimum_geometry_scale)) return false;
  std::uint32_t provenance = 0;
  if (!read_u32(values, cursor, provenance) || !read_u32(values, cursor, output.provenance_high) || !read_u32(values, cursor, output.provenance_low)) return false;
  output.provenance_present = provenance != 0;
  return cursor == values.size();
}

bool encode_packet(const GeometryWire& input, std::span<double> values) noexcept {
  if (values.size() != kOutputWords) return false;
  values[0] = static_cast<std::uint16_t>(input.result_code);
  values[1] = input.iterations;
  values[2] = input.residual;
  values[3] = input.transfer_departure_velocity.x;
  values[4] = input.transfer_departure_velocity.y;
  values[5] = input.transfer_departure_velocity.z;
  values[6] = input.transfer_arrival_velocity.x;
  values[7] = input.transfer_arrival_velocity.y;
  values[8] = input.transfer_arrival_velocity.z;
  values[9] = input.periapsis_present ? 1.0 : 0.0;
  values[10] = input.periapsis_radius;
  values[11] = input.semi_major_axis;
  values[12] = input.eccentricity;
  return true;
}

GeometryWire evaluate(GeometryWire input) noexcept {
  input.result_code = ResultCode::invalid_input;
  input.iterations = 0;
  input.residual = 0.0;
  input.transfer_departure_velocity = {};
  input.transfer_arrival_velocity = {};
  input.periapsis_present = false;
  input.periapsis_radius = 0.0;
  input.semi_major_axis = 0.0;
  input.eccentricity = 0.0;
  if (!valid_input(input)) {
    if (input.revolutions != 0) input.result_code = ResultCode::unsupported_revolution_count;
    else if (input.motion_sense < 1 || input.motion_sense > 2 || input.path < 1 || input.path > 2) input.result_code = ResultCode::invalid_branch;
    else if (finite(input.mu) && input.mu <= 0.0) input.result_code = ResultCode::invalid_mu;
    return input;
  }

  const double r1_unscaled = norm(input.departure_position);
  const double r2_unscaled = norm(input.arrival_position);
  const double normal_norm = norm(input.reference_normal);
  const auto cross_unscaled = cross(input.departure_position, input.arrival_position);
  const double cross_norm = norm(cross_unscaled);
  if (!(r1_unscaled > 0.0) || !(r2_unscaled > 0.0) || !(normal_norm > 0.0)
      || cross_norm <= kGeometryTolerance * r1_unscaled * r2_unscaled
      || std::abs(dot(cross_unscaled, input.reference_normal)) <= kGeometryTolerance * cross_norm * normal_norm) {
    input.result_code = ResultCode::degenerate_geometry;
    return input;
  }

  const double scale = std::max({input.minimum_geometry_scale, r1_unscaled, r2_unscaled});
  const frame::Vec3 r1_vector = multiply(input.departure_position, 1.0 / scale);
  const frame::Vec3 r2_vector = multiply(input.arrival_position, 1.0 / scale);
  const double r1 = norm(r1_vector);
  const double r2 = norm(r2_vector);
  const double cosine = std::clamp(dot(r1_vector, r2_vector) / (r1 * r2), -1.0, 1.0);
  const double sine_magnitude = cross_norm / (r1_unscaled * r2_unscaled);
  const double orientation = dot(cross_unscaled, input.reference_normal);
  int direction = orientation > 0.0 ? 1 : -1;
  if (input.motion_sense == 2) direction = -direction;
  if (input.path == 2) direction = -direction;
  const double sine = sine_magnitude * static_cast<double>(direction);
  const double denominator = 1.0 - cosine;
  if (!(denominator > kGeometryTolerance) || !finite(sine)) {
    input.result_code = ResultCode::degenerate_geometry;
    return input;
  }
  const double a = sine * std::sqrt(r1 * r2 / denominator);
  const double time_scale = std::sqrt(scale * scale * scale / input.mu);
  const double time_of_flight = (input.time_of_flight_seconds + static_cast<double>(input.time_of_flight_nanoseconds) / 1e9) / time_scale;
  if (!finite(a) || !finite(time_of_flight) || time_of_flight <= 0.0) {
    input.result_code = ResultCode::numerical_failure;
    return input;
  }

  double z = 0.0;
  double y = 0.0;
  double residual = 0.0;
  std::uint32_t iterations = 0;
  if (!solve_z(r1, r2, a, time_of_flight, input.relative_time_of_flight_tolerance, input.max_iterations, z, y, residual, iterations)) {
    input.result_code = ResultCode::non_convergent;
    input.iterations = iterations;
    input.residual = residual;
    return input;
  }
  const double f = 1.0 - y / r1;
  const double g = a * std::sqrt(y);
  const double g_dot = 1.0 - y / r2;
  if (!finite(f) || !finite(g) || !finite(g_dot) || std::abs(g) <= std::numeric_limits<double>::epsilon()) {
    input.result_code = ResultCode::numerical_failure;
    return input;
  }
  const frame::Vec3 velocity1_normalized = multiply(subtract(r2_vector, multiply(r1_vector, f)), 1.0 / g);
  const frame::Vec3 velocity2_normalized = multiply(subtract(multiply(r2_vector, g_dot), r1_vector), 1.0 / g);
  const double velocity_scale = std::sqrt(input.mu / scale);
  const frame::Vec3 velocity1 = multiply(velocity1_normalized, velocity_scale);
  const frame::Vec3 velocity2 = multiply(velocity2_normalized, velocity_scale);
  if (!finite_vec(velocity1) || !finite_vec(velocity2)) {
    input.result_code = ResultCode::numerical_failure;
    return input;
  }

  const auto angular_momentum = cross(input.departure_position, velocity1);
  const double h2 = dot(angular_momentum, angular_momentum);
  const double speed2 = dot(velocity1, velocity1);
  const double specific_energy = speed2 * 0.5 - input.mu / r1_unscaled;
  const double semi_major_axis = std::abs(specific_energy) > std::numeric_limits<double>::epsilon() ? -input.mu / (2.0 * specific_energy) : std::numeric_limits<double>::infinity();
  const auto eccentricity_vector = subtract(multiply(cross(velocity1, angular_momentum), 1.0 / input.mu), multiply(input.departure_position, 1.0 / r1_unscaled));
  const double eccentricity = norm(eccentricity_vector);
  const double periapsis = h2 > 0.0 && finite(eccentricity) ? h2 / (input.mu * (1.0 + eccentricity)) : 0.0;
  if (!finite(eccentricity) || !finite(periapsis)) {
    input.result_code = ResultCode::numerical_failure;
    return input;
  }
  input.result_code = ResultCode::success;
  input.iterations = iterations;
  input.residual = residual;
  input.transfer_departure_velocity = velocity1;
  input.transfer_arrival_velocity = velocity2;
  input.periapsis_present = finite(periapsis) && periapsis > 0.0;
  input.periapsis_radius = input.periapsis_present ? periapsis : 0.0;
  input.semi_major_axis = finite(semi_major_axis) ? semi_major_axis : 0.0;
  input.eccentricity = eccentricity;
  return input;
}

}  // namespace orbit_engine::lambert
