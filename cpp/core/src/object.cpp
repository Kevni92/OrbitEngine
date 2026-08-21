#include "orbit_engine/object.hpp"

#include <cmath>

namespace orbit_engine::object {

bool is_valid(ObjectId value) noexcept {
  return value != 0;
}

ObjectIdWire object_id_to_wire(ObjectId value) noexcept {
  return ObjectIdWire{
    static_cast<std::uint32_t>(value >> 32U),
    static_cast<std::uint32_t>(value),
  };
}

ObjectId object_id_from_wire(ObjectIdWire value) noexcept {
  return (static_cast<ObjectId>(value.high) << 32U) | static_cast<ObjectId>(value.low);
}

bool is_valid(ObjectType value) noexcept {
  return is_valid_object_type_code(static_cast<std::uint16_t>(value));
}

std::uint16_t object_type_code(ObjectType value) noexcept {
  return static_cast<std::uint16_t>(value);
}

bool is_valid_object_type_code(std::uint16_t value) noexcept {
  return value >= object_type_code(ObjectType::star)
    && value <= object_type_code(ObjectType::debris);
}

std::optional<ObjectType> object_type_from_code(std::uint16_t value) noexcept {
  if (!is_valid_object_type_code(value)) {
    return std::nullopt;
  }
  return static_cast<ObjectType>(value);
}

bool is_valid(OptionalPhysicalScalar value) noexcept {
  if (!value.present) {
    return value.value == 0.0;
  }
  return std::isfinite(value.value) && value.value >= 0.0;
}

bool is_valid(PhysicalProperties value) noexcept {
  return is_valid(value.mass)
    && is_valid(value.mu)
    && is_valid(value.physical_radius)
    && is_valid(value.collision_bounding_radius);
}

bool is_valid(ObjectWire value) noexcept {
  return is_valid(object_id_from_wire(ObjectIdWire{value.object_id_high, value.object_id_low}))
    && is_valid_object_type_code(value.object_type_code)
    && is_valid(value.properties);
}

bool round_trip(ObjectWire input, ObjectWire& output) noexcept {
  if (!is_valid(input)) {
    return false;
  }
  output = input;
  return true;
}

}  // namespace orbit_engine::object
