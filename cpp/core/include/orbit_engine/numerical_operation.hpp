#pragma once

#include "orbit_engine/time.hpp"

#include <cstdint>

namespace orbit_engine::numerical_operation {

enum class ResultCode : std::uint16_t {
  success = 0,
  invalid_input = 1,
  unsupported_temporal_direction = 2,
  invalid_configuration = 3,
  numerical_failure = 4,
  invalid_mass = 5,
  step_underflow = 6,
  accepted_step_budget = 7,
  rejected_step_budget = 8,
};

struct NumericalWire {
  std::uint16_t result_code = 0;
  std::uint32_t object_id_high = 0;
  std::uint32_t object_id_low = 0;
  std::uint32_t propagation_frame_high = 0;
  std::uint32_t propagation_frame_low = 0;
  std::uint32_t frame_revision_high = 0;
  std::uint32_t frame_revision_low = 0;
  time::TimeWire anchor_epoch{};
  time::TimeWire target_epoch{};
  double anchor_position_x = 0.0;
  double anchor_position_y = 0.0;
  double anchor_position_z = 0.0;
  double anchor_velocity_x = 0.0;
  double anchor_velocity_y = 0.0;
  double anchor_velocity_z = 0.0;
  bool mass_present = false;
  double mass = 0.0;
  double constant_acceleration_x = 0.0;
  double constant_acceleration_y = 0.0;
  double constant_acceleration_z = 0.0;
  bool source_present = false;
  std::uint32_t source_id_high = 0;
  std::uint32_t source_id_low = 0;
  std::uint32_t source_revision_high = 0;
  std::uint32_t source_revision_low = 0;
  double source_position_x = 0.0;
  double source_position_y = 0.0;
  double source_position_z = 0.0;
  bool source_mu_present = false;
  double source_mu = 0.0;
  bool source_mass_present = false;
  double source_mass = 0.0;
  double relative_tolerance = 0.0;
  double position_absolute_tolerance_meters = 0.0;
  double velocity_absolute_tolerance_meters_per_second = 0.0;
  double mass_absolute_tolerance_kilograms = 0.0;
  std::uint32_t checkpoint_stride_accepted_steps = 0;
  std::uint32_t max_checkpoint_count = 0;
  std::uint32_t max_dense_step_count = 0;
  std::uint32_t max_accepted_steps_per_extension = 0;
  std::uint32_t max_rejected_steps_per_extension = 0;
  time::TimeWire min_step{};
  time::TimeWire max_step{};
  std::uint32_t configuration_revision_high = 0;
  std::uint32_t configuration_revision_low = 0;
  std::uint32_t motion_revision_high = 0;
  std::uint32_t motion_revision_low = 0;
  time::TimeWire result_epoch{};
  double result_position_x = 0.0;
  double result_position_y = 0.0;
  double result_position_z = 0.0;
  double result_velocity_x = 0.0;
  double result_velocity_y = 0.0;
  double result_velocity_z = 0.0;
  bool result_mass_present = false;
  double result_mass = 0.0;
};

[[nodiscard]] bool is_valid_input(NumericalWire value) noexcept;
[[nodiscard]] NumericalWire evaluate(NumericalWire input);

}  // namespace orbit_engine::numerical_operation
