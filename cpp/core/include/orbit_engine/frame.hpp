#pragma once

#include "orbit_engine/time.hpp"

#include <cstdint>
#include <optional>

namespace orbit_engine::frame {

using ReferenceFrameId = std::uint64_t;

inline constexpr ReferenceFrameId kRootReferenceFrameId = 1;

struct ReferenceFrameIdWire {
  std::uint32_t high;
  std::uint32_t low;
};

struct Vec3 {
  double x;
  double y;
  double z;
};

struct Quaternion {
  double w;
  double x;
  double y;
  double z;
};

struct RigidStateTransform {
  Vec3 translation;
  Vec3 origin_velocity;
  Quaternion rotation;
  Vec3 angular_velocity;
  time::SimulationInstant epoch;
};

struct CartesianState {
  Vec3 position;
  Vec3 velocity;
  time::SimulationInstant epoch;
};

struct FrameWire {
  std::uint32_t reference_frame_id_high;
  std::uint32_t reference_frame_id_low;
  time::TimeWire epoch;
  double translation_x;
  double translation_y;
  double translation_z;
  double origin_velocity_x;
  double origin_velocity_y;
  double origin_velocity_z;
  double rotation_w;
  double rotation_x;
  double rotation_y;
  double rotation_z;
  double angular_velocity_x;
  double angular_velocity_y;
  double angular_velocity_z;
};

inline constexpr double kQuaternionUnitTolerance = 1e-12;

[[nodiscard]] bool is_valid(ReferenceFrameId value) noexcept;
[[nodiscard]] ReferenceFrameIdWire reference_frame_id_to_wire(ReferenceFrameId value) noexcept;
[[nodiscard]] ReferenceFrameId reference_frame_id_from_wire(ReferenceFrameIdWire value) noexcept;

[[nodiscard]] bool is_valid(Vec3 value) noexcept;
[[nodiscard]] bool is_valid(Quaternion value) noexcept;
[[nodiscard]] std::optional<Quaternion> normalize(Quaternion value) noexcept;

[[nodiscard]] bool is_valid(RigidStateTransform value) noexcept;
[[nodiscard]] std::optional<RigidStateTransform> compose(
  RigidStateTransform parent_from_middle,
  RigidStateTransform middle_from_child
) noexcept;
[[nodiscard]] std::optional<RigidStateTransform> inverse(RigidStateTransform value) noexcept;
[[nodiscard]] std::optional<CartesianState> transform(
  RigidStateTransform value,
  CartesianState state
) noexcept;

[[nodiscard]] bool is_valid(FrameWire value) noexcept;
[[nodiscard]] bool round_trip(FrameWire input, FrameWire& output) noexcept;

}  // namespace orbit_engine::frame
