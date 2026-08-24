#pragma once

#include "orbit_engine/force.hpp"

#include <cstdint>
#include <functional>
#include <optional>
#include <variant>
#include <vector>

namespace orbit_engine::thrust {

inline constexpr double kStandardGravityMetersPerSecondSquared = 9.80665;
inline constexpr std::size_t kMaximumStages = 64;

enum class MassFlowKind : std::uint8_t {
  direct = 1,
  exhaust_velocity = 2,
  specific_impulse = 3,
};

struct MassFlowSpecification {
  MassFlowKind kind = MassFlowKind::direct;
  double value = 0.0;
};

// The sampler returns a unit quaternion that rotates vectors from the
// declared source frame into the numerical integration frame at the supplied
// internal sample time. It is a portable-core dependency, not a JS callback
// in the numerical hot loop.
using DirectionTransformSampler = std::function<bool(
  frame::ReferenceFrameId source_frame,
  const numerical::NumericalSampleTime& sample_time,
  frame::Quaternion& integration_from_source,
  force::Failure& failure
)>;

using AttitudeSampler = std::function<bool(
  const numerical::NumericalSampleTime& sample_time,
  frame::Quaternion& integration_from_body,
  force::Failure& failure
)>;

struct ReferenceFrameDirection {
  frame::ReferenceFrameId frame_id = 0;
  std::uint64_t frame_revision = 0;
  frame::Vec3 unit_vector{};
  DirectionTransformSampler sample_transform;
};

struct BodyFrameDirection {
  frame::Vec3 unit_vector_body{};
  object::ObjectId attitude_source_id = 0;
  std::uint64_t attitude_revision = 0;
  AttitudeSampler sample_attitude;
};

using Direction = std::variant<ReferenceFrameDirection, BodyFrameDirection>;

struct FiniteThrustStage {
  force::TimeInterval validity{};
  double force_magnitude_newtons = 0.0;
  double throttle = 0.0;
  Direction direction;
  MassFlowSpecification mass_flow;
};

struct FiniteThrustConfiguration {
  object::ObjectId target_id = 0;
  std::uint32_t order = 0;
  force::TimeInterval validity{};
  frame::ReferenceFrameId integration_frame = 0;
  std::vector<FiniteThrustStage> stages;
  std::optional<double> minimum_mass_kilograms;
  std::uint64_t configuration_identity = 1;
  DirectionTransformSampler sample_transform;
};

[[nodiscard]] bool normalize_mass_flow(
  MassFlowSpecification specification,
  double force_magnitude_newtons,
  double& mass_flow_kilograms_per_second,
  force::Failure& failure
) noexcept;

[[nodiscard]] force::Provider make_finite_thrust_provider(
  FiniteThrustConfiguration configuration,
  force::Failure& failure
);

}  // namespace orbit_engine::thrust
