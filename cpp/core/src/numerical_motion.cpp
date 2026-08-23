#include "orbit_engine/numerical_motion.hpp"

#include <algorithm>
#include <bit>
#include <cmath>
#include <limits>
#include <set>
#include <utility>

namespace orbit_engine::numerical_motion {
namespace {

using Vec3 = frame::Vec3;

bool finite(double value) noexcept { return std::isfinite(value); }
bool finite_vec(Vec3 value) noexcept { return frame::is_valid(value); }

Vec3 add(Vec3 left, Vec3 right) noexcept {
  return Vec3{left.x + right.x, left.y + right.y, left.z + right.z};
}

Vec3 subtract(Vec3 left, Vec3 right) noexcept {
  return Vec3{left.x - right.x, left.y - right.y, left.z - right.z};
}

Vec3 scale(Vec3 value, double factor) noexcept {
  return Vec3{value.x * factor, value.y * factor, value.z * factor};
}

Vec3 cross(Vec3 left, Vec3 right) noexcept {
  return Vec3{
    left.y * right.z - left.z * right.y,
    left.z * right.x - left.x * right.z,
    left.x * right.y - left.y * right.x,
  };
}

bool contains(const force::TimeInterval& interval, time::SimulationInstant target) noexcept {
  return interval.valid()
    && time::compare(target, interval.start) >= 0
    && (!interval.end.has_value() || time::compare(target, *interval.end) < 0);
}

void set_failure(Failure& failure, FailureCode code, const char* message) {
  failure = Failure{code, message};
}

void set_numerical_failure(numerical::Failure& failure, numerical::FailureCode code, const std::string& message) {
  failure = numerical::Failure{code, message};
}

void set_force_failure(numerical::Failure& failure, const force::Failure& source) {
  set_numerical_failure(
    failure,
    source.code == force::FailureCode::none
      ? numerical::FailureCode::derivative_failure
      : numerical::FailureCode::derivative_failure,
    source.message.empty() ? "force evaluation failed" : source.message);
}

std::uint64_t mix(std::uint64_t hash, std::uint64_t value) noexcept {
  hash ^= value;
  hash *= 1099511628211ULL;
  return hash;
}

void add_interval_identity(std::uint64_t& hash, const force::TimeInterval& interval) noexcept {
  hash = mix(hash, static_cast<std::uint64_t>(interval.start.seconds));
  hash = mix(hash, interval.start.nanoseconds);
  if (interval.end.has_value()) {
    hash = mix(hash, static_cast<std::uint64_t>(interval.end->seconds));
    hash = mix(hash, interval.end->nanoseconds);
  }
}

std::uint64_t identity_for_configuration(
  const NumericalSegmentAnchor& anchor,
  const NumericalMotionConfiguration& configuration,
  std::uint64_t segment_identity
) noexcept {
  std::uint64_t hash = 1469598103934665603ULL;
  hash = mix(hash, anchor.object_id);
  hash = mix(hash, anchor.propagation_frame);
  hash = mix(hash, static_cast<std::uint64_t>(anchor.epoch.seconds));
  hash = mix(hash, anchor.epoch.nanoseconds);
  hash = mix(hash, segment_identity);
  hash = mix(hash, configuration.configuration_identity);
  hash = mix(hash, configuration.integrator.configuration_identity);
  hash = mix(hash, configuration.force_providers.configuration_identity());
  if (anchor.mass.has_value()) hash = mix(hash, std::bit_cast<std::uint64_t>(*anchor.mass));
  if (configuration.frame_dynamics.has_value()) {
    hash = mix(hash, configuration.frame_dynamics->frame_id);
    hash = mix(hash, configuration.frame_dynamics->revision);
    add_interval_identity(hash, configuration.frame_dynamics->validity);
  }
  for (const auto& provider : configuration.mass_flow_providers) {
    hash = mix(hash, provider.definition.order);
    hash = mix(hash, provider.definition.configuration_identity);
    add_interval_identity(hash, provider.definition.validity);
    for (const auto& dependency : provider.definition.dependencies) {
      hash = mix(hash, static_cast<std::uint64_t>(dependency.kind));
      hash = mix(hash, dependency.id);
      hash = mix(hash, dependency.revision);
    }
  }
  return hash;
}

bool validate_configuration(
  const NumericalSegmentAnchor& anchor,
  const NumericalMotionConfiguration& configuration,
  Failure& failure
) {
  numerical::Failure numerical_failure;
  if (!configuration.integrator.validate(numerical_failure)) {
    set_failure(failure, FailureCode::invalid_configuration, numerical_failure.message.c_str());
    return false;
  }
  if (!configuration.validity.valid()
      || time::compare(configuration.validity.start, anchor.epoch) > 0
      || (configuration.validity.end.has_value()
        && time::compare(anchor.epoch, *configuration.validity.end) >= 0)) {
    set_failure(failure, FailureCode::invalid_configuration, "numerical validity does not contain the segment anchor");
    return false;
  }
  if (!configuration.force_providers.valid()) {
    set_failure(failure, FailureCode::invalid_configuration, "force-provider runtime is invalid");
    return false;
  }
  const numerical::NumericalSampleTime anchor_sample{anchor.epoch, 0.0};
  for (const auto& provider : configuration.force_providers.providers()) {
    if (!provider.definition.validity.contains(anchor_sample)) {
      set_failure(failure, FailureCode::invalid_configuration, "force-provider validity does not contain the segment anchor");
      return false;
    }
  }

  if (anchor.mass.has_value() != configuration.integrator.has_mass_component) {
    set_failure(failure, FailureCode::invalid_configuration, "mass state and integrator mass configuration disagree");
    return false;
  }
  if (!configuration.mass_flow_providers.empty() && !configuration.integrator.has_mass_component) {
    set_failure(failure, FailureCode::missing_mass, "mass flow requires an integrated mass anchor");
    return false;
  }
  std::set<std::uint32_t> mass_orders;
  for (const auto& provider : configuration.mass_flow_providers) {
    if (!provider.evaluate || !provider.definition.validity.valid()
        || !mass_orders.insert(provider.definition.order).second) {
      set_failure(failure, FailureCode::invalid_configuration, "mass-flow providers require unique order, validity, and evaluator");
      return false;
    }
    if (!provider.definition.validity.contains(anchor_sample)) {
      set_failure(failure, FailureCode::invalid_configuration, "mass-flow validity does not contain the segment anchor");
      return false;
    }
  }

  if (anchor.propagation_frame != frame::kRootReferenceFrameId) {
    if (!configuration.frame_dynamics.has_value()) {
      set_failure(failure, FailureCode::missing_frame_dynamics, "non-root numerical frames require continuous frame dynamics");
      return false;
    }
    const auto& frame_dynamics = *configuration.frame_dynamics;
    if (frame_dynamics.frame_id != anchor.propagation_frame
        || !frame_dynamics.validity.valid()
        || !frame_dynamics.sample
        || !frame_dynamics.validity.contains(anchor_sample)) {
      set_failure(failure, FailureCode::invalid_frame_dynamics, "frame dynamics are missing, invalid, or do not contain the anchor");
      return false;
    }
  } else if (configuration.frame_dynamics.has_value()) {
    set_failure(failure, FailureCode::invalid_frame_dynamics, "the inertial root uses direct inertial equations");
    return false;
  }

  for (const auto& boundary : configuration.hard_boundaries) {
    if (!time::is_normalized(boundary.instant)
        || time::compare(boundary.instant, anchor.epoch) <= 0) {
      set_failure(failure, FailureCode::invalid_configuration, "hard boundaries must be exact instants after the segment anchor");
      return false;
    }
  }
  return true;
}

std::vector<numerical::HardBoundary> build_hard_boundaries(
  const NumericalSegmentAnchor& anchor,
  const NumericalMotionConfiguration& configuration
) {
  std::vector<numerical::HardBoundary> result = configuration.hard_boundaries;
  const auto append_interval = [&result](const force::TimeInterval& interval, std::uint64_t identity) {
    result.push_back(numerical::HardBoundary{interval.start, identity});
    if (interval.end.has_value()) result.push_back(numerical::HardBoundary{*interval.end, identity});
  };
  if (configuration.validity.end.has_value()) {
    result.push_back(numerical::HardBoundary{*configuration.validity.end, configuration.configuration_identity});
  }
  for (const auto& boundary : configuration.force_providers.hard_boundaries()) {
    result.push_back(boundary);
  }
  for (const auto& provider : configuration.mass_flow_providers) {
    append_interval(provider.definition.validity, provider.definition.configuration_identity);
  }
  if (configuration.frame_dynamics.has_value()) {
    append_interval(configuration.frame_dynamics->validity, configuration.frame_dynamics->revision);
  }
  std::sort(result.begin(), result.end(), [](const auto& left, const auto& right) {
    if (time::compare(left.instant, right.instant) != 0) {
      return time::compare(left.instant, right.instant) < 0;
    }
    return left.identity < right.identity;
  });
  result.erase(std::remove_if(result.begin(), result.end(), [&anchor](const auto& boundary) {
    return time::compare(boundary.instant, anchor.epoch) <= 0;
  }), result.end());
  return result;
}

bool valid_frame_sample(const FrameDynamicsSample& sample) noexcept {
  return frame::is_valid(sample.root_from_integration_frame)
    && finite_vec(sample.origin_acceleration)
    && finite_vec(sample.angular_velocity)
    && finite_vec(sample.angular_acceleration);
}

void use_left_limit_at_discontinuity(
  const force::TimeInterval& interval,
  const numerical::NumericalSampleTime& original,
  numerical::NumericalSampleTime& adjusted
) noexcept {
  if (!interval.end.has_value() || original.offset_seconds <= 0.0) return;
  const auto duration = time::subtract(*interval.end, original.exact_step_start);
  if (duration.has_value()
      && original.offset_seconds == time::to_seconds(*duration)) {
    adjusted.offset_seconds = std::nextafter(original.offset_seconds, 0.0);
  }
}

}  // namespace

bool is_valid(const NumericalSegmentAnchor& anchor, Failure& failure) noexcept {
  if (anchor.object_id == 0
      || !time::is_normalized(anchor.epoch)
      || !frame::is_valid(anchor.propagation_frame)
      || !finite_vec(anchor.position)
      || !finite_vec(anchor.velocity)
      || anchor.segment_identity == 0) {
    failure = Failure{FailureCode::invalid_anchor, "numerical segment anchor is invalid"};
    return false;
  }
  if (anchor.mass.has_value() && (!finite(*anchor.mass) || *anchor.mass < 0.0)) {
    failure = Failure{FailureCode::invalid_mass, "numerical mass anchor must be finite and non-negative"};
    return false;
  }
  failure = {};
  return true;
}

NumericalMotionSegment::NumericalMotionSegment(
  NumericalSegmentAnchor anchor,
  NumericalMotionConfiguration configuration
)
  : anchor_(std::move(anchor)), configuration_(std::move(configuration)) {
  if (!is_valid(anchor_, construction_failure_)
      || !validate_configuration(anchor_, configuration_, construction_failure_)) {
    return;
  }
  hard_boundaries_ = build_hard_boundaries(anchor_, configuration_);
  auto era = make_era(anchor_, configuration_, configuration_.validity.end, construction_failure_);
  if (!era) return;
  eras_.push_back(std::move(era));
  valid_ = true;
}

NumericalMotionSegment::~NumericalMotionSegment() = default;

bool NumericalMotionSegment::valid() const noexcept { return valid_; }
const Failure& NumericalMotionSegment::construction_failure() const noexcept { return construction_failure_; }
const NumericalSegmentAnchor& NumericalMotionSegment::anchor() const noexcept { return anchor_; }
const NumericalMotionConfiguration& NumericalMotionSegment::configuration() const noexcept { return configuration_; }

std::uint64_t NumericalMotionSegment::cache_identity() const noexcept {
  if (eras_.empty()) return 0;
  return eras_.back()->cache_identity;
}

std::vector<numerical::HardBoundary> NumericalMotionSegment::hard_boundaries() const {
  return hard_boundaries_;
}

std::unique_ptr<NumericalMotionSegment::Era> NumericalMotionSegment::make_era(
  NumericalSegmentAnchor anchor,
  NumericalMotionConfiguration configuration,
  std::optional<time::SimulationInstant> end,
  Failure& failure
) const {
  configuration.hard_boundaries.erase(std::remove_if(
    configuration.hard_boundaries.begin(),
    configuration.hard_boundaries.end(),
    [&anchor](const auto& boundary) {
      return time::compare(boundary.instant, anchor.epoch) <= 0;
    }), configuration.hard_boundaries.end());
  if (!is_valid(anchor, failure) || !validate_configuration(anchor, configuration, failure)) return nullptr;
  if (end.has_value() && time::compare(anchor.epoch, *end) >= 0) {
    set_failure(failure, FailureCode::invalid_configuration, "numerical era has no positive validity interval");
    return nullptr;
  }

  std::sort(configuration.mass_flow_providers.begin(), configuration.mass_flow_providers.end(), [](const auto& left, const auto& right) {
    return left.definition.order < right.definition.order;
  });
  auto era = std::make_unique<Era>(Era{
    anchor.epoch,
    end,
    anchor,
    std::move(configuration),
    nullptr,
    0,
  });
  era->cache_identity = identity_for_configuration(era->anchor, era->configuration, era->anchor.segment_identity);
  auto local_boundaries = build_hard_boundaries(era->anchor, era->configuration);
  numerical::Anchor tape_anchor{
    era->anchor.epoch,
    {era->anchor.position.x, era->anchor.position.y, era->anchor.position.z,
     era->anchor.velocity.x, era->anchor.velocity.y, era->anchor.velocity.z},
    era->anchor.segment_identity,
  };
  if (era->anchor.mass.has_value()) tape_anchor.state.push_back(*era->anchor.mass);
  era->configuration.integrator.has_mass_component = era->anchor.mass.has_value();
  era->tape = std::make_unique<numerical::DOP853Tape>(
    std::move(tape_anchor),
    era->configuration.integrator,
    [era_pointer = era.get()](
      const numerical::NumericalSampleTime& sample_time,
      std::span<const double> state,
      std::span<double> derivative,
      numerical::Failure& output
    ) {
      return evaluate_derivative(*era_pointer, sample_time, state, derivative, output);
    },
    std::move(local_boundaries));
  if (!era->tape->valid()) {
    const auto& tape_failure = era->tape->construction_failure();
    set_failure(failure, FailureCode::numerical_failure, tape_failure.message.c_str());
    return nullptr;
  }
  failure = {};
  return era;
}

NumericalMotionSegment::Era* NumericalMotionSegment::find_era(time::SimulationInstant target) noexcept {
  for (const auto& era : eras_) {
    if (time::compare(target, era->start) >= 0
        && (!era->end.has_value() || time::compare(target, *era->end) < 0)) return era.get();
  }
  return nullptr;
}

const NumericalMotionSegment::Era* NumericalMotionSegment::find_era(time::SimulationInstant target) const noexcept {
  for (const auto& era : eras_) {
    if (time::compare(target, era->start) >= 0
        && (!era->end.has_value() || time::compare(target, *era->end) < 0)) return era.get();
  }
  return nullptr;
}

bool NumericalMotionSegment::evaluate_state_vector(
  Era& era,
  time::SimulationInstant target,
  std::vector<double>& values,
  Failure& failure
) {
  numerical::Failure tape_failure;
  if (!era.tape->evaluate(target, values, tape_failure)) {
    const auto message = tape_failure.message.empty() ? "numerical tape evaluation failed" : tape_failure.message;
    const auto code = tape_failure.code == numerical::FailureCode::unsupported_temporal_direction
      ? FailureCode::unsupported_temporal_direction
      : FailureCode::numerical_failure;
    set_failure(failure, code, message.c_str());
    return false;
  }
  return true;
}

bool NumericalMotionSegment::state_at(
  time::SimulationInstant target,
  NumericalState& state,
  Failure& failure
) {
  if (!valid_) {
    failure = construction_failure_;
    return false;
  }
  if (!time::is_normalized(target)) {
    set_failure(failure, FailureCode::target_outside_validity, "target instant is not normalized");
    return false;
  }
  if (time::compare(target, anchor_.epoch) < 0) {
    set_failure(failure, FailureCode::unsupported_temporal_direction, "numerical motion is forward-only from its exact anchor");
    return false;
  }
  Era* era = find_era(target);
  if (era == nullptr) {
    set_failure(failure, FailureCode::target_outside_validity, "target instant is outside the numerical segment validity");
    return false;
  }
  std::vector<double> values;
  if (!evaluate_state_vector(*era, target, values, failure)) return false;
  const bool has_mass = era->anchor.mass.has_value();
  if (values.size() != (has_mass ? 7U : 6U)) {
    set_failure(failure, FailureCode::numerical_failure, "numerical tape returned an unexpected state dimension");
    return false;
  }
  state = NumericalState{
    target,
    era->anchor.propagation_frame,
    Vec3{values[0], values[1], values[2]},
    Vec3{values[3], values[4], values[5]},
    has_mass ? std::optional<double>{values[6]} : std::nullopt,
  };
  if (!finite_vec(state.position) || !finite_vec(state.velocity)
      || (state.mass.has_value() && (!finite(*state.mass) || *state.mass < 0.0))) {
    set_failure(failure, FailureCode::invalid_mass, "numerical state contains a non-finite or negative physical value");
    return false;
  }
  failure = {};
  return true;
}

bool NumericalMotionSegment::mass_at(
  time::SimulationInstant target,
  std::optional<double>& mass,
  Failure& failure
) {
  NumericalState state;
  if (!state_at(target, state, failure)) return false;
  mass = state.mass;
  if (!mass.has_value()) {
    set_failure(failure, FailureCode::missing_mass, "the numerical segment does not own an integrated mass state");
    return false;
  }
  return true;
}

bool NumericalMotionSegment::invalidate_from(
  time::SimulationInstant instant,
  std::uint64_t new_segment_identity,
  Failure& failure
) {
  if (!valid_ || new_segment_identity == 0 || !time::is_normalized(instant)) {
    set_failure(failure, FailureCode::invalid_configuration, "numerical cache invalidation request is invalid");
    return false;
  }
  const auto target_era = find_era(instant);
  if (target_era == nullptr) {
    set_failure(failure, FailureCode::target_outside_validity, "cache invalidation instant is outside the numerical segment");
    return false;
  }
  std::size_t index = 0;
  while (index < eras_.size() && eras_[index].get() != target_era) ++index;
  if (index == eras_.size()) {
    set_failure(failure, FailureCode::invalid_configuration, "numerical cache era lookup failed");
    return false;
  }

  NumericalState current;
  if (!state_at(instant, current, failure)) return false;
  NumericalSegmentAnchor successor_anchor{
    anchor_.object_id,
    instant,
    anchor_.propagation_frame,
    current.position,
    current.velocity,
    current.mass,
    new_segment_identity,
  };
  auto successor = make_era(
    successor_anchor,
    target_era->configuration,
    target_era->end,
    failure);
  if (!successor) return false;

  if (time::compare(instant, target_era->start) == 0) {
    eras_[index] = std::move(successor);
  } else {
    target_era->end = instant;
    eras_.insert(eras_.begin() + static_cast<std::ptrdiff_t>(index + 1), std::move(successor));
  }
  failure = {};
  return true;
}

numerical::TapeDiagnostics NumericalMotionSegment::diagnostics() const noexcept {
  if (eras_.empty()) return {};
  return eras_.back()->tape->diagnostics();
}

bool NumericalMotionSegment::evaluate_derivative(
  const Era& era,
  const numerical::NumericalSampleTime& sample_time,
  std::span<const double> state,
  std::span<double> derivative,
  numerical::Failure& failure
) {
  const bool has_mass = era.anchor.mass.has_value();
  if (state.size() != (has_mass ? 7U : 6U) || derivative.size() != state.size()) {
    set_numerical_failure(failure, numerical::FailureCode::invalid_state, "numerical motion state dimension is invalid");
    return false;
  }
  if (!std::all_of(state.begin(), state.end(), finite)) {
    set_numerical_failure(failure, numerical::FailureCode::invalid_state, "numerical motion state is non-finite");
    return false;
  }
  const std::optional<double> mass = has_mass ? std::optional<double>{state[6]} : std::nullopt;
  if (mass.has_value() && (!finite(*mass) || *mass < 0.0)) {
    set_numerical_failure(failure, numerical::FailureCode::invalid_state, "numerical physical mass is negative or non-finite");
    return false;
  }

  // DOP853 needs the endpoint derivative to build a step that lands exactly
  // on a discontinuity. Evaluate that endpoint using the left-hand continuous
  // sample; the next accepted step starts at the exact boundary and cannot
  // reuse this derivative across the configuration change.
  numerical::NumericalSampleTime dependency_sample = sample_time;
  for (const auto& provider : era.configuration.force_providers.providers()) {
    use_left_limit_at_discontinuity(provider.definition.validity, sample_time, dependency_sample);
  }
  for (const auto& provider : era.configuration.mass_flow_providers) {
    use_left_limit_at_discontinuity(provider.definition.validity, sample_time, dependency_sample);
  }
  if (era.configuration.frame_dynamics.has_value()) {
    use_left_limit_at_discontinuity(era.configuration.frame_dynamics->validity, sample_time, dependency_sample);
  }

  Vec3 acceleration{};
  force::Failure force_failure;
  if (!era.configuration.force_providers.evaluate(
        force::ForceEvaluationContext{
          era.anchor.object_id,
          dependency_sample,
          Vec3{state[0], state[1], state[2]},
          mass,
        },
        acceleration,
        force_failure)) {
    set_force_failure(failure, force_failure);
    return false;
  }

  if (era.anchor.propagation_frame != frame::kRootReferenceFrameId) {
    const auto& definition = *era.configuration.frame_dynamics;
    if (!definition.validity.contains(dependency_sample)) {
      set_numerical_failure(failure, numerical::FailureCode::derivative_failure, "frame dynamics are outside their exact validity interval");
      return false;
    }
    FrameDynamicsSample sample;
    Failure frame_failure;
    if (!definition.sample(dependency_sample, sample, frame_failure)) {
      set_numerical_failure(
        failure,
        numerical::FailureCode::derivative_failure,
        frame_failure.message.empty() ? "frame dynamics sampling failed" : frame_failure.message);
      return false;
    }
    if (!valid_frame_sample(sample)) {
      set_numerical_failure(failure, numerical::FailureCode::non_finite_derivative, "frame dynamics sample is non-finite or not normalized");
      return false;
    }
    const Vec3 position{state[0], state[1], state[2]};
    const Vec3 velocity{state[3], state[4], state[5]};
    const Vec3 coriolis = scale(cross(sample.angular_velocity, velocity), 2.0);
    const Vec3 centrifugal = cross(sample.angular_velocity, cross(sample.angular_velocity, position));
    const Vec3 euler = cross(sample.angular_acceleration, position);
    acceleration = subtract(acceleration, add(sample.origin_acceleration, add(coriolis, add(centrifugal, euler))));
  }
  if (!finite_vec(acceleration)) {
    set_numerical_failure(failure, numerical::FailureCode::non_finite_derivative, "numerical acceleration is non-finite");
    return false;
  }

  derivative[0] = state[3];
  derivative[1] = state[4];
  derivative[2] = state[5];
  derivative[3] = acceleration.x;
  derivative[4] = acceleration.y;
  derivative[5] = acceleration.z;
  if (has_mass) {
    double mass_rate = 0.0;
    for (const auto& provider : era.configuration.mass_flow_providers) {
      if (!provider.definition.validity.contains(dependency_sample)) {
        set_numerical_failure(failure, numerical::FailureCode::derivative_failure, "mass-flow provider is outside its exact validity interval");
        return false;
      }
      double contribution = 0.0;
      if (!provider.evaluate(
            force::ForceEvaluationContext{
              era.anchor.object_id,
              dependency_sample,
              Vec3{state[0], state[1], state[2]},
              mass,
            },
            contribution,
            force_failure)) {
        set_force_failure(failure, force_failure);
        return false;
      }
      if (!finite(contribution)) {
        set_numerical_failure(failure, numerical::FailureCode::non_finite_derivative, "mass-flow provider returned a non-finite rate");
        return false;
      }
      mass_rate += contribution;
      if (!finite(mass_rate)) {
        set_numerical_failure(failure, numerical::FailureCode::non_finite_derivative, "mass-flow accumulation is non-finite");
        return false;
      }
    }
    derivative[6] = mass_rate;
  }
  if (!std::all_of(derivative.begin(), derivative.end(), finite)) {
    set_numerical_failure(failure, numerical::FailureCode::non_finite_derivative, "numerical derivative is non-finite");
    return false;
  }
  failure = {};
  return true;
}

}  // namespace orbit_engine::numerical_motion
