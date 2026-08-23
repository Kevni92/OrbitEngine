#pragma once

#include "orbit_engine/force.hpp"
#include "orbit_engine/frame.hpp"
#include "orbit_engine/numerical.hpp"
#include "orbit_engine/object.hpp"

#include <cstdint>
#include <functional>
#include <memory>
#include <optional>
#include <span>
#include <string>
#include <vector>

namespace orbit_engine::numerical_motion {

enum class FailureCode : std::uint16_t {
  none = 0,
  invalid_configuration = 1,
  invalid_anchor = 2,
  target_outside_validity = 3,
  unsupported_temporal_direction = 4,
  missing_frame_dynamics = 5,
  invalid_frame_dynamics = 6,
  frame_dynamics_out_of_validity = 7,
  invalid_mass = 8,
  missing_mass = 9,
  numerical_failure = 10,
};

struct Failure {
  FailureCode code = FailureCode::none;
  std::string message;
};

struct NumericalSegmentAnchor {
  object::ObjectId object_id = 0;
  time::SimulationInstant epoch{};
  frame::ReferenceFrameId propagation_frame = 0;
  frame::Vec3 position{};
  frame::Vec3 velocity{};
  std::optional<double> mass;
  std::uint64_t segment_identity = 1;
};

struct NumericalState {
  time::SimulationInstant epoch{};
  frame::ReferenceFrameId propagation_frame = 0;
  frame::Vec3 position{};
  frame::Vec3 velocity{};
  std::optional<double> mass;
};

// The orientation is the inertial-root-from-integration-frame rotation. The
// three acceleration/rate vectors are already expressed in integration-frame
// coordinates, so stage evaluation does not need a second frame conversion.
// The sample is continuous at NumericalSampleTime and is not a public epoch.
struct FrameDynamicsSample {
  frame::Quaternion root_from_integration_frame{};
  frame::Vec3 origin_acceleration{};
  frame::Vec3 angular_velocity{};
  frame::Vec3 angular_acceleration{};
};

using FrameDynamicsSampler = std::function<bool(
  const numerical::NumericalSampleTime& sample_time,
  FrameDynamicsSample& sample,
  Failure& failure
)>;

struct FrameDynamicsDefinition {
  frame::ReferenceFrameId frame_id = 0;
  force::TimeInterval validity{};
  std::uint64_t revision = 0;
  FrameDynamicsSampler sample;
};

struct MassFlowProviderDefinition {
  std::uint32_t order = 0;
  force::TimeInterval validity{};
  std::vector<force::Dependency> dependencies;
  std::uint64_t configuration_identity = 0;
};

using MassFlowEvaluator = std::function<bool(
  const force::ForceEvaluationContext& context,
  double& mass_rate_kilograms_per_second,
  force::Failure& failure
)>;

struct MassFlowProvider {
  MassFlowProviderDefinition definition;
  MassFlowEvaluator evaluate;
};

struct NumericalMotionConfiguration {
  numerical::Configuration integrator;
  force::ProviderRuntime force_providers;
  force::TimeInterval validity{};
  std::optional<FrameDynamicsDefinition> frame_dynamics;
  std::vector<MassFlowProvider> mass_flow_providers;
  std::vector<numerical::HardBoundary> hard_boundaries;
  std::uint64_t configuration_identity = 1;
};

[[nodiscard]] bool is_valid(const NumericalSegmentAnchor& anchor, Failure& failure) noexcept;

class NumericalMotionSegment {
public:
  NumericalMotionSegment(
    NumericalSegmentAnchor anchor,
    NumericalMotionConfiguration configuration
  );
  ~NumericalMotionSegment();

  NumericalMotionSegment(const NumericalMotionSegment&) = delete;
  NumericalMotionSegment& operator=(const NumericalMotionSegment&) = delete;
  NumericalMotionSegment(NumericalMotionSegment&&) = delete;
  NumericalMotionSegment& operator=(NumericalMotionSegment&&) = delete;

  [[nodiscard]] bool valid() const noexcept;
  [[nodiscard]] const Failure& construction_failure() const noexcept;
  [[nodiscard]] const NumericalSegmentAnchor& anchor() const noexcept;
  [[nodiscard]] const NumericalMotionConfiguration& configuration() const noexcept;
  [[nodiscard]] std::uint64_t cache_identity() const noexcept;
  [[nodiscard]] std::vector<numerical::HardBoundary> hard_boundaries() const;

  // Read-only state evaluation. The only mutable effect is derived tape/cache
  // population; the authority, exact engine time, and physical history are not
  // changed by this operation.
  [[nodiscard]] bool state_at(
    time::SimulationInstant target,
    NumericalState& state,
    Failure& failure
  );

  [[nodiscard]] bool mass_at(
    time::SimulationInstant target,
    std::optional<double>& mass,
    Failure& failure
  );

  // Start a new cache/revision era at an exact instant. The state at the
  // invalidation instant is evaluated before anything is committed; a failure
  // therefore leaves all existing eras untouched.
  [[nodiscard]] bool invalidate_from(
    time::SimulationInstant instant,
    std::uint64_t new_segment_identity,
    Failure& failure
  );

  [[nodiscard]] numerical::TapeDiagnostics diagnostics() const noexcept;

private:
  struct Era {
    time::SimulationInstant start{};
    std::optional<time::SimulationInstant> end;
    NumericalSegmentAnchor anchor;
    NumericalMotionConfiguration configuration;
    std::unique_ptr<numerical::DOP853Tape> tape;
    std::uint64_t cache_identity = 0;
  };

  NumericalSegmentAnchor anchor_;
  NumericalMotionConfiguration configuration_;
  Failure construction_failure_;
  bool valid_ = false;
  std::vector<numerical::HardBoundary> hard_boundaries_;
  std::vector<std::unique_ptr<Era>> eras_;

  [[nodiscard]] std::unique_ptr<Era> make_era(
    NumericalSegmentAnchor anchor,
    NumericalMotionConfiguration configuration,
    std::optional<time::SimulationInstant> end,
    Failure& failure
  ) const;
  [[nodiscard]] Era* find_era(time::SimulationInstant target) noexcept;
  [[nodiscard]] const Era* find_era(time::SimulationInstant target) const noexcept;
  [[nodiscard]] bool evaluate_state_vector(
    Era& era,
    time::SimulationInstant target,
    std::vector<double>& values,
    Failure& failure
  );
  [[nodiscard]] static bool evaluate_derivative(
    const Era& era,
    const numerical::NumericalSampleTime& sample_time,
    std::span<const double> state,
    std::span<double> derivative,
    numerical::Failure& failure
  );
};

}  // namespace orbit_engine::numerical_motion
