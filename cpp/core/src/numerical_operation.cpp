#include "orbit_engine/numerical_operation.hpp"

#include "orbit_engine/force.hpp"
#include "orbit_engine/numerical_motion.hpp"
#include "orbit_engine/object.hpp"
#include "orbit_engine/thrust.hpp"

#include <cmath>

namespace orbit_engine::numerical_operation {
namespace {

bool finite(double value) noexcept { return std::isfinite(value); }

std::uint64_t uint64_from_wire(std::uint32_t high, std::uint32_t low) noexcept {
  return (static_cast<std::uint64_t>(high) << 32U) | low;
}

bool valid_time(time::TimeWire value) noexcept { return time::from_wire(value).has_value(); }

bool valid_non_negative(double value) noexcept { return finite(value) && value >= 0.0; }

bool valid_frame(std::uint32_t high, std::uint32_t low) noexcept {
  return frame::is_valid(frame::reference_frame_id_from_wire({high, low}));
}

bool valid_non_zero_uint64(std::uint32_t high, std::uint32_t low) noexcept {
  return high != 0 || low != 0;
}

}  // namespace

bool is_valid_input(NumericalWire value) noexcept {
  if (!object::is_valid(object::object_id_from_wire({value.object_id_high, value.object_id_low}))
      || !frame::is_valid(frame::reference_frame_id_from_wire({value.propagation_frame_high, value.propagation_frame_low}))
      || !valid_time(value.anchor_epoch) || !valid_time(value.target_epoch)
      || !valid_time(value.min_step) || !valid_time(value.max_step)
      || !finite(value.anchor_position_x) || !finite(value.anchor_position_y) || !finite(value.anchor_position_z)
      || !finite(value.anchor_velocity_x) || !finite(value.anchor_velocity_y) || !finite(value.anchor_velocity_z)
      || !finite(value.constant_acceleration_x) || !finite(value.constant_acceleration_y) || !finite(value.constant_acceleration_z)
      || !finite(value.relative_tolerance) || !finite(value.position_absolute_tolerance_meters)
      || !finite(value.velocity_absolute_tolerance_meters_per_second)
      || !finite(value.mass_absolute_tolerance_kilograms)
      || !finite(value.maneuver_force_magnitude_newtons)
      || !finite(value.maneuver_mass_flow_kilograms_per_second)
      || !finite(value.maneuver_minimum_mass_kilograms)
      || !finite(value.maneuver_direction_x) || !finite(value.maneuver_direction_y) || !finite(value.maneuver_direction_z)) {
    return false;
  }
  const auto anchor = *time::from_wire(value.anchor_epoch);
  const auto min_step = *time::from_wire_duration(value.min_step);
  const auto max_step = *time::from_wire_duration(value.max_step);
  if (time::compare(min_step, time::Duration{0, 1}) < 0
      || time::compare(max_step, min_step) < 0
      || value.relative_tolerance <= 0.0
      || value.position_absolute_tolerance_meters <= 0.0
      || value.velocity_absolute_tolerance_meters_per_second <= 0.0
      || value.mass_absolute_tolerance_kilograms <= 0.0
      || value.checkpoint_stride_accepted_steps == 0
      || value.max_checkpoint_count == 0
      || value.max_dense_step_count == 0
      || value.max_accepted_steps_per_extension == 0
      || value.max_rejected_steps_per_extension == 0) {
    return false;
  }
  if (value.mass_present && !valid_non_negative(value.mass)) return false;
  if (!value.mass_present && value.mass != 0.0) return false;
  if (!value.maneuver_present) {
    if (value.maneuver_id_high != 0 || value.maneuver_id_low != 0
        || value.maneuver_revision_high != 0 || value.maneuver_revision_low != 0
        || value.maneuver_stage_index != 0
        || value.maneuver_force_magnitude_newtons != 0.0
        || value.maneuver_mass_flow_kilograms_per_second != 0.0
        || value.maneuver_minimum_mass_present || value.maneuver_minimum_mass_kilograms != 0.0
        || value.maneuver_direction_kind != 0
        || value.maneuver_direction_frame_high != 0 || value.maneuver_direction_frame_low != 0
        || value.maneuver_direction_frame_revision_high != 0 || value.maneuver_direction_frame_revision_low != 0
        || value.maneuver_direction_x != 0.0 || value.maneuver_direction_y != 0.0 || value.maneuver_direction_z != 0.0
        || value.maneuver_attitude_source_high != 0 || value.maneuver_attitude_source_low != 0
        || value.maneuver_attitude_revision_high != 0 || value.maneuver_attitude_revision_low != 0) return false;
  } else {
    const auto maneuver_start = time::from_wire(value.maneuver_stage_start);
    const auto maneuver_end = time::from_wire(value.maneuver_stage_end);
    if (!valid_non_zero_uint64(value.maneuver_id_high, value.maneuver_id_low)
        || !valid_non_zero_uint64(value.maneuver_revision_high, value.maneuver_revision_low)
        || !maneuver_start.has_value() || !maneuver_end.has_value()
        || time::compare(*maneuver_start, *maneuver_end) >= 0
        || !valid_non_negative(value.maneuver_force_magnitude_newtons)
        || !valid_non_negative(value.maneuver_mass_flow_kilograms_per_second)
        || (value.maneuver_minimum_mass_present && value.maneuver_minimum_mass_kilograms <= 0.0)
        || (!value.maneuver_minimum_mass_present && value.maneuver_minimum_mass_kilograms != 0.0)
        || (value.maneuver_direction_kind != 1 && value.maneuver_direction_kind != 2)) return false;
    if (value.maneuver_direction_kind == 1) {
      if (!valid_frame(value.maneuver_direction_frame_high, value.maneuver_direction_frame_low)
          || !valid_non_zero_uint64(value.maneuver_direction_frame_revision_high, value.maneuver_direction_frame_revision_low)
          || value.maneuver_attitude_source_high != 0 || value.maneuver_attitude_source_low != 0
          || value.maneuver_attitude_revision_high != 0 || value.maneuver_attitude_revision_low != 0) return false;
    } else if (!valid_non_zero_uint64(value.maneuver_attitude_source_high, value.maneuver_attitude_source_low)
        || !valid_non_zero_uint64(value.maneuver_attitude_revision_high, value.maneuver_attitude_revision_low)
        || value.maneuver_direction_frame_high != 0 || value.maneuver_direction_frame_low != 0
        || value.maneuver_direction_frame_revision_high != 0 || value.maneuver_direction_frame_revision_low != 0) return false;
  }
  if (value.source_present) {
    if (!object::is_valid(object::object_id_from_wire({value.source_id_high, value.source_id_low}))
        || !finite(value.source_position_x) || !finite(value.source_position_y) || !finite(value.source_position_z)
        || (value.source_mu_present && !valid_non_negative(value.source_mu))
        || (value.source_mass_present && !valid_non_negative(value.source_mass))
        || (!value.source_mu_present && !value.source_mass_present)) return false;
  } else if (value.source_id_high != 0 || value.source_id_low != 0 || value.source_mu_present
      || value.source_mass_present || value.source_mu != 0.0 || value.source_mass != 0.0
      || value.source_revision_high != 0 || value.source_revision_low != 0) {
    return false;
  }
  return true;
}

NumericalWire evaluate(NumericalWire input) {
  if (!is_valid_input(input)) {
    input.result_code = static_cast<std::uint16_t>(ResultCode::invalid_input);
    return input;
  }
  const auto anchor_epoch = *time::from_wire(input.anchor_epoch);
  const auto target_epoch = *time::from_wire(input.target_epoch);
  if (time::compare(target_epoch, anchor_epoch) < 0) {
    input.result_code = static_cast<std::uint16_t>(ResultCode::unsupported_temporal_direction);
    return input;
  }

  const auto object_id = object::object_id_from_wire({input.object_id_high, input.object_id_low});
  force::Provider constant_provider;
  constant_provider.definition.kind = force::ProviderKind::custom;
  constant_provider.definition.order = 0;
  constant_provider.definition.validity = force::TimeInterval{anchor_epoch, std::nullopt};
  constant_provider.definition.configuration_identity = 1;
  const frame::Vec3 constant_acceleration{
    input.constant_acceleration_x,
    input.constant_acceleration_y,
    input.constant_acceleration_z,
  };
  constant_provider.evaluate = [constant_acceleration](const force::ForceEvaluationContext&, frame::Vec3& acceleration, force::Failure&) {
    acceleration = constant_acceleration;
    return true;
  };
  std::vector<force::Provider> providers{constant_provider};
  if (input.source_present) {
    force::GravitySource source;
    source.id = object::object_id_from_wire({input.source_id_high, input.source_id_low});
    source.validity = force::TimeInterval{anchor_epoch, std::nullopt};
    source.fixed_position = frame::Vec3{input.source_position_x, input.source_position_y, input.source_position_z};
    source.has_fixed_position = true;
    if (input.source_mu_present) source.mu = input.source_mu;
    if (input.source_mass_present) source.mass = input.source_mass;
    source.revision = uint64_from_wire(input.source_revision_high, input.source_revision_low);
    force::Failure force_failure;
    auto gravity = force::make_newtonian_gravity_provider(force::NewtonianGravityConfiguration{
      1,
      force::TimeInterval{anchor_epoch, std::nullopt},
      {source},
      uint64_from_wire(input.configuration_revision_high, input.configuration_revision_low),
    }, force_failure);
    if (!gravity.evaluate) {
      input.result_code = static_cast<std::uint16_t>(ResultCode::invalid_configuration);
      return input;
    }
    providers.push_back(std::move(gravity));
  }

  if (input.maneuver_present) {
    const auto stage_start = *time::from_wire(input.maneuver_stage_start);
    const auto stage_end = *time::from_wire(input.maneuver_stage_end);
    thrust::FiniteThrustStage stage;
    stage.validity = force::TimeInterval{stage_start, stage_end};
    stage.force_magnitude_newtons = input.maneuver_force_magnitude_newtons;
    stage.throttle = 1.0;
    stage.mass_flow = thrust::MassFlowSpecification{
      thrust::MassFlowKind::direct,
      input.maneuver_mass_flow_kilograms_per_second,
    };
    if (input.maneuver_direction_kind == 1) {
      stage.direction = thrust::ReferenceFrameDirection{
        frame::reference_frame_id_from_wire({input.maneuver_direction_frame_high, input.maneuver_direction_frame_low}),
        uint64_from_wire(input.maneuver_direction_frame_revision_high, input.maneuver_direction_frame_revision_low),
        frame::Vec3{input.maneuver_direction_x, input.maneuver_direction_y, input.maneuver_direction_z},
        {},
      };
    } else {
      stage.direction = thrust::BodyFrameDirection{
        frame::Vec3{input.maneuver_direction_x, input.maneuver_direction_y, input.maneuver_direction_z},
        object::object_id_from_wire({input.maneuver_attitude_source_high, input.maneuver_attitude_source_low}),
        uint64_from_wire(input.maneuver_attitude_revision_high, input.maneuver_attitude_revision_low),
        {},
      };
    }
    thrust::FiniteThrustConfiguration thrust_configuration;
    thrust_configuration.target_id = object_id;
    thrust_configuration.order = input.source_present ? 2 : 1;
    thrust_configuration.validity = force::TimeInterval{stage_start, stage_end};
    thrust_configuration.integration_frame = frame::reference_frame_id_from_wire({input.propagation_frame_high, input.propagation_frame_low});
    thrust_configuration.stages.push_back(std::move(stage));
    if (input.maneuver_minimum_mass_present) thrust_configuration.minimum_mass_kilograms = input.maneuver_minimum_mass_kilograms;
    thrust_configuration.configuration_identity = uint64_from_wire(input.configuration_revision_high, input.configuration_revision_low);
    force::Failure thrust_failure;
    auto thrust_provider = thrust::make_finite_thrust_provider(std::move(thrust_configuration), thrust_failure);
    if (!thrust_provider.evaluate_combined) {
      input.result_code = static_cast<std::uint16_t>(ResultCode::invalid_configuration);
      return input;
    }
    providers.push_back(std::move(thrust_provider));
  }

  const auto frame_id = frame::reference_frame_id_from_wire({input.propagation_frame_high, input.propagation_frame_low});
  numerical_motion::NumericalSegmentAnchor anchor{
    object_id,
    anchor_epoch,
    frame_id,
    frame::Vec3{input.anchor_position_x, input.anchor_position_y, input.anchor_position_z},
    frame::Vec3{input.anchor_velocity_x, input.anchor_velocity_y, input.anchor_velocity_z},
    input.mass_present ? std::optional<double>{input.mass} : std::nullopt,
    uint64_from_wire(input.motion_revision_high, input.motion_revision_low),
  };
  numerical::Configuration integrator;
  integrator.relative_tolerance = input.relative_tolerance;
  integrator.position_absolute_tolerance_meters = input.position_absolute_tolerance_meters;
  integrator.velocity_absolute_tolerance_meters_per_second = input.velocity_absolute_tolerance_meters_per_second;
  integrator.mass_absolute_tolerance_kilograms = input.mass_absolute_tolerance_kilograms;
  integrator.has_mass_component = input.mass_present;
  integrator.checkpoint_stride_accepted_steps = input.checkpoint_stride_accepted_steps;
  integrator.max_checkpoint_count = input.max_checkpoint_count;
  integrator.max_dense_step_count = input.max_dense_step_count;
  integrator.max_accepted_steps_per_extension = input.max_accepted_steps_per_extension;
  integrator.max_rejected_steps_per_extension = input.max_rejected_steps_per_extension;
  integrator.min_step = *time::from_wire_duration(input.min_step);
  integrator.max_step = *time::from_wire_duration(input.max_step);
  integrator.configuration_identity = uint64_from_wire(input.configuration_revision_high, input.configuration_revision_low);
  numerical_motion::NumericalMotionConfiguration configuration{
    integrator,
    force::ProviderRuntime(std::move(providers)),
    force::TimeInterval{anchor_epoch, std::nullopt},
    std::nullopt,
    {},
    {},
    uint64_from_wire(input.configuration_revision_high, input.configuration_revision_low),
  };
  numerical_motion::NumericalMotionSegment segment(std::move(anchor), std::move(configuration));
  if (!segment.valid()) {
    input.result_code = static_cast<std::uint16_t>(ResultCode::invalid_configuration);
    return input;
  }
  numerical_motion::NumericalState result;
  numerical_motion::Failure motion_failure;
  if (!segment.state_at(target_epoch, result, motion_failure)) {
    if (motion_failure.code == numerical_motion::FailureCode::unsupported_temporal_direction) {
      input.result_code = static_cast<std::uint16_t>(ResultCode::unsupported_temporal_direction);
    } else if (motion_failure.code == numerical_motion::FailureCode::invalid_mass) {
      input.result_code = static_cast<std::uint16_t>(ResultCode::invalid_mass);
    } else if (motion_failure.numerical_code == numerical::FailureCode::step_underflow) {
      input.result_code = static_cast<std::uint16_t>(ResultCode::step_underflow);
    } else if (motion_failure.numerical_code == numerical::FailureCode::accepted_step_budget) {
      input.result_code = static_cast<std::uint16_t>(ResultCode::accepted_step_budget);
    } else if (motion_failure.numerical_code == numerical::FailureCode::rejected_step_budget) {
      input.result_code = static_cast<std::uint16_t>(ResultCode::rejected_step_budget);
    } else {
      input.result_code = static_cast<std::uint16_t>(ResultCode::numerical_failure);
    }
    return input;
  }
  input.result_code = static_cast<std::uint16_t>(ResultCode::success);
  input.result_epoch = time::to_wire(result.epoch);
  input.result_position_x = result.position.x;
  input.result_position_y = result.position.y;
  input.result_position_z = result.position.z;
  input.result_velocity_x = result.velocity.x;
  input.result_velocity_y = result.velocity.y;
  input.result_velocity_z = result.velocity.z;
  input.result_mass_present = result.mass.has_value();
  input.result_mass = result.mass.value_or(0.0);
  return input;
}

}  // namespace orbit_engine::numerical_operation
