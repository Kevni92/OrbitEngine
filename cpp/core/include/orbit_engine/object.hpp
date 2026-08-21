#pragma once

#include <cstdint>
#include <optional>

namespace orbit_engine::object {

using ObjectId = std::uint64_t;

struct ObjectIdWire {
  std::uint32_t high;
  std::uint32_t low;
};

enum class ObjectType : std::uint16_t {
  star = 1,
  planet = 2,
  dwarf_planet = 3,
  moon = 4,
  asteroid = 5,
  comet = 6,
  spacecraft = 7,
  station = 8,
  artificial_satellite = 9,
  surface_object = 10,
  debris = 11,
};

struct OptionalPhysicalScalar {
  bool present;
  double value;
};

struct PhysicalProperties {
  OptionalPhysicalScalar mass;
  OptionalPhysicalScalar mu;
  OptionalPhysicalScalar physical_radius;
  OptionalPhysicalScalar collision_bounding_radius;
};

struct ObjectWire {
  std::uint32_t object_id_high;
  std::uint32_t object_id_low;
  std::uint16_t object_type_code;
  PhysicalProperties properties;
};

[[nodiscard]] bool is_valid(ObjectId value) noexcept;
[[nodiscard]] ObjectIdWire object_id_to_wire(ObjectId value) noexcept;
[[nodiscard]] ObjectId object_id_from_wire(ObjectIdWire value) noexcept;

[[nodiscard]] bool is_valid(ObjectType value) noexcept;
[[nodiscard]] std::uint16_t object_type_code(ObjectType value) noexcept;
[[nodiscard]] bool is_valid_object_type_code(std::uint16_t value) noexcept;
[[nodiscard]] std::optional<ObjectType> object_type_from_code(std::uint16_t value) noexcept;

[[nodiscard]] bool is_valid(OptionalPhysicalScalar value) noexcept;
[[nodiscard]] bool is_valid(PhysicalProperties value) noexcept;
[[nodiscard]] bool is_valid(ObjectWire value) noexcept;
[[nodiscard]] bool round_trip(ObjectWire input, ObjectWire& output) noexcept;

}  // namespace orbit_engine::object
