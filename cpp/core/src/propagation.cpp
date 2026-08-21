#include "orbit_engine/propagation.hpp"

#include "orbit_engine/object.hpp"

#include <cmath>

namespace orbit_engine::propagation {

bool is_valid(PropagationWire value) noexcept {
  if (!object::is_valid(object::object_id_from_wire({value.object_id_high, value.object_id_low}))) {
    return false;
  }
  if (value.model_kind_code < 1 || value.model_kind_code > 4
      || value.direction_code < 1 || value.direction_code > 3
      || value.bounded_direction_code > 2) {
    return false;
  }
  if (value.direction_code != 3 && value.bounded_direction_code != 0) {
    return false;
  }
  if (value.direction_code == 3 && value.bounded_direction_code == 0) {
    return false;
  }
  if ((value.propagation_frame_high == 0 && value.propagation_frame_low == 0)
      || (value.result_frame_high == 0 && value.result_frame_low == 0)) {
    return false;
  }
  const auto start = time::from_wire(value.segment_start);
  const auto end = time::from_wire(value.segment_end);
  const auto target = time::from_wire(value.target);
  if (!start.has_value() || !end.has_value() || !target.has_value()) {
    return false;
  }
  if (value.segment_end_present && time::compare(*start, *end) >= 0) {
    return false;
  }
  if (value.outcome_code > 2) {
    return false;
  }
  if (!std::isfinite(value.position_x) || !std::isfinite(value.position_y)
      || !std::isfinite(value.position_z) || !std::isfinite(value.velocity_x)
      || !std::isfinite(value.velocity_y) || !std::isfinite(value.velocity_z)
      || !std::isfinite(value.position_absolute_meters) || !std::isfinite(value.position_relative)
      || !std::isfinite(value.velocity_absolute_meters_per_second)
      || !std::isfinite(value.velocity_relative)) {
    return false;
  }
  return value.position_absolute_meters >= 0.0
    && value.position_relative >= 0.0
    && value.velocity_absolute_meters_per_second >= 0.0
    && value.velocity_relative >= 0.0;
}

bool round_trip(PropagationWire input, PropagationWire& output) noexcept {
  if (!is_valid(input)) {
    return false;
  }
  output = input;
  return true;
}

}  // namespace orbit_engine::propagation
