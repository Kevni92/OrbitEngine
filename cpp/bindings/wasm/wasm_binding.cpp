#include "orbit_engine/core.hpp"
#include "orbit_engine/frame.hpp"
#include "orbit_engine/object.hpp"
#include "orbit_engine/propagation.hpp"
#include "orbit_engine/registry.hpp"
#include "orbit_engine/time.hpp"

#include <emscripten/emscripten.h>

extern "C" {

orbit_engine::registry::Registry g_registry;

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
    output,
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

}
