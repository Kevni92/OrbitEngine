#include "orbit_engine/coupled.hpp"

#include <algorithm>
#include <atomic>
#include <bit>
#include <cmath>
#include <set>
#include <utility>

namespace orbit_engine::coupled {
namespace {

using Vec3 = frame::Vec3;

std::atomic<CoupledAuthorityId> next_authority_id{1};

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

void fail(Failure& failure, FailureCode code, const char* message) {
  failure = Failure{code, message};
}

void numerical_fail(numerical::Failure& failure, numerical::FailureCode code, const std::string& message) {
  failure = numerical::Failure{code, message};
}

void force_fail(numerical::Failure& failure, const force::Failure& source) {
  numerical_fail(
    failure,
    numerical::FailureCode::derivative_failure,
    source.message.empty() ? "external force evaluation failed" : source.message);
}

void add_interval_identity(std::uint64_t& hash, const force::TimeInterval& interval) noexcept {
  hash ^= static_cast<std::uint64_t>(interval.start.seconds);
  hash *= 1099511628211ULL;
  hash ^= interval.start.nanoseconds;
  hash *= 1099511628211ULL;
  if (interval.end.has_value()) {
    hash ^= static_cast<std::uint64_t>(interval.end->seconds);
    hash *= 1099511628211ULL;
    hash ^= interval.end->nanoseconds;
    hash *= 1099511628211ULL;
  }
}

std::vector<numerical::HardBoundary> boundaries_for(
  const MemberAnchor& anchor,
  const Configuration& configuration
) {
  std::vector<numerical::HardBoundary> result = configuration.hard_boundaries;
  for (const auto& boundary : configuration.external_providers.hard_boundaries()) result.push_back(boundary);
  if (configuration.validity_end.has_value()) {
    result.push_back(numerical::HardBoundary{*configuration.validity_end, configuration.configuration_identity});
  }
  if (configuration.frame_dynamics.has_value()) {
    const auto& interval = configuration.frame_dynamics->validity;
    result.push_back(numerical::HardBoundary{interval.start, configuration.frame_dynamics->revision});
    if (interval.end.has_value()) result.push_back(numerical::HardBoundary{*interval.end, configuration.frame_dynamics->revision});
  }
  std::sort(result.begin(), result.end(), [](const auto& left, const auto& right) {
    if (time::compare(left.instant, right.instant) != 0) return time::compare(left.instant, right.instant) < 0;
    return left.identity < right.identity;
  });
  result.erase(std::remove_if(result.begin(), result.end(), [&anchor](const auto& boundary) {
    return time::compare(boundary.instant, anchor.epoch) <= 0;
  }), result.end());
  return result;
}

bool valid_member(const MemberAnchor& member, time::SimulationInstant epoch, frame::ReferenceFrameId frame_id, Failure& failure) {
  if (member.object_id == 0 || !time::is_normalized(member.epoch)
      || time::compare(member.epoch, epoch) != 0
      || member.propagation_frame != frame_id
      || !frame::is_valid(member.propagation_frame)
      || !finite_vec(member.position) || !finite_vec(member.velocity)) {
    fail(failure, FailureCode::invalid_membership, "coupled member anchor is invalid or not canonical");
    return false;
  }
  if (member.mass.has_value() && (!finite(*member.mass) || *member.mass < 0.0)) {
    fail(failure, FailureCode::invalid_state, "coupled member mass is negative or non-finite");
    return false;
  }
  if (member.mu.has_value() && (!finite(*member.mu) || *member.mu < 0.0)) {
    fail(failure, FailureCode::invalid_state, "coupled member mu is negative or non-finite");
    return false;
  }
  return true;
}

bool validate_configuration(
  const std::vector<MemberAnchor>& members,
  const Configuration& configuration,
  Failure& failure
) {
  if (members.size() < 2 || members.size() > 32) {
    fail(failure, FailureCode::invalid_membership, "coupled authority requires between 2 and 32 members");
    return false;
  }
  const auto& first = members.front();
  numerical::Failure numerical_failure;
  if (!configuration.integrator.validate(numerical_failure)) {
    fail(failure, FailureCode::invalid_configuration, "coupled numerical configuration is invalid");
    return false;
  }
  if (configuration.integrator.has_mass_component) {
    fail(failure, FailureCode::invalid_configuration, "coupled v1 uses one fixed physical mass per member");
    return false;
  }
  if (configuration.validity_end.has_value()
      && (!time::is_normalized(*configuration.validity_end)
        || time::compare(first.epoch, *configuration.validity_end) >= 0)) {
    fail(failure, FailureCode::invalid_configuration, "coupled validity end must be after the exact anchor");
    return false;
  }
  if (!configuration.external_providers.valid()) {
    fail(failure, FailureCode::invalid_configuration, "coupled external force runtime is invalid");
    return false;
  }
  const numerical::NumericalSampleTime sample{first.epoch, 0.0};
  for (const auto& provider : configuration.external_providers.providers()) {
    if (!provider.definition.validity.contains(sample)) {
      fail(failure, FailureCode::invalid_configuration, "external provider validity does not contain the coupled anchor");
      return false;
    }
  }
  if (first.propagation_frame != frame::kRootReferenceFrameId) {
    if (!configuration.frame_dynamics.has_value()
        || configuration.frame_dynamics->frame_id != first.propagation_frame
        || !configuration.frame_dynamics->validity.valid()
        || !configuration.frame_dynamics->sample
        || !configuration.frame_dynamics->validity.contains(sample)) {
      fail(failure, FailureCode::invalid_configuration, "non-root coupled frames require continuous frame dynamics");
      return false;
    }
  } else if (configuration.frame_dynamics.has_value()) {
    fail(failure, FailureCode::invalid_configuration, "the inertial root does not accept non-inertial frame dynamics");
    return false;
  }
  for (const auto& boundary : configuration.hard_boundaries) {
    if (!time::is_normalized(boundary.instant)
        || time::compare(boundary.instant, first.epoch) <= 0) {
      fail(failure, FailureCode::invalid_configuration, "coupled hard boundaries must be after the exact anchor");
      return false;
    }
  }
  return true;
}

std::uint64_t identity_for(
  const std::vector<MemberAnchor>& members,
  const Configuration& configuration,
  CoupledAuthorityId authority_id,
  std::uint64_t revision
) noexcept {
  std::uint64_t hash = 1469598103934665603ULL;
  hash ^= authority_id; hash *= 1099511628211ULL;
  hash ^= revision; hash *= 1099511628211ULL;
  hash ^= configuration.configuration_identity; hash *= 1099511628211ULL;
  hash ^= configuration.integrator.configuration_identity; hash *= 1099511628211ULL;
  for (const auto component : configuration.integrator.component_kinds) {
    hash ^= static_cast<std::uint64_t>(component); hash *= 1099511628211ULL;
  }
  hash ^= configuration.external_providers.configuration_identity(); hash *= 1099511628211ULL;
  for (const auto& member : members) {
    hash ^= member.object_id; hash *= 1099511628211ULL;
    hash ^= static_cast<std::uint64_t>(member.epoch.seconds); hash *= 1099511628211ULL;
    hash ^= member.epoch.nanoseconds; hash *= 1099511628211ULL;
    hash ^= std::bit_cast<std::uint64_t>(member.position.x); hash *= 1099511628211ULL;
    hash ^= std::bit_cast<std::uint64_t>(member.position.y); hash *= 1099511628211ULL;
    hash ^= std::bit_cast<std::uint64_t>(member.position.z); hash *= 1099511628211ULL;
    hash ^= std::bit_cast<std::uint64_t>(member.velocity.x); hash *= 1099511628211ULL;
    hash ^= std::bit_cast<std::uint64_t>(member.velocity.y); hash *= 1099511628211ULL;
    hash ^= std::bit_cast<std::uint64_t>(member.velocity.z); hash *= 1099511628211ULL;
    hash ^= member.motion_revision; hash *= 1099511628211ULL;
    hash ^= member.property_revision; hash *= 1099511628211ULL;
    hash ^= member.mass_revision; hash *= 1099511628211ULL;
    if (member.mass.has_value()) { hash ^= std::bit_cast<std::uint64_t>(*member.mass); hash *= 1099511628211ULL; }
    if (member.mu.has_value()) { hash ^= std::bit_cast<std::uint64_t>(*member.mu); hash *= 1099511628211ULL; }
  }
  if (configuration.frame_dynamics.has_value()) {
    hash ^= configuration.frame_dynamics->revision; hash *= 1099511628211ULL;
    add_interval_identity(hash, configuration.frame_dynamics->validity);
  }
  if (configuration.validity_end.has_value()) {
    hash ^= static_cast<std::uint64_t>(configuration.validity_end->seconds); hash *= 1099511628211ULL;
    hash ^= configuration.validity_end->nanoseconds; hash *= 1099511628211ULL;
  }
  for (const auto& boundary : configuration.hard_boundaries) {
    hash ^= static_cast<std::uint64_t>(boundary.instant.seconds); hash *= 1099511628211ULL;
    hash ^= boundary.instant.nanoseconds; hash *= 1099511628211ULL;
    hash ^= boundary.identity; hash *= 1099511628211ULL;
  }
  return hash;
}

void use_left_limit_at_discontinuity(
  const force::TimeInterval& interval,
  const numerical::NumericalSampleTime& original,
  numerical::NumericalSampleTime& adjusted
) noexcept {
  if (!interval.end.has_value() || original.offset_seconds <= 0.0) return;
  const auto duration = time::subtract(*interval.end, original.exact_step_start);
  if (duration.has_value() && original.offset_seconds == time::to_seconds(*duration)) {
    adjusted.offset_seconds = std::nextafter(original.offset_seconds, 0.0);
  }
}

double strength(const MemberAnchor& member) noexcept {
  if (member.mu.has_value()) return *member.mu;
  if (member.mass.has_value()) return force::kNewtonianGravitationalConstant * *member.mass;
  return 0.0;
}

}  // namespace

CoupledAuthority::CoupledAuthority(
  std::vector<MemberAnchor> members,
  Configuration configuration,
  std::uint64_t group_revision
)
  : members_(std::move(members)), configuration_(std::move(configuration)) {
  std::sort(members_.begin(), members_.end(), [](const auto& left, const auto& right) { return left.object_id < right.object_id; });
  if (members_.empty()
      || !validate_configuration(members_, configuration_, construction_failure_)) return;
  std::set<object::ObjectId> ids;
  for (const auto& member : members_) {
    if (!ids.insert(member.object_id).second
        || !valid_member(member, members_.front().epoch, members_.front().propagation_frame, construction_failure_)) return;
  }
  if (!configuration_.integrator.component_kinds.empty()) {
    if (configuration_.integrator.component_kinds.size() != members_.size() * 6U) {
      fail(construction_failure_, FailureCode::invalid_configuration, "coupled component tolerance layout has the wrong size");
      return;
    }
  } else {
    configuration_.integrator.component_kinds.reserve(members_.size() * 6U);
    for (std::size_t index = 0; index < members_.size(); ++index) {
      configuration_.integrator.component_kinds.insert(
        configuration_.integrator.component_kinds.end(),
        {numerical::ComponentKind::position, numerical::ComponentKind::position, numerical::ComponentKind::position,
         numerical::ComponentKind::velocity, numerical::ComponentKind::velocity, numerical::ComponentKind::velocity});
    }
  }
  hard_boundaries_ = boundaries_for(members_.front(), configuration_);
  configuration_.hard_boundaries = hard_boundaries_;
  authority_id_ = next_authority_id.fetch_add(1);
  group_revision_ = group_revision == 0 ? authority_id_ : group_revision;
  cache_identity_ = identity_for(members_, configuration_, authority_id_, group_revision_);

  numerical::Anchor anchor;
  anchor.epoch = members_.front().epoch;
  anchor.segment_identity = cache_identity_;
  anchor.state.reserve(members_.size() * 6U);
  for (const auto& member : members_) {
    anchor.state.insert(anchor.state.end(), {
      member.position.x, member.position.y, member.position.z,
      member.velocity.x, member.velocity.y, member.velocity.z,
    });
  }
  tape_ = std::make_unique<numerical::DOP853Tape>(
    std::move(anchor),
    configuration_.integrator,
    [this](const numerical::NumericalSampleTime& sample_time, std::span<const double> state, std::span<double> derivative, numerical::Failure& failure) {
      return evaluate_derivative(*this, sample_time, state, derivative, failure);
    },
    hard_boundaries_);
  if (!tape_->valid()) {
    fail(construction_failure_, FailureCode::numerical_failure, tape_->construction_failure().message.c_str());
    tape_.reset();
    return;
  }
  valid_ = true;
}

CoupledAuthority::~CoupledAuthority() = default;

bool CoupledAuthority::valid() const noexcept { return valid_; }
const Failure& CoupledAuthority::construction_failure() const noexcept { return construction_failure_; }
CoupledAuthorityId CoupledAuthority::authority_id() const noexcept { return authority_id_; }
std::uint64_t CoupledAuthority::group_revision() const noexcept { return group_revision_; }
std::uint64_t CoupledAuthority::cache_identity() const noexcept { return cache_identity_; }
const std::vector<MemberAnchor>& CoupledAuthority::members() const noexcept { return members_; }
const Configuration& CoupledAuthority::configuration() const noexcept { return configuration_; }
std::vector<numerical::HardBoundary> CoupledAuthority::hard_boundaries() const { return hard_boundaries_; }

std::size_t CoupledAuthority::member_slot(object::ObjectId object_id) const noexcept {
  for (std::size_t index = 0; index < members_.size(); ++index) {
    if (members_[index].object_id == object_id) return index;
  }
  return members_.size();
}

bool CoupledAuthority::evaluate_shared(
  time::SimulationInstant target,
  std::vector<double>& values,
  Failure& failure
) {
  if (!valid_) {
    failure = construction_failure_;
    return false;
  }
  if (!time::is_normalized(target)) {
    fail(failure, FailureCode::target_outside_validity, "coupled target instant is not normalized");
    return false;
  }
  if (time::compare(target, members_.front().epoch) < 0) {
    fail(failure, FailureCode::unsupported_temporal_direction, "coupled authority integrates forward only from its exact anchor");
    return false;
  }
  if (configuration_.validity_end.has_value() && time::compare(target, *configuration_.validity_end) >= 0) {
    fail(failure, FailureCode::target_outside_validity, "coupled target is outside its validity interval");
    return false;
  }
  ++shared_evaluation_count_;
  numerical::Failure tape_failure;
  if (!tape_->evaluate(target, values, tape_failure)) {
    const auto code = tape_failure.code == numerical::FailureCode::unsupported_temporal_direction
      ? FailureCode::unsupported_temporal_direction
      : FailureCode::numerical_failure;
    fail(failure, code, tape_failure.message.empty() ? "coupled tape evaluation failed" : tape_failure.message.c_str());
    return false;
  }
  return true;
}

bool CoupledAuthority::extract_state(
  object::ObjectId object_id,
  time::SimulationInstant target,
  const std::vector<double>& values,
  MemberState& state,
  Failure& failure
) const {
  const auto slot = member_slot(object_id);
  if (slot == members_.size() || values.size() != members_.size() * 6U) {
    fail(failure, FailureCode::invalid_membership, "requested object is not a coupled member");
    return false;
  }
  const auto offset = slot * 6U;
  state = MemberState{
    target,
    members_[slot].propagation_frame,
    Vec3{values[offset], values[offset + 1], values[offset + 2]},
    Vec3{values[offset + 3], values[offset + 4], values[offset + 5]},
    members_[slot].mass,
  };
  if (!finite_vec(state.position) || !finite_vec(state.velocity)) {
    fail(failure, FailureCode::invalid_state, "coupled result contains a non-finite state");
    return false;
  }
  return true;
}

bool CoupledAuthority::state_at(
  object::ObjectId object_id,
  time::SimulationInstant target,
  MemberState& state,
  Failure& failure
) {
  std::vector<MemberState> states;
  if (!state_batch({object_id}, target, states, failure)) return false;
  state = states.front();
  return true;
}

bool CoupledAuthority::state_batch(
  const std::vector<object::ObjectId>& object_ids,
  time::SimulationInstant target,
  std::vector<MemberState>& states,
  Failure& failure
) {
  if (object_ids.empty()) {
    fail(failure, FailureCode::invalid_membership, "coupled batch request cannot be empty");
    return false;
  }
  std::set<object::ObjectId> unique;
  for (const auto object_id : object_ids) {
    if (!unique.insert(object_id).second || member_slot(object_id) == members_.size()) {
      fail(failure, FailureCode::invalid_membership, "coupled batch contains an unknown or duplicate object");
      return false;
    }
  }
  std::vector<double> values;
  if (!evaluate_shared(target, values, failure)) return false;
  std::vector<MemberState> result;
  result.reserve(object_ids.size());
  for (const auto object_id : object_ids) {
    MemberState state;
    if (!extract_state(object_id, target, values, state, failure)) return false;
    result.push_back(state);
  }
  states = std::move(result);
  failure = {};
  return true;
}

std::size_t CoupledAuthority::shared_evaluation_count() const noexcept { return shared_evaluation_count_; }
numerical::TapeDiagnostics CoupledAuthority::diagnostics() const noexcept { return tape_ ? tape_->diagnostics() : numerical::TapeDiagnostics{}; }

bool CoupledAuthority::evaluate_derivative(
  const CoupledAuthority& authority,
  const numerical::NumericalSampleTime& sample_time,
  std::span<const double> state,
  std::span<double> derivative,
  numerical::Failure& failure
) {
  const auto count = authority.members_.size();
  if (state.size() != count * 6U || derivative.size() != state.size()) {
    numerical_fail(failure, numerical::FailureCode::invalid_state, "coupled state vector dimension is invalid");
    return false;
  }
  if (!std::all_of(state.begin(), state.end(), finite)) {
    numerical_fail(failure, numerical::FailureCode::invalid_state, "coupled state vector is non-finite");
    return false;
  }
  std::vector<Vec3> positions(count);
  std::vector<Vec3> accelerations(count, Vec3{0.0, 0.0, 0.0});
  for (std::size_t index = 0; index < count; ++index) {
    const auto offset = index * 6U;
    positions[index] = Vec3{state[offset], state[offset + 1], state[offset + 2]};
  }

  numerical::NumericalSampleTime dependency_sample = sample_time;
  for (const auto& provider : authority.configuration_.external_providers.providers()) {
    use_left_limit_at_discontinuity(provider.definition.validity, sample_time, dependency_sample);
  }
  if (authority.configuration_.frame_dynamics.has_value()) {
    use_left_limit_at_discontinuity(authority.configuration_.frame_dynamics->validity, sample_time, dependency_sample);
  }

  // Canonical i<j pair order is the only source of mutual gravity. There is
  // no recursive member state query and therefore no dependency cycle.
  for (std::size_t i = 0; i < count; ++i) {
    for (std::size_t j = i + 1; j < count; ++j) {
      const Vec3 displacement{
        positions[j].x - positions[i].x,
        positions[j].y - positions[i].y,
        positions[j].z - positions[i].z,
      };
      const double distance_squared = displacement.x * displacement.x
        + displacement.y * displacement.y + displacement.z * displacement.z;
      const double source_i = strength(authority.members_[i]);
      const double source_j = strength(authority.members_[j]);
      if (source_i == 0.0 && source_j == 0.0) continue;
      if (!finite(distance_squared) || distance_squared <= 0.0) {
        numerical_fail(failure, numerical::FailureCode::derivative_failure, "coupled members occupy a singular gravity geometry");
        return false;
      }
      const double inverse_distance = 1.0 / std::sqrt(distance_squared);
      const double inverse_distance_cubed = inverse_distance * inverse_distance * inverse_distance;
      if (source_j != 0.0) accelerations[i] = add(accelerations[i], scale(displacement, source_j * inverse_distance_cubed));
      if (source_i != 0.0) accelerations[j] = add(accelerations[j], scale(displacement, -source_i * inverse_distance_cubed));
    }
  }

  for (std::size_t index = 0; index < count; ++index) {
    force::Failure force_failure;
    Vec3 external_acceleration{};
    if (!authority.configuration_.external_providers.evaluate(
          force::ForceEvaluationContext{
            authority.members_[index].object_id,
            dependency_sample,
            positions[index],
            authority.members_[index].mass,
          },
          external_acceleration,
          force_failure)) {
      force_fail(failure, force_failure);
      return false;
    }
    accelerations[index] = add(accelerations[index], external_acceleration);
  }

  if (authority.members_.front().propagation_frame != frame::kRootReferenceFrameId) {
    numerical_motion::FrameDynamicsSample frame_sample;
    numerical_motion::Failure frame_failure;
    if (!authority.configuration_.frame_dynamics->sample(dependency_sample, frame_sample, frame_failure)) {
      numerical_fail(failure, numerical::FailureCode::derivative_failure, frame_failure.message.empty() ? "coupled frame dynamics sampling failed" : frame_failure.message);
      return false;
    }
    if (!frame::is_valid(frame_sample.root_from_integration_frame)
        || !finite_vec(frame_sample.origin_acceleration)
        || !finite_vec(frame_sample.angular_velocity)
        || !finite_vec(frame_sample.angular_acceleration)) {
      numerical_fail(failure, numerical::FailureCode::non_finite_derivative, "coupled frame dynamics are non-finite");
      return false;
    }
    for (std::size_t index = 0; index < count; ++index) {
      const auto offset = index * 6U;
      const Vec3 velocity{state[offset + 3], state[offset + 4], state[offset + 5]};
      const Vec3 coriolis = scale(cross(frame_sample.angular_velocity, velocity), 2.0);
      const Vec3 centrifugal = cross(frame_sample.angular_velocity, cross(frame_sample.angular_velocity, positions[index]));
      const Vec3 euler = cross(frame_sample.angular_acceleration, positions[index]);
      accelerations[index] = subtract(accelerations[index], add(frame_sample.origin_acceleration, add(coriolis, add(centrifugal, euler))));
    }
  }

  for (std::size_t index = 0; index < count; ++index) {
    const auto offset = index * 6U;
    derivative[offset] = state[offset + 3];
    derivative[offset + 1] = state[offset + 4];
    derivative[offset + 2] = state[offset + 5];
    derivative[offset + 3] = accelerations[index].x;
    derivative[offset + 4] = accelerations[index].y;
    derivative[offset + 5] = accelerations[index].z;
  }
  if (!std::all_of(derivative.begin(), derivative.end(), finite)) {
    numerical_fail(failure, numerical::FailureCode::non_finite_derivative, "coupled derivative is non-finite");
    return false;
  }
  failure = {};
  return true;
}

const CoupledAuthority* CoupledAuthorityManager::authority() const noexcept { return authority_.get(); }

bool CoupledAuthorityManager::promote(
  time::SimulationInstant target,
  std::vector<MemberCandidate> candidates,
  Configuration configuration,
  Failure& failure
) {
  if (!time::is_normalized(target) || candidates.size() < 2 || candidates.size() > 32) {
    fail(failure, FailureCode::transaction_rejected, "coupled promotion requires an exact target and 2..32 candidates");
    return false;
  }
  std::sort(candidates.begin(), candidates.end(), [](const auto& left, const auto& right) { return left.object_id < right.object_id; });
  std::vector<MemberAnchor> anchors;
  anchors.reserve(candidates.size());
  std::set<object::ObjectId> ids;
  for (auto& candidate : candidates) {
    if (!ids.insert(candidate.object_id).second || !candidate.evaluate) {
      fail(failure, FailureCode::transaction_rejected, "coupled promotion contains a duplicate or missing candidate");
      return false;
    }
    MemberAnchor anchor;
    if (!candidate.evaluate(target, anchor, failure)) {
      if (failure.code == FailureCode::none) fail(failure, FailureCode::transaction_rejected, "coupled promotion candidate evaluation failed");
      return false;
    }
    anchor.object_id = candidate.object_id;
    anchor.epoch = target;
    anchor.motion_revision = candidate.motion_revision;
    anchor.property_revision = candidate.property_revision;
    anchor.mass_revision = candidate.mass_revision;
    anchors.push_back(anchor);
  }
  auto replacement = make_successor(target, anchors, configuration, failure);
  if (!replacement) return false;
  authority_ = std::move(replacement);
  failure = {};
  return true;
}

std::unique_ptr<CoupledAuthority> CoupledAuthorityManager::make_successor(
  time::SimulationInstant target,
  const std::vector<MemberAnchor>& anchors,
  const Configuration& configuration,
  Failure& failure
) {
  auto successor_configuration = configuration;
  auto successor = std::make_unique<CoupledAuthority>(anchors, std::move(successor_configuration), next_group_revision_++);
  if (!successor->valid()) {
    failure = successor->construction_failure();
    return nullptr;
  }
  return successor;
}

bool CoupledAuthorityManager::demote(
  time::SimulationInstant target,
  const std::vector<object::ObjectId>& object_ids,
  std::vector<MemberAnchor>& successor_anchors,
  Failure& failure
) {
  if (!authority_ || !authority_->valid() || object_ids.empty()) {
    fail(failure, FailureCode::transaction_rejected, "no coupled authority or empty demotion request");
    return false;
  }
  std::set<object::ObjectId> requested;
  for (const auto object_id : object_ids) {
    if (!requested.insert(object_id).second || authority_->member_slot(object_id) == authority_->members().size()) {
      fail(failure, FailureCode::transaction_rejected, "demotion contains an unknown or duplicate member");
      return false;
    }
  }
  std::vector<object::ObjectId> all_ids;
  all_ids.reserve(authority_->members().size());
  for (const auto& member : authority_->members()) all_ids.push_back(member.object_id);
  std::vector<MemberState> states;
  if (!authority_->state_batch(all_ids, target, states, failure)) return false;
  std::vector<MemberAnchor> requested_anchors;
  requested_anchors.reserve(object_ids.size());
  for (std::size_t index = 0; index < object_ids.size(); ++index) {
    const auto slot = authority_->member_slot(object_ids[index]);
    const auto& old = authority_->members()[slot];
    requested_anchors.push_back(MemberAnchor{
      old.object_id, target, old.propagation_frame, states[slot].position, states[slot].velocity,
      states[slot].mass, old.mu, old.motion_revision + 1, old.property_revision, old.mass_revision,
    });
  }
  std::vector<MemberAnchor> remaining;
  std::vector<object::ObjectId> remaining_ids;
  for (const auto& old : authority_->members()) {
    if (!requested.contains(old.object_id)) remaining_ids.push_back(old.object_id);
  }
  for (std::size_t index = 0; index < remaining_ids.size(); ++index) {
    const auto& old = authority_->members()[authority_->member_slot(remaining_ids[index])];
    const auto& state = states[authority_->member_slot(remaining_ids[index])];
    remaining.push_back(MemberAnchor{
      old.object_id, target, old.propagation_frame, state.position, state.velocity,
      state.mass, old.mu, old.motion_revision + 1, old.property_revision, old.mass_revision,
    });
  }
  std::unique_ptr<CoupledAuthority> replacement;
  if (remaining.size() >= 2) replacement = make_successor(target, remaining, authority_->configuration(), failure);
  if (!remaining.empty() && remaining.size() < 2 && object_ids.size() != authority_->members().size()) {
    fail(failure, FailureCode::transaction_rejected, "demotion would leave an unrepresented single-member group");
    return false;
  }
  successor_anchors = std::move(requested_anchors);
  authority_ = std::move(replacement);
  failure = {};
  return true;
}

bool CoupledAuthorityManager::remove(
  time::SimulationInstant target,
  object::ObjectId object_id,
  MemberAnchor& removed_anchor,
  Failure& failure
) {
  std::vector<MemberAnchor> removed;
  if (!demote(target, {object_id}, removed, failure)) return false;
  removed_anchor = removed.front();
  return true;
}

}  // namespace orbit_engine::coupled
