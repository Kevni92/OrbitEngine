#include "orbit_engine/frame.hpp"

#include <cmath>

namespace orbit_engine::frame {
namespace {

Vec3 add(Vec3 left, Vec3 right) noexcept {
  return Vec3{left.x + right.x, left.y + right.y, left.z + right.z};
}

Vec3 negate(Vec3 value) noexcept {
  return Vec3{-value.x, -value.y, -value.z};
}

Vec3 cross(Vec3 left, Vec3 right) noexcept {
  return Vec3{
    left.y * right.z - left.z * right.y,
    left.z * right.x - left.x * right.z,
    left.x * right.y - left.y * right.x,
  };
}

Quaternion multiply(Quaternion left, Quaternion right) noexcept {
  return Quaternion{
    left.w * right.w - left.x * right.x - left.y * right.y - left.z * right.z,
    left.w * right.x + left.x * right.w + left.y * right.z - left.z * right.y,
    left.w * right.y - left.x * right.z + left.y * right.w + left.z * right.x,
    left.w * right.z + left.x * right.y - left.y * right.x + left.z * right.w,
  };
}

Quaternion conjugate(Quaternion value) noexcept {
  return Quaternion{value.w, -value.x, -value.y, -value.z};
}

Vec3 rotate(Quaternion rotation, Vec3 value) noexcept {
  const auto vectorQuaternion = Quaternion{0.0, value.x, value.y, value.z};
  const auto rotated = multiply(multiply(rotation, vectorQuaternion), conjugate(rotation));
  return Vec3{rotated.x, rotated.y, rotated.z};
}

bool same_epoch(time::SimulationInstant left, time::SimulationInstant right) noexcept {
  return time::compare(left, right) == 0;
}

}  // namespace

bool is_valid(ReferenceFrameId value) noexcept {
  return value != 0;
}

ReferenceFrameIdWire reference_frame_id_to_wire(ReferenceFrameId value) noexcept {
  return ReferenceFrameIdWire{
    static_cast<std::uint32_t>(value >> 32U),
    static_cast<std::uint32_t>(value),
  };
}

ReferenceFrameId reference_frame_id_from_wire(ReferenceFrameIdWire value) noexcept {
  return (static_cast<ReferenceFrameId>(value.high) << 32U) | static_cast<ReferenceFrameId>(value.low);
}

bool is_valid(Vec3 value) noexcept {
  return std::isfinite(value.x) && std::isfinite(value.y) && std::isfinite(value.z);
}

bool is_valid(Quaternion value) noexcept {
  if (!std::isfinite(value.w) || !std::isfinite(value.x)
      || !std::isfinite(value.y) || !std::isfinite(value.z)) {
    return false;
  }
  const auto norm = std::sqrt(
    value.w * value.w + value.x * value.x + value.y * value.y + value.z * value.z);
  return norm != 0.0 && std::abs(norm - 1.0) <= kQuaternionUnitTolerance;
}

std::optional<Quaternion> normalize(Quaternion value) noexcept {
  if (!is_valid(value)) {
    return std::nullopt;
  }
  const auto norm = std::sqrt(
    value.w * value.w + value.x * value.x + value.y * value.y + value.z * value.z);
  return Quaternion{value.w / norm, value.x / norm, value.y / norm, value.z / norm};
}

bool is_valid(RigidStateTransform value) noexcept {
  return is_valid(value.translation)
    && is_valid(value.origin_velocity)
    && is_valid(value.rotation)
    && is_valid(value.angular_velocity)
    && time::is_normalized(value.epoch);
}

std::optional<RigidStateTransform> compose(
  RigidStateTransform parent_from_middle,
  RigidStateTransform middle_from_child
) noexcept {
  if (!is_valid(parent_from_middle) || !is_valid(middle_from_child)
      || !same_epoch(parent_from_middle.epoch, middle_from_child.epoch)) {
    return std::nullopt;
  }

  const auto rotatedTranslation = rotate(parent_from_middle.rotation, middle_from_child.translation);
  const auto rotation = normalize(multiply(parent_from_middle.rotation, middle_from_child.rotation));
  if (!rotation.has_value()) {
    return std::nullopt;
  }

  return RigidStateTransform{
    add(parent_from_middle.translation, rotatedTranslation),
    add(
      add(parent_from_middle.origin_velocity,
          rotate(parent_from_middle.rotation, middle_from_child.origin_velocity)),
      cross(parent_from_middle.angular_velocity, rotatedTranslation)),
    *rotation,
    add(
      parent_from_middle.angular_velocity,
      rotate(parent_from_middle.rotation, middle_from_child.angular_velocity)),
    parent_from_middle.epoch,
  };
}

std::optional<RigidStateTransform> inverse(RigidStateTransform value) noexcept {
  if (!is_valid(value)) {
    return std::nullopt;
  }

  const auto inverseRotation = conjugate(value.rotation);
  return RigidStateTransform{
    negate(rotate(inverseRotation, value.translation)),
    rotate(inverseRotation, add(negate(value.origin_velocity), cross(value.angular_velocity, value.translation))),
    inverseRotation,
    negate(rotate(inverseRotation, value.angular_velocity)),
    value.epoch,
  };
}

std::optional<CartesianState> transform(
  RigidStateTransform value,
  CartesianState state
) noexcept {
  if (!is_valid(value) || !is_valid(state.position) || !is_valid(state.velocity)
      || !time::is_normalized(state.epoch) || !same_epoch(value.epoch, state.epoch)) {
    return std::nullopt;
  }

  const auto rotatedPosition = rotate(value.rotation, state.position);
  return CartesianState{
    add(value.translation, rotatedPosition),
    add(
      add(value.origin_velocity, rotate(value.rotation, state.velocity)),
      cross(value.angular_velocity, rotatedPosition)),
    state.epoch,
  };
}

bool is_valid(FrameWire value) noexcept {
  if (!is_valid(reference_frame_id_from_wire(
        ReferenceFrameIdWire{value.reference_frame_id_high, value.reference_frame_id_low}))) {
    return false;
  }
  if (!time::from_wire(value.epoch).has_value()) {
    return false;
  }
  return is_valid(RigidStateTransform{
    Vec3{value.translation_x, value.translation_y, value.translation_z},
    Vec3{value.origin_velocity_x, value.origin_velocity_y, value.origin_velocity_z},
    Quaternion{value.rotation_w, value.rotation_x, value.rotation_y, value.rotation_z},
    Vec3{value.angular_velocity_x, value.angular_velocity_y, value.angular_velocity_z},
    *time::from_wire(value.epoch),
  });
}

bool round_trip(FrameWire input, FrameWire& output) noexcept {
  if (!is_valid(input)) {
    return false;
  }
  output = input;
  return true;
}

}  // namespace orbit_engine::frame
