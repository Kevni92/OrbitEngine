#pragma once

#include "orbit_engine/time.hpp"

#include <cstdint>

namespace orbit_engine::propagation {

struct PropagationWire {
  std::uint32_t object_id_high;
  std::uint32_t object_id_low;
  std::uint16_t model_kind_code;
  std::uint16_t direction_code;
  std::uint16_t bounded_direction_code;
  std::uint32_t propagation_frame_high;
  std::uint32_t propagation_frame_low;
  std::uint32_t configuration_revision_high;
  std::uint32_t configuration_revision_low;
  std::uint32_t motion_revision_high;
  std::uint32_t motion_revision_low;
  time::TimeWire segment_start;
  bool segment_end_present;
  time::TimeWire segment_end;
  time::TimeWire target;
  std::uint16_t outcome_code;
  std::uint32_t result_frame_high;
  std::uint32_t result_frame_low;
  double position_x;
  double position_y;
  double position_z;
  double velocity_x;
  double velocity_y;
  double velocity_z;
  double position_absolute_meters;
  double position_relative;
  double velocity_absolute_meters_per_second;
  double velocity_relative;
};

[[nodiscard]] bool is_valid(PropagationWire value) noexcept;
[[nodiscard]] bool round_trip(PropagationWire input, PropagationWire& output) noexcept;

}  // namespace orbit_engine::propagation
