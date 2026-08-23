#include "orbit_engine/numerical_operation.hpp"

#include <cmath>
#include <iostream>

#define CHECK(condition) do { if (!(condition)) { std::cerr << "CHECK failed: " << #condition << " at line " << __LINE__ << "\n"; return 1; } } while (false)

namespace {

orbit_engine::numerical_operation::NumericalWire fixture() {
  using namespace orbit_engine;
  numerical_operation::NumericalWire value;
  value.object_id_low = 42;
  value.propagation_frame_low = 1;
  value.anchor_epoch = time::TimeWire{0, 0, 0};
  value.target_epoch = time::TimeWire{0, 2, 0};
  value.anchor_position_x = 1.0;
  value.anchor_velocity_x = 3.0;
  value.mass_present = true;
  value.mass = 4.0;
  value.constant_acceleration_x = 2.0;
  value.relative_tolerance = 1e-12;
  value.position_absolute_tolerance_meters = 1e-12;
  value.velocity_absolute_tolerance_meters_per_second = 1e-12;
  value.mass_absolute_tolerance_kilograms = 1e-9;
  value.checkpoint_stride_accepted_steps = 32;
  value.max_checkpoint_count = 64;
  value.max_dense_step_count = 256;
  value.max_accepted_steps_per_extension = 100'000;
  value.max_rejected_steps_per_extension = 10'000;
  value.min_step = time::TimeWire{0, 0, 1};
  value.max_step = time::TimeWire{0, 1, 0};
  value.configuration_revision_low = 1;
  value.motion_revision_low = 2;
  value.result_epoch = value.target_epoch;
  value.result_mass_present = true;
  value.result_mass = value.mass;
  return value;
}

int evaluates_through_portable_core() {
  const auto result = orbit_engine::numerical_operation::evaluate(fixture());
  CHECK(result.result_code == static_cast<std::uint16_t>(orbit_engine::numerical_operation::ResultCode::success));
  CHECK(result.result_epoch.seconds_low == 2);
  CHECK(std::abs(result.result_position_x - 11.0) < 1e-8);
  CHECK(std::abs(result.result_velocity_x - 7.0) < 1e-9);
  CHECK(result.result_mass_present);
  CHECK(result.result_mass == 4.0);
  return 0;
}

int rejects_backward_query() {
  auto value = fixture();
  value.target_epoch = orbit_engine::time::TimeWire{0, 0, 0};
  value.anchor_epoch = orbit_engine::time::TimeWire{0, 1, 0};
  const auto result = orbit_engine::numerical_operation::evaluate(value);
  CHECK(result.result_code == static_cast<std::uint16_t>(orbit_engine::numerical_operation::ResultCode::unsupported_temporal_direction));
  return 0;
}

}  // namespace

int main() {
  if (evaluates_through_portable_core() != 0) return 1;
  if (rejects_backward_query() != 0) return 1;
  return 0;
}
