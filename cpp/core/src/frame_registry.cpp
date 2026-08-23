#include "orbit_engine/frame_registry.hpp"

#include "orbit_engine/object.hpp"

namespace orbit_engine::frame_registry {
namespace {

frame::ReferenceFrameId frame_id(FrameRegistryWire value) noexcept {
  return frame::reference_frame_id_from_wire({value.frame_id_high, value.frame_id_low});
}

frame::ReferenceFrameId parent_id(FrameRegistryWire value) noexcept {
  return frame::reference_frame_id_from_wire({value.parent_high, value.parent_low});
}

bool valid_dependency(FrameRegistryWire value) noexcept {
  if (!value.dependency_present) {
    return value.dependency_high == 0 && value.dependency_low == 0;
  }
  return object::is_valid(object::object_id_from_wire({value.dependency_high, value.dependency_low}));
}

}  // namespace

bool is_valid_input(FrameRegistryWire value) noexcept {
  if (value.operation_code > static_cast<std::uint16_t>(Operation::remove_frame)) return false;
  if (value.operation_code == static_cast<std::uint16_t>(Operation::reset)) return true;
  if (!frame::is_valid(frame_id(value))) return false;
  if (value.operation_code == static_cast<std::uint16_t>(Operation::lookup)
      || value.operation_code == static_cast<std::uint16_t>(Operation::remove_frame)) {
    return true;
  }
  if (value.parent_present && !frame::is_valid(parent_id(value))) return false;
  if (value.provider_code < static_cast<std::uint16_t>(ProviderCode::static_rigid)
      || value.provider_code > static_cast<std::uint16_t>(ProviderCode::ephemeris_source_centered)) {
    return false;
  }
  if (!valid_dependency(value)) return false;
  return frame::is_valid(value.transform)
    && frame::reference_frame_id_from_wire({
      value.transform.reference_frame_id_high,
      value.transform.reference_frame_id_low,
    }) == frame_id(value);
}

Registry::Registry() noexcept = default;

FrameRegistryWire Registry::result(FrameRegistryWire input, ResultCode code) const noexcept {
  input.result_code = static_cast<std::uint16_t>(code);
  return input;
}

FrameRegistryWire Registry::record_result(const Record& record) const noexcept {
  auto output = record.value;
  output.operation_code = static_cast<std::uint16_t>(Operation::lookup);
  output.result_code = static_cast<std::uint16_t>(ResultCode::success);
  return output;
}

FrameRegistryWire Registry::command(FrameRegistryWire input) noexcept {
  if (!is_valid_input(input)) return result(input, ResultCode::invalid_input);
  const auto operation = static_cast<Operation>(input.operation_code);
  if (operation == Operation::reset) {
    live_.clear();
    retired_.clear();
    const auto root = frame::reference_frame_id_to_wire(frame::kRootReferenceFrameId);
    const auto rootTransform = frame::FrameWire{
      root.high,
      root.low,
      time::TimeWire{0, 0, 0},
      0.0,
      0.0,
      0.0,
      0.0,
      0.0,
      0.0,
      1.0,
      0.0,
      0.0,
      0.0,
      0.0,
      0.0,
      0.0,
    };
    live_.emplace(
      frame::kRootReferenceFrameId,
      Record{FrameRegistryWire{
        static_cast<std::uint16_t>(Operation::lookup),
        static_cast<std::uint16_t>(ResultCode::success),
        root.high,
        root.low,
        false,
        0,
        0,
        static_cast<std::uint16_t>(ProviderCode::root),
        false,
        0,
        0,
        rootTransform,
      }}
    );
    return result(input, ResultCode::success);
  }

  const auto id = frame_id(input);
  const auto existing = live_.find(id);
  if (operation == Operation::register_frame) {
    if (id == frame::kRootReferenceFrameId) return result(input, ResultCode::duplicate_live_id);
    if (existing != live_.end()) return result(input, ResultCode::duplicate_live_id);
    if (retired_.contains(id)) return result(input, ResultCode::retired_id);
    if (!input.parent_present) return result(input, ResultCode::missing_parent);
    const auto parent = parent_id(input);
    if (!live_.contains(parent)) return result(input, ResultCode::missing_parent);
    live_.emplace(id, Record{input});
    return record_result(live_.find(id)->second);
  }
  if (operation == Operation::lookup) {
    if (existing == live_.end()) return result(input, retired_.contains(id) ? ResultCode::retired_id : ResultCode::not_live);
    return record_result(existing->second);
  }
  if (id == frame::kRootReferenceFrameId) return result(input, ResultCode::root_protected);
  if (existing == live_.end()) return result(input, retired_.contains(id) ? ResultCode::retired_id : ResultCode::not_live);
  for (const auto& entry : live_) {
    if (entry.second.value.parent_present && parent_id(entry.second.value) == id) {
      return result(input, ResultCode::blocked_removal);
    }
  }
  live_.erase(existing);
  retired_.insert(id);
  return result(input, ResultCode::success);
}

}  // namespace orbit_engine::frame_registry