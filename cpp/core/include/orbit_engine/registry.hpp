#pragma once

#include "orbit_engine/object.hpp"
#include "orbit_engine/propagation.hpp"
#include "orbit_engine/time.hpp"

#include <cstdint>
#include <map>
#include <set>

namespace orbit_engine::registry {

enum class Operation : std::uint16_t {
  reset = 0,
  register_object = 1,
  lookup = 2,
  update_properties = 3,
  remove_object = 4,
  diverge = 5,
  advance_clock = 6,
};

enum class ResultCode : std::uint16_t {
  success = 0,
  invalid_input = 1,
  duplicate_live_id = 2,
  retired_id = 3,
  not_live = 4,
  blocked_removal = 5,
  retroactive_change = 6,
  invalid_transition = 7,
};

struct RegistryWire {
  std::uint16_t operation_code;
  std::uint16_t result_code;
  std::uint32_t object_id_high;
  std::uint32_t object_id_low;
  std::uint16_t object_type_code;
  object::PhysicalProperties properties;
  bool state_present;
  time::TimeWire state_epoch;
  std::uint32_t state_frame_high;
  std::uint32_t state_frame_low;
  double position_x;
  double position_y;
  double position_z;
  double velocity_x;
  double velocity_y;
  double velocity_z;
  std::uint16_t model_kind_code;
  std::uint16_t direction_code;
  time::TimeWire segment_start;
  bool segment_end_present;
  time::TimeWire segment_end;
  std::uint32_t configuration_revision_high;
  std::uint32_t configuration_revision_low;
  std::uint32_t motion_revision_high;
  std::uint32_t motion_revision_low;
  std::uint16_t reference_status_code;
  std::uint32_t property_revision_high;
  std::uint32_t property_revision_low;
  time::TimeWire effective_epoch;
  bool structural_parent_present;
  std::uint32_t structural_parent_high;
  std::uint32_t structural_parent_low;
};

[[nodiscard]] bool is_valid_input(RegistryWire value) noexcept;

class Registry {
public:
  Registry() noexcept;

  [[nodiscard]] RegistryWire command(RegistryWire input) noexcept;

private:
  struct Record {
    RegistryWire value;
    std::uint64_t property_revision;
  };

  std::map<object::ObjectId, Record> live_;
  std::set<object::ObjectId> retired_;
  time::SimulationInstant current_time_{};

  [[nodiscard]] RegistryWire result(RegistryWire input, ResultCode code) const noexcept;
  [[nodiscard]] RegistryWire record_result(const Record& record) const noexcept;
};

}  // namespace orbit_engine::registry
