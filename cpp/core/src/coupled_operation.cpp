#include "orbit_engine/coupled_operation.hpp"

#include "orbit_engine/force.hpp"
#include "orbit_engine/frame.hpp"
#include "orbit_engine/object.hpp"

#include <algorithm>
#include <cmath>
#include <limits>
#include <set>
#include <vector>

namespace orbit_engine::coupled_operation {
namespace {

template <typename T>
bool word(double value, T& output) noexcept {
  if (!std::isfinite(value) || std::trunc(value) != value || value < 0.0
      || value > static_cast<double>(std::numeric_limits<std::uint32_t>::max())) return false;
  output = static_cast<T>(value);
  return true;
}

bool signed_word(double value, std::int32_t& output) noexcept {
  if (!std::isfinite(value) || std::trunc(value) != value
      || value < static_cast<double>(std::numeric_limits<std::int32_t>::min())
      || value > static_cast<double>(std::numeric_limits<std::int32_t>::max())) return false;
  output = static_cast<std::int32_t>(value);
  return true;
}

bool finite(double value) noexcept { return std::isfinite(value); }

bool sample_in_interval(const force::TimeInterval& interval, const numerical::NumericalSampleTime& sample) noexcept {
  const auto from_start = time::subtract(interval.start, sample.exact_step_start);
  if (!from_start.has_value() || sample.offset_seconds < time::to_seconds(*from_start)) return false;
  if (!interval.end.has_value()) return true;
  const auto from_end = time::subtract(*interval.end, sample.exact_step_start);
  return from_end.has_value() && sample.offset_seconds < time::to_seconds(*from_end);
}

std::uint64_t id_from_words(std::uint32_t high, std::uint32_t low) noexcept {
  return (static_cast<std::uint64_t>(high) << 32U) | low;
}

void id_to_words(std::uint64_t value, std::uint32_t& high, std::uint32_t& low) noexcept {
  high = static_cast<std::uint32_t>(value >> 32U);
  low = static_cast<std::uint32_t>(value);
}

bool read_time(std::span<const double> values, std::size_t& cursor, time::TimeWire& output) noexcept {
  std::int32_t high = 0;
  std::uint32_t low = 0;
  std::uint32_t nanos = 0;
  if (cursor + 3 > values.size() || !signed_word(values[cursor++], high)
      || !word(values[cursor++], low) || !word(values[cursor++], nanos) || nanos >= 1'000'000'000U) return false;
  output = time::TimeWire{high, low, nanos};
  return true;
}

void write_time(const time::TimeWire& value, std::span<double> output, std::size_t& cursor) noexcept {
  output[cursor++] = value.seconds_high;
  output[cursor++] = value.seconds_low;
  output[cursor++] = value.nanoseconds;
}

bool read_member(std::span<const double> values, std::size_t& cursor, MemberWire& output) noexcept {
  if (cursor + kMemberWords > values.size()
      || !word(values[cursor++], output.object_id_high) || !word(values[cursor++], output.object_id_low)
      || !read_time(values, cursor, output.epoch)
      || !word(values[cursor++], output.frame_high) || !word(values[cursor++], output.frame_low)) return false;
  double* continuous[] = {&output.position_x, &output.position_y, &output.position_z, &output.velocity_x, &output.velocity_y, &output.velocity_z};
  for (auto* value : continuous) {
    if (cursor >= values.size() || !finite(values[cursor])) return false;
    *value = values[cursor++];
  }
  if (cursor + 2 > values.size() || !finite(values[cursor])) return false;
  output.mass_present = values[cursor++] != 0.0; output.mass = values[cursor++];
  if (!finite(output.mass) || cursor + 2 > values.size() || !finite(values[cursor])) return false;
  output.mu_present = values[cursor++] != 0.0; output.mu = values[cursor++];
  return word(values[cursor++], output.motion_revision_high) && word(values[cursor++], output.motion_revision_low)
    && word(values[cursor++], output.property_revision_high) && word(values[cursor++], output.property_revision_low)
    && word(values[cursor++], output.mass_revision_high) && word(values[cursor++], output.mass_revision_low);
}

void write_member(const MemberWire& value, std::span<double> output, std::size_t& cursor) noexcept {
  output[cursor++] = value.object_id_high; output[cursor++] = value.object_id_low; write_time(value.epoch, output, cursor);
  output[cursor++] = value.frame_high; output[cursor++] = value.frame_low;
  output[cursor++] = value.position_x; output[cursor++] = value.position_y; output[cursor++] = value.position_z;
  output[cursor++] = value.velocity_x; output[cursor++] = value.velocity_y; output[cursor++] = value.velocity_z;
  output[cursor++] = value.mass_present ? 1.0 : 0.0; output[cursor++] = value.mass;
  output[cursor++] = value.mu_present ? 1.0 : 0.0; output[cursor++] = value.mu;
  output[cursor++] = value.motion_revision_high; output[cursor++] = value.motion_revision_low;
  output[cursor++] = value.property_revision_high; output[cursor++] = value.property_revision_low;
  output[cursor++] = value.mass_revision_high; output[cursor++] = value.mass_revision_low;
}

bool read_maneuver(std::span<const double> values, std::size_t& cursor, ManeuverWire& output) noexcept {
  if (cursor + kManeuverWords > values.size()) return false;
  output.present = values[cursor++] != 0.0;
  if (!word(values[cursor++], output.object_id_high) || !word(values[cursor++], output.object_id_low)
      || !word(values[cursor++], output.maneuver_id_high) || !word(values[cursor++], output.maneuver_id_low)
      || !word(values[cursor++], output.maneuver_revision_high) || !word(values[cursor++], output.maneuver_revision_low)
      || !word(values[cursor++], output.configuration_revision_high) || !word(values[cursor++], output.configuration_revision_low)
      || !word(values[cursor++], output.stage_index) || !read_time(values, cursor, output.stage_start)
      || !read_time(values, cursor, output.stage_end)) return false;
  if (cursor + 2 > values.size() || !finite(values[cursor])) return false;
  output.force_magnitude_newtons = values[cursor++];
  if (cursor + 1 > values.size() || !finite(values[cursor])) return false;
  output.mass_flow_kilograms_per_second = values[cursor++];
  if (cursor + 2 > values.size() || !finite(values[cursor])) return false;
  output.minimum_mass_present = values[cursor++] != 0.0;
  output.minimum_mass_kilograms = values[cursor++];
  if (cursor >= values.size() || !word(values[cursor++], output.direction_kind)) return false;
  if (!word(values[cursor++], output.direction_frame_high) || !word(values[cursor++], output.direction_frame_low)
      || !word(values[cursor++], output.direction_frame_revision_high) || !word(values[cursor++], output.direction_frame_revision_low)) return false;
  for (double* value : {&output.direction_x, &output.direction_y, &output.direction_z}) {
    if (cursor >= values.size() || !finite(values[cursor])) return false;
    *value = values[cursor++];
  }
  return word(values[cursor++], output.attitude_source_high) && word(values[cursor++], output.attitude_source_low)
    && word(values[cursor++], output.attitude_revision_high) && word(values[cursor++], output.attitude_revision_low);
}

void write_maneuver(const ManeuverWire& value, std::span<double> output, std::size_t& cursor) noexcept {
  output[cursor++] = value.present ? 1.0 : 0.0;
  output[cursor++] = value.object_id_high; output[cursor++] = value.object_id_low;
  output[cursor++] = value.maneuver_id_high; output[cursor++] = value.maneuver_id_low;
  output[cursor++] = value.maneuver_revision_high; output[cursor++] = value.maneuver_revision_low;
  output[cursor++] = value.configuration_revision_high; output[cursor++] = value.configuration_revision_low;
  output[cursor++] = value.stage_index; write_time(value.stage_start, output, cursor); write_time(value.stage_end, output, cursor);
  output[cursor++] = value.force_magnitude_newtons; output[cursor++] = value.mass_flow_kilograms_per_second;
  output[cursor++] = value.minimum_mass_present ? 1.0 : 0.0; output[cursor++] = value.minimum_mass_kilograms;
  output[cursor++] = value.direction_kind;
  output[cursor++] = value.direction_frame_high; output[cursor++] = value.direction_frame_low;
  output[cursor++] = value.direction_frame_revision_high; output[cursor++] = value.direction_frame_revision_low;
  output[cursor++] = value.direction_x; output[cursor++] = value.direction_y; output[cursor++] = value.direction_z;
  output[cursor++] = value.attitude_source_high; output[cursor++] = value.attitude_source_low;
  output[cursor++] = value.attitude_revision_high; output[cursor++] = value.attitude_revision_low;
}

bool valid_wire(const CoupledWire& value) noexcept {
  if (value.operation_code < static_cast<std::uint16_t>(OperationCode::promote)
      || value.operation_code > static_cast<std::uint16_t>(OperationCode::remove)
      || value.member_count > kMaxMembers || value.requested_count > kMaxMembers || value.maneuver_count > kMaxMembers
      || !time::from_wire(value.target_epoch).has_value()
      || !finite(value.relative_tolerance) || !finite(value.position_absolute_tolerance_meters)
      || !finite(value.velocity_absolute_tolerance_meters_per_second)
      || !finite(value.mass_absolute_tolerance_kilograms)
      || !time::from_wire_duration(value.min_step).has_value()
      || !time::from_wire_duration(value.max_step).has_value()
      || !finite(value.constant_acceleration_x) || !finite(value.constant_acceleration_y) || !finite(value.constant_acceleration_z)) return false;
  if (value.operation_code == static_cast<std::uint16_t>(OperationCode::promote)
      && (value.member_count < 2 || value.member_count > kMaxMembers)) return false;
  if (value.operation_code != static_cast<std::uint16_t>(OperationCode::promote)
      && (value.requested_count == 0 || value.requested_count > kMaxMembers)) return false;
  if (value.relative_tolerance <= 0.0 || value.position_absolute_tolerance_meters <= 0.0
      || value.velocity_absolute_tolerance_meters_per_second <= 0.0 || value.mass_absolute_tolerance_kilograms <= 0.0
      || value.checkpoint_stride_accepted_steps == 0 || value.max_checkpoint_count == 0
      || value.max_dense_step_count == 0 || value.max_accepted_steps_per_extension == 0
      || value.max_rejected_steps_per_extension == 0
      || time::compare(*time::from_wire_duration(value.min_step), time::Duration{0, 1}) < 0
      || time::compare(*time::from_wire_duration(value.max_step), *time::from_wire_duration(value.min_step)) < 0) return false;
  std::set<object::ObjectId> member_ids;
  for (std::size_t index = 0; index < value.member_count; ++index) {
    member_ids.insert(object::object_id_from_wire({value.members[index].object_id_high, value.members[index].object_id_low}));
  }
  std::set<object::ObjectId> maneuver_targets;
  for (std::size_t index = 0; index < value.maneuver_count; ++index) {
    const auto& maneuver = value.maneuvers[index];
    const auto target = object::object_id_from_wire({maneuver.object_id_high, maneuver.object_id_low});
    if (!maneuver.present || !object::is_valid(target) || !member_ids.contains(target) || !maneuver_targets.insert(target).second
        || maneuver.maneuver_id_high == 0 && maneuver.maneuver_id_low == 0
        || maneuver.maneuver_revision_high == 0 && maneuver.maneuver_revision_low == 0
        || !time::from_wire(maneuver.stage_start).has_value() || !time::from_wire(maneuver.stage_end).has_value()
        || time::compare(*time::from_wire(maneuver.stage_start), *time::from_wire(maneuver.stage_end)) >= 0
        || maneuver.direction_kind < 1 || maneuver.direction_kind > 2
        || !finite(maneuver.force_magnitude_newtons) || maneuver.force_magnitude_newtons < 0.0
        || !finite(maneuver.mass_flow_kilograms_per_second) || maneuver.mass_flow_kilograms_per_second < 0.0
        || !finite(maneuver.minimum_mass_kilograms) || (maneuver.minimum_mass_present && maneuver.minimum_mass_kilograms <= 0.0)
        || !finite(maneuver.direction_x) || !finite(maneuver.direction_y) || !finite(maneuver.direction_z)) return false;
    if (maneuver.direction_kind == 1) {
      if (!frame::is_valid(frame::reference_frame_id_from_wire({maneuver.direction_frame_high, maneuver.direction_frame_low}))
          || maneuver.direction_frame_revision_high == 0 && maneuver.direction_frame_revision_low == 0
          || maneuver.attitude_source_high != 0 || maneuver.attitude_source_low != 0
          || maneuver.attitude_revision_high != 0 || maneuver.attitude_revision_low != 0) return false;
    } else if (maneuver.attitude_source_high == 0 && maneuver.attitude_source_low == 0) return false;
  }
  return true;
}

coupled::MemberAnchor to_anchor(const MemberWire& value) {
  return coupled::MemberAnchor{
    id_from_words(value.object_id_high, value.object_id_low),
    *time::from_wire(value.epoch),
    id_from_words(value.frame_high, value.frame_low),
    frame::Vec3{value.position_x, value.position_y, value.position_z},
    frame::Vec3{value.velocity_x, value.velocity_y, value.velocity_z},
    value.mass_present ? std::optional<double>{value.mass} : std::nullopt,
    value.mu_present ? std::optional<double>{value.mu} : std::nullopt,
    id_from_words(value.motion_revision_high, value.motion_revision_low),
    id_from_words(value.property_revision_high, value.property_revision_low),
    id_from_words(value.mass_revision_high, value.mass_revision_low),
  };
}

MemberWire from_anchor(const coupled::MemberAnchor& value) {
  MemberWire result;
  id_to_words(value.object_id, result.object_id_high, result.object_id_low);
  result.epoch = time::to_wire(value.epoch);
  id_to_words(value.propagation_frame, result.frame_high, result.frame_low);
  result.position_x = value.position.x; result.position_y = value.position.y; result.position_z = value.position.z;
  result.velocity_x = value.velocity.x; result.velocity_y = value.velocity.y; result.velocity_z = value.velocity.z;
  result.mass_present = value.mass.has_value(); result.mass = value.mass.value_or(0.0);
  result.mu_present = value.mu.has_value(); result.mu = value.mu.value_or(0.0);
  id_to_words(value.motion_revision, result.motion_revision_high, result.motion_revision_low);
  id_to_words(value.property_revision, result.property_revision_high, result.property_revision_low);
  id_to_words(value.mass_revision, result.mass_revision_high, result.mass_revision_low);
  return result;
}

force::Provider constant_provider(const CoupledWire& input, time::SimulationInstant epoch) {
  force::Provider provider;
  provider.definition.kind = force::ProviderKind::custom;
  provider.definition.order = 0;
  provider.definition.validity = force::TimeInterval{epoch, std::nullopt};
  provider.definition.configuration_identity = id_from_words(input.configuration_revision_high, input.configuration_revision_low);
  const frame::Vec3 acceleration{input.constant_acceleration_x, input.constant_acceleration_y, input.constant_acceleration_z};
  provider.evaluate = [acceleration](const force::ForceEvaluationContext&, frame::Vec3& result, force::Failure&) { result = acceleration; return true; };
  return provider;
}

force::Provider maneuver_provider(const ManeuverWire& input, time::SimulationInstant epoch, std::uint32_t order) {
  const auto target = id_from_words(input.object_id_high, input.object_id_low);
  const auto stage_start = *time::from_wire(input.stage_start);
  const auto stage_end = *time::from_wire(input.stage_end);
  const auto integration_frame = frame::kRootReferenceFrameId;
  force::Provider provider;
  provider.definition.kind = force::ProviderKind::finite_thrust;
  provider.definition.order = order;
  provider.definition.validity = force::TimeInterval{epoch, std::nullopt};
  provider.definition.requires_mass = false;
  provider.definition.configuration_identity = id_from_words(input.configuration_revision_high, input.configuration_revision_low);
  provider.definition.dependencies.push_back(force::Dependency{
    force::DependencyKind::source,
    id_from_words(input.maneuver_id_high, input.maneuver_id_low),
    id_from_words(input.maneuver_revision_high, input.maneuver_revision_low),
  });
  provider.definition.hard_boundaries.push_back(numerical::HardBoundary{stage_start, provider.definition.configuration_identity});
  provider.definition.hard_boundaries.push_back(numerical::HardBoundary{stage_end, provider.definition.configuration_identity});
  provider.evaluate = [input, target, stage_start, stage_end, integration_frame](
      const force::ForceEvaluationContext& context, frame::Vec3& result, force::Failure& failure) {
    result = frame::Vec3{0.0, 0.0, 0.0};
    if (context.target_id != target || !sample_in_interval(force::TimeInterval{stage_start, stage_end}, context.sample_time)) return true;
    if (!context.target_mass.has_value() || *context.target_mass <= 0.0) {
      failure = force::Failure{force::FailureCode::missing_dependency, "coupled maneuver thrust requires a positive member mass"};
      return false;
    }
    if (input.direction_kind != 1
        || frame::reference_frame_id_from_wire({input.direction_frame_high, input.direction_frame_low}) != integration_frame) {
      failure = force::Failure{force::FailureCode::missing_dependency, "coupled body-frame or non-root maneuver direction requires an attitude/frame sampler"};
      return false;
    }
    const double acceleration = input.force_magnitude_newtons / *context.target_mass;
    result = frame::Vec3{
      input.direction_x * acceleration,
      input.direction_y * acceleration,
      input.direction_z * acceleration,
    };
    return frame::is_valid(result);
  };
  return provider;
}

coupled::Configuration configuration(const CoupledWire& input, time::SimulationInstant epoch) {
  numerical::Configuration integrator;
  integrator.relative_tolerance = input.relative_tolerance;
  integrator.position_absolute_tolerance_meters = input.position_absolute_tolerance_meters;
  integrator.velocity_absolute_tolerance_meters_per_second = input.velocity_absolute_tolerance_meters_per_second;
  integrator.mass_absolute_tolerance_kilograms = input.mass_absolute_tolerance_kilograms;
  integrator.min_step = *time::from_wire_duration(input.min_step);
  integrator.max_step = *time::from_wire_duration(input.max_step);
  integrator.checkpoint_stride_accepted_steps = input.checkpoint_stride_accepted_steps;
  integrator.max_checkpoint_count = input.max_checkpoint_count;
  integrator.max_dense_step_count = input.max_dense_step_count;
  integrator.max_accepted_steps_per_extension = input.max_accepted_steps_per_extension;
  integrator.max_rejected_steps_per_extension = input.max_rejected_steps_per_extension;
  std::vector<force::Provider> providers;
  providers.push_back(constant_provider(input, epoch));
  for (std::size_t index = 0; index < input.maneuver_count; ++index) {
    providers.push_back(maneuver_provider(input.maneuvers[index], epoch, static_cast<std::uint32_t>(index + 1)));
  }
  return coupled::Configuration{
    integrator,
    force::ProviderRuntime(std::move(providers)),
    std::nullopt,
    {},
    std::nullopt,
    id_from_words(input.configuration_revision_high, input.configuration_revision_low),
  };
}

}  // namespace

bool decode_packet(std::span<const double> values, CoupledWire& output) noexcept {
  if (values.size() != kInputWords) return false;
  std::size_t cursor = 0;
  if (!word(values[cursor++], output.result_code) || !word(values[cursor++], output.operation_code)
      || !read_time(values, cursor, output.target_epoch)
      || !word(values[cursor++], output.authority_id_high) || !word(values[cursor++], output.authority_id_low)
      || !word(values[cursor++], output.group_revision_high) || !word(values[cursor++], output.group_revision_low)
      || !word(values[cursor++], output.member_count)) return false;
  for (auto& member : output.members) if (!read_member(values, cursor, member)) return false;
  if (!word(values[cursor++], output.requested_count)) return false;
  for (std::size_t index = 0; index < kMaxMembers; ++index) {
    if (!word(values[cursor++], output.requested_id_high[index]) || !word(values[cursor++], output.requested_id_low[index])) return false;
  }
  if (!word(values[cursor++], output.maneuver_count)) return false;
  for (auto& maneuver : output.maneuvers) if (!read_maneuver(values, cursor, maneuver)) return false;
  if (!word(values[cursor++], output.configuration_revision_high) || !word(values[cursor++], output.configuration_revision_low)) return false;
  double* continuous[] = {&output.relative_tolerance, &output.position_absolute_tolerance_meters, &output.velocity_absolute_tolerance_meters_per_second, &output.mass_absolute_tolerance_kilograms};
  for (auto* value : continuous) if (cursor >= values.size() || !finite(values[cursor])) return false; else *value = values[cursor++];
  if (!word(values[cursor++], output.checkpoint_stride_accepted_steps) || !word(values[cursor++], output.max_checkpoint_count)
      || !word(values[cursor++], output.max_dense_step_count) || !word(values[cursor++], output.max_accepted_steps_per_extension)
      || !word(values[cursor++], output.max_rejected_steps_per_extension)) return false;
  if (!read_time(values, cursor, output.min_step) || !read_time(values, cursor, output.max_step)) return false;
  double* acceleration[] = {&output.constant_acceleration_x, &output.constant_acceleration_y, &output.constant_acceleration_z};
  for (auto* value : acceleration) if (cursor >= values.size() || !finite(values[cursor])) return false; else *value = values[cursor++];
  if (cursor != kInputWords) return false;
  return valid_wire(output);
}

bool encode_packet(const CoupledWire& input, std::span<double> values) noexcept {
  if (values.size() != kOutputWords || input.result_count > kMaxMembers) return false;
  std::fill(values.begin(), values.end(), 0.0);
  std::size_t cursor = 0;
  values[cursor++] = input.result_code; values[cursor++] = input.operation_code;
  const auto authority = id_from_words(input.authority_id_high, input.authority_id_low);
  const auto revision = id_from_words(input.group_revision_high, input.group_revision_low);
  std::uint32_t high = 0, low = 0; id_to_words(authority, high, low); values[cursor++] = high; values[cursor++] = low;
  id_to_words(revision, high, low); values[cursor++] = high; values[cursor++] = low;
  values[cursor++] = input.result_count;
  const auto shared = static_cast<std::uint64_t>(input.shared_evaluation_count_high) << 32U | input.shared_evaluation_count_low;
  id_to_words(shared, high, low); values[cursor++] = high; values[cursor++] = low;
  for (std::size_t index = 0; index < kMaxMembers; ++index) write_member(input.results[index], values, cursor);
  return cursor == kOutputWords;
}

CoupledWire evaluate(CoupledWire input) {
  if (!valid_wire(input)) { input.result_code = static_cast<std::uint16_t>(ResultCode::invalid_input); return input; }
  static coupled::CoupledAuthorityManager manager;
  const auto operation = static_cast<OperationCode>(input.operation_code);
  const auto target = *time::from_wire(input.target_epoch);
  coupled::Failure failure;
  if (operation == OperationCode::promote) {
    const auto config = configuration(input, target);
    std::vector<coupled::MemberCandidate> candidates;
    candidates.reserve(input.member_count);
    for (std::size_t index = 0; index < input.member_count; ++index) {
      const auto member = to_anchor(input.members[index]);
      candidates.push_back(coupled::MemberCandidate{
        member.object_id, member.motion_revision, member.property_revision, member.mass_revision,
        [member](time::SimulationInstant requested, coupled::MemberAnchor& result, coupled::Failure& output) {
          if (time::compare(requested, member.epoch) != 0) { output = coupled::Failure{coupled::FailureCode::invalid_state, "member anchor epoch does not equal promotion target"}; return false; }
          result = member; return true;
        },
      });
    }
    if (!manager.promote(target, std::move(candidates), config, failure)) {
      input.result_code = failure.code == coupled::FailureCode::invalid_configuration ? static_cast<std::uint16_t>(ResultCode::invalid_configuration) : static_cast<std::uint16_t>(ResultCode::transaction_rejected);
      return input;
    }
  } else {
    auto* authority = manager.authority();
    if (authority == nullptr || id_from_words(input.authority_id_high, input.authority_id_low) != authority->authority_id()) {
      input.result_code = static_cast<std::uint16_t>(ResultCode::transaction_rejected); return input;
    }
    if (operation == OperationCode::evaluate) {
      std::vector<object::ObjectId> ids;
      for (std::size_t index = 0; index < input.requested_count; ++index) ids.push_back(id_from_words(input.requested_id_high[index], input.requested_id_low[index]));
      std::vector<coupled::MemberState> states;
      if (!authority->state_batch(ids, target, states, failure)) {
        input.result_code = failure.code == coupled::FailureCode::unsupported_temporal_direction ? static_cast<std::uint16_t>(ResultCode::unsupported_temporal_direction) : static_cast<std::uint16_t>(ResultCode::numerical_failure); return input;
      }
      input.result_count = static_cast<std::uint32_t>(states.size());
      for (std::size_t index = 0; index < states.size(); ++index) {
        auto& result = input.results[index]; const auto& state = states[index]; const auto& member = authority->members()[authority->member_slot(ids[index])];
        result = from_anchor(coupled::MemberAnchor{ids[index], state.epoch, state.propagation_frame, state.position, state.velocity, state.mass, member.mu, member.motion_revision, member.property_revision, member.mass_revision});
      }
    } else if (operation == OperationCode::demote) {
      std::vector<object::ObjectId> ids; for (std::size_t index = 0; index < input.requested_count; ++index) ids.push_back(id_from_words(input.requested_id_high[index], input.requested_id_low[index]));
      std::vector<coupled::MemberAnchor> anchors;
      if (!manager.demote(target, ids, anchors, failure)) { input.result_code = static_cast<std::uint16_t>(ResultCode::transaction_rejected); return input; }
      input.result_count = static_cast<std::uint32_t>(anchors.size()); for (std::size_t index = 0; index < anchors.size(); ++index) input.results[index] = from_anchor(anchors[index]);
    } else {
      coupled::MemberAnchor removed;
      if (!manager.remove(target, id_from_words(input.requested_id_high[0], input.requested_id_low[0]), removed, failure)) { input.result_code = static_cast<std::uint16_t>(ResultCode::transaction_rejected); return input; }
      input.result_count = 1; input.results[0] = from_anchor(removed);
    }
  }
  const auto* result_authority = manager.authority();
  if (result_authority != nullptr) { id_to_words(result_authority->authority_id(), input.authority_id_high, input.authority_id_low); id_to_words(result_authority->group_revision(), input.group_revision_high, input.group_revision_low); const auto evaluations = static_cast<std::uint64_t>(result_authority->shared_evaluation_count()); input.shared_evaluation_count_high = static_cast<std::uint32_t>(evaluations >> 32U); input.shared_evaluation_count_low = static_cast<std::uint32_t>(evaluations); }
  else { input.authority_id_high = input.authority_id_low = input.group_revision_high = input.group_revision_low = 0; }
  input.result_code = static_cast<std::uint16_t>(ResultCode::success);
  return input;
}

}  // namespace orbit_engine::coupled_operation
