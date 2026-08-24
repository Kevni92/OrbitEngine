#pragma once

#include "orbit_engine/frame.hpp"
#include "orbit_engine/numerical.hpp"
#include "orbit_engine/object.hpp"

#include <cstdint>
#include <functional>
#include <optional>
#include <string>
#include <vector>

namespace orbit_engine::force {

inline constexpr double kNewtonianGravitationalConstant = 6.67430e-11;

enum class FailureCode : std::uint16_t {
  none = 0,
  invalid_configuration = 1,
  provider_out_of_validity = 2,
  missing_dependency = 3,
  source_unavailable = 4,
  invalid_gravity_strength = 5,
  singular_gravity_geometry = 6,
  non_finite_output = 7,
  invalid_direction = 8,
  invalid_attitude = 9,
  minimum_mass_reached = 10,
};

struct Failure {
  FailureCode code = FailureCode::none;
  std::string message;
};

struct TimeInterval {
  time::SimulationInstant start{};
  std::optional<time::SimulationInstant> end;

  [[nodiscard]] bool valid() const noexcept;
  [[nodiscard]] bool contains(const numerical::NumericalSampleTime& sample) const noexcept;
};

enum class DependencyKind : std::uint16_t {
  object = 1,
  source = 2,
  property = 3,
  frame = 4,
  mass = 5,
};

struct Dependency {
  DependencyKind kind = DependencyKind::source;
  std::uint64_t id = 0;
  std::uint64_t revision = 0;
};

enum class ProviderKind : std::uint16_t {
  custom = 1,
  newtonian_gravity = 2,
  finite_thrust = 3,
};

using MinimumMassBoundaryFinder = std::function<bool(
  time::SimulationInstant anchor,
  double initial_mass_kilograms,
  std::optional<time::SimulationInstant>& boundary,
  Failure& failure
)>;

struct ProviderDefinition {
  ProviderKind kind = ProviderKind::custom;
  std::uint32_t order = 0;
  TimeInterval validity{};
  std::vector<Dependency> dependencies;
  bool requires_mass = false;
  std::uint64_t configuration_identity = 0;
  // Additional exact discontinuities owned by a provider, such as stage
  // boundaries inside one validity interval.
  std::vector<numerical::HardBoundary> hard_boundaries;
  MinimumMassBoundaryFinder minimum_mass_boundary;
};

struct ForceEvaluationContext {
  object::ObjectId target_id = 0;
  numerical::NumericalSampleTime sample_time{};
  frame::Vec3 target_position{};
  std::optional<double> target_mass;
  bool left_limit = false;
};

using ProviderEvaluator = std::function<bool(
  const ForceEvaluationContext& context,
  frame::Vec3& acceleration,
  Failure& failure
)>;

using MassRateEvaluator = std::function<bool(
  const ForceEvaluationContext& context,
  double& mass_rate_kilograms_per_second,
  Failure& failure
)>;

using CombinedEvaluator = std::function<bool(
  const ForceEvaluationContext& context,
  frame::Vec3& acceleration,
  double& mass_rate_kilograms_per_second,
  Failure& failure
)>;

struct Provider {
  ProviderDefinition definition;
  ProviderEvaluator evaluate;
  MassRateEvaluator evaluate_mass_rate;
  CombinedEvaluator evaluate_combined;
};

struct GravitySource {
  object::ObjectId id = 0;
  TimeInterval validity{};
  std::optional<double> mu;
  std::optional<double> mass;
  std::uint64_t revision = 0;
  frame::Vec3 fixed_position{};
  bool has_fixed_position = false;
  std::function<bool(const numerical::NumericalSampleTime&, frame::Vec3&, Failure&)> sample_position;
};

struct NewtonianGravityConfiguration {
  std::uint32_t order = 0;
  TimeInterval validity{};
  std::vector<GravitySource> sources;
  std::uint64_t configuration_identity = 1;
};

[[nodiscard]] bool validate_gravity_source(const GravitySource& source, Failure& failure) noexcept;
[[nodiscard]] Provider make_newtonian_gravity_provider(NewtonianGravityConfiguration configuration, Failure& failure);

class ProviderRuntime {
public:
  explicit ProviderRuntime(std::vector<Provider> providers);

  [[nodiscard]] bool valid() const noexcept;
  [[nodiscard]] const Failure& construction_failure() const noexcept;
  [[nodiscard]] std::uint64_t configuration_identity() const noexcept;
  [[nodiscard]] const std::vector<Provider>& providers() const noexcept;
  [[nodiscard]] std::vector<numerical::HardBoundary> hard_boundaries() const;
  [[nodiscard]] std::vector<Dependency> dependencies() const;

  [[nodiscard]] bool evaluate(
    const ForceEvaluationContext& context,
    frame::Vec3& acceleration,
    double& mass_rate_kilograms_per_second,
    Failure& failure
  ) const noexcept;

  // Compatibility overload for providers that only contribute acceleration.
  [[nodiscard]] bool evaluate(
    const ForceEvaluationContext& context,
    frame::Vec3& acceleration,
    Failure& failure
  ) const noexcept;

private:
  std::vector<Provider> providers_;
  std::uint64_t configuration_identity_ = 0;
  Failure construction_failure_;
  bool valid_ = false;
};

}  // namespace orbit_engine::force
