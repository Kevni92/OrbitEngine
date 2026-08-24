#include "orbit_engine/lambert.hpp"

#include <cassert>
#include <cmath>
#include <vector>

namespace {

orbit_engine::lambert::GeometryWire case_input(std::uint16_t motion_sense, std::uint16_t path) {
  orbit_engine::lambert::GeometryWire value;
  value.central_body_low = 1;
  value.planning_frame_low = 1;
  value.mu = 3.986004418e14;
  value.time_of_flight_seconds = 2914.0;
  value.departure_position = {7'000'000.0, 0.0, 0.0};
  value.arrival_position = {0.0, 7'000'000.0, 0.0};
  value.motion_sense = motion_sense;
  value.path = path;
  value.revolutions = 0;
  value.reference_normal = {0.0, 0.0, 1.0};
  value.relative_time_of_flight_tolerance = 1e-12;
  value.velocity_tolerance = 1e-9;
  value.max_iterations = 64;
  value.minimum_geometry_scale = 1.0;
  return value;
}

orbit_engine::lambert::GeometryWire published_hyperbolic_case() {
  // MathWorks Lambert universal-variable example, long-time/short-way case:
  // https://nl.mathworks.com/matlabcentral/fileexchange/44789
  orbit_engine::lambert::GeometryWire value;
  value.central_body_low = 1;
  value.planning_frame_low = 1;
  value.mu = 398'600.44e9;
  value.time_of_flight_seconds = 600.0;
  value.departure_position = {-1'461'900.0, 2'444'200.0, 6'524'200.0};
  value.arrival_position = {-1'043'500.0, 5'847'900.0, 3'774'100.0};
  value.motion_sense = 1;
  value.path = 1;
  value.revolutions = 0;
  value.reference_normal = {0.0, 0.0, 1.0};
  value.relative_time_of_flight_tolerance = 1e-12;
  value.velocity_tolerance = 1e-9;
  value.max_iterations = 64;
  value.minimum_geometry_scale = 1.0;
  return value;
}

double angular_momentum_z(const orbit_engine::lambert::GeometryWire& value) {
  return value.departure_position.x * value.transfer_departure_velocity.y
    - value.departure_position.y * value.transfer_departure_velocity.x;
}

}  // namespace

int main() {
  const auto prograde_short = orbit_engine::lambert::evaluate(case_input(1, 1));
  assert(prograde_short.result_code == orbit_engine::lambert::ResultCode::success);
  assert(prograde_short.iterations > 0 && prograde_short.iterations <= 64);
  assert(prograde_short.residual <= 1e-12);
  assert(std::abs(prograde_short.transfer_departure_velocity.x - 3925.4284705) < 1e-5);
  assert(std::abs(prograde_short.transfer_departure_velocity.y - 5834.4113522) < 1e-5);
  assert(prograde_short.periapsis_present && prograde_short.periapsis_radius > 0.0);
  assert(prograde_short.eccentricity >= 0.0);

  const auto retrograde_short = orbit_engine::lambert::evaluate(case_input(2, 1));
  const auto prograde_long = orbit_engine::lambert::evaluate(case_input(1, 2));
  assert(retrograde_short.result_code == orbit_engine::lambert::ResultCode::success);
  assert(prograde_long.result_code == orbit_engine::lambert::ResultCode::success);
  assert(angular_momentum_z(prograde_short) > 0.0);
  assert(angular_momentum_z(retrograde_short) < 0.0);
  assert(angular_momentum_z(prograde_long) < 0.0);

  const auto hyperbolic = orbit_engine::lambert::evaluate(published_hyperbolic_case());
  assert(hyperbolic.result_code == orbit_engine::lambert::ResultCode::success);
  assert(hyperbolic.residual <= 1e-12);
  assert(hyperbolic.semi_major_axis < 0.0);
  assert(hyperbolic.eccentricity > 1.0);

  auto unsupported = case_input(1, 1);
  unsupported.revolutions = 1;
  assert(orbit_engine::lambert::evaluate(unsupported).result_code == orbit_engine::lambert::ResultCode::unsupported_revolution_count);

  auto degenerate = case_input(1, 1);
  degenerate.arrival_position = {14'000'000.0, 0.0, 0.0};
  assert(orbit_engine::lambert::evaluate(degenerate).result_code == orbit_engine::lambert::ResultCode::degenerate_geometry);

  auto non_convergent = case_input(1, 1);
  non_convergent.max_iterations = 1;
  assert(orbit_engine::lambert::evaluate(non_convergent).result_code == orbit_engine::lambert::ResultCode::non_convergent);

  const auto input = case_input(1, 1);
  std::vector<double> packet(orbit_engine::lambert::kInputWords);
  std::size_t cursor = 0;
  packet[cursor++] = input.central_body_high; packet[cursor++] = input.central_body_low;
  packet[cursor++] = input.planning_frame_high; packet[cursor++] = input.planning_frame_low;
  packet[cursor++] = input.mu; packet[cursor++] = input.time_of_flight_seconds; packet[cursor++] = input.time_of_flight_nanoseconds;
  packet[cursor++] = input.departure_position.x; packet[cursor++] = input.departure_position.y; packet[cursor++] = input.departure_position.z;
  packet[cursor++] = input.arrival_position.x; packet[cursor++] = input.arrival_position.y; packet[cursor++] = input.arrival_position.z;
  packet[cursor++] = input.motion_sense; packet[cursor++] = input.path; packet[cursor++] = input.revolutions;
  packet[cursor++] = input.reference_normal.x; packet[cursor++] = input.reference_normal.y; packet[cursor++] = input.reference_normal.z;
  packet[cursor++] = input.relative_time_of_flight_tolerance; packet[cursor++] = input.velocity_tolerance;
  packet[cursor++] = input.max_iterations; packet[cursor++] = input.minimum_geometry_scale;
  packet[cursor++] = input.provenance_present ? 1.0 : 0.0; packet[cursor++] = input.provenance_high; packet[cursor++] = input.provenance_low;
  orbit_engine::lambert::GeometryWire decoded;
  assert(orbit_engine::lambert::decode_packet(packet, decoded));
  std::vector<double> output(orbit_engine::lambert::kOutputWords);
  assert(orbit_engine::lambert::encode_packet(prograde_short, output));
  assert(output[0] == 0.0 && std::isfinite(output[2]));
}
