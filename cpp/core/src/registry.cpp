#include "orbit_engine/registry.hpp"

#include "orbit_engine/frame.hpp"

#include <cmath>

namespace orbit_engine::registry {
namespace {

bool valid_time(time::TimeWire value) noexcept {
  return time::from_wire(value).has_value();
}

bool valid_frame(std::uint32_t high, std::uint32_t low) noexcept {
  return frame::is_valid(frame::reference_frame_id_from_wire({high, low}));
}

bool valid_state(RegistryWire value) noexcept {
  return value.state_present
    && valid_time(value.state_epoch)
    && valid_frame(value.state_frame_high, value.state_frame_low)
    && std::isfinite(value.position_x) && std::isfinite(value.position_y) && std::isfinite(value.position_z)
    && std::isfinite(value.velocity_x) && std::isfinite(value.velocity_y) && std::isfinite(value.velocity_z);
}

bool valid_motion(RegistryWire value) noexcept {
  const auto state = time::from_wire(value.state_epoch);
  const auto start = time::from_wire(value.segment_start);
  const auto end = time::from_wire(value.segment_end);
  if (!state.has_value() || !start.has_value() || !end.has_value()) return false;
  if (value.model_kind_code < 1 || value.model_kind_code > 4
      || value.direction_code < 1 || value.direction_code > 3
      || !valid_frame(value.state_frame_high, value.state_frame_low)
      || value.reference_status_code > 2) {
    return false;
  }
  if (time::compare(*state, *start) < 0) return false;
  return !value.segment_end_present || (
    time::compare(*start, *end) < 0 && time::compare(*state, *end) < 0
  );
}

bool valid_structural_parent(RegistryWire value) noexcept {
  if (!value.structural_parent_present) {
    return value.structural_parent_high == 0 && value.structural_parent_low == 0;
  }
  const auto parent = object::object_id_from_wire({
    value.structural_parent_high,
    value.structural_parent_low,
  });
  const auto child = object::object_id_from_wire({value.object_id_high, value.object_id_low});
  return object::is_valid(parent)
    && parent != child;
}

object::ObjectId object_id(RegistryWire value) noexcept {
  return object::object_id_from_wire({value.object_id_high, value.object_id_low});
}

std::uint64_t revision_from_wire(RegistryWire value) noexcept {
  return (static_cast<std::uint64_t>(value.property_revision_high) << 32U) | value.property_revision_low;
}

}  // namespace

bool is_valid_input(RegistryWire value) noexcept {
  if (value.operation_code > static_cast<std::uint16_t>(Operation::replace_motion)) {
    return false;
  }
  if (value.operation_code == static_cast<std::uint16_t>(Operation::reset)) {
    return true;
  }
  if (value.operation_code == static_cast<std::uint16_t>(Operation::advance_clock)) {
    return valid_time(value.effective_epoch);
  }
  if (!object::is_valid(object_id(value))) {
    return false;
  }
  if (value.operation_code == static_cast<std::uint16_t>(Operation::lookup)
      || value.operation_code == static_cast<std::uint16_t>(Operation::remove_object)) {
    return true;
  }
  if (!object::is_valid_object_type_code(value.object_type_code)
      || !object::is_valid(value.properties)
      || !valid_time(value.effective_epoch)) {
    return false;
  }
  if (value.operation_code == static_cast<std::uint16_t>(Operation::update_properties)) {
    return true;
  }
  return valid_state(value) && valid_motion(value) && valid_structural_parent(value);
}

Registry::Registry() noexcept = default;

RegistryWire Registry::result(RegistryWire input, ResultCode code) const noexcept {
  input.result_code = static_cast<std::uint16_t>(code);
  return input;
}

RegistryWire Registry::record_result(const Record& record) const noexcept {
  auto output = record.value;
  output.operation_code = static_cast<std::uint16_t>(Operation::lookup);
  output.result_code = static_cast<std::uint16_t>(ResultCode::success);
  const auto revisionHigh = static_cast<std::uint32_t>(record.property_revision >> 32U);
  const auto revisionLow = static_cast<std::uint32_t>(record.property_revision);
  output.property_revision_high = revisionHigh;
  output.property_revision_low = revisionLow;
  return output;
}

RegistryWire Registry::command(RegistryWire input) noexcept {
  if (!is_valid_input(input)) {
    return result(input, ResultCode::invalid_input);
  }
  const auto operation = static_cast<Operation>(input.operation_code);
  if (operation == Operation::reset) {
    live_.clear();
    retired_.clear();
    current_time_ = time::SimulationInstant{0, 0};
    return result(input, ResultCode::success);
  }
  if (operation == Operation::advance_clock) {
    const auto target = time::from_wire(input.effective_epoch);
    if (!target.has_value() || time::compare(*target, current_time_) < 0) {
      return result(input, ResultCode::retroactive_change);
    }
    current_time_ = *target;
    input.effective_epoch = time::to_wire(current_time_);
    return result(input, ResultCode::success);
  }

  const auto id = object_id(input);
  const auto live = live_.find(id);
  if (operation == Operation::register_object) {
    if (live != live_.end()) return result(input, ResultCode::duplicate_live_id);
    if (retired_.contains(id)) return result(input, ResultCode::retired_id);
    if (input.structural_parent_present) {
      const auto parent = object::object_id_from_wire({
        input.structural_parent_high,
        input.structural_parent_low,
      });
      if (!live_.contains(parent)) return result(input, ResultCode::invalid_input);
    }
    if (input.reference_status_code == 0) {
      input.reference_status_code = input.model_kind_code == 1 ? 1 : 0;
    }
    const auto propertyRevision = std::uint64_t{1};
    live_.emplace(id, Record{input, propertyRevision});
    return record_result(live_.find(id)->second);
  }
  if (operation == Operation::lookup) {
    if (live != live_.end()) return record_result(live->second);
    return result(input, retired_.contains(id) ? ResultCode::retired_id : ResultCode::not_live);
  }
  if (operation == Operation::remove_object) {
    if (live == live_.end()) return result(input, retired_.contains(id) ? ResultCode::retired_id : ResultCode::not_live);
    for (const auto& entry : live_) {
      if (entry.first != id && entry.second.value.structural_parent_present
          && object::object_id_from_wire({
            entry.second.value.structural_parent_high,
            entry.second.value.structural_parent_low,
          }) == id) {
        return result(input, ResultCode::blocked_removal);
      }
    }
    live_.erase(live);
    retired_.insert(id);
    return result(input, ResultCode::success);
  }
  if (live == live_.end()) return result(input, retired_.contains(id) ? ResultCode::retired_id : ResultCode::not_live);
  auto& record = live->second;
  const auto effective = time::from_wire(input.effective_epoch);
  if (!effective.has_value() || time::compare(*effective, current_time_) < 0) {
    return result(input, ResultCode::retroactive_change);
  }
  if (operation == Operation::update_properties) {
    record.value.properties = input.properties;
    record.property_revision += 1;
    record.value.effective_epoch = input.effective_epoch;
    return record_result(record);
  }
  if (operation == Operation::replace_motion) {
    const auto inputEpoch = time::from_wire(input.state_epoch);
    const auto inputStart = time::from_wire(input.segment_start);
    if (!inputEpoch.has_value() || !inputStart.has_value()
        || time::compare(*inputEpoch, *effective) != 0
        || time::compare(*inputStart, *effective) != 0) {
      return result(input, ResultCode::invalid_transition);
    }
    if (record.value.reference_status_code == 2 && input.reference_status_code != 2) {
      return result(input, ResultCode::invalid_transition);
    }
    if (input.reference_status_code == 1 && input.model_kind_code != 1) {
      return result(input, ResultCode::invalid_transition);
    }
    if (record.value.reference_status_code == 1 && input.model_kind_code != 1
        && input.reference_status_code != 2) {
      return result(input, ResultCode::invalid_transition);
    }
    record.value.state_present = input.state_present;
    record.value.state_epoch = input.state_epoch;
    record.value.state_frame_high = input.state_frame_high;
    record.value.state_frame_low = input.state_frame_low;
    record.value.position_x = input.position_x;
    record.value.position_y = input.position_y;
    record.value.position_z = input.position_z;
    record.value.velocity_x = input.velocity_x;
    record.value.velocity_y = input.velocity_y;
    record.value.velocity_z = input.velocity_z;
    record.value.model_kind_code = input.model_kind_code;
    record.value.direction_code = input.direction_code;
    record.value.segment_start = input.segment_start;
    record.value.segment_end_present = input.segment_end_present;
    record.value.segment_end = input.segment_end;
    record.value.configuration_revision_high = input.configuration_revision_high;
    record.value.configuration_revision_low = input.configuration_revision_low;
    record.value.motion_revision_high = input.motion_revision_high;
    record.value.motion_revision_low = input.motion_revision_low;
    record.value.reference_status_code = input.reference_status_code;
    record.value.effective_epoch = input.effective_epoch;
    record.value.properties = input.properties;
    record.property_revision = revision_from_wire(input);
    return record_result(record);
  }
  if (operation == Operation::diverge) {
    const auto inputEpoch = time::from_wire(input.state_epoch);
    if (record.value.reference_status_code != 1 || input.model_kind_code == 1
        || !inputEpoch.has_value()
        || time::compare(*inputEpoch, *effective) != 0
        || time::compare(*time::from_wire(input.segment_start), *effective) != 0) {
      return result(input, ResultCode::invalid_transition);
    }
    record.value.state_present = input.state_present;
    record.value.state_epoch = input.state_epoch;
    record.value.state_frame_high = input.state_frame_high;
    record.value.state_frame_low = input.state_frame_low;
    record.value.position_x = input.position_x;
    record.value.position_y = input.position_y;
    record.value.position_z = input.position_z;
    record.value.velocity_x = input.velocity_x;
    record.value.velocity_y = input.velocity_y;
    record.value.velocity_z = input.velocity_z;
    record.value.model_kind_code = input.model_kind_code;
    record.value.direction_code = input.direction_code;
    record.value.segment_start = input.segment_start;
    record.value.segment_end_present = input.segment_end_present;
    record.value.segment_end = input.segment_end;
    record.value.configuration_revision_high = input.configuration_revision_high;
    record.value.configuration_revision_low = input.configuration_revision_low;
    record.value.motion_revision_high = input.motion_revision_high;
    record.value.motion_revision_low = input.motion_revision_low;
    record.value.reference_status_code = 2;
    record.value.effective_epoch = input.effective_epoch;
    return record_result(record);
  }
  return result(input, ResultCode::invalid_input);
}

}  // namespace orbit_engine::registry
