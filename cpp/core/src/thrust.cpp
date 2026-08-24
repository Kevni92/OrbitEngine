#include "orbit_engine/thrust.hpp"

#include <algorithm>
#include <bit>
#include <cmath>
#include <set>

namespace orbit_engine::thrust {
namespace {

bool finite(double value) noexcept { return std::isfinite(value); }

std::uint64_t mix(std::uint64_t hash, std::uint64_t value) noexcept {
  hash ^= value;
  hash *= 1099511628211ULL;
  return hash;
}

void add_double(std::uint64_t& hash, double value) noexcept {
  hash = mix(hash, std::bit_cast<std::uint64_t>(value));
}

void add_interval(std::uint64_t& hash, const force::TimeInterval& interval) noexcept {
  hash = mix(hash, static_cast<std::uint64_t>(interval.start.seconds));
  hash = mix(hash, interval.start.nanoseconds);
  if (interval.end.has_value()) {
    hash = mix(hash, static_cast<std::uint64_t>(interval.end->seconds));
    hash = mix(hash, interval.end->nanoseconds);
  }
}

bool unit_vector(frame::Vec3 value) noexcept {
  if (!frame::is_valid(value)) return false;
  const double norm_squared = value.x * value.x + value.y * value.y + value.z * value.z;
  if (!finite(norm_squared) || norm_squared <= 0.0) return false;
  return std::abs(std::sqrt(norm_squared) - 1.0) <= 1e-12;
}

bool contained(const force::TimeInterval& outer, const force::TimeInterval& inner) noexcept {
  if (!outer.valid() || !inner.valid()) return false;
  if (time::compare(inner.start, outer.start) < 0) return false;
  return !outer.end.has_value()
    || (inner.end.has_value() && time::compare(*inner.end, *outer.end) <= 0);
}

void invalid(force::Failure& failure, force::FailureCode code, const char* message) noexcept {
  failure = force::Failure{code, message};
}

std::uint64_t configuration_hash(const FiniteThrustConfiguration& configuration) noexcept {
  std::uint64_t hash = 1469598103934665603ULL;
  hash = mix(hash, configuration.target_id);
  hash = mix(hash, configuration.order);
  hash = mix(hash, configuration.integration_frame);
  hash = mix(hash, configuration.configuration_identity);
  add_interval(hash, configuration.validity);
  if (configuration.minimum_mass_kilograms.has_value()) add_double(hash, *configuration.minimum_mass_kilograms);
  for (const auto& stage : configuration.stages) {
    add_interval(hash, stage.validity);
    add_double(hash, stage.force_magnitude_newtons);
    add_double(hash, stage.throttle);
    hash = mix(hash, static_cast<std::uint64_t>(stage.mass_flow.kind));
    add_double(hash, stage.mass_flow.value);
    if (std::holds_alternative<ReferenceFrameDirection>(stage.direction)) {
      const auto& direction = std::get<ReferenceFrameDirection>(stage.direction);
      hash = mix(hash, 1);
      hash = mix(hash, direction.frame_id);
      hash = mix(hash, direction.frame_revision);
      add_double(hash, direction.unit_vector.x);
      add_double(hash, direction.unit_vector.y);
      add_double(hash, direction.unit_vector.z);
    } else {
      const auto& direction = std::get<BodyFrameDirection>(stage.direction);
      hash = mix(hash, 2);
      hash = mix(hash, direction.attitude_source_id);
      hash = mix(hash, direction.attitude_revision);
      add_double(hash, direction.unit_vector_body.x);
      add_double(hash, direction.unit_vector_body.y);
      add_double(hash, direction.unit_vector_body.z);
    }
  }
  return hash;
}

bool stage_is_active(const FiniteThrustStage& stage, const numerical::NumericalSampleTime& sample) noexcept {
  return stage.validity.contains(sample);
}

const FiniteThrustStage* active_stage(
  const std::vector<FiniteThrustStage>& stages,
  const numerical::NumericalSampleTime& sample
) noexcept {
  for (const auto& stage : stages) {
    if (stage_is_active(stage, sample)) return &stage;
  }
  return nullptr;
}

bool find_minimum_mass_boundary(
  const FiniteThrustConfiguration& configuration,
  const std::vector<double>& normalized_flows,
  time::SimulationInstant anchor,
  double initial_mass,
  std::optional<time::SimulationInstant>& boundary,
  force::Failure& failure
) {
  boundary.reset();
  if (!configuration.minimum_mass_kilograms.has_value()) return true;
  const double minimum_mass = *configuration.minimum_mass_kilograms;
  if (!finite(initial_mass) || initial_mass < minimum_mass) {
    invalid(failure, force::FailureCode::minimum_mass_reached, "initial physical mass is below the configured minimum");
    return false;
  }
  double mass = initial_mass;
  for (std::size_t index = 0; index < configuration.stages.size(); ++index) {
    const auto& stage = configuration.stages[index];
    if (!stage.validity.end.has_value() || time::compare(*stage.validity.end, anchor) <= 0) continue;
    const auto stage_start = time::compare(stage.validity.start, anchor) > 0 ? stage.validity.start : anchor;
    const auto duration = time::subtract(*stage.validity.end, stage_start);
    if (!duration.has_value()) continue;
    const double available_seconds = time::to_seconds(*duration);
    const double flow = normalized_flows[index] * stage.throttle;
    if (!finite(flow) || flow < 0.0 || !finite(available_seconds) || available_seconds < 0.0) {
      invalid(failure, force::FailureCode::invalid_configuration, "minimum-mass boundary inputs are invalid");
      return false;
    }
    if (flow == 0.0) continue;
    const double seconds_to_minimum = (mass - minimum_mass) / flow;
    if (!finite(seconds_to_minimum) || seconds_to_minimum < 0.0) {
      invalid(failure, force::FailureCode::minimum_mass_reached, "minimum-mass depletion time is invalid");
      return false;
    }
    if (seconds_to_minimum == 0.0) return true;
    if (seconds_to_minimum <= available_seconds) {
      const long double nanoseconds_real = static_cast<long double>(seconds_to_minimum) * 1'000'000'000.0L;
      if (!std::isfinite(static_cast<double>(nanoseconds_real))) {
        invalid(failure, force::FailureCode::invalid_configuration, "minimum-mass boundary exceeds exact time range");
        return false;
      }
      const auto nanoseconds = static_cast<std::int64_t>(std::floor(std::max(0.0L, nanoseconds_real)));
      const time::Duration exact_duration{nanoseconds / 1'000'000'000LL, static_cast<std::uint32_t>(nanoseconds % 1'000'000'000LL)};
      const auto exact_boundary = time::add(stage_start, exact_duration);
      if (!exact_boundary.has_value()) {
        invalid(failure, force::FailureCode::invalid_configuration, "minimum-mass boundary overflowed exact time");
        return false;
      }
      boundary = *exact_boundary;
      return true;
    }
    mass -= flow * available_seconds;
    if (!finite(mass)) {
      invalid(failure, force::FailureCode::invalid_configuration, "mass depletion became non-finite");
      return false;
    }
  }
  return true;
}

bool evaluate_direction(
  const FiniteThrustConfiguration& configuration,
  const FiniteThrustStage& stage,
  const numerical::NumericalSampleTime& sample,
  frame::Vec3& direction,
  force::Failure& failure
) {
  frame::Vec3 source_direction{};
  frame::Quaternion rotation{1.0, 0.0, 0.0, 0.0};
  if (std::holds_alternative<ReferenceFrameDirection>(stage.direction)) {
    const auto& reference = std::get<ReferenceFrameDirection>(stage.direction);
    source_direction = reference.unit_vector;
    if (reference.frame_id != configuration.integration_frame) {
      const auto& sampler = reference.sample_transform ? reference.sample_transform : configuration.sample_transform;
      if (!sampler) {
        invalid(failure, force::FailureCode::missing_dependency, "thrust reference-frame direction has no transform sampler");
        return false;
      }
      if (!sampler(reference.frame_id, sample, rotation, failure)) {
        if (failure.code == force::FailureCode::none) invalid(failure, force::FailureCode::source_unavailable, "thrust reference-frame transform sampling failed");
        return false;
      }
    }
  } else {
    const auto& body = std::get<BodyFrameDirection>(stage.direction);
    source_direction = body.unit_vector_body;
    if (!body.sample_attitude) {
      invalid(failure, force::FailureCode::missing_dependency, "body-frame thrust direction has no attitude sampler");
      return false;
    }
    if (!body.sample_attitude(sample, rotation, failure)) {
      if (failure.code == force::FailureCode::none) invalid(failure, force::FailureCode::source_unavailable, "body-frame attitude sampling failed");
      return false;
    }
  }
  if (!frame::is_valid(rotation)) {
    invalid(failure, force::FailureCode::invalid_attitude, "thrust direction rotation is invalid");
    return false;
  }
  const auto rotated = frame::rotate_vector(rotation, source_direction);
  if (!rotated.has_value() || !unit_vector(*rotated)) {
    invalid(failure, force::FailureCode::invalid_direction, "thrust direction transform returned a non-unit vector");
    return false;
  }
  direction = *rotated;
  return true;
}

}  // namespace

bool normalize_mass_flow(
  MassFlowSpecification specification,
  double force_magnitude_newtons,
  double& mass_flow_kilograms_per_second,
  force::Failure& failure
) noexcept {
  if (!finite(force_magnitude_newtons) || force_magnitude_newtons < 0.0) {
    invalid(failure, force::FailureCode::invalid_configuration, "thrust force magnitude must be finite and non-negative");
    return false;
  }
  if (!finite(specification.value)) {
    invalid(failure, force::FailureCode::invalid_configuration, "thrust mass-flow input must be finite");
    return false;
  }
  switch (specification.kind) {
    case MassFlowKind::direct:
      if (specification.value < 0.0) {
        invalid(failure, force::FailureCode::invalid_configuration, "direct mass flow must be non-negative");
        return false;
      }
      mass_flow_kilograms_per_second = specification.value;
      break;
    case MassFlowKind::exhaust_velocity:
      if (specification.value <= 0.0) {
        invalid(failure, force::FailureCode::invalid_configuration, "exhaust velocity must be strictly positive");
        return false;
      }
      mass_flow_kilograms_per_second = force_magnitude_newtons / specification.value;
      break;
    case MassFlowKind::specific_impulse: {
      if (specification.value <= 0.0) {
        invalid(failure, force::FailureCode::invalid_configuration, "specific impulse must be strictly positive");
        return false;
      }
      const double exhaust_velocity = specification.value * kStandardGravityMetersPerSecondSquared;
      if (!finite(exhaust_velocity)) {
        invalid(failure, force::FailureCode::invalid_configuration, "specific impulse overflowed exhaust velocity");
        return false;
      }
      mass_flow_kilograms_per_second = force_magnitude_newtons / exhaust_velocity;
      break;
    }
    default:
      invalid(failure, force::FailureCode::invalid_configuration, "unknown thrust mass-flow specification");
      return false;
  }
  if (!finite(mass_flow_kilograms_per_second) || mass_flow_kilograms_per_second < 0.0) {
    invalid(failure, force::FailureCode::invalid_configuration, "normalized thrust mass flow is invalid");
    return false;
  }
  failure = {};
  return true;
}

force::Provider make_finite_thrust_provider(
  FiniteThrustConfiguration configuration,
  force::Failure& failure
) {
  if (!configuration.validity.valid()
      || !frame::is_valid(configuration.integration_frame)
      || configuration.stages.empty()
      || configuration.stages.size() > kMaximumStages) {
    invalid(failure, force::FailureCode::invalid_configuration, "finite-thrust validity, integration frame, or stage count is invalid");
    return {};
  }
  if (configuration.minimum_mass_kilograms.has_value()
      && (!finite(*configuration.minimum_mass_kilograms) || *configuration.minimum_mass_kilograms <= 0.0)) {
    invalid(failure, force::FailureCode::invalid_configuration, "minimum mass must be finite and strictly positive");
    return {};
  }

  std::sort(configuration.stages.begin(), configuration.stages.end(), [](const auto& left, const auto& right) {
    return time::compare(left.validity.start, right.validity.start) < 0;
  });
  std::uint64_t identity = configuration_hash(configuration);
  std::vector<double> normalized_flows;
  normalized_flows.reserve(configuration.stages.size());
  bool requires_mass = false;
  for (std::size_t index = 0; index < configuration.stages.size(); ++index) {
    const auto& stage = configuration.stages[index];
    if (!contained(configuration.validity, stage.validity)
        || !stage.validity.end.has_value()
        || !finite(stage.force_magnitude_newtons) || stage.force_magnitude_newtons < 0.0
        || !finite(stage.throttle) || stage.throttle < 0.0 || stage.throttle > 1.0) {
      invalid(failure, force::FailureCode::invalid_configuration, "finite-thrust stage interval or scalar is invalid");
      return {};
    }
    if (index > 0 && time::compare(configuration.stages[index - 1].validity.end.value(), stage.validity.start) > 0) {
      invalid(failure, force::FailureCode::invalid_configuration, "finite-thrust stages overlap");
      return {};
    }
    bool valid_direction = false;
    if (std::holds_alternative<ReferenceFrameDirection>(stage.direction)) {
      const auto& direction = std::get<ReferenceFrameDirection>(stage.direction);
      valid_direction = frame::is_valid(direction.frame_id) && unit_vector(direction.unit_vector);
      if (direction.frame_id != configuration.integration_frame
          && !direction.sample_transform && !configuration.sample_transform) {
        invalid(failure, force::FailureCode::missing_dependency, "reference-frame thrust direction requires a transform sampler");
        return {};
      }
      identity = mix(identity, direction.frame_id);
      identity = mix(identity, direction.frame_revision);
    } else {
      const auto& direction = std::get<BodyFrameDirection>(stage.direction);
      valid_direction = direction.attitude_source_id != 0
        && direction.attitude_revision != 0
        && static_cast<bool>(direction.sample_attitude)
        && unit_vector(direction.unit_vector_body);
      identity = mix(identity, direction.attitude_source_id);
      identity = mix(identity, direction.attitude_revision);
    }
    if (!valid_direction) {
      invalid(failure, force::FailureCode::invalid_direction, "finite-thrust direction is invalid");
      return {};
    }
    double flow = 0.0;
    if (!normalize_mass_flow(stage.mass_flow, stage.force_magnitude_newtons, flow, failure)) return {};
    const double effective_force = stage.force_magnitude_newtons * stage.throttle;
    const double effective_flow = flow * stage.throttle;
    if (!finite(effective_force) || !finite(effective_flow)) {
      invalid(failure, force::FailureCode::invalid_configuration, "finite-thrust throttle overflowed a physical value");
      return {};
    }
    requires_mass = requires_mass || effective_force > 0.0 || effective_flow > 0.0;
    normalized_flows.push_back(flow);
    identity = mix(identity, static_cast<std::uint64_t>(stage.validity.start.seconds));
    identity = mix(identity, stage.validity.start.nanoseconds);
    add_double(identity, effective_force);
    add_double(identity, effective_flow);
  }
  if (configuration.target_id == 0) {
    // Zero means a provider can be used by a coupled authority for the
    // member selected by ForceEvaluationContext.
  }

  force::Provider provider;
  provider.definition.kind = force::ProviderKind::finite_thrust;
  provider.definition.order = configuration.order;
  provider.definition.validity = configuration.validity;
  provider.definition.requires_mass = requires_mass;
  provider.definition.configuration_identity = identity;
  if (configuration.target_id != 0) {
    provider.definition.dependencies.push_back(force::Dependency{force::DependencyKind::object, configuration.target_id, identity});
  }
  for (const auto& stage : configuration.stages) {
    provider.definition.hard_boundaries.push_back(numerical::HardBoundary{stage.validity.start, identity});
    if (stage.validity.end.has_value()) provider.definition.hard_boundaries.push_back(numerical::HardBoundary{*stage.validity.end, identity});
    if (std::holds_alternative<ReferenceFrameDirection>(stage.direction)) {
      const auto& direction = std::get<ReferenceFrameDirection>(stage.direction);
      provider.definition.dependencies.push_back(force::Dependency{force::DependencyKind::frame, direction.frame_id, direction.frame_revision});
    } else {
      const auto& direction = std::get<BodyFrameDirection>(stage.direction);
      provider.definition.dependencies.push_back(force::Dependency{force::DependencyKind::property, direction.attitude_source_id, direction.attitude_revision});
    }
  }

  if (configuration.minimum_mass_kilograms.has_value()) {
    const auto boundary_configuration = configuration;
    const auto boundary_flows = normalized_flows;
    provider.definition.minimum_mass_boundary = [
      boundary_configuration,
      boundary_flows
    ](
      time::SimulationInstant anchor,
      double initial_mass,
      std::optional<time::SimulationInstant>& boundary,
      force::Failure& output
    ) {
      return find_minimum_mass_boundary(boundary_configuration, boundary_flows, anchor, initial_mass, boundary, output);
    };
  }

  provider.evaluate_combined = [configuration = std::move(configuration), normalized_flows = std::move(normalized_flows)](
    const force::ForceEvaluationContext& context,
    frame::Vec3& acceleration,
    double& mass_rate,
    force::Failure& output
  ) {
    if (configuration.target_id != 0 && configuration.target_id != context.target_id) {
      invalid(output, force::FailureCode::missing_dependency, "finite-thrust provider target does not match evaluation target");
      return false;
    }
    acceleration = frame::Vec3{0.0, 0.0, 0.0};
    mass_rate = 0.0;
    const auto* stage = active_stage(configuration.stages, context.sample_time);
    if (stage == nullptr) {
      output = {};
      return true;
    }
    const auto stage_index = static_cast<std::size_t>(stage - configuration.stages.data());
    frame::Vec3 direction{};
    if (!evaluate_direction(configuration, *stage, context.sample_time, direction, output)) return false;
    const double force = stage->force_magnitude_newtons * stage->throttle;
    const double flow = normalized_flows[stage_index] * stage->throttle;
    if (configuration.minimum_mass_kilograms.has_value() && context.target_mass.has_value()) {
      if (*context.target_mass < *configuration.minimum_mass_kilograms) {
        invalid(output, force::FailureCode::minimum_mass_reached, "finite-thrust mass is below its configured minimum");
        return false;
      }
      if (*context.target_mass == *configuration.minimum_mass_kilograms && flow > 0.0 && !context.left_limit) {
        // The exact depletion boundary is a hard numerical boundary. At and
        // after it the burn contributes no further force or mass flow.
        output = {};
        return true;
      }
    }
    if (force > 0.0) {
      if (!context.target_mass.has_value() || *context.target_mass <= 0.0) {
        invalid(output, force::FailureCode::missing_dependency, "finite thrust requires strictly positive physical mass");
        return false;
      }
      acceleration = frame::Vec3{
        direction.x * force / *context.target_mass,
        direction.y * force / *context.target_mass,
        direction.z * force / *context.target_mass,
      };
    }
    mass_rate = -flow;
    if (!frame::is_valid(acceleration) || !finite(mass_rate)) {
      invalid(output, force::FailureCode::non_finite_output, "finite-thrust output is non-finite");
      return false;
    }
    output = {};
    return true;
  };
  failure = {};
  return provider;
}

}  // namespace orbit_engine::thrust
