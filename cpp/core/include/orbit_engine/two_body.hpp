#pragma once

#include "orbit_engine/frame.hpp"
#include "orbit_engine/object.hpp"

#include <cstdint>

namespace orbit_engine::two_body {

enum class ResultCode : std::uint16_t {
  success = 0,
  invalid_input = 1,
  invalid_mu = 2,
  numerical_failure = 3,
};

struct TwoBodyWire {
  std::uint16_t result_code;
  std::uint32_t central_object_id_high;
  std::uint32_t central_object_id_low;
  double mu;
  std::uint32_t anchor_frame_high;
  std::uint32_t anchor_frame_low;
  time::TimeWire anchor_epoch;
  double anchor_position_x;
  double anchor_position_y;
  double anchor_position_z;
  double anchor_velocity_x;
  double anchor_velocity_y;
  double anchor_velocity_z;
  time::TimeWire target_epoch;
  std::uint32_t result_frame_high;
  std::uint32_t result_frame_low;
  time::TimeWire result_epoch;
  double result_position_x;
  double result_position_y;
  double result_position_z;
  double result_velocity_x;
  double result_velocity_y;
  double result_velocity_z;
};

[[nodiscard]] bool is_valid_input(TwoBodyWire value) noexcept;
[[nodiscard]] TwoBodyWire evaluate(TwoBodyWire input) noexcept;

}  // namespace orbit_engine::two_body
