#include "orbit_engine/core.hpp"
#include "orbit_engine/coupled_operation.hpp"
#include "orbit_engine/frame.hpp"
#include "orbit_engine/frame_registry.hpp"
#include "orbit_engine/lambert.hpp"
#include "orbit_engine/numerical_operation.hpp"
#include "orbit_engine/object.hpp"
#include "orbit_engine/propagation.hpp"
#include "orbit_engine/registry.hpp"
#include "orbit_engine/scheduler.hpp"
#include "orbit_engine/time.hpp"
#include "orbit_engine/two_body.hpp"

#include <emscripten/emscripten.h>

#include <span>
#include <utility>

extern "C" {

orbit_engine::registry::Registry g_registry;
orbit_engine::frame_registry::Registry g_frame_registry;
orbit_engine::scheduler::Scheduler g_scheduler;

EMSCRIPTEN_KEEPALIVE int orbit_engine_binding_protocol_version() {
  return orbit_engine::kBindingProtocolVersion;
}

EMSCRIPTEN_KEEPALIVE int orbit_engine_core_version() {
  return orbit_engine::kCoreVersion;
}

EMSCRIPTEN_KEEPALIVE int orbit_engine_health() {
  return orbit_engine::health().health_code;
}

bool round_trip_time(
  std::int32_t seconds_high,
  std::uint32_t seconds_low,
  std::uint32_t nanoseconds,
  orbit_engine::time::TimeWire& output
) {
  return orbit_engine::time::round_trip_wire(
    orbit_engine::time::TimeWire{seconds_high, seconds_low, nanoseconds},
    output
  );
}

std::optional<orbit_engine::object::ObjectWire> round_trip_object(
  std::uint32_t object_id_high,
  std::uint32_t object_id_low,
  std::uint16_t object_type_code,
  int mass_present,
  double mass,
  int mu_present,
  double mu,
  int physical_radius_present,
  double physical_radius,
  int collision_bounding_radius_present,
  double collision_bounding_radius
) {
  orbit_engine::object::ObjectWire input{
    object_id_high,
    object_id_low,
    object_type_code,
    orbit_engine::object::PhysicalProperties{
      {mass_present != 0, mass},
      {mu_present != 0, mu},
      {physical_radius_present != 0, physical_radius},
      {collision_bounding_radius_present != 0, collision_bounding_radius},
    },
  };
  orbit_engine::object::ObjectWire output{};
  if (!orbit_engine::object::round_trip(input, output)) {
    return std::nullopt;
  }
  return output;
}

std::uint32_t object_id_high_or_zero(const std::optional<orbit_engine::object::ObjectWire>& value) {
  return value.has_value() ? value->object_id_high : 0;
}

std::uint32_t object_id_low_or_zero(const std::optional<orbit_engine::object::ObjectWire>& value) {
  return value.has_value() ? value->object_id_low : 0;
}

std::uint16_t object_type_code_or_zero(const std::optional<orbit_engine::object::ObjectWire>& value) {
  return value.has_value() ? value->object_type_code : 0;
}

int mass_present_or_zero(const std::optional<orbit_engine::object::ObjectWire>& value) {
  return value.has_value() && value->properties.mass.present ? 1 : 0;
}

double mass_or_zero(const std::optional<orbit_engine::object::ObjectWire>& value) {
  return value.has_value() ? value->properties.mass.value : 0.0;
}

int mu_present_or_zero(const std::optional<orbit_engine::object::ObjectWire>& value) {
  return value.has_value() && value->properties.mu.present ? 1 : 0;
}

double mu_or_zero(const std::optional<orbit_engine::object::ObjectWire>& value) {
  return value.has_value() ? value->properties.mu.value : 0.0;
}

int physical_radius_present_or_zero(const std::optional<orbit_engine::object::ObjectWire>& value) {
  return value.has_value() && value->properties.physical_radius.present ? 1 : 0;
}

double physical_radius_or_zero(const std::optional<orbit_engine::object::ObjectWire>& value) {
  return value.has_value() ? value->properties.physical_radius.value : 0.0;
}

int collision_radius_present_or_zero(const std::optional<orbit_engine::object::ObjectWire>& value) {
  return value.has_value() && value->properties.collision_bounding_radius.present ? 1 : 0;
}

double collision_radius_or_zero(const std::optional<orbit_engine::object::ObjectWire>& value) {
  return value.has_value() ? value->properties.collision_bounding_radius.value : 0.0;
}

#define FRAME_PARAMETERS \
  std::uint32_t reference_frame_id_high, \
  std::uint32_t reference_frame_id_low, \
  std::int32_t epoch_seconds_high, \
  std::uint32_t epoch_seconds_low, \
  std::uint32_t epoch_nanoseconds, \
  double translation_x, \
  double translation_y, \
  double translation_z, \
  double origin_velocity_x, \
  double origin_velocity_y, \
  double origin_velocity_z, \
  double rotation_w, \
  double rotation_x, \
  double rotation_y, \
  double rotation_z, \
  double angular_velocity_x, \
  double angular_velocity_y, \
  double angular_velocity_z

#define FRAME_ARGUMENTS \
  reference_frame_id_high, reference_frame_id_low, \
  epoch_seconds_high, epoch_seconds_low, epoch_nanoseconds, \
  translation_x, translation_y, translation_z, \
  origin_velocity_x, origin_velocity_y, origin_velocity_z, \
  rotation_w, rotation_x, rotation_y, rotation_z, \
  angular_velocity_x, angular_velocity_y, angular_velocity_z

orbit_engine::frame::FrameWire round_trip_frame_or_zero(FRAME_PARAMETERS) {
  const orbit_engine::frame::FrameWire input{
    reference_frame_id_high,
    reference_frame_id_low,
    orbit_engine::time::TimeWire{epoch_seconds_high, epoch_seconds_low, epoch_nanoseconds},
    translation_x,
    translation_y,
    translation_z,
    origin_velocity_x,
    origin_velocity_y,
    origin_velocity_z,
    rotation_w,
    rotation_x,
    rotation_y,
    rotation_z,
    angular_velocity_x,
    angular_velocity_y,
    angular_velocity_z,
  };
  orbit_engine::frame::FrameWire output{};
  return orbit_engine::frame::round_trip(input, output) ? output : orbit_engine::frame::FrameWire{};
}

EMSCRIPTEN_KEEPALIVE std::int32_t orbit_engine_round_trip_time_seconds_high(
  std::int32_t seconds_high,
  std::uint32_t seconds_low,
  std::uint32_t nanoseconds
) {
  orbit_engine::time::TimeWire output{};
  return round_trip_time(seconds_high, seconds_low, nanoseconds, output) ? output.seconds_high : 0;
}

EMSCRIPTEN_KEEPALIVE std::uint32_t orbit_engine_round_trip_time_seconds_low(
  std::int32_t seconds_high,
  std::uint32_t seconds_low,
  std::uint32_t nanoseconds
) {
  orbit_engine::time::TimeWire output{};
  return round_trip_time(seconds_high, seconds_low, nanoseconds, output) ? output.seconds_low : 0;
}

EMSCRIPTEN_KEEPALIVE std::uint32_t orbit_engine_round_trip_time_nanoseconds(
  std::int32_t seconds_high,
  std::uint32_t seconds_low,
  std::uint32_t nanoseconds
) {
  orbit_engine::time::TimeWire output{};
  return round_trip_time(seconds_high, seconds_low, nanoseconds, output) ? output.nanoseconds : 0;
}

EMSCRIPTEN_KEEPALIVE double orbit_engine_round_trip_double(double value) {
  return orbit_engine::time::round_trip_double(value);
}

EMSCRIPTEN_KEEPALIVE std::uint32_t orbit_engine_round_trip_frame_reference_frame_id_high(FRAME_PARAMETERS) {
  return round_trip_frame_or_zero(FRAME_ARGUMENTS).reference_frame_id_high;
}

EMSCRIPTEN_KEEPALIVE std::uint32_t orbit_engine_round_trip_frame_reference_frame_id_low(FRAME_PARAMETERS) {
  return round_trip_frame_or_zero(FRAME_ARGUMENTS).reference_frame_id_low;
}

EMSCRIPTEN_KEEPALIVE std::int32_t orbit_engine_round_trip_frame_epoch_seconds_high(FRAME_PARAMETERS) {
  return round_trip_frame_or_zero(FRAME_ARGUMENTS).epoch.seconds_high;
}

EMSCRIPTEN_KEEPALIVE std::uint32_t orbit_engine_round_trip_frame_epoch_seconds_low(FRAME_PARAMETERS) {
  return round_trip_frame_or_zero(FRAME_ARGUMENTS).epoch.seconds_low;
}

EMSCRIPTEN_KEEPALIVE std::uint32_t orbit_engine_round_trip_frame_epoch_nanoseconds(FRAME_PARAMETERS) {
  return round_trip_frame_or_zero(FRAME_ARGUMENTS).epoch.nanoseconds;
}

EMSCRIPTEN_KEEPALIVE double orbit_engine_round_trip_frame_translation_x(FRAME_PARAMETERS) {
  return round_trip_frame_or_zero(FRAME_ARGUMENTS).translation_x;
}

EMSCRIPTEN_KEEPALIVE double orbit_engine_round_trip_frame_translation_y(FRAME_PARAMETERS) {
  return round_trip_frame_or_zero(FRAME_ARGUMENTS).translation_y;
}

EMSCRIPTEN_KEEPALIVE double orbit_engine_round_trip_frame_translation_z(FRAME_PARAMETERS) {
  return round_trip_frame_or_zero(FRAME_ARGUMENTS).translation_z;
}

EMSCRIPTEN_KEEPALIVE double orbit_engine_round_trip_frame_origin_velocity_x(FRAME_PARAMETERS) {
  return round_trip_frame_or_zero(FRAME_ARGUMENTS).origin_velocity_x;
}

EMSCRIPTEN_KEEPALIVE double orbit_engine_round_trip_frame_origin_velocity_y(FRAME_PARAMETERS) {
  return round_trip_frame_or_zero(FRAME_ARGUMENTS).origin_velocity_y;
}

EMSCRIPTEN_KEEPALIVE double orbit_engine_round_trip_frame_origin_velocity_z(FRAME_PARAMETERS) {
  return round_trip_frame_or_zero(FRAME_ARGUMENTS).origin_velocity_z;
}

EMSCRIPTEN_KEEPALIVE double orbit_engine_round_trip_frame_rotation_w(FRAME_PARAMETERS) {
  return round_trip_frame_or_zero(FRAME_ARGUMENTS).rotation_w;
}

EMSCRIPTEN_KEEPALIVE double orbit_engine_round_trip_frame_rotation_x(FRAME_PARAMETERS) {
  return round_trip_frame_or_zero(FRAME_ARGUMENTS).rotation_x;
}

EMSCRIPTEN_KEEPALIVE double orbit_engine_round_trip_frame_rotation_y(FRAME_PARAMETERS) {
  return round_trip_frame_or_zero(FRAME_ARGUMENTS).rotation_y;
}

EMSCRIPTEN_KEEPALIVE double orbit_engine_round_trip_frame_rotation_z(FRAME_PARAMETERS) {
  return round_trip_frame_or_zero(FRAME_ARGUMENTS).rotation_z;
}

EMSCRIPTEN_KEEPALIVE double orbit_engine_round_trip_frame_angular_velocity_x(FRAME_PARAMETERS) {
  return round_trip_frame_or_zero(FRAME_ARGUMENTS).angular_velocity_x;
}

EMSCRIPTEN_KEEPALIVE double orbit_engine_round_trip_frame_angular_velocity_y(FRAME_PARAMETERS) {
  return round_trip_frame_or_zero(FRAME_ARGUMENTS).angular_velocity_y;
}

EMSCRIPTEN_KEEPALIVE double orbit_engine_round_trip_frame_angular_velocity_z(FRAME_PARAMETERS) {
  return round_trip_frame_or_zero(FRAME_ARGUMENTS).angular_velocity_z;
}

EMSCRIPTEN_KEEPALIVE std::uint32_t orbit_engine_round_trip_object_id_high(
  std::uint32_t object_id_high,
  std::uint32_t object_id_low,
  std::uint16_t object_type_code,
  int mass_present,
  double mass,
  int mu_present,
  double mu,
  int physical_radius_present,
  double physical_radius,
  int collision_bounding_radius_present,
  double collision_bounding_radius
) {
  return object_id_high_or_zero(round_trip_object(
    object_id_high, object_id_low, object_type_code, mass_present, mass, mu_present, mu,
    physical_radius_present, physical_radius, collision_bounding_radius_present, collision_bounding_radius));
}

EMSCRIPTEN_KEEPALIVE std::uint32_t orbit_engine_round_trip_object_id_low(
  std::uint32_t object_id_high,
  std::uint32_t object_id_low,
  std::uint16_t object_type_code,
  int mass_present,
  double mass,
  int mu_present,
  double mu,
  int physical_radius_present,
  double physical_radius,
  int collision_bounding_radius_present,
  double collision_bounding_radius
) {
  return object_id_low_or_zero(round_trip_object(
    object_id_high, object_id_low, object_type_code, mass_present, mass, mu_present, mu,
    physical_radius_present, physical_radius, collision_bounding_radius_present, collision_bounding_radius));
}

EMSCRIPTEN_KEEPALIVE std::uint16_t orbit_engine_round_trip_object_type_code(
  std::uint32_t object_id_high,
  std::uint32_t object_id_low,
  std::uint16_t object_type_code,
  int mass_present,
  double mass,
  int mu_present,
  double mu,
  int physical_radius_present,
  double physical_radius,
  int collision_bounding_radius_present,
  double collision_bounding_radius
) {
  return object_type_code_or_zero(round_trip_object(
    object_id_high, object_id_low, object_type_code, mass_present, mass, mu_present, mu,
    physical_radius_present, physical_radius, collision_bounding_radius_present, collision_bounding_radius));
}

EMSCRIPTEN_KEEPALIVE int orbit_engine_round_trip_object_mass_present(
  std::uint32_t object_id_high,
  std::uint32_t object_id_low,
  std::uint16_t object_type_code,
  int mass_present,
  double mass,
  int mu_present,
  double mu,
  int physical_radius_present,
  double physical_radius,
  int collision_bounding_radius_present,
  double collision_bounding_radius
) {
  return mass_present_or_zero(round_trip_object(
    object_id_high, object_id_low, object_type_code, mass_present, mass, mu_present, mu,
    physical_radius_present, physical_radius, collision_bounding_radius_present, collision_bounding_radius));
}

EMSCRIPTEN_KEEPALIVE double orbit_engine_round_trip_object_mass(
  std::uint32_t object_id_high,
  std::uint32_t object_id_low,
  std::uint16_t object_type_code,
  int mass_present,
  double mass,
  int mu_present,
  double mu,
  int physical_radius_present,
  double physical_radius,
  int collision_bounding_radius_present,
  double collision_bounding_radius
) {
  return mass_or_zero(round_trip_object(
    object_id_high, object_id_low, object_type_code, mass_present, mass, mu_present, mu,
    physical_radius_present, physical_radius, collision_bounding_radius_present, collision_bounding_radius));
}

EMSCRIPTEN_KEEPALIVE int orbit_engine_round_trip_object_mu_present(
  std::uint32_t object_id_high,
  std::uint32_t object_id_low,
  std::uint16_t object_type_code,
  int mass_present,
  double mass,
  int mu_present,
  double mu,
  int physical_radius_present,
  double physical_radius,
  int collision_bounding_radius_present,
  double collision_bounding_radius
) {
  return mu_present_or_zero(round_trip_object(
    object_id_high, object_id_low, object_type_code, mass_present, mass, mu_present, mu,
    physical_radius_present, physical_radius, collision_bounding_radius_present, collision_bounding_radius));
}

EMSCRIPTEN_KEEPALIVE double orbit_engine_round_trip_object_mu(
  std::uint32_t object_id_high,
  std::uint32_t object_id_low,
  std::uint16_t object_type_code,
  int mass_present,
  double mass,
  int mu_present,
  double mu,
  int physical_radius_present,
  double physical_radius,
  int collision_bounding_radius_present,
  double collision_bounding_radius
) {
  return mu_or_zero(round_trip_object(
    object_id_high, object_id_low, object_type_code, mass_present, mass, mu_present, mu,
    physical_radius_present, physical_radius, collision_bounding_radius_present, collision_bounding_radius));
}

EMSCRIPTEN_KEEPALIVE int orbit_engine_round_trip_object_physical_radius_present(
  std::uint32_t object_id_high,
  std::uint32_t object_id_low,
  std::uint16_t object_type_code,
  int mass_present,
  double mass,
  int mu_present,
  double mu,
  int physical_radius_present,
  double physical_radius,
  int collision_bounding_radius_present,
  double collision_bounding_radius
) {
  return physical_radius_present_or_zero(round_trip_object(
    object_id_high, object_id_low, object_type_code, mass_present, mass, mu_present, mu,
    physical_radius_present, physical_radius, collision_bounding_radius_present, collision_bounding_radius));
}

EMSCRIPTEN_KEEPALIVE double orbit_engine_round_trip_object_physical_radius(
  std::uint32_t object_id_high,
  std::uint32_t object_id_low,
  std::uint16_t object_type_code,
  int mass_present,
  double mass,
  int mu_present,
  double mu,
  int physical_radius_present,
  double physical_radius,
  int collision_bounding_radius_present,
  double collision_bounding_radius
) {
  return physical_radius_or_zero(round_trip_object(
    object_id_high, object_id_low, object_type_code, mass_present, mass, mu_present, mu,
    physical_radius_present, physical_radius, collision_bounding_radius_present, collision_bounding_radius));
}

EMSCRIPTEN_KEEPALIVE int orbit_engine_round_trip_object_collision_radius_present(
  std::uint32_t object_id_high,
  std::uint32_t object_id_low,
  std::uint16_t object_type_code,
  int mass_present,
  double mass,
  int mu_present,
  double mu,
  int physical_radius_present,
  double physical_radius,
  int collision_bounding_radius_present,
  double collision_bounding_radius
) {
  return collision_radius_present_or_zero(round_trip_object(
    object_id_high, object_id_low, object_type_code, mass_present, mass, mu_present, mu,
    physical_radius_present, physical_radius, collision_bounding_radius_present, collision_bounding_radius));
}

EMSCRIPTEN_KEEPALIVE double orbit_engine_round_trip_object_collision_radius(
  std::uint32_t object_id_high,
  std::uint32_t object_id_low,
  std::uint16_t object_type_code,
  int mass_present,
  double mass,
  int mu_present,
  double mu,
  int physical_radius_present,
  double physical_radius,
  int collision_bounding_radius_present,
  double collision_bounding_radius
) {
  return collision_radius_or_zero(round_trip_object(
    object_id_high, object_id_low, object_type_code, mass_present, mass, mu_present, mu,
    physical_radius_present, physical_radius, collision_bounding_radius_present, collision_bounding_radius));
}

#undef FRAME_ARGUMENTS
#undef FRAME_PARAMETERS

#define PROP_PARAMETERS \
  std::uint32_t object_id_high, std::uint32_t object_id_low, \
  std::uint16_t model_kind_code, std::uint16_t direction_code, std::uint16_t bounded_direction_code, \
  std::uint32_t propagation_frame_high, std::uint32_t propagation_frame_low, \
  std::uint32_t configuration_revision_high, std::uint32_t configuration_revision_low, \
  std::uint32_t motion_revision_high, std::uint32_t motion_revision_low, \
  std::int32_t segment_start_seconds_high, std::uint32_t segment_start_seconds_low, std::uint32_t segment_start_nanoseconds, \
  int segment_end_present, std::int32_t segment_end_seconds_high, std::uint32_t segment_end_seconds_low, std::uint32_t segment_end_nanoseconds, \
  std::int32_t target_seconds_high, std::uint32_t target_seconds_low, std::uint32_t target_nanoseconds, \
  std::uint16_t outcome_code, std::uint32_t result_frame_high, std::uint32_t result_frame_low, \
  double position_x, double position_y, double position_z, double velocity_x, double velocity_y, double velocity_z, \
  double position_absolute_meters, double position_relative, double velocity_absolute_meters_per_second, double velocity_relative

#define PROP_ARGUMENTS \
  object_id_high, object_id_low, model_kind_code, direction_code, bounded_direction_code, \
  propagation_frame_high, propagation_frame_low, configuration_revision_high, configuration_revision_low, \
  motion_revision_high, motion_revision_low, segment_start_seconds_high, segment_start_seconds_low, segment_start_nanoseconds, \
  segment_end_present, segment_end_seconds_high, segment_end_seconds_low, segment_end_nanoseconds, \
  target_seconds_high, target_seconds_low, target_nanoseconds, outcome_code, result_frame_high, result_frame_low, \
  position_x, position_y, position_z, velocity_x, velocity_y, velocity_z, \
  position_absolute_meters, position_relative, velocity_absolute_meters_per_second, velocity_relative

orbit_engine::propagation::PropagationWire g_propagation_output{};

EMSCRIPTEN_KEEPALIVE int orbit_engine_round_trip_propagation(PROP_PARAMETERS) {
  const orbit_engine::propagation::PropagationWire input{
    object_id_high,
    object_id_low,
    model_kind_code,
    direction_code,
    bounded_direction_code,
    propagation_frame_high,
    propagation_frame_low,
    configuration_revision_high,
    configuration_revision_low,
    motion_revision_high,
    motion_revision_low,
    orbit_engine::time::TimeWire{segment_start_seconds_high, segment_start_seconds_low, segment_start_nanoseconds},
    segment_end_present != 0,
    orbit_engine::time::TimeWire{segment_end_seconds_high, segment_end_seconds_low, segment_end_nanoseconds},
    orbit_engine::time::TimeWire{target_seconds_high, target_seconds_low, target_nanoseconds},
    outcome_code,
    result_frame_high,
    result_frame_low,
    position_x,
    position_y,
    position_z,
    velocity_x,
    velocity_y,
    velocity_z,
    position_absolute_meters,
    position_relative,
    velocity_absolute_meters_per_second,
    velocity_relative,
  };
  orbit_engine::propagation::PropagationWire output{};
  if (!orbit_engine::propagation::round_trip(input, output)) {
    g_propagation_output = orbit_engine::propagation::PropagationWire{};
    return 0;
  }
  g_propagation_output = output;
  return 1;
}

#define PROP_GETTER(name, field, type) \
  EMSCRIPTEN_KEEPALIVE type name() { return g_propagation_output.field; }

PROP_GETTER(orbit_engine_propagation_object_id_high, object_id_high, std::uint32_t)
PROP_GETTER(orbit_engine_propagation_object_id_low, object_id_low, std::uint32_t)
PROP_GETTER(orbit_engine_propagation_model_kind_code, model_kind_code, std::uint16_t)
PROP_GETTER(orbit_engine_propagation_direction_code, direction_code, std::uint16_t)
PROP_GETTER(orbit_engine_propagation_bounded_direction_code, bounded_direction_code, std::uint16_t)
PROP_GETTER(orbit_engine_propagation_frame_high, propagation_frame_high, std::uint32_t)
PROP_GETTER(orbit_engine_propagation_frame_low, propagation_frame_low, std::uint32_t)
PROP_GETTER(orbit_engine_propagation_configuration_revision_high, configuration_revision_high, std::uint32_t)
PROP_GETTER(orbit_engine_propagation_configuration_revision_low, configuration_revision_low, std::uint32_t)
PROP_GETTER(orbit_engine_propagation_motion_revision_high, motion_revision_high, std::uint32_t)
PROP_GETTER(orbit_engine_propagation_motion_revision_low, motion_revision_low, std::uint32_t)
PROP_GETTER(orbit_engine_propagation_segment_start_seconds_high, segment_start.seconds_high, std::int32_t)
PROP_GETTER(orbit_engine_propagation_segment_start_seconds_low, segment_start.seconds_low, std::uint32_t)
PROP_GETTER(orbit_engine_propagation_segment_start_nanoseconds, segment_start.nanoseconds, std::uint32_t)
PROP_GETTER(orbit_engine_propagation_segment_end_present, segment_end_present, int)
PROP_GETTER(orbit_engine_propagation_segment_end_seconds_high, segment_end.seconds_high, std::int32_t)
PROP_GETTER(orbit_engine_propagation_segment_end_seconds_low, segment_end.seconds_low, std::uint32_t)
PROP_GETTER(orbit_engine_propagation_segment_end_nanoseconds, segment_end.nanoseconds, std::uint32_t)
PROP_GETTER(orbit_engine_propagation_target_seconds_high, target.seconds_high, std::int32_t)
PROP_GETTER(orbit_engine_propagation_target_seconds_low, target.seconds_low, std::uint32_t)
PROP_GETTER(orbit_engine_propagation_target_nanoseconds, target.nanoseconds, std::uint32_t)
PROP_GETTER(orbit_engine_propagation_outcome_code, outcome_code, std::uint16_t)
PROP_GETTER(orbit_engine_propagation_result_frame_high, result_frame_high, std::uint32_t)
PROP_GETTER(orbit_engine_propagation_result_frame_low, result_frame_low, std::uint32_t)
PROP_GETTER(orbit_engine_propagation_position_x, position_x, double)
PROP_GETTER(orbit_engine_propagation_position_y, position_y, double)
PROP_GETTER(orbit_engine_propagation_position_z, position_z, double)
PROP_GETTER(orbit_engine_propagation_velocity_x, velocity_x, double)
PROP_GETTER(orbit_engine_propagation_velocity_y, velocity_y, double)
PROP_GETTER(orbit_engine_propagation_velocity_z, velocity_z, double)
PROP_GETTER(orbit_engine_propagation_position_absolute_meters, position_absolute_meters, double)
PROP_GETTER(orbit_engine_propagation_position_relative, position_relative, double)
PROP_GETTER(orbit_engine_propagation_velocity_absolute_meters_per_second, velocity_absolute_meters_per_second, double)
PROP_GETTER(orbit_engine_propagation_velocity_relative, velocity_relative, double)

#undef PROP_GETTER
#undef PROP_ARGUMENTS
#undef PROP_PARAMETERS

#define REG_PARAMETERS \
  std::uint16_t operation_code, std::uint16_t result_code, \
  std::uint32_t object_id_high, std::uint32_t object_id_low, std::uint16_t object_type_code, \
  int mass_present, double mass, int mu_present, double mu, \
  int physical_radius_present, double physical_radius, int collision_bounding_radius_present, double collision_bounding_radius, \
  int state_present, std::int32_t state_epoch_seconds_high, std::uint32_t state_epoch_seconds_low, std::uint32_t state_epoch_nanoseconds, \
  std::uint32_t state_frame_high, std::uint32_t state_frame_low, \
  double position_x, double position_y, double position_z, double velocity_x, double velocity_y, double velocity_z, \
  std::uint16_t model_kind_code, std::uint16_t direction_code, \
  std::int32_t segment_start_seconds_high, std::uint32_t segment_start_seconds_low, std::uint32_t segment_start_nanoseconds, \
  int segment_end_present, std::int32_t segment_end_seconds_high, std::uint32_t segment_end_seconds_low, std::uint32_t segment_end_nanoseconds, \
  std::uint32_t configuration_revision_high, std::uint32_t configuration_revision_low, \
  std::uint32_t motion_revision_high, std::uint32_t motion_revision_low, std::uint16_t reference_status_code, \
  std::uint32_t property_revision_high, std::uint32_t property_revision_low, \
  std::int32_t effective_epoch_seconds_high, std::uint32_t effective_epoch_seconds_low, std::uint32_t effective_epoch_nanoseconds, \
  int structural_parent_present, std::uint32_t structural_parent_high, std::uint32_t structural_parent_low

#define REG_ARGUMENTS \
  operation_code, result_code, object_id_high, object_id_low, object_type_code, \
  mass_present, mass, mu_present, mu, physical_radius_present, physical_radius, \
  collision_bounding_radius_present, collision_bounding_radius, state_present, \
  state_epoch_seconds_high, state_epoch_seconds_low, state_epoch_nanoseconds, state_frame_high, state_frame_low, \
  position_x, position_y, position_z, velocity_x, velocity_y, velocity_z, model_kind_code, direction_code, \
  segment_start_seconds_high, segment_start_seconds_low, segment_start_nanoseconds, segment_end_present, \
  segment_end_seconds_high, segment_end_seconds_low, segment_end_nanoseconds, configuration_revision_high, \
  configuration_revision_low, motion_revision_high, motion_revision_low, reference_status_code, \
  property_revision_high, property_revision_low, effective_epoch_seconds_high, effective_epoch_seconds_low, \
  effective_epoch_nanoseconds, structural_parent_present, structural_parent_high, structural_parent_low

orbit_engine::registry::RegistryWire g_registry_output{};

EMSCRIPTEN_KEEPALIVE int orbit_engine_round_trip_registry(REG_PARAMETERS) {
  const orbit_engine::registry::RegistryWire input{
    operation_code,
    result_code,
    object_id_high,
    object_id_low,
    object_type_code,
    orbit_engine::object::PhysicalProperties{
      {mass_present != 0, mass},
      {mu_present != 0, mu},
      {physical_radius_present != 0, physical_radius},
      {collision_bounding_radius_present != 0, collision_bounding_radius},
    },
    state_present != 0,
    orbit_engine::time::TimeWire{state_epoch_seconds_high, state_epoch_seconds_low, state_epoch_nanoseconds},
    state_frame_high,
    state_frame_low,
    position_x,
    position_y,
    position_z,
    velocity_x,
    velocity_y,
    velocity_z,
    model_kind_code,
    direction_code,
    orbit_engine::time::TimeWire{segment_start_seconds_high, segment_start_seconds_low, segment_start_nanoseconds},
    segment_end_present != 0,
    orbit_engine::time::TimeWire{segment_end_seconds_high, segment_end_seconds_low, segment_end_nanoseconds},
    configuration_revision_high,
    configuration_revision_low,
    motion_revision_high,
    motion_revision_low,
    reference_status_code,
    property_revision_high,
    property_revision_low,
    orbit_engine::time::TimeWire{effective_epoch_seconds_high, effective_epoch_seconds_low, effective_epoch_nanoseconds},
    structural_parent_present != 0,
    structural_parent_high,
    structural_parent_low,
  };
  g_registry_output = g_registry.command(input);
  return 1;
}

#define REG_GETTER(name, field, type) \
  EMSCRIPTEN_KEEPALIVE type name() { return g_registry_output.field; }

REG_GETTER(orbit_engine_registry_operation_code, operation_code, std::uint16_t)
REG_GETTER(orbit_engine_registry_result_code, result_code, std::uint16_t)
REG_GETTER(orbit_engine_registry_object_id_high, object_id_high, std::uint32_t)
REG_GETTER(orbit_engine_registry_object_id_low, object_id_low, std::uint32_t)
REG_GETTER(orbit_engine_registry_object_type_code, object_type_code, std::uint16_t)
REG_GETTER(orbit_engine_registry_mass_present, properties.mass.present, int)
REG_GETTER(orbit_engine_registry_mass, properties.mass.value, double)
REG_GETTER(orbit_engine_registry_mu_present, properties.mu.present, int)
REG_GETTER(orbit_engine_registry_mu, properties.mu.value, double)
REG_GETTER(orbit_engine_registry_physical_radius_present, properties.physical_radius.present, int)
REG_GETTER(orbit_engine_registry_physical_radius, properties.physical_radius.value, double)
REG_GETTER(orbit_engine_registry_collision_bounding_radius_present, properties.collision_bounding_radius.present, int)
REG_GETTER(orbit_engine_registry_collision_bounding_radius, properties.collision_bounding_radius.value, double)
REG_GETTER(orbit_engine_registry_state_present, state_present, int)
REG_GETTER(orbit_engine_registry_state_epoch_seconds_high, state_epoch.seconds_high, std::int32_t)
REG_GETTER(orbit_engine_registry_state_epoch_seconds_low, state_epoch.seconds_low, std::uint32_t)
REG_GETTER(orbit_engine_registry_state_epoch_nanoseconds, state_epoch.nanoseconds, std::uint32_t)
REG_GETTER(orbit_engine_registry_state_frame_high, state_frame_high, std::uint32_t)
REG_GETTER(orbit_engine_registry_state_frame_low, state_frame_low, std::uint32_t)
REG_GETTER(orbit_engine_registry_position_x, position_x, double)
REG_GETTER(orbit_engine_registry_position_y, position_y, double)
REG_GETTER(orbit_engine_registry_position_z, position_z, double)
REG_GETTER(orbit_engine_registry_velocity_x, velocity_x, double)
REG_GETTER(orbit_engine_registry_velocity_y, velocity_y, double)
REG_GETTER(orbit_engine_registry_velocity_z, velocity_z, double)
REG_GETTER(orbit_engine_registry_model_kind_code, model_kind_code, std::uint16_t)
REG_GETTER(orbit_engine_registry_direction_code, direction_code, std::uint16_t)
REG_GETTER(orbit_engine_registry_segment_start_seconds_high, segment_start.seconds_high, std::int32_t)
REG_GETTER(orbit_engine_registry_segment_start_seconds_low, segment_start.seconds_low, std::uint32_t)
REG_GETTER(orbit_engine_registry_segment_start_nanoseconds, segment_start.nanoseconds, std::uint32_t)
REG_GETTER(orbit_engine_registry_segment_end_present, segment_end_present, int)
REG_GETTER(orbit_engine_registry_segment_end_seconds_high, segment_end.seconds_high, std::int32_t)
REG_GETTER(orbit_engine_registry_segment_end_seconds_low, segment_end.seconds_low, std::uint32_t)
REG_GETTER(orbit_engine_registry_segment_end_nanoseconds, segment_end.nanoseconds, std::uint32_t)
REG_GETTER(orbit_engine_registry_configuration_revision_high, configuration_revision_high, std::uint32_t)
REG_GETTER(orbit_engine_registry_configuration_revision_low, configuration_revision_low, std::uint32_t)
REG_GETTER(orbit_engine_registry_motion_revision_high, motion_revision_high, std::uint32_t)
REG_GETTER(orbit_engine_registry_motion_revision_low, motion_revision_low, std::uint32_t)
REG_GETTER(orbit_engine_registry_reference_status_code, reference_status_code, std::uint16_t)
REG_GETTER(orbit_engine_registry_property_revision_high, property_revision_high, std::uint32_t)
REG_GETTER(orbit_engine_registry_property_revision_low, property_revision_low, std::uint32_t)
REG_GETTER(orbit_engine_registry_effective_epoch_seconds_high, effective_epoch.seconds_high, std::int32_t)
REG_GETTER(orbit_engine_registry_effective_epoch_seconds_low, effective_epoch.seconds_low, std::uint32_t)
REG_GETTER(orbit_engine_registry_effective_epoch_nanoseconds, effective_epoch.nanoseconds, std::uint32_t)
REG_GETTER(orbit_engine_registry_structural_parent_present, structural_parent_present, int)
REG_GETTER(orbit_engine_registry_structural_parent_high, structural_parent_high, std::uint32_t)
REG_GETTER(orbit_engine_registry_structural_parent_low, structural_parent_low, std::uint32_t)

#undef REG_GETTER
#undef REG_ARGUMENTS
#undef REG_PARAMETERS

#define FRAME_REG_PARAMETERS \
  std::uint16_t operation_code, std::uint16_t result_code, \
  std::uint32_t frame_id_high, std::uint32_t frame_id_low, \
  int parent_present, std::uint32_t parent_high, std::uint32_t parent_low, \
  std::uint16_t provider_code, int dependency_present, \
  std::uint32_t dependency_high, std::uint32_t dependency_low, \
  std::uint32_t transform_reference_frame_id_high, std::uint32_t transform_reference_frame_id_low, \
  std::int32_t transform_epoch_seconds_high, std::uint32_t transform_epoch_seconds_low, \
  std::uint32_t transform_epoch_nanoseconds, \
  double transform_translation_x, double transform_translation_y, double transform_translation_z, \
  double transform_origin_velocity_x, double transform_origin_velocity_y, double transform_origin_velocity_z, \
  double transform_rotation_w, double transform_rotation_x, double transform_rotation_y, double transform_rotation_z, \
  double transform_angular_velocity_x, double transform_angular_velocity_y, double transform_angular_velocity_z

orbit_engine::frame_registry::FrameRegistryWire g_frame_registry_output{};

EMSCRIPTEN_KEEPALIVE int orbit_engine_round_trip_frame_registry(FRAME_REG_PARAMETERS) {
  const orbit_engine::frame_registry::FrameRegistryWire input{
    operation_code,
    result_code,
    frame_id_high,
    frame_id_low,
    parent_present != 0,
    parent_high,
    parent_low,
    provider_code,
    dependency_present != 0,
    dependency_high,
    dependency_low,
    orbit_engine::frame::FrameWire{
      transform_reference_frame_id_high,
      transform_reference_frame_id_low,
      orbit_engine::time::TimeWire{
        transform_epoch_seconds_high,
        transform_epoch_seconds_low,
        transform_epoch_nanoseconds,
      },
      transform_translation_x,
      transform_translation_y,
      transform_translation_z,
      transform_origin_velocity_x,
      transform_origin_velocity_y,
      transform_origin_velocity_z,
      transform_rotation_w,
      transform_rotation_x,
      transform_rotation_y,
      transform_rotation_z,
      transform_angular_velocity_x,
      transform_angular_velocity_y,
      transform_angular_velocity_z,
    },
  };
  g_frame_registry_output = g_frame_registry.command(input);
  return 1;
}

#define FRAME_REG_GETTER(name, field, type) \
  EMSCRIPTEN_KEEPALIVE type name() { return g_frame_registry_output.field; }

FRAME_REG_GETTER(orbit_engine_frame_registry_operation_code, operation_code, std::uint16_t)
FRAME_REG_GETTER(orbit_engine_frame_registry_result_code, result_code, std::uint16_t)
FRAME_REG_GETTER(orbit_engine_frame_registry_frame_id_high, frame_id_high, std::uint32_t)
FRAME_REG_GETTER(orbit_engine_frame_registry_frame_id_low, frame_id_low, std::uint32_t)
FRAME_REG_GETTER(orbit_engine_frame_registry_parent_present, parent_present, int)
FRAME_REG_GETTER(orbit_engine_frame_registry_parent_high, parent_high, std::uint32_t)
FRAME_REG_GETTER(orbit_engine_frame_registry_parent_low, parent_low, std::uint32_t)
FRAME_REG_GETTER(orbit_engine_frame_registry_provider_code, provider_code, std::uint16_t)
FRAME_REG_GETTER(orbit_engine_frame_registry_dependency_present, dependency_present, int)
FRAME_REG_GETTER(orbit_engine_frame_registry_dependency_high, dependency_high, std::uint32_t)
FRAME_REG_GETTER(orbit_engine_frame_registry_dependency_low, dependency_low, std::uint32_t)
FRAME_REG_GETTER(orbit_engine_frame_registry_transform_reference_frame_id_high, transform.reference_frame_id_high, std::uint32_t)
FRAME_REG_GETTER(orbit_engine_frame_registry_transform_reference_frame_id_low, transform.reference_frame_id_low, std::uint32_t)
FRAME_REG_GETTER(orbit_engine_frame_registry_transform_epoch_seconds_high, transform.epoch.seconds_high, std::int32_t)
FRAME_REG_GETTER(orbit_engine_frame_registry_transform_epoch_seconds_low, transform.epoch.seconds_low, std::uint32_t)
FRAME_REG_GETTER(orbit_engine_frame_registry_transform_epoch_nanoseconds, transform.epoch.nanoseconds, std::uint32_t)
FRAME_REG_GETTER(orbit_engine_frame_registry_transform_translation_x, transform.translation_x, double)
FRAME_REG_GETTER(orbit_engine_frame_registry_transform_translation_y, transform.translation_y, double)
FRAME_REG_GETTER(orbit_engine_frame_registry_transform_translation_z, transform.translation_z, double)
FRAME_REG_GETTER(orbit_engine_frame_registry_transform_origin_velocity_x, transform.origin_velocity_x, double)
FRAME_REG_GETTER(orbit_engine_frame_registry_transform_origin_velocity_y, transform.origin_velocity_y, double)
FRAME_REG_GETTER(orbit_engine_frame_registry_transform_origin_velocity_z, transform.origin_velocity_z, double)
FRAME_REG_GETTER(orbit_engine_frame_registry_transform_rotation_w, transform.rotation_w, double)
FRAME_REG_GETTER(orbit_engine_frame_registry_transform_rotation_x, transform.rotation_x, double)
FRAME_REG_GETTER(orbit_engine_frame_registry_transform_rotation_y, transform.rotation_y, double)
FRAME_REG_GETTER(orbit_engine_frame_registry_transform_rotation_z, transform.rotation_z, double)
FRAME_REG_GETTER(orbit_engine_frame_registry_transform_angular_velocity_x, transform.angular_velocity_x, double)
FRAME_REG_GETTER(orbit_engine_frame_registry_transform_angular_velocity_y, transform.angular_velocity_y, double)
FRAME_REG_GETTER(orbit_engine_frame_registry_transform_angular_velocity_z, transform.angular_velocity_z, double)

#undef FRAME_REG_GETTER
#undef FRAME_REG_PARAMETERS

#define TWO_BODY_PARAMETERS \
  std::uint16_t result_code, std::uint32_t central_object_id_high, std::uint32_t central_object_id_low, double mu, \
  std::uint32_t anchor_frame_high, std::uint32_t anchor_frame_low, \
  std::int32_t anchor_epoch_seconds_high, std::uint32_t anchor_epoch_seconds_low, std::uint32_t anchor_epoch_nanoseconds, \
  double anchor_position_x, double anchor_position_y, double anchor_position_z, \
  double anchor_velocity_x, double anchor_velocity_y, double anchor_velocity_z, \
  std::int32_t target_epoch_seconds_high, std::uint32_t target_epoch_seconds_low, std::uint32_t target_epoch_nanoseconds, \
  std::uint32_t result_frame_high, std::uint32_t result_frame_low, \
  std::int32_t result_epoch_seconds_high, std::uint32_t result_epoch_seconds_low, std::uint32_t result_epoch_nanoseconds, \
  double result_position_x, double result_position_y, double result_position_z, \
  double result_velocity_x, double result_velocity_y, double result_velocity_z

orbit_engine::two_body::TwoBodyWire g_two_body_output{};

EMSCRIPTEN_KEEPALIVE int orbit_engine_round_trip_two_body(TWO_BODY_PARAMETERS) {
  const orbit_engine::two_body::TwoBodyWire input{
    result_code,
    central_object_id_high,
    central_object_id_low,
    mu,
    anchor_frame_high,
    anchor_frame_low,
    orbit_engine::time::TimeWire{anchor_epoch_seconds_high, anchor_epoch_seconds_low, anchor_epoch_nanoseconds},
    anchor_position_x,
    anchor_position_y,
    anchor_position_z,
    anchor_velocity_x,
    anchor_velocity_y,
    anchor_velocity_z,
    orbit_engine::time::TimeWire{target_epoch_seconds_high, target_epoch_seconds_low, target_epoch_nanoseconds},
    result_frame_high,
    result_frame_low,
    orbit_engine::time::TimeWire{result_epoch_seconds_high, result_epoch_seconds_low, result_epoch_nanoseconds},
    result_position_x,
    result_position_y,
    result_position_z,
    result_velocity_x,
    result_velocity_y,
    result_velocity_z,
  };
  g_two_body_output = orbit_engine::two_body::evaluate(input);
  return 1;
}

#define TWO_BODY_GETTER(name, field, type) \
  EMSCRIPTEN_KEEPALIVE type name() { return g_two_body_output.field; }

TWO_BODY_GETTER(orbit_engine_two_body_result_code, result_code, std::uint16_t)
TWO_BODY_GETTER(orbit_engine_two_body_central_object_id_high, central_object_id_high, std::uint32_t)
TWO_BODY_GETTER(orbit_engine_two_body_central_object_id_low, central_object_id_low, std::uint32_t)
TWO_BODY_GETTER(orbit_engine_two_body_mu, mu, double)
TWO_BODY_GETTER(orbit_engine_two_body_anchor_frame_high, anchor_frame_high, std::uint32_t)
TWO_BODY_GETTER(orbit_engine_two_body_anchor_frame_low, anchor_frame_low, std::uint32_t)
TWO_BODY_GETTER(orbit_engine_two_body_anchor_epoch_seconds_high, anchor_epoch.seconds_high, std::int32_t)
TWO_BODY_GETTER(orbit_engine_two_body_anchor_epoch_seconds_low, anchor_epoch.seconds_low, std::uint32_t)
TWO_BODY_GETTER(orbit_engine_two_body_anchor_epoch_nanoseconds, anchor_epoch.nanoseconds, std::uint32_t)
TWO_BODY_GETTER(orbit_engine_two_body_anchor_position_x, anchor_position_x, double)
TWO_BODY_GETTER(orbit_engine_two_body_anchor_position_y, anchor_position_y, double)
TWO_BODY_GETTER(orbit_engine_two_body_anchor_position_z, anchor_position_z, double)
TWO_BODY_GETTER(orbit_engine_two_body_anchor_velocity_x, anchor_velocity_x, double)
TWO_BODY_GETTER(orbit_engine_two_body_anchor_velocity_y, anchor_velocity_y, double)
TWO_BODY_GETTER(orbit_engine_two_body_anchor_velocity_z, anchor_velocity_z, double)
TWO_BODY_GETTER(orbit_engine_two_body_target_epoch_seconds_high, target_epoch.seconds_high, std::int32_t)
TWO_BODY_GETTER(orbit_engine_two_body_target_epoch_seconds_low, target_epoch.seconds_low, std::uint32_t)
TWO_BODY_GETTER(orbit_engine_two_body_target_epoch_nanoseconds, target_epoch.nanoseconds, std::uint32_t)
TWO_BODY_GETTER(orbit_engine_two_body_result_frame_high, result_frame_high, std::uint32_t)
TWO_BODY_GETTER(orbit_engine_two_body_result_frame_low, result_frame_low, std::uint32_t)
TWO_BODY_GETTER(orbit_engine_two_body_result_epoch_seconds_high, result_epoch.seconds_high, std::int32_t)
TWO_BODY_GETTER(orbit_engine_two_body_result_epoch_seconds_low, result_epoch.seconds_low, std::uint32_t)
TWO_BODY_GETTER(orbit_engine_two_body_result_epoch_nanoseconds, result_epoch.nanoseconds, std::uint32_t)
TWO_BODY_GETTER(orbit_engine_two_body_result_position_x, result_position_x, double)
TWO_BODY_GETTER(orbit_engine_two_body_result_position_y, result_position_y, double)
TWO_BODY_GETTER(orbit_engine_two_body_result_position_z, result_position_z, double)
TWO_BODY_GETTER(orbit_engine_two_body_result_velocity_x, result_velocity_x, double)
TWO_BODY_GETTER(orbit_engine_two_body_result_velocity_y, result_velocity_y, double)
TWO_BODY_GETTER(orbit_engine_two_body_result_velocity_z, result_velocity_z, double)

#undef TWO_BODY_GETTER
#undef TWO_BODY_PARAMETERS

#define NUMERICAL_PARAMETERS \
  std::uint16_t result_code, \
  std::uint32_t object_id_high, std::uint32_t object_id_low, \
  std::uint32_t propagation_frame_high, std::uint32_t propagation_frame_low, \
  std::uint32_t frame_revision_high, std::uint32_t frame_revision_low, \
  std::int32_t anchor_epoch_seconds_high, std::uint32_t anchor_epoch_seconds_low, std::uint32_t anchor_epoch_nanoseconds, \
  std::int32_t target_epoch_seconds_high, std::uint32_t target_epoch_seconds_low, std::uint32_t target_epoch_nanoseconds, \
  double anchor_position_x, double anchor_position_y, double anchor_position_z, \
  double anchor_velocity_x, double anchor_velocity_y, double anchor_velocity_z, \
  int mass_present, double mass, \
  double constant_acceleration_x, double constant_acceleration_y, double constant_acceleration_z, \
  int source_present, std::uint32_t source_id_high, std::uint32_t source_id_low, \
  std::uint32_t source_revision_high, std::uint32_t source_revision_low, \
  double source_position_x, double source_position_y, double source_position_z, \
  int source_mu_present, double source_mu, int source_mass_present, double source_mass, \
  double relative_tolerance, double position_absolute_tolerance_meters, double velocity_absolute_tolerance_meters_per_second, \
  double mass_absolute_tolerance_kilograms, \
  std::uint32_t checkpoint_stride_accepted_steps, std::uint32_t max_checkpoint_count, \
  std::uint32_t max_dense_step_count, std::uint32_t max_accepted_steps_per_extension, \
  std::uint32_t max_rejected_steps_per_extension, \
  std::int32_t min_step_seconds_high, std::uint32_t min_step_seconds_low, std::uint32_t min_step_nanoseconds, \
  std::int32_t max_step_seconds_high, std::uint32_t max_step_seconds_low, std::uint32_t max_step_nanoseconds, \
  std::uint32_t configuration_revision_high, std::uint32_t configuration_revision_low, \
  std::uint32_t motion_revision_high, std::uint32_t motion_revision_low, \
  int maneuver_present, std::uint32_t maneuver_id_high, std::uint32_t maneuver_id_low, \
  std::uint32_t maneuver_revision_high, std::uint32_t maneuver_revision_low, std::uint32_t maneuver_stage_index, \
  std::int32_t maneuver_stage_start_seconds_high, std::uint32_t maneuver_stage_start_seconds_low, std::uint32_t maneuver_stage_start_nanoseconds, \
  std::int32_t maneuver_stage_end_seconds_high, std::uint32_t maneuver_stage_end_seconds_low, std::uint32_t maneuver_stage_end_nanoseconds, \
  double maneuver_force_magnitude_newtons, double maneuver_mass_flow_kilograms_per_second, \
  int maneuver_minimum_mass_present, double maneuver_minimum_mass_kilograms, std::uint32_t maneuver_direction_kind, \
  std::uint32_t maneuver_direction_frame_high, std::uint32_t maneuver_direction_frame_low, \
  std::uint32_t maneuver_direction_frame_revision_high, std::uint32_t maneuver_direction_frame_revision_low, \
  double maneuver_direction_x, double maneuver_direction_y, double maneuver_direction_z, \
  std::uint32_t maneuver_attitude_source_high, std::uint32_t maneuver_attitude_source_low, \
  std::uint32_t maneuver_attitude_revision_high, std::uint32_t maneuver_attitude_revision_low

orbit_engine::numerical_operation::NumericalWire g_numerical_output{};

EMSCRIPTEN_KEEPALIVE int orbit_engine_round_trip_numerical(NUMERICAL_PARAMETERS) {
  orbit_engine::numerical_operation::NumericalWire input{};
  input.result_code = result_code;
  input.object_id_high = object_id_high;
  input.object_id_low = object_id_low;
  input.propagation_frame_high = propagation_frame_high;
  input.propagation_frame_low = propagation_frame_low;
  input.frame_revision_high = frame_revision_high;
  input.frame_revision_low = frame_revision_low;
  input.anchor_epoch = orbit_engine::time::TimeWire{anchor_epoch_seconds_high, anchor_epoch_seconds_low, anchor_epoch_nanoseconds};
  input.target_epoch = orbit_engine::time::TimeWire{target_epoch_seconds_high, target_epoch_seconds_low, target_epoch_nanoseconds};
  input.anchor_position_x = anchor_position_x;
  input.anchor_position_y = anchor_position_y;
  input.anchor_position_z = anchor_position_z;
  input.anchor_velocity_x = anchor_velocity_x;
  input.anchor_velocity_y = anchor_velocity_y;
  input.anchor_velocity_z = anchor_velocity_z;
  input.mass_present = mass_present != 0;
  input.mass = mass;
  input.constant_acceleration_x = constant_acceleration_x;
  input.constant_acceleration_y = constant_acceleration_y;
  input.constant_acceleration_z = constant_acceleration_z;
  input.source_present = source_present != 0;
  input.source_id_high = source_id_high;
  input.source_id_low = source_id_low;
  input.source_revision_high = source_revision_high;
  input.source_revision_low = source_revision_low;
  input.source_position_x = source_position_x;
  input.source_position_y = source_position_y;
  input.source_position_z = source_position_z;
  input.source_mu_present = source_mu_present != 0;
  input.source_mu = source_mu;
  input.source_mass_present = source_mass_present != 0;
  input.source_mass = source_mass;
  input.relative_tolerance = relative_tolerance;
  input.position_absolute_tolerance_meters = position_absolute_tolerance_meters;
  input.velocity_absolute_tolerance_meters_per_second = velocity_absolute_tolerance_meters_per_second;
  input.mass_absolute_tolerance_kilograms = mass_absolute_tolerance_kilograms;
  input.checkpoint_stride_accepted_steps = checkpoint_stride_accepted_steps;
  input.max_checkpoint_count = max_checkpoint_count;
  input.max_dense_step_count = max_dense_step_count;
  input.max_accepted_steps_per_extension = max_accepted_steps_per_extension;
  input.max_rejected_steps_per_extension = max_rejected_steps_per_extension;
  input.min_step = orbit_engine::time::TimeWire{min_step_seconds_high, min_step_seconds_low, min_step_nanoseconds};
  input.max_step = orbit_engine::time::TimeWire{max_step_seconds_high, max_step_seconds_low, max_step_nanoseconds};
  input.configuration_revision_high = configuration_revision_high;
  input.configuration_revision_low = configuration_revision_low;
  input.motion_revision_high = motion_revision_high;
  input.motion_revision_low = motion_revision_low;
  input.maneuver_present = maneuver_present != 0;
  input.maneuver_id_high = maneuver_id_high;
  input.maneuver_id_low = maneuver_id_low;
  input.maneuver_revision_high = maneuver_revision_high;
  input.maneuver_revision_low = maneuver_revision_low;
  input.maneuver_stage_index = maneuver_stage_index;
  input.maneuver_stage_start = orbit_engine::time::TimeWire{maneuver_stage_start_seconds_high, maneuver_stage_start_seconds_low, maneuver_stage_start_nanoseconds};
  input.maneuver_stage_end = orbit_engine::time::TimeWire{maneuver_stage_end_seconds_high, maneuver_stage_end_seconds_low, maneuver_stage_end_nanoseconds};
  input.maneuver_force_magnitude_newtons = maneuver_force_magnitude_newtons;
  input.maneuver_mass_flow_kilograms_per_second = maneuver_mass_flow_kilograms_per_second;
  input.maneuver_minimum_mass_present = maneuver_minimum_mass_present != 0;
  input.maneuver_minimum_mass_kilograms = maneuver_minimum_mass_kilograms;
  input.maneuver_direction_kind = static_cast<std::uint16_t>(maneuver_direction_kind);
  input.maneuver_direction_frame_high = maneuver_direction_frame_high;
  input.maneuver_direction_frame_low = maneuver_direction_frame_low;
  input.maneuver_direction_frame_revision_high = maneuver_direction_frame_revision_high;
  input.maneuver_direction_frame_revision_low = maneuver_direction_frame_revision_low;
  input.maneuver_direction_x = maneuver_direction_x;
  input.maneuver_direction_y = maneuver_direction_y;
  input.maneuver_direction_z = maneuver_direction_z;
  input.maneuver_attitude_source_high = maneuver_attitude_source_high;
  input.maneuver_attitude_source_low = maneuver_attitude_source_low;
  input.maneuver_attitude_revision_high = maneuver_attitude_revision_high;
  input.maneuver_attitude_revision_low = maneuver_attitude_revision_low;
  g_numerical_output = orbit_engine::numerical_operation::evaluate(input);
  return 1;
}

#define NUMERICAL_GETTER(name, field, type) \
  EMSCRIPTEN_KEEPALIVE type name() { return g_numerical_output.field; }

NUMERICAL_GETTER(orbit_engine_numerical_result_code, result_code, std::uint16_t)
NUMERICAL_GETTER(orbit_engine_numerical_result_epoch_seconds_high, result_epoch.seconds_high, std::int32_t)
NUMERICAL_GETTER(orbit_engine_numerical_result_epoch_seconds_low, result_epoch.seconds_low, std::uint32_t)
NUMERICAL_GETTER(orbit_engine_numerical_result_epoch_nanoseconds, result_epoch.nanoseconds, std::uint32_t)
NUMERICAL_GETTER(orbit_engine_numerical_result_position_x, result_position_x, double)
NUMERICAL_GETTER(orbit_engine_numerical_result_position_y, result_position_y, double)
NUMERICAL_GETTER(orbit_engine_numerical_result_position_z, result_position_z, double)
NUMERICAL_GETTER(orbit_engine_numerical_result_velocity_x, result_velocity_x, double)
NUMERICAL_GETTER(orbit_engine_numerical_result_velocity_y, result_velocity_y, double)
NUMERICAL_GETTER(orbit_engine_numerical_result_velocity_z, result_velocity_z, double)
NUMERICAL_GETTER(orbit_engine_numerical_result_mass_present, result_mass_present, int)
NUMERICAL_GETTER(orbit_engine_numerical_result_mass, result_mass, double)

#undef NUMERICAL_GETTER
#undef NUMERICAL_PARAMETERS

EMSCRIPTEN_KEEPALIVE int orbit_engine_round_trip_coupled(
  const double* input,
  std::uint32_t input_length,
  double* output,
  std::uint32_t output_length
) {
  if (input == nullptr || output == nullptr) return 0;
  orbit_engine::coupled_operation::CoupledWire wire;
  if (!orbit_engine::coupled_operation::decode_packet(
        std::span<const double>(input, input_length), wire)) return 0;
  wire = orbit_engine::coupled_operation::evaluate(std::move(wire));
  if (!orbit_engine::coupled_operation::encode_packet(
        wire, std::span<double>(output, output_length))) return 0;
  return 1;
}

EMSCRIPTEN_KEEPALIVE int orbit_engine_round_trip_scheduler(
  const double* input,
  std::uint32_t input_length,
  double* output,
  std::uint32_t output_length
) {
  if (input == nullptr || output == nullptr) return 0;
  orbit_engine::scheduler::SchedulerWire wire;
  if (!orbit_engine::scheduler::decode_packet(std::span<const double>(input, input_length), wire)) return 0;
  wire = g_scheduler.command(wire);
  if (!orbit_engine::scheduler::encode_packet(wire, std::span<double>(output, output_length))) return 0;
  return 1;
  if (!orbit_engine::scheduler::encode_packet(wire, std::span<double>(output, output_length))) return 0;
  return 1;
}

EMSCRIPTEN_KEEPALIVE int orbit_engine_round_trip_planner(
  const double* input,
  std::uint32_t input_length,
  double* output,
  std::uint32_t output_length
) {
  if (input == nullptr || output == nullptr) return 0;
  orbit_engine::lambert::GeometryWire wire;
  if (!orbit_engine::lambert::decode_packet(std::span<const double>(input, input_length), wire)) return 0;
  wire = orbit_engine::lambert::evaluate(wire);
  if (!orbit_engine::lambert::encode_packet(wire, std::span<double>(output, output_length))) return 0;
  return 1;
}

}
