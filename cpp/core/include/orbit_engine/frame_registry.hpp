#pragma once

#include "orbit_engine/frame.hpp"

#include <cstdint>
#include <map>
#include <set>

namespace orbit_engine::frame_registry {

enum class Operation : std::uint16_t {
  reset = 0,
  register_frame = 1,
  lookup = 2,
  remove_frame = 3,
};

enum class ProviderCode : std::uint16_t {
  root = 0,
  static_rigid = 1,
  object_centered = 2,
  body_fixed = 3,
  static_local = 4,
  object_attached = 5,
};

enum class ResultCode : std::uint16_t {
  success = 0,
  invalid_input = 1,
  duplicate_live_id = 2,
  retired_id = 3,
  not_live = 4,
  blocked_removal = 5,
  missing_parent = 6,
  root_protected = 7,
};

struct FrameRegistryWire {
  std::uint16_t operation_code;
  std::uint16_t result_code;
  std::uint32_t frame_id_high;
  std::uint32_t frame_id_low;
  bool parent_present;
  std::uint32_t parent_high;
  std::uint32_t parent_low;
  std::uint16_t provider_code;
  bool dependency_present;
  std::uint32_t dependency_high;
  std::uint32_t dependency_low;
  frame::FrameWire transform;
};

[[nodiscard]] bool is_valid_input(FrameRegistryWire value) noexcept;

class Registry {
public:
  Registry() noexcept;

  [[nodiscard]] FrameRegistryWire command(FrameRegistryWire input) noexcept;

private:
  struct Record {
    FrameRegistryWire value;
  };

  std::map<frame::ReferenceFrameId, Record> live_;
  std::set<frame::ReferenceFrameId> retired_;

  [[nodiscard]] FrameRegistryWire result(FrameRegistryWire input, ResultCode code) const noexcept;
  [[nodiscard]] FrameRegistryWire record_result(const Record& record) const noexcept;
};

}  // namespace orbit_engine::frame_registry
