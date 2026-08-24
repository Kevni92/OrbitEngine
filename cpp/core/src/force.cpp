#include "orbit_engine/force.hpp"

#include <algorithm>
#include <bit>
#include <cmath>
#include <limits>
#include <set>

namespace orbit_engine::force {
namespace {

bool finite_vec(frame::Vec3 value) noexcept { return frame::is_valid(value); }

std::uint64_t mix(std::uint64_t hash, std::uint64_t value) noexcept {
  hash ^= value;
  hash *= 1099511628211ULL;
  return hash;
}

std::uint64_t identity_for_double(std::uint64_t hash, double value) noexcept {
  return mix(hash, std::bit_cast<std::uint64_t>(value));
}

std::uint64_t provider_identity(const Provider& provider) noexcept {
  std::uint64_t hash = 1469598103934665603ULL;
  hash = mix(hash, static_cast<std::uint64_t>(provider.definition.kind));
  hash = mix(hash, provider.definition.order);
  hash = mix(hash, provider.definition.configuration_identity);
  hash = mix(hash, provider.definition.validity.start.seconds);
  hash = mix(hash, provider.definition.validity.start.nanoseconds);
  if (provider.definition.validity.end.has_value()) {
    hash = mix(hash, provider.definition.validity.end->seconds);
    hash = mix(hash, provider.definition.validity.end->nanoseconds);
  }
  for (const auto& dependency : provider.definition.dependencies) {
    hash = mix(hash, static_cast<std::uint64_t>(dependency.kind));
    hash = mix(hash, dependency.id);
    hash = mix(hash, dependency.revision);
  }
  for (const auto& boundary : provider.definition.hard_boundaries) {
    hash = mix(hash, static_cast<std::uint64_t>(boundary.instant.seconds));
    hash = mix(hash, boundary.instant.nanoseconds);
    hash = mix(hash, boundary.identity);
  }
  return hash;
}

bool sample_is_in_interval(const TimeInterval& interval, const numerical::NumericalSampleTime& sample) noexcept {
  if (!interval.valid() || !std::isfinite(sample.offset_seconds) || sample.offset_seconds < 0.0) return false;
  const auto from_start = time::subtract(interval.start, sample.exact_step_start);
  if (!from_start.has_value() && time::compare(interval.start, sample.exact_step_start) > 0) return false;
  if (from_start.has_value() && sample.offset_seconds < time::to_seconds(*from_start)) return false;
  if (interval.end.has_value()) {
    const auto to_end = time::subtract(*interval.end, sample.exact_step_start);
    if (!to_end.has_value()) return false;
    if (sample.offset_seconds >= time::to_seconds(*to_end)) return false;
  }
  return true;
}

}  // namespace

bool TimeInterval::valid() const noexcept {
  if (!time::is_normalized(start)) return false;
  return !end.has_value() || (time::is_normalized(*end) && time::compare(start, *end) < 0);
}

bool TimeInterval::contains(const numerical::NumericalSampleTime& sample) const noexcept {
  return sample_is_in_interval(*this, sample);
}

bool validate_gravity_source(const GravitySource& source, Failure& failure) noexcept {
  if (source.id == 0 || !source.validity.valid() || !finite_vec(source.fixed_position)) {
    failure = Failure{FailureCode::invalid_configuration, "gravity source identity, validity, or position is invalid"};
    return false;
  }
  if (!source.has_fixed_position && !source.sample_position) {
    failure = Failure{FailureCode::missing_dependency, "gravity source has no continuous position sampler"};
    return false;
  }
  if (source.mu.has_value() && (!std::isfinite(*source.mu) || *source.mu < 0.0)) {
    failure = Failure{FailureCode::invalid_gravity_strength, "gravity source mu must be finite and non-negative"};
    return false;
  }
  if (source.mass.has_value() && (!std::isfinite(*source.mass) || *source.mass < 0.0)) {
    failure = Failure{FailureCode::invalid_gravity_strength, "gravity source mass must be finite and non-negative"};
    return false;
  }
  if (!source.mu.has_value() && !source.mass.has_value()) {
    failure = Failure{FailureCode::invalid_gravity_strength, "gravity source requires mu or physical mass"};
    return false;
  }
  return true;
}

Provider make_newtonian_gravity_provider(NewtonianGravityConfiguration configuration, Failure& failure) {
  if (!configuration.validity.valid()) {
    failure = Failure{FailureCode::invalid_configuration, "Newtonian gravity validity is invalid"};
    return {};
  }
  std::sort(configuration.sources.begin(), configuration.sources.end(), [](const GravitySource& left, const GravitySource& right) { return left.id < right.id; });
  std::set<object::ObjectId> ids;
  for (const auto& source : configuration.sources) {
    if (!ids.insert(source.id).second || !validate_gravity_source(source, failure)) return {};
  }
  Provider provider;
  provider.definition.kind = ProviderKind::newtonian_gravity;
  provider.definition.order = configuration.order;
  provider.definition.validity = configuration.validity;
  provider.definition.configuration_identity = configuration.configuration_identity;
  provider.definition.dependencies.reserve(configuration.sources.size());
  for (const auto& source : configuration.sources) {
    provider.definition.dependencies.push_back(Dependency{DependencyKind::source, source.id, source.revision});
  }
  provider.evaluate = [sources = std::move(configuration.sources)](const ForceEvaluationContext& context, frame::Vec3& acceleration, Failure& output) {
    acceleration = frame::Vec3{0.0, 0.0, 0.0};
    for (const auto& source : sources) {
      if (source.id == context.target_id) continue;
      if (!source.validity.contains(context.sample_time)) { output = Failure{FailureCode::source_unavailable, "gravity source is outside its exact validity interval"}; return false; }
      double mu = 0.0;
      if (source.mu.has_value()) mu = *source.mu;
      else if (source.mass.has_value()) mu = kNewtonianGravitationalConstant * *source.mass;
      if (!std::isfinite(mu) || mu < 0.0) { output = Failure{FailureCode::invalid_gravity_strength, "gravity source strength is invalid"}; return false; }
      if (mu == 0.0) continue;
      frame::Vec3 source_position{};
      if (source.has_fixed_position) source_position = source.fixed_position;
      else if (!source.sample_position(context.sample_time, source_position, output)) { if (output.code == FailureCode::none) output = Failure{FailureCode::source_unavailable, "gravity source position sampling failed"}; return false; }
      if (!finite_vec(source_position)) { output = Failure{FailureCode::non_finite_output, "gravity source position is non-finite"}; return false; }
      const frame::Vec3 displacement{source_position.x - context.target_position.x, source_position.y - context.target_position.y, source_position.z - context.target_position.z};
      const double distance_squared = displacement.x * displacement.x + displacement.y * displacement.y + displacement.z * displacement.z;
      if (!std::isfinite(distance_squared) || distance_squared <= 0.0) { output = Failure{FailureCode::singular_gravity_geometry, "gravity source and target occupy the same position"}; return false; }
      const double inverse_distance = 1.0 / std::sqrt(distance_squared);
      const double factor = mu * inverse_distance * inverse_distance * inverse_distance;
      acceleration.x += factor * displacement.x;
      acceleration.y += factor * displacement.y;
      acceleration.z += factor * displacement.z;
    }
    if (!finite_vec(acceleration)) { output = Failure{FailureCode::non_finite_output, "Newtonian gravity acceleration is non-finite"}; return false; }
    return true;
  };
  failure = {};
  return provider;
}

ProviderRuntime::ProviderRuntime(std::vector<Provider> providers) : providers_(std::move(providers)) {
  std::sort(providers_.begin(), providers_.end(), [](const Provider& left, const Provider& right) { return left.definition.order < right.definition.order; });
  std::set<std::uint32_t> orders;
  std::uint64_t identity = 1469598103934665603ULL;
  for (const auto& provider : providers_) {
    if ((!provider.evaluate && !provider.evaluate_combined)
        || !provider.definition.validity.valid()
        || !orders.insert(provider.definition.order).second) {
      construction_failure_ = Failure{FailureCode::invalid_configuration, "force providers require unique order, validity, and evaluator"};
      return;
    }
    identity = mix(identity, provider_identity(provider));
  }
  configuration_identity_ = identity;
  valid_ = true;
}

bool ProviderRuntime::valid() const noexcept { return valid_; }
const Failure& ProviderRuntime::construction_failure() const noexcept { return construction_failure_; }
std::uint64_t ProviderRuntime::configuration_identity() const noexcept { return configuration_identity_; }
const std::vector<Provider>& ProviderRuntime::providers() const noexcept { return providers_; }

std::vector<numerical::HardBoundary> ProviderRuntime::hard_boundaries() const {
  std::vector<numerical::HardBoundary> result;
  for (const auto& provider : providers_) {
    result.push_back(numerical::HardBoundary{provider.definition.validity.start, provider.definition.configuration_identity});
    if (provider.definition.validity.end.has_value()) result.push_back(numerical::HardBoundary{*provider.definition.validity.end, provider.definition.configuration_identity});
    result.insert(result.end(), provider.definition.hard_boundaries.begin(), provider.definition.hard_boundaries.end());
  }
  std::sort(result.begin(), result.end(), [](const auto& left, const auto& right) { return time::compare(left.instant, right.instant) < 0; });
  return result;
}

std::vector<Dependency> ProviderRuntime::dependencies() const {
  std::vector<Dependency> result;
  for (const auto& provider : providers_) result.insert(result.end(), provider.definition.dependencies.begin(), provider.definition.dependencies.end());
  return result;
}

bool ProviderRuntime::evaluate(
  const ForceEvaluationContext& context,
  frame::Vec3& acceleration,
  double& mass_rate_kilograms_per_second,
  Failure& failure
) const noexcept {
  if (!valid_) { failure = construction_failure_; return false; }
  if (context.target_id == 0 || !finite_vec(context.target_position) || !std::isfinite(context.sample_time.offset_seconds) || context.sample_time.offset_seconds < 0.0) { failure = Failure{FailureCode::invalid_configuration, "force evaluation context is invalid"}; return false; }
  if (context.target_mass.has_value() && (!std::isfinite(*context.target_mass) || *context.target_mass < 0.0)) { failure = Failure{FailureCode::invalid_configuration, "target mass is invalid"}; return false; }
  acceleration = frame::Vec3{0.0, 0.0, 0.0};
  mass_rate_kilograms_per_second = 0.0;
  for (const auto& provider : providers_) {
    if (!provider.definition.validity.contains(context.sample_time)) { failure = Failure{FailureCode::provider_out_of_validity, "force provider is outside its exact validity interval"}; return false; }
    if (provider.definition.requires_mass && (!context.target_mass.has_value() || *context.target_mass <= 0.0)) { failure = Failure{FailureCode::missing_dependency, "force provider requires strictly positive target mass"}; return false; }
    frame::Vec3 contribution{};
    double contribution_rate = 0.0;
    if (provider.evaluate_combined) {
      if (!provider.evaluate_combined(context, contribution, contribution_rate, failure)) {
        if (failure.code == FailureCode::none) failure = Failure{FailureCode::non_finite_output, "force provider evaluation failed"};
        return false;
      }
    } else if (!provider.evaluate(context, contribution, failure)) {
      if (failure.code == FailureCode::none) failure = Failure{FailureCode::non_finite_output, "force provider evaluation failed"};
      return false;
    }
    if (!finite_vec(contribution)) { failure = Failure{FailureCode::non_finite_output, "force provider returned non-finite acceleration"}; return false; }
    acceleration.x += contribution.x; acceleration.y += contribution.y; acceleration.z += contribution.z;
    if (!finite_vec(acceleration)) { failure = Failure{FailureCode::non_finite_output, "force accumulation is non-finite"}; return false; }
    if (provider.evaluate_combined) {
      if (!std::isfinite(contribution_rate)) { failure = Failure{FailureCode::non_finite_output, "force provider returned non-finite mass rate"}; return false; }
      mass_rate_kilograms_per_second += contribution_rate;
      if (!std::isfinite(mass_rate_kilograms_per_second)) { failure = Failure{FailureCode::non_finite_output, "mass-flow accumulation is non-finite"}; return false; }
    } else if (provider.evaluate_mass_rate) {
      if (!provider.evaluate_mass_rate(context, contribution_rate, failure)) {
        if (failure.code == FailureCode::none) failure = Failure{FailureCode::non_finite_output, "mass-flow provider evaluation failed"};
        return false;
      }
      if (!std::isfinite(contribution_rate)) { failure = Failure{FailureCode::non_finite_output, "mass-flow provider returned non-finite rate"}; return false; }
      mass_rate_kilograms_per_second += contribution_rate;
      if (!std::isfinite(mass_rate_kilograms_per_second)) { failure = Failure{FailureCode::non_finite_output, "mass-flow accumulation is non-finite"}; return false; }
    }
  }
  failure = {};
  return true;
}

bool ProviderRuntime::evaluate(
  const ForceEvaluationContext& context,
  frame::Vec3& acceleration,
  Failure& failure
) const noexcept {
  double ignored_mass_rate = 0.0;
  return evaluate(context, acceleration, ignored_mass_rate, failure);
}

}  // namespace orbit_engine::force
