#include "orbit_engine/core.hpp"
#include "orbit_engine/coupled_operation.hpp"
#include "orbit_engine/frame.hpp"
#include "orbit_engine/frame_registry.hpp"
#include "orbit_engine/numerical_operation.hpp"
#include "orbit_engine/object.hpp"
#include "orbit_engine/propagation.hpp"
#include "orbit_engine/registry.hpp"
#include "orbit_engine/time.hpp"
#include "orbit_engine/two_body.hpp"

#include <cmath>
#include <cstdint>
#include <type_traits>
#include <napi.h>

namespace {

orbit_engine::registry::Registry g_registry;
orbit_engine::frame_registry::Registry g_frame_registry;

Napi::Value Initialize(const Napi::CallbackInfo& info) {
  const auto health = orbit_engine::health();
  auto result = Napi::Object::New(info.Env());
  result.Set("coreVersion", Napi::Number::New(info.Env(), health.core_version));
  result.Set("healthCode", Napi::Number::New(info.Env(), health.health_code));
  return result;
}

bool readWire(const Napi::Value& value, orbit_engine::time::TimeWire& output) {
  if (!value.IsObject()) {
    return false;
  }

  const auto object = value.As<Napi::Object>();
  const auto readInteger = [&object](const char* name, double minimum, double maximum, auto& target) {
    const auto value = object.Get(name);
    if (!value.IsNumber()) {
      return false;
    }
    const auto number = value.As<Napi::Number>().DoubleValue();
    if (!std::isfinite(number) || std::trunc(number) != number || number < minimum || number > maximum) {
      return false;
    }
    target = static_cast<std::decay_t<decltype(target)>>(number);
    return true;
  };

  return readInteger("secondsHigh", -2'147'483'648.0, 2'147'483'647.0, output.seconds_high)
    && readInteger("secondsLow", 0.0, 4'294'967'295.0, output.seconds_low)
    && readInteger("nanoseconds", 0.0, 999'999'999.0, output.nanoseconds);
}

bool readObjectWire(const Napi::Value& value, orbit_engine::object::ObjectWire& output) {
  if (!value.IsObject()) {
    return false;
  }

  const auto object = value.As<Napi::Object>();
  const auto readInteger = [&object](const char* name, double minimum, double maximum, auto& target) {
    const auto value = object.Get(name);
    if (!value.IsNumber()) {
      return false;
    }
    const auto number = value.As<Napi::Number>().DoubleValue();
    if (!std::isfinite(number) || std::trunc(number) != number || number < minimum || number > maximum) {
      return false;
    }
    target = static_cast<std::decay_t<decltype(target)>>(number);
    return true;
  };
  const auto readOptional = [&object](const char* presenceName, const char* valueName,
                                      orbit_engine::object::OptionalPhysicalScalar& target) {
    const auto presence = object.Get(presenceName);
    const auto value = object.Get(valueName);
    if (!presence.IsBoolean() || !value.IsNumber()) {
      return false;
    }
    target.present = presence.As<Napi::Boolean>().Value();
    target.value = value.As<Napi::Number>().DoubleValue();
    return std::isfinite(target.value);
  };

  return readInteger("objectIdHigh", 0.0, 4'294'967'295.0, output.object_id_high)
    && readInteger("objectIdLow", 0.0, 4'294'967'295.0, output.object_id_low)
    && readInteger("objectTypeCode", 0.0, 65'535.0, output.object_type_code)
    && readOptional("massPresent", "mass", output.properties.mass)
    && readOptional("muPresent", "mu", output.properties.mu)
    && readOptional("physicalRadiusPresent", "physicalRadius", output.properties.physical_radius)
    && readOptional(
      "collisionBoundingRadiusPresent",
      "collisionBoundingRadius",
      output.properties.collision_bounding_radius
    );
}

bool readFrameWire(const Napi::Value& value, orbit_engine::frame::FrameWire& output) {
  if (!value.IsObject()) {
    return false;
  }

  const auto object = value.As<Napi::Object>();
  const auto readInteger = [&object](const char* name, double minimum, double maximum, auto& target) {
    const auto value = object.Get(name);
    if (!value.IsNumber()) {
      return false;
    }
    const auto number = value.As<Napi::Number>().DoubleValue();
    if (!std::isfinite(number) || std::trunc(number) != number || number < minimum || number > maximum) {
      return false;
    }
    target = static_cast<std::decay_t<decltype(target)>>(number);
    return true;
  };
  const auto readDouble = [&object](const char* name, double& target) {
    const auto value = object.Get(name);
    if (!value.IsNumber()) {
      return false;
    }
    target = value.As<Napi::Number>().DoubleValue();
    return std::isfinite(target);
  };

  return readInteger("referenceFrameIdHigh", 0.0, 4'294'967'295.0, output.reference_frame_id_high)
    && readInteger("referenceFrameIdLow", 0.0, 4'294'967'295.0, output.reference_frame_id_low)
    && readInteger("epochSecondsHigh", -2'147'483'648.0, 2'147'483'647.0, output.epoch.seconds_high)
    && readInteger("epochSecondsLow", 0.0, 4'294'967'295.0, output.epoch.seconds_low)
    && readInteger("epochNanoseconds", 0.0, 999'999'999.0, output.epoch.nanoseconds)
    && readDouble("translationX", output.translation_x)
    && readDouble("translationY", output.translation_y)
    && readDouble("translationZ", output.translation_z)
    && readDouble("originVelocityX", output.origin_velocity_x)
    && readDouble("originVelocityY", output.origin_velocity_y)
    && readDouble("originVelocityZ", output.origin_velocity_z)
    && readDouble("rotationW", output.rotation_w)
    && readDouble("rotationX", output.rotation_x)
    && readDouble("rotationY", output.rotation_y)
    && readDouble("rotationZ", output.rotation_z)
    && readDouble("angularVelocityX", output.angular_velocity_x)
    && readDouble("angularVelocityY", output.angular_velocity_y)
    && readDouble("angularVelocityZ", output.angular_velocity_z);
}

bool readPropagationWire(const Napi::Value& value, orbit_engine::propagation::PropagationWire& output) {
  if (!value.IsObject()) {
    return false;
  }
  const auto object = value.As<Napi::Object>();
  const auto readInteger = [&object](const char* name, double minimum, double maximum, auto& target) {
    const auto value = object.Get(name);
    if (!value.IsNumber()) return false;
    const auto number = value.As<Napi::Number>().DoubleValue();
    if (!std::isfinite(number) || std::trunc(number) != number || number < minimum || number > maximum) return false;
    target = static_cast<std::decay_t<decltype(target)>>(number);
    return true;
  };
  const auto readDouble = [&object](const char* name, double& target) {
    const auto value = object.Get(name);
    if (!value.IsNumber()) return false;
    target = value.As<Napi::Number>().DoubleValue();
    return std::isfinite(target);
  };
  const auto readBoolean = [&object](const char* name, bool& target) {
    const auto value = object.Get(name);
    if (!value.IsBoolean()) return false;
    target = value.As<Napi::Boolean>().Value();
    return true;
  };
  return readInteger("objectIdHigh", 0.0, 4'294'967'295.0, output.object_id_high)
    && readInteger("objectIdLow", 0.0, 4'294'967'295.0, output.object_id_low)
    && readInteger("modelKindCode", 0.0, 65'535.0, output.model_kind_code)
    && readInteger("directionCode", 0.0, 65'535.0, output.direction_code)
    && readInteger("boundedDirectionCode", 0.0, 65'535.0, output.bounded_direction_code)
    && readInteger("propagationFrameHigh", 0.0, 4'294'967'295.0, output.propagation_frame_high)
    && readInteger("propagationFrameLow", 0.0, 4'294'967'295.0, output.propagation_frame_low)
    && readInteger("configurationRevisionHigh", 0.0, 4'294'967'295.0, output.configuration_revision_high)
    && readInteger("configurationRevisionLow", 0.0, 4'294'967'295.0, output.configuration_revision_low)
    && readInteger("motionRevisionHigh", 0.0, 4'294'967'295.0, output.motion_revision_high)
    && readInteger("motionRevisionLow", 0.0, 4'294'967'295.0, output.motion_revision_low)
    && readInteger("segmentStartSecondsHigh", -2'147'483'648.0, 2'147'483'647.0, output.segment_start.seconds_high)
    && readInteger("segmentStartSecondsLow", 0.0, 4'294'967'295.0, output.segment_start.seconds_low)
    && readInteger("segmentStartNanoseconds", 0.0, 999'999'999.0, output.segment_start.nanoseconds)
    && readBoolean("segmentEndPresent", output.segment_end_present)
    && readInteger("segmentEndSecondsHigh", -2'147'483'648.0, 2'147'483'647.0, output.segment_end.seconds_high)
    && readInteger("segmentEndSecondsLow", 0.0, 4'294'967'295.0, output.segment_end.seconds_low)
    && readInteger("segmentEndNanoseconds", 0.0, 999'999'999.0, output.segment_end.nanoseconds)
    && readInteger("targetSecondsHigh", -2'147'483'648.0, 2'147'483'647.0, output.target.seconds_high)
    && readInteger("targetSecondsLow", 0.0, 4'294'967'295.0, output.target.seconds_low)
    && readInteger("targetNanoseconds", 0.0, 999'999'999.0, output.target.nanoseconds)
    && readInteger("outcomeCode", 0.0, 65'535.0, output.outcome_code)
    && readInteger("resultFrameHigh", 0.0, 4'294'967'295.0, output.result_frame_high)
    && readInteger("resultFrameLow", 0.0, 4'294'967'295.0, output.result_frame_low)
    && readDouble("positionX", output.position_x)
    && readDouble("positionY", output.position_y)
    && readDouble("positionZ", output.position_z)
    && readDouble("velocityX", output.velocity_x)
    && readDouble("velocityY", output.velocity_y)
    && readDouble("velocityZ", output.velocity_z)
    && readDouble("positionAbsoluteMeters", output.position_absolute_meters)
    && readDouble("positionRelative", output.position_relative)
    && readDouble("velocityAbsoluteMetersPerSecond", output.velocity_absolute_meters_per_second)
    && readDouble("velocityRelative", output.velocity_relative);
}

bool readRegistryWire(const Napi::Value& value, orbit_engine::registry::RegistryWire& output) {
  if (!value.IsObject()) return false;
  const auto object = value.As<Napi::Object>();
  const auto readInteger = [&object](const char* name, double minimum, double maximum, auto& target) {
    const auto value = object.Get(name);
    if (!value.IsNumber()) return false;
    const auto number = value.As<Napi::Number>().DoubleValue();
    if (!std::isfinite(number) || std::trunc(number) != number || number < minimum || number > maximum) return false;
    target = static_cast<std::decay_t<decltype(target)>>(number);
    return true;
  };
  const auto readDouble = [&object](const char* name, double& target) {
    const auto value = object.Get(name);
    if (!value.IsNumber()) return false;
    target = value.As<Napi::Number>().DoubleValue();
    return std::isfinite(target);
  };
  const auto readBoolean = [&object](const char* name, bool& target) {
    const auto value = object.Get(name);
    if (!value.IsBoolean()) return false;
    target = value.As<Napi::Boolean>().Value();
    return true;
  };
  const auto readOptional = [&object](const char* presenceName, const char* valueName,
                                      orbit_engine::object::OptionalPhysicalScalar& target) {
    const auto presence = object.Get(presenceName);
    const auto value = object.Get(valueName);
    if (!presence.IsBoolean() || !value.IsNumber()) return false;
    target.present = presence.As<Napi::Boolean>().Value();
    target.value = value.As<Napi::Number>().DoubleValue();
    return std::isfinite(target.value);
  };
  return readInteger("operationCode", 0.0, 65'535.0, output.operation_code)
    && readInteger("resultCode", 0.0, 65'535.0, output.result_code)
    && readInteger("objectIdHigh", 0.0, 4'294'967'295.0, output.object_id_high)
    && readInteger("objectIdLow", 0.0, 4'294'967'295.0, output.object_id_low)
    && readInteger("objectTypeCode", 0.0, 65'535.0, output.object_type_code)
    && readOptional("massPresent", "mass", output.properties.mass)
    && readOptional("muPresent", "mu", output.properties.mu)
    && readOptional("physicalRadiusPresent", "physicalRadius", output.properties.physical_radius)
    && readOptional("collisionBoundingRadiusPresent", "collisionBoundingRadius", output.properties.collision_bounding_radius)
    && readBoolean("statePresent", output.state_present)
    && readInteger("stateEpochSecondsHigh", -2'147'483'648.0, 2'147'483'647.0, output.state_epoch.seconds_high)
    && readInteger("stateEpochSecondsLow", 0.0, 4'294'967'295.0, output.state_epoch.seconds_low)
    && readInteger("stateEpochNanoseconds", 0.0, 999'999'999.0, output.state_epoch.nanoseconds)
    && readInteger("stateFrameHigh", 0.0, 4'294'967'295.0, output.state_frame_high)
    && readInteger("stateFrameLow", 0.0, 4'294'967'295.0, output.state_frame_low)
    && readDouble("positionX", output.position_x)
    && readDouble("positionY", output.position_y)
    && readDouble("positionZ", output.position_z)
    && readDouble("velocityX", output.velocity_x)
    && readDouble("velocityY", output.velocity_y)
    && readDouble("velocityZ", output.velocity_z)
    && readInteger("modelKindCode", 0.0, 65'535.0, output.model_kind_code)
    && readInteger("directionCode", 0.0, 65'535.0, output.direction_code)
    && readInteger("segmentStartSecondsHigh", -2'147'483'648.0, 2'147'483'647.0, output.segment_start.seconds_high)
    && readInteger("segmentStartSecondsLow", 0.0, 4'294'967'295.0, output.segment_start.seconds_low)
    && readInteger("segmentStartNanoseconds", 0.0, 999'999'999.0, output.segment_start.nanoseconds)
    && readBoolean("segmentEndPresent", output.segment_end_present)
    && readInteger("segmentEndSecondsHigh", -2'147'483'648.0, 2'147'483'647.0, output.segment_end.seconds_high)
    && readInteger("segmentEndSecondsLow", 0.0, 4'294'967'295.0, output.segment_end.seconds_low)
    && readInteger("segmentEndNanoseconds", 0.0, 999'999'999.0, output.segment_end.nanoseconds)
    && readInteger("configurationRevisionHigh", 0.0, 4'294'967'295.0, output.configuration_revision_high)
    && readInteger("configurationRevisionLow", 0.0, 4'294'967'295.0, output.configuration_revision_low)
    && readInteger("motionRevisionHigh", 0.0, 4'294'967'295.0, output.motion_revision_high)
    && readInteger("motionRevisionLow", 0.0, 4'294'967'295.0, output.motion_revision_low)
    && readInteger("referenceStatusCode", 0.0, 65'535.0, output.reference_status_code)
    && readInteger("propertyRevisionHigh", 0.0, 4'294'967'295.0, output.property_revision_high)
    && readInteger("propertyRevisionLow", 0.0, 4'294'967'295.0, output.property_revision_low)
    && readInteger("effectiveEpochSecondsHigh", -2'147'483'648.0, 2'147'483'647.0, output.effective_epoch.seconds_high)
    && readInteger("effectiveEpochSecondsLow", 0.0, 4'294'967'295.0, output.effective_epoch.seconds_low)
    && readInteger("effectiveEpochNanoseconds", 0.0, 999'999'999.0, output.effective_epoch.nanoseconds)
    && readBoolean("structuralParentPresent", output.structural_parent_present)
    && readInteger("structuralParentHigh", 0.0, 4'294'967'295.0, output.structural_parent_high)
    && readInteger("structuralParentLow", 0.0, 4'294'967'295.0, output.structural_parent_low);
}

bool readFrameRegistryWire(const Napi::Value& value, orbit_engine::frame_registry::FrameRegistryWire& output) {
  if (!value.IsObject()) return false;
  const auto object = value.As<Napi::Object>();
  const auto readInteger = [&object](const char* name, double minimum, double maximum, auto& target) {
    const auto value = object.Get(name);
    if (!value.IsNumber()) return false;
    const auto number = value.As<Napi::Number>().DoubleValue();
    if (!std::isfinite(number) || std::trunc(number) != number || number < minimum || number > maximum) return false;
    target = static_cast<std::decay_t<decltype(target)>>(number);
    return true;
  };
  const auto readDouble = [&object](const char* name, double& target) {
    const auto value = object.Get(name);
    if (!value.IsNumber()) return false;
    target = value.As<Napi::Number>().DoubleValue();
    return std::isfinite(target);
  };
  const auto readBoolean = [&object](const char* name, bool& target) {
    const auto value = object.Get(name);
    if (!value.IsBoolean()) return false;
    target = value.As<Napi::Boolean>().Value();
    return true;
  };
  return readInteger("operationCode", 0.0, 65'535.0, output.operation_code)
    && readInteger("resultCode", 0.0, 65'535.0, output.result_code)
    && readInteger("frameIdHigh", 0.0, 4'294'967'295.0, output.frame_id_high)
    && readInteger("frameIdLow", 0.0, 4'294'967'295.0, output.frame_id_low)
    && readBoolean("parentPresent", output.parent_present)
    && readInteger("parentHigh", 0.0, 4'294'967'295.0, output.parent_high)
    && readInteger("parentLow", 0.0, 4'294'967'295.0, output.parent_low)
    && readInteger("providerCode", 0.0, 65'535.0, output.provider_code)
    && readBoolean("dependencyPresent", output.dependency_present)
    && readInteger("dependencyHigh", 0.0, 4'294'967'295.0, output.dependency_high)
    && readInteger("dependencyLow", 0.0, 4'294'967'295.0, output.dependency_low)
    && readInteger("transformReferenceFrameIdHigh", 0.0, 4'294'967'295.0, output.transform.reference_frame_id_high)
    && readInteger("transformReferenceFrameIdLow", 0.0, 4'294'967'295.0, output.transform.reference_frame_id_low)
    && readInteger("transformEpochSecondsHigh", -2'147'483'648.0, 2'147'483'647.0, output.transform.epoch.seconds_high)
    && readInteger("transformEpochSecondsLow", 0.0, 4'294'967'295.0, output.transform.epoch.seconds_low)
    && readInteger("transformEpochNanoseconds", 0.0, 999'999'999.0, output.transform.epoch.nanoseconds)
    && readDouble("transformTranslationX", output.transform.translation_x)
    && readDouble("transformTranslationY", output.transform.translation_y)
    && readDouble("transformTranslationZ", output.transform.translation_z)
    && readDouble("transformOriginVelocityX", output.transform.origin_velocity_x)
    && readDouble("transformOriginVelocityY", output.transform.origin_velocity_y)
    && readDouble("transformOriginVelocityZ", output.transform.origin_velocity_z)
    && readDouble("transformRotationW", output.transform.rotation_w)
    && readDouble("transformRotationX", output.transform.rotation_x)
    && readDouble("transformRotationY", output.transform.rotation_y)
    && readDouble("transformRotationZ", output.transform.rotation_z)
    && readDouble("transformAngularVelocityX", output.transform.angular_velocity_x)
    && readDouble("transformAngularVelocityY", output.transform.angular_velocity_y)
    && readDouble("transformAngularVelocityZ", output.transform.angular_velocity_z);
}

bool readTwoBodyWire(const Napi::Value& value, orbit_engine::two_body::TwoBodyWire& output) {
  if (!value.IsObject()) return false;
  const auto object = value.As<Napi::Object>();
  const auto readInteger = [&object](const char* name, double minimum, double maximum, auto& target) {
    const auto value = object.Get(name);
    if (!value.IsNumber()) return false;
    const auto number = value.As<Napi::Number>().DoubleValue();
    if (!std::isfinite(number) || std::trunc(number) != number || number < minimum || number > maximum) return false;
    target = static_cast<std::decay_t<decltype(target)>>(number);
    return true;
  };
  const auto readDouble = [&object](const char* name, double& target) {
    const auto value = object.Get(name);
    if (!value.IsNumber()) return false;
    target = value.As<Napi::Number>().DoubleValue();
    return std::isfinite(target);
  };
  return readInteger("resultCode", 0.0, 65'535.0, output.result_code)
    && readInteger("centralObjectIdHigh", 0.0, 4'294'967'295.0, output.central_object_id_high)
    && readInteger("centralObjectIdLow", 0.0, 4'294'967'295.0, output.central_object_id_low)
    && readDouble("mu", output.mu)
    && readInteger("anchorFrameHigh", 0.0, 4'294'967'295.0, output.anchor_frame_high)
    && readInteger("anchorFrameLow", 0.0, 4'294'967'295.0, output.anchor_frame_low)
    && readWire(object.Get("anchorEpoch"), output.anchor_epoch)
    && readDouble("anchorPositionX", output.anchor_position_x)
    && readDouble("anchorPositionY", output.anchor_position_y)
    && readDouble("anchorPositionZ", output.anchor_position_z)
    && readDouble("anchorVelocityX", output.anchor_velocity_x)
    && readDouble("anchorVelocityY", output.anchor_velocity_y)
    && readDouble("anchorVelocityZ", output.anchor_velocity_z)
    && readWire(object.Get("targetEpoch"), output.target_epoch)
    && readInteger("resultFrameHigh", 0.0, 4'294'967'295.0, output.result_frame_high)
    && readInteger("resultFrameLow", 0.0, 4'294'967'295.0, output.result_frame_low)
    && readWire(object.Get("resultEpoch"), output.result_epoch)
    && readDouble("resultPositionX", output.result_position_x)
    && readDouble("resultPositionY", output.result_position_y)
    && readDouble("resultPositionZ", output.result_position_z)
    && readDouble("resultVelocityX", output.result_velocity_x)
    && readDouble("resultVelocityY", output.result_velocity_y)
    && readDouble("resultVelocityZ", output.result_velocity_z);
}

Napi::Object writeWire(Napi::Env env, orbit_engine::time::TimeWire value) {
  auto result = Napi::Object::New(env);
  result.Set("secondsHigh", Napi::Number::New(env, value.seconds_high));
  result.Set("secondsLow", Napi::Number::New(env, value.seconds_low));
  result.Set("nanoseconds", Napi::Number::New(env, value.nanoseconds));
  return result;
}

Napi::Object writeObjectWire(Napi::Env env, orbit_engine::object::ObjectWire value) {
  auto result = Napi::Object::New(env);
  result.Set("objectIdHigh", Napi::Number::New(env, value.object_id_high));
  result.Set("objectIdLow", Napi::Number::New(env, value.object_id_low));
  result.Set("objectTypeCode", Napi::Number::New(env, value.object_type_code));
  result.Set("massPresent", Napi::Boolean::New(env, value.properties.mass.present));
  result.Set("mass", Napi::Number::New(env, value.properties.mass.value));
  result.Set("muPresent", Napi::Boolean::New(env, value.properties.mu.present));
  result.Set("mu", Napi::Number::New(env, value.properties.mu.value));
  result.Set("physicalRadiusPresent", Napi::Boolean::New(env, value.properties.physical_radius.present));
  result.Set("physicalRadius", Napi::Number::New(env, value.properties.physical_radius.value));
  result.Set(
    "collisionBoundingRadiusPresent",
    Napi::Boolean::New(env, value.properties.collision_bounding_radius.present)
  );
  result.Set("collisionBoundingRadius", Napi::Number::New(env, value.properties.collision_bounding_radius.value));
  return result;
}

Napi::Object writeFrameWire(Napi::Env env, orbit_engine::frame::FrameWire value) {
  auto result = Napi::Object::New(env);
  result.Set("referenceFrameIdHigh", Napi::Number::New(env, value.reference_frame_id_high));
  result.Set("referenceFrameIdLow", Napi::Number::New(env, value.reference_frame_id_low));
  result.Set("epochSecondsHigh", Napi::Number::New(env, value.epoch.seconds_high));
  result.Set("epochSecondsLow", Napi::Number::New(env, value.epoch.seconds_low));
  result.Set("epochNanoseconds", Napi::Number::New(env, value.epoch.nanoseconds));
  result.Set("translationX", Napi::Number::New(env, value.translation_x));
  result.Set("translationY", Napi::Number::New(env, value.translation_y));
  result.Set("translationZ", Napi::Number::New(env, value.translation_z));
  result.Set("originVelocityX", Napi::Number::New(env, value.origin_velocity_x));
  result.Set("originVelocityY", Napi::Number::New(env, value.origin_velocity_y));
  result.Set("originVelocityZ", Napi::Number::New(env, value.origin_velocity_z));
  result.Set("rotationW", Napi::Number::New(env, value.rotation_w));
  result.Set("rotationX", Napi::Number::New(env, value.rotation_x));
  result.Set("rotationY", Napi::Number::New(env, value.rotation_y));
  result.Set("rotationZ", Napi::Number::New(env, value.rotation_z));
  result.Set("angularVelocityX", Napi::Number::New(env, value.angular_velocity_x));
  result.Set("angularVelocityY", Napi::Number::New(env, value.angular_velocity_y));
  result.Set("angularVelocityZ", Napi::Number::New(env, value.angular_velocity_z));
  return result;
}

Napi::Object writePropagationWire(Napi::Env env, orbit_engine::propagation::PropagationWire value) {
  auto result = Napi::Object::New(env);
  result.Set("objectIdHigh", Napi::Number::New(env, value.object_id_high));
  result.Set("objectIdLow", Napi::Number::New(env, value.object_id_low));
  result.Set("modelKindCode", Napi::Number::New(env, value.model_kind_code));
  result.Set("directionCode", Napi::Number::New(env, value.direction_code));
  result.Set("boundedDirectionCode", Napi::Number::New(env, value.bounded_direction_code));
  result.Set("propagationFrameHigh", Napi::Number::New(env, value.propagation_frame_high));
  result.Set("propagationFrameLow", Napi::Number::New(env, value.propagation_frame_low));
  result.Set("configurationRevisionHigh", Napi::Number::New(env, value.configuration_revision_high));
  result.Set("configurationRevisionLow", Napi::Number::New(env, value.configuration_revision_low));
  result.Set("motionRevisionHigh", Napi::Number::New(env, value.motion_revision_high));
  result.Set("motionRevisionLow", Napi::Number::New(env, value.motion_revision_low));
  result.Set("segmentStartSecondsHigh", Napi::Number::New(env, value.segment_start.seconds_high));
  result.Set("segmentStartSecondsLow", Napi::Number::New(env, value.segment_start.seconds_low));
  result.Set("segmentStartNanoseconds", Napi::Number::New(env, value.segment_start.nanoseconds));
  result.Set("segmentEndPresent", Napi::Boolean::New(env, value.segment_end_present));
  result.Set("segmentEndSecondsHigh", Napi::Number::New(env, value.segment_end.seconds_high));
  result.Set("segmentEndSecondsLow", Napi::Number::New(env, value.segment_end.seconds_low));
  result.Set("segmentEndNanoseconds", Napi::Number::New(env, value.segment_end.nanoseconds));
  result.Set("targetSecondsHigh", Napi::Number::New(env, value.target.seconds_high));
  result.Set("targetSecondsLow", Napi::Number::New(env, value.target.seconds_low));
  result.Set("targetNanoseconds", Napi::Number::New(env, value.target.nanoseconds));
  result.Set("outcomeCode", Napi::Number::New(env, value.outcome_code));
  result.Set("resultFrameHigh", Napi::Number::New(env, value.result_frame_high));
  result.Set("resultFrameLow", Napi::Number::New(env, value.result_frame_low));
  result.Set("positionX", Napi::Number::New(env, value.position_x));
  result.Set("positionY", Napi::Number::New(env, value.position_y));
  result.Set("positionZ", Napi::Number::New(env, value.position_z));
  result.Set("velocityX", Napi::Number::New(env, value.velocity_x));
  result.Set("velocityY", Napi::Number::New(env, value.velocity_y));
  result.Set("velocityZ", Napi::Number::New(env, value.velocity_z));
  result.Set("positionAbsoluteMeters", Napi::Number::New(env, value.position_absolute_meters));
  result.Set("positionRelative", Napi::Number::New(env, value.position_relative));
  result.Set("velocityAbsoluteMetersPerSecond", Napi::Number::New(env, value.velocity_absolute_meters_per_second));
  result.Set("velocityRelative", Napi::Number::New(env, value.velocity_relative));
  return result;
}

Napi::Object writeRegistryWire(Napi::Env env, orbit_engine::registry::RegistryWire value) {
  auto result = Napi::Object::New(env);
  result.Set("operationCode", Napi::Number::New(env, value.operation_code));
  result.Set("resultCode", Napi::Number::New(env, value.result_code));
  result.Set("objectIdHigh", Napi::Number::New(env, value.object_id_high));
  result.Set("objectIdLow", Napi::Number::New(env, value.object_id_low));
  result.Set("objectTypeCode", Napi::Number::New(env, value.object_type_code));
  result.Set("massPresent", Napi::Boolean::New(env, value.properties.mass.present));
  result.Set("mass", Napi::Number::New(env, value.properties.mass.value));
  result.Set("muPresent", Napi::Boolean::New(env, value.properties.mu.present));
  result.Set("mu", Napi::Number::New(env, value.properties.mu.value));
  result.Set("physicalRadiusPresent", Napi::Boolean::New(env, value.properties.physical_radius.present));
  result.Set("physicalRadius", Napi::Number::New(env, value.properties.physical_radius.value));
  result.Set("collisionBoundingRadiusPresent", Napi::Boolean::New(env, value.properties.collision_bounding_radius.present));
  result.Set("collisionBoundingRadius", Napi::Number::New(env, value.properties.collision_bounding_radius.value));
  result.Set("statePresent", Napi::Boolean::New(env, value.state_present));
  result.Set("stateEpochSecondsHigh", Napi::Number::New(env, value.state_epoch.seconds_high));
  result.Set("stateEpochSecondsLow", Napi::Number::New(env, value.state_epoch.seconds_low));
  result.Set("stateEpochNanoseconds", Napi::Number::New(env, value.state_epoch.nanoseconds));
  result.Set("stateFrameHigh", Napi::Number::New(env, value.state_frame_high));
  result.Set("stateFrameLow", Napi::Number::New(env, value.state_frame_low));
  result.Set("positionX", Napi::Number::New(env, value.position_x));
  result.Set("positionY", Napi::Number::New(env, value.position_y));
  result.Set("positionZ", Napi::Number::New(env, value.position_z));
  result.Set("velocityX", Napi::Number::New(env, value.velocity_x));
  result.Set("velocityY", Napi::Number::New(env, value.velocity_y));
  result.Set("velocityZ", Napi::Number::New(env, value.velocity_z));
  result.Set("modelKindCode", Napi::Number::New(env, value.model_kind_code));
  result.Set("directionCode", Napi::Number::New(env, value.direction_code));
  result.Set("segmentStartSecondsHigh", Napi::Number::New(env, value.segment_start.seconds_high));
  result.Set("segmentStartSecondsLow", Napi::Number::New(env, value.segment_start.seconds_low));
  result.Set("segmentStartNanoseconds", Napi::Number::New(env, value.segment_start.nanoseconds));
  result.Set("segmentEndPresent", Napi::Boolean::New(env, value.segment_end_present));
  result.Set("segmentEndSecondsHigh", Napi::Number::New(env, value.segment_end.seconds_high));
  result.Set("segmentEndSecondsLow", Napi::Number::New(env, value.segment_end.seconds_low));
  result.Set("segmentEndNanoseconds", Napi::Number::New(env, value.segment_end.nanoseconds));
  result.Set("configurationRevisionHigh", Napi::Number::New(env, value.configuration_revision_high));
  result.Set("configurationRevisionLow", Napi::Number::New(env, value.configuration_revision_low));
  result.Set("motionRevisionHigh", Napi::Number::New(env, value.motion_revision_high));
  result.Set("motionRevisionLow", Napi::Number::New(env, value.motion_revision_low));
  result.Set("referenceStatusCode", Napi::Number::New(env, value.reference_status_code));
  result.Set("propertyRevisionHigh", Napi::Number::New(env, value.property_revision_high));
  result.Set("propertyRevisionLow", Napi::Number::New(env, value.property_revision_low));
  result.Set("effectiveEpochSecondsHigh", Napi::Number::New(env, value.effective_epoch.seconds_high));
  result.Set("effectiveEpochSecondsLow", Napi::Number::New(env, value.effective_epoch.seconds_low));
  result.Set("effectiveEpochNanoseconds", Napi::Number::New(env, value.effective_epoch.nanoseconds));
  result.Set("structuralParentPresent", Napi::Boolean::New(env, value.structural_parent_present));
  result.Set("structuralParentHigh", Napi::Number::New(env, value.structural_parent_high));
  result.Set("structuralParentLow", Napi::Number::New(env, value.structural_parent_low));
  return result;
}

Napi::Object writeFrameRegistryWire(Napi::Env env, orbit_engine::frame_registry::FrameRegistryWire value) {
  auto result = Napi::Object::New(env);
  result.Set("operationCode", Napi::Number::New(env, value.operation_code));
  result.Set("resultCode", Napi::Number::New(env, value.result_code));
  result.Set("frameIdHigh", Napi::Number::New(env, value.frame_id_high));
  result.Set("frameIdLow", Napi::Number::New(env, value.frame_id_low));
  result.Set("parentPresent", Napi::Boolean::New(env, value.parent_present));
  result.Set("parentHigh", Napi::Number::New(env, value.parent_high));
  result.Set("parentLow", Napi::Number::New(env, value.parent_low));
  result.Set("providerCode", Napi::Number::New(env, value.provider_code));
  result.Set("dependencyPresent", Napi::Boolean::New(env, value.dependency_present));
  result.Set("dependencyHigh", Napi::Number::New(env, value.dependency_high));
  result.Set("dependencyLow", Napi::Number::New(env, value.dependency_low));
  result.Set("transformReferenceFrameIdHigh", Napi::Number::New(env, value.transform.reference_frame_id_high));
  result.Set("transformReferenceFrameIdLow", Napi::Number::New(env, value.transform.reference_frame_id_low));
  result.Set("transformEpochSecondsHigh", Napi::Number::New(env, value.transform.epoch.seconds_high));
  result.Set("transformEpochSecondsLow", Napi::Number::New(env, value.transform.epoch.seconds_low));
  result.Set("transformEpochNanoseconds", Napi::Number::New(env, value.transform.epoch.nanoseconds));
  result.Set("transformTranslationX", Napi::Number::New(env, value.transform.translation_x));
  result.Set("transformTranslationY", Napi::Number::New(env, value.transform.translation_y));
  result.Set("transformTranslationZ", Napi::Number::New(env, value.transform.translation_z));
  result.Set("transformOriginVelocityX", Napi::Number::New(env, value.transform.origin_velocity_x));
  result.Set("transformOriginVelocityY", Napi::Number::New(env, value.transform.origin_velocity_y));
  result.Set("transformOriginVelocityZ", Napi::Number::New(env, value.transform.origin_velocity_z));
  result.Set("transformRotationW", Napi::Number::New(env, value.transform.rotation_w));
  result.Set("transformRotationX", Napi::Number::New(env, value.transform.rotation_x));
  result.Set("transformRotationY", Napi::Number::New(env, value.transform.rotation_y));
  result.Set("transformRotationZ", Napi::Number::New(env, value.transform.rotation_z));
  result.Set("transformAngularVelocityX", Napi::Number::New(env, value.transform.angular_velocity_x));
  result.Set("transformAngularVelocityY", Napi::Number::New(env, value.transform.angular_velocity_y));
  result.Set("transformAngularVelocityZ", Napi::Number::New(env, value.transform.angular_velocity_z));
  return result;
}

Napi::Object writeTwoBodyWire(Napi::Env env, orbit_engine::two_body::TwoBodyWire value) {
  auto result = Napi::Object::New(env);
  result.Set("resultCode", Napi::Number::New(env, value.result_code));
  result.Set("centralObjectIdHigh", Napi::Number::New(env, value.central_object_id_high));
  result.Set("centralObjectIdLow", Napi::Number::New(env, value.central_object_id_low));
  result.Set("mu", Napi::Number::New(env, value.mu));
  result.Set("anchorFrameHigh", Napi::Number::New(env, value.anchor_frame_high));
  result.Set("anchorFrameLow", Napi::Number::New(env, value.anchor_frame_low));
  result.Set("anchorEpoch", writeWire(env, value.anchor_epoch));
  result.Set("anchorPositionX", Napi::Number::New(env, value.anchor_position_x));
  result.Set("anchorPositionY", Napi::Number::New(env, value.anchor_position_y));
  result.Set("anchorPositionZ", Napi::Number::New(env, value.anchor_position_z));
  result.Set("anchorVelocityX", Napi::Number::New(env, value.anchor_velocity_x));
  result.Set("anchorVelocityY", Napi::Number::New(env, value.anchor_velocity_y));
  result.Set("anchorVelocityZ", Napi::Number::New(env, value.anchor_velocity_z));
  result.Set("targetEpoch", writeWire(env, value.target_epoch));
  result.Set("resultFrameHigh", Napi::Number::New(env, value.result_frame_high));
  result.Set("resultFrameLow", Napi::Number::New(env, value.result_frame_low));
  result.Set("resultEpoch", writeWire(env, value.result_epoch));
  result.Set("resultPositionX", Napi::Number::New(env, value.result_position_x));
  result.Set("resultPositionY", Napi::Number::New(env, value.result_position_y));
  result.Set("resultPositionZ", Napi::Number::New(env, value.result_position_z));
  result.Set("resultVelocityX", Napi::Number::New(env, value.result_velocity_x));
  result.Set("resultVelocityY", Napi::Number::New(env, value.result_velocity_y));
  result.Set("resultVelocityZ", Napi::Number::New(env, value.result_velocity_z));
  return result;
}

bool readNumericalWire(const Napi::Value& value, orbit_engine::numerical_operation::NumericalWire& output) {
  if (!value.IsObject()) return false;
  const auto object = value.As<Napi::Object>();
  const auto readInteger = [&object](const char* name, double minimum, double maximum, auto& target) {
    const auto value = object.Get(name);
    if (!value.IsNumber()) return false;
    const auto number = value.As<Napi::Number>().DoubleValue();
    if (!std::isfinite(number) || std::trunc(number) != number || number < minimum || number > maximum) return false;
    target = static_cast<std::decay_t<decltype(target)>>(number);
    return true;
  };
  const auto readDouble = [&object](const char* name, double& target) {
    const auto value = object.Get(name);
    if (!value.IsNumber()) return false;
    target = value.As<Napi::Number>().DoubleValue();
    return std::isfinite(target);
  };
  const auto readBoolean = [&object](const char* name, bool& target) {
    const auto value = object.Get(name);
    if (!value.IsBoolean()) return false;
    target = value.As<Napi::Boolean>().Value();
    return true;
  };
  return readInteger("resultCode", 0.0, 65'535.0, output.result_code)
    && readInteger("objectIdHigh", 0.0, 4'294'967'295.0, output.object_id_high)
    && readInteger("objectIdLow", 0.0, 4'294'967'295.0, output.object_id_low)
    && readInteger("propagationFrameHigh", 0.0, 4'294'967'295.0, output.propagation_frame_high)
    && readInteger("propagationFrameLow", 0.0, 4'294'967'295.0, output.propagation_frame_low)
    && readInteger("frameRevisionHigh", 0.0, 4'294'967'295.0, output.frame_revision_high)
    && readInteger("frameRevisionLow", 0.0, 4'294'967'295.0, output.frame_revision_low)
    && readWire(object.Get("anchorEpoch"), output.anchor_epoch)
    && readWire(object.Get("targetEpoch"), output.target_epoch)
    && readDouble("anchorPositionX", output.anchor_position_x)
    && readDouble("anchorPositionY", output.anchor_position_y)
    && readDouble("anchorPositionZ", output.anchor_position_z)
    && readDouble("anchorVelocityX", output.anchor_velocity_x)
    && readDouble("anchorVelocityY", output.anchor_velocity_y)
    && readDouble("anchorVelocityZ", output.anchor_velocity_z)
    && readBoolean("massPresent", output.mass_present)
    && readDouble("mass", output.mass)
    && readDouble("constantAccelerationX", output.constant_acceleration_x)
    && readDouble("constantAccelerationY", output.constant_acceleration_y)
    && readDouble("constantAccelerationZ", output.constant_acceleration_z)
    && readBoolean("sourcePresent", output.source_present)
    && readInteger("sourceIdHigh", 0.0, 4'294'967'295.0, output.source_id_high)
    && readInteger("sourceIdLow", 0.0, 4'294'967'295.0, output.source_id_low)
    && readInteger("sourceRevisionHigh", 0.0, 4'294'967'295.0, output.source_revision_high)
    && readInteger("sourceRevisionLow", 0.0, 4'294'967'295.0, output.source_revision_low)
    && readDouble("sourcePositionX", output.source_position_x)
    && readDouble("sourcePositionY", output.source_position_y)
    && readDouble("sourcePositionZ", output.source_position_z)
    && readBoolean("sourceMuPresent", output.source_mu_present)
    && readDouble("sourceMu", output.source_mu)
    && readBoolean("sourceMassPresent", output.source_mass_present)
    && readDouble("sourceMass", output.source_mass)
    && readDouble("relativeTolerance", output.relative_tolerance)
    && readDouble("positionAbsoluteToleranceMeters", output.position_absolute_tolerance_meters)
    && readDouble("velocityAbsoluteToleranceMetersPerSecond", output.velocity_absolute_tolerance_meters_per_second)
    && readDouble("massAbsoluteToleranceKilograms", output.mass_absolute_tolerance_kilograms)
    && readInteger("checkpointStrideAcceptedSteps", 1.0, 4'294'967'295.0, output.checkpoint_stride_accepted_steps)
    && readInteger("maxCheckpointCount", 1.0, 4'294'967'295.0, output.max_checkpoint_count)
    && readInteger("maxDenseStepCount", 1.0, 4'294'967'295.0, output.max_dense_step_count)
    && readInteger("maxAcceptedStepsPerExtension", 1.0, 4'294'967'295.0, output.max_accepted_steps_per_extension)
    && readInteger("maxRejectedStepsPerExtension", 1.0, 4'294'967'295.0, output.max_rejected_steps_per_extension)
    && readWire(object.Get("minStep"), output.min_step)
    && readWire(object.Get("maxStep"), output.max_step)
    && readInteger("configurationRevisionHigh", 0.0, 4'294'967'295.0, output.configuration_revision_high)
    && readInteger("configurationRevisionLow", 0.0, 4'294'967'295.0, output.configuration_revision_low)
    && readInteger("motionRevisionHigh", 0.0, 4'294'967'295.0, output.motion_revision_high)
    && readInteger("motionRevisionLow", 0.0, 4'294'967'295.0, output.motion_revision_low)
    && readWire(object.Get("resultEpoch"), output.result_epoch)
    && readDouble("resultPositionX", output.result_position_x)
    && readDouble("resultPositionY", output.result_position_y)
    && readDouble("resultPositionZ", output.result_position_z)
    && readDouble("resultVelocityX", output.result_velocity_x)
    && readDouble("resultVelocityY", output.result_velocity_y)
    && readDouble("resultVelocityZ", output.result_velocity_z)
    && readBoolean("resultMassPresent", output.result_mass_present)
    && readDouble("resultMass", output.result_mass);
}

Napi::Object writeNumericalWire(Napi::Env env, const orbit_engine::numerical_operation::NumericalWire& value) {
  auto result = Napi::Object::New(env);
  result.Set("resultCode", Napi::Number::New(env, value.result_code));
  result.Set("objectIdHigh", Napi::Number::New(env, value.object_id_high));
  result.Set("objectIdLow", Napi::Number::New(env, value.object_id_low));
  result.Set("propagationFrameHigh", Napi::Number::New(env, value.propagation_frame_high));
  result.Set("propagationFrameLow", Napi::Number::New(env, value.propagation_frame_low));
  result.Set("frameRevisionHigh", Napi::Number::New(env, value.frame_revision_high));
  result.Set("frameRevisionLow", Napi::Number::New(env, value.frame_revision_low));
  result.Set("anchorEpoch", writeWire(env, value.anchor_epoch));
  result.Set("targetEpoch", writeWire(env, value.target_epoch));
  result.Set("anchorPositionX", Napi::Number::New(env, value.anchor_position_x));
  result.Set("anchorPositionY", Napi::Number::New(env, value.anchor_position_y));
  result.Set("anchorPositionZ", Napi::Number::New(env, value.anchor_position_z));
  result.Set("anchorVelocityX", Napi::Number::New(env, value.anchor_velocity_x));
  result.Set("anchorVelocityY", Napi::Number::New(env, value.anchor_velocity_y));
  result.Set("anchorVelocityZ", Napi::Number::New(env, value.anchor_velocity_z));
  result.Set("massPresent", Napi::Boolean::New(env, value.mass_present));
  result.Set("mass", Napi::Number::New(env, value.mass));
  result.Set("constantAccelerationX", Napi::Number::New(env, value.constant_acceleration_x));
  result.Set("constantAccelerationY", Napi::Number::New(env, value.constant_acceleration_y));
  result.Set("constantAccelerationZ", Napi::Number::New(env, value.constant_acceleration_z));
  result.Set("sourcePresent", Napi::Boolean::New(env, value.source_present));
  result.Set("sourceIdHigh", Napi::Number::New(env, value.source_id_high));
  result.Set("sourceIdLow", Napi::Number::New(env, value.source_id_low));
  result.Set("sourceRevisionHigh", Napi::Number::New(env, value.source_revision_high));
  result.Set("sourceRevisionLow", Napi::Number::New(env, value.source_revision_low));
  result.Set("sourcePositionX", Napi::Number::New(env, value.source_position_x));
  result.Set("sourcePositionY", Napi::Number::New(env, value.source_position_y));
  result.Set("sourcePositionZ", Napi::Number::New(env, value.source_position_z));
  result.Set("sourceMuPresent", Napi::Boolean::New(env, value.source_mu_present));
  result.Set("sourceMu", Napi::Number::New(env, value.source_mu));
  result.Set("sourceMassPresent", Napi::Boolean::New(env, value.source_mass_present));
  result.Set("sourceMass", Napi::Number::New(env, value.source_mass));
  result.Set("relativeTolerance", Napi::Number::New(env, value.relative_tolerance));
  result.Set("positionAbsoluteToleranceMeters", Napi::Number::New(env, value.position_absolute_tolerance_meters));
  result.Set("velocityAbsoluteToleranceMetersPerSecond", Napi::Number::New(env, value.velocity_absolute_tolerance_meters_per_second));
  result.Set("massAbsoluteToleranceKilograms", Napi::Number::New(env, value.mass_absolute_tolerance_kilograms));
  result.Set("checkpointStrideAcceptedSteps", Napi::Number::New(env, value.checkpoint_stride_accepted_steps));
  result.Set("maxCheckpointCount", Napi::Number::New(env, value.max_checkpoint_count));
  result.Set("maxDenseStepCount", Napi::Number::New(env, value.max_dense_step_count));
  result.Set("maxAcceptedStepsPerExtension", Napi::Number::New(env, value.max_accepted_steps_per_extension));
  result.Set("maxRejectedStepsPerExtension", Napi::Number::New(env, value.max_rejected_steps_per_extension));
  result.Set("minStep", writeWire(env, value.min_step));
  result.Set("maxStep", writeWire(env, value.max_step));
  result.Set("configurationRevisionHigh", Napi::Number::New(env, value.configuration_revision_high));
  result.Set("configurationRevisionLow", Napi::Number::New(env, value.configuration_revision_low));
  result.Set("motionRevisionHigh", Napi::Number::New(env, value.motion_revision_high));
  result.Set("motionRevisionLow", Napi::Number::New(env, value.motion_revision_low));
  result.Set("resultEpoch", writeWire(env, value.result_epoch));
  result.Set("resultPositionX", Napi::Number::New(env, value.result_position_x));
  result.Set("resultPositionY", Napi::Number::New(env, value.result_position_y));
  result.Set("resultPositionZ", Napi::Number::New(env, value.result_position_z));
  result.Set("resultVelocityX", Napi::Number::New(env, value.result_velocity_x));
  result.Set("resultVelocityY", Napi::Number::New(env, value.result_velocity_y));
  result.Set("resultVelocityZ", Napi::Number::New(env, value.result_velocity_z));
  result.Set("resultMassPresent", Napi::Boolean::New(env, value.result_mass_present));
  result.Set("resultMass", Napi::Number::New(env, value.result_mass));
  return result;
}

bool readCoupledMember(const Napi::Value& value, orbit_engine::coupled_operation::MemberWire& output) {
  if (!value.IsObject()) return false;
  const auto object = value.As<Napi::Object>();
  const auto readInteger = [&object](const char* name, double minimum, double maximum, auto& target) {
    const auto value = object.Get(name); if (!value.IsNumber()) return false;
    const auto number = value.As<Napi::Number>().DoubleValue();
    if (!std::isfinite(number) || std::trunc(number) != number || number < minimum || number > maximum) return false;
    target = static_cast<std::decay_t<decltype(target)>>(number); return true;
  };
  const auto readDouble = [&object](const char* name, double& target) {
    const auto value = object.Get(name); if (!value.IsNumber()) return false;
    target = value.As<Napi::Number>().DoubleValue(); return std::isfinite(target);
  };
  const auto readBoolean = [&object](const char* name, bool& target) {
    const auto value = object.Get(name); if (!value.IsBoolean()) return false;
    target = value.As<Napi::Boolean>().Value(); return true;
  };
  return readInteger("objectIdHigh", 0.0, 4'294'967'295.0, output.object_id_high)
    && readInteger("objectIdLow", 0.0, 4'294'967'295.0, output.object_id_low)
    && readWire(object.Get("epoch"), output.epoch)
    && readInteger("frameHigh", 0.0, 4'294'967'295.0, output.frame_high)
    && readInteger("frameLow", 0.0, 4'294'967'295.0, output.frame_low)
    && readDouble("positionX", output.position_x) && readDouble("positionY", output.position_y) && readDouble("positionZ", output.position_z)
    && readDouble("velocityX", output.velocity_x) && readDouble("velocityY", output.velocity_y) && readDouble("velocityZ", output.velocity_z)
    && readBoolean("massPresent", output.mass_present) && readDouble("mass", output.mass)
    && readBoolean("muPresent", output.mu_present) && readDouble("mu", output.mu)
    && readInteger("motionRevisionHigh", 0.0, 4'294'967'295.0, output.motion_revision_high)
    && readInteger("motionRevisionLow", 0.0, 4'294'967'295.0, output.motion_revision_low)
    && readInteger("propertyRevisionHigh", 0.0, 4'294'967'295.0, output.property_revision_high)
    && readInteger("propertyRevisionLow", 0.0, 4'294'967'295.0, output.property_revision_low)
    && readInteger("massRevisionHigh", 0.0, 4'294'967'295.0, output.mass_revision_high)
    && readInteger("massRevisionLow", 0.0, 4'294'967'295.0, output.mass_revision_low);
}

Napi::Object writeCoupledMember(Napi::Env env, const orbit_engine::coupled_operation::MemberWire& value) {
  auto result = Napi::Object::New(env);
  result.Set("objectIdHigh", Napi::Number::New(env, value.object_id_high)); result.Set("objectIdLow", Napi::Number::New(env, value.object_id_low));
  result.Set("epoch", writeWire(env, value.epoch)); result.Set("frameHigh", Napi::Number::New(env, value.frame_high)); result.Set("frameLow", Napi::Number::New(env, value.frame_low));
  result.Set("positionX", Napi::Number::New(env, value.position_x)); result.Set("positionY", Napi::Number::New(env, value.position_y)); result.Set("positionZ", Napi::Number::New(env, value.position_z));
  result.Set("velocityX", Napi::Number::New(env, value.velocity_x)); result.Set("velocityY", Napi::Number::New(env, value.velocity_y)); result.Set("velocityZ", Napi::Number::New(env, value.velocity_z));
  result.Set("massPresent", Napi::Boolean::New(env, value.mass_present)); result.Set("mass", Napi::Number::New(env, value.mass));
  result.Set("muPresent", Napi::Boolean::New(env, value.mu_present)); result.Set("mu", Napi::Number::New(env, value.mu));
  result.Set("motionRevisionHigh", Napi::Number::New(env, value.motion_revision_high)); result.Set("motionRevisionLow", Napi::Number::New(env, value.motion_revision_low));
  result.Set("propertyRevisionHigh", Napi::Number::New(env, value.property_revision_high)); result.Set("propertyRevisionLow", Napi::Number::New(env, value.property_revision_low));
  result.Set("massRevisionHigh", Napi::Number::New(env, value.mass_revision_high)); result.Set("massRevisionLow", Napi::Number::New(env, value.mass_revision_low));
  return result;
}

bool readCoupledWire(const Napi::Value& value, orbit_engine::coupled_operation::CoupledWire& output) {
  if (!value.IsObject()) return false;
  const auto object = value.As<Napi::Object>();
  const auto readInteger = [&object](const char* name, double minimum, double maximum, auto& target) {
    const auto value = object.Get(name); if (!value.IsNumber()) return false; const auto number = value.As<Napi::Number>().DoubleValue();
    if (!std::isfinite(number) || std::trunc(number) != number || number < minimum || number > maximum) return false;
    target = static_cast<std::decay_t<decltype(target)>>(number); return true;
  };
  const auto readDouble = [&object](const char* name, double& target) { const auto value = object.Get(name); if (!value.IsNumber()) return false; target = value.As<Napi::Number>().DoubleValue(); return std::isfinite(target); };
  if (!readInteger("resultCode", 0.0, 65'535.0, output.result_code) || !readInteger("operationCode", 1.0, 4.0, output.operation_code)
      || !readWire(object.Get("targetEpoch"), output.target_epoch)
      || !readInteger("authorityIdHigh", 0.0, 4'294'967'295.0, output.authority_id_high) || !readInteger("authorityIdLow", 0.0, 4'294'967'295.0, output.authority_id_low)
      || !readInteger("groupRevisionHigh", 0.0, 4'294'967'295.0, output.group_revision_high) || !readInteger("groupRevisionLow", 0.0, 4'294'967'295.0, output.group_revision_low)
      || !readInteger("memberCount", 0.0, 32.0, output.member_count) || !readInteger("requestedCount", 0.0, 32.0, output.requested_count)
      || !readInteger("configurationRevisionHigh", 0.0, 4'294'967'295.0, output.configuration_revision_high) || !readInteger("configurationRevisionLow", 0.0, 4'294'967'295.0, output.configuration_revision_low)
      || !readDouble("relativeTolerance", output.relative_tolerance) || !readDouble("positionAbsoluteToleranceMeters", output.position_absolute_tolerance_meters)
      || !readDouble("velocityAbsoluteToleranceMetersPerSecond", output.velocity_absolute_tolerance_meters_per_second) || !readDouble("massAbsoluteToleranceKilograms", output.mass_absolute_tolerance_kilograms)
      || !readInteger("checkpointStrideAcceptedSteps", 1.0, 4'294'967'295.0, output.checkpoint_stride_accepted_steps) || !readInteger("maxCheckpointCount", 1.0, 4'294'967'295.0, output.max_checkpoint_count)
      || !readInteger("maxDenseStepCount", 1.0, 4'294'967'295.0, output.max_dense_step_count) || !readInteger("maxAcceptedStepsPerExtension", 1.0, 4'294'967'295.0, output.max_accepted_steps_per_extension)
      || !readInteger("maxRejectedStepsPerExtension", 1.0, 4'294'967'295.0, output.max_rejected_steps_per_extension)
      || !readWire(object.Get("minStep"), output.min_step) || !readWire(object.Get("maxStep"), output.max_step)
      || !readDouble("constantAccelerationX", output.constant_acceleration_x) || !readDouble("constantAccelerationY", output.constant_acceleration_y) || !readDouble("constantAccelerationZ", output.constant_acceleration_z)) return false;
  const auto members = object.Get("members");
  if (!members.IsArray() || output.member_count > orbit_engine::coupled_operation::kMaxMembers || members.As<Napi::Array>().Length() < output.member_count) return false;
  for (std::size_t index = 0; index < output.member_count; ++index) if (!readCoupledMember(members.As<Napi::Array>().Get(index), output.members[index])) return false;
  const auto requested = object.Get("requestedIds");
  if (!requested.IsArray() || requested.As<Napi::Array>().Length() < output.requested_count) return false;
  for (std::size_t index = 0; index < output.requested_count; ++index) {
    const auto id = requested.As<Napi::Array>().Get(index); if (!id.IsObject()) return false; const auto item = id.As<Napi::Object>();
    const auto high = item.Get("high"); const auto low = item.Get("low"); if (!high.IsNumber() || !low.IsNumber()) return false;
    output.requested_id_high[index] = static_cast<std::uint32_t>(high.As<Napi::Number>().Uint32Value()); output.requested_id_low[index] = static_cast<std::uint32_t>(low.As<Napi::Number>().Uint32Value());
  }
  return true;
}

Napi::Object writeCoupledWire(Napi::Env env, const orbit_engine::coupled_operation::CoupledWire& value) {
  auto result = Napi::Object::New(env);
  result.Set("resultCode", Napi::Number::New(env, value.result_code)); result.Set("operationCode", Napi::Number::New(env, value.operation_code));
  result.Set("authorityIdHigh", Napi::Number::New(env, value.authority_id_high)); result.Set("authorityIdLow", Napi::Number::New(env, value.authority_id_low));
  result.Set("groupRevisionHigh", Napi::Number::New(env, value.group_revision_high)); result.Set("groupRevisionLow", Napi::Number::New(env, value.group_revision_low));
  result.Set("resultCount", Napi::Number::New(env, value.result_count)); result.Set("sharedEvaluationCountHigh", Napi::Number::New(env, value.shared_evaluation_count_high)); result.Set("sharedEvaluationCountLow", Napi::Number::New(env, value.shared_evaluation_count_low));
  auto results = Napi::Array::New(env, value.result_count); for (std::size_t index = 0; index < value.result_count; ++index) results.Set(index, writeCoupledMember(env, value.results[index])); result.Set("results", results);
  return result;
}

Napi::Value RoundTripTime(const Napi::CallbackInfo& info) {
  const auto env = info.Env();
  if (info.Length() != 1) {
    Napi::TypeError::New(env, "roundTripTime expects one wire value").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  orbit_engine::time::TimeWire input{};
  if (!readWire(info[0], input)) {
    Napi::TypeError::New(env, "roundTripTime received an invalid wire value").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  orbit_engine::time::TimeWire output{};
  if (!orbit_engine::time::round_trip_wire(input, output)) {
    Napi::RangeError::New(env, "roundTripTime received an invalid nanosecond value").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  return writeWire(env, output);
}

Napi::Value RoundTripDouble(const Napi::CallbackInfo& info) {
  const auto env = info.Env();
  if (info.Length() != 1 || !info[0].IsNumber()) {
    Napi::TypeError::New(env, "roundTripDouble expects one number").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  const auto value = info[0].As<Napi::Number>().DoubleValue();
  if (!std::isfinite(value)) {
    Napi::TypeError::New(env, "roundTripDouble expects a finite number").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  return Napi::Number::New(env, orbit_engine::time::round_trip_double(value));
}

Napi::Value RoundTripObject(const Napi::CallbackInfo& info) {
  const auto env = info.Env();
  if (info.Length() != 1) {
    Napi::TypeError::New(env, "roundTripObject expects one object wire value").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  orbit_engine::object::ObjectWire input{};
  if (!readObjectWire(info[0], input)) {
    Napi::TypeError::New(env, "roundTripObject received an invalid wire value").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  orbit_engine::object::ObjectWire output{};
  if (!orbit_engine::object::round_trip(input, output)) {
    Napi::RangeError::New(env, "roundTripObject received an invalid object value").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  return writeObjectWire(env, output);
}

Napi::Value RoundTripFrame(const Napi::CallbackInfo& info) {
  const auto env = info.Env();
  if (info.Length() != 1) {
    Napi::TypeError::New(env, "roundTripFrame expects one frame wire value").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  orbit_engine::frame::FrameWire input{};
  if (!readFrameWire(info[0], input)) {
    Napi::TypeError::New(env, "roundTripFrame received an invalid wire value").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  orbit_engine::frame::FrameWire output{};
  if (!orbit_engine::frame::round_trip(input, output)) {
    Napi::RangeError::New(env, "roundTripFrame received an invalid frame value").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  return writeFrameWire(env, output);
}

Napi::Value RoundTripPropagation(const Napi::CallbackInfo& info) {
  const auto env = info.Env();
  if (info.Length() != 1) {
    Napi::TypeError::New(env, "roundTripPropagation expects one propagation wire value").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  orbit_engine::propagation::PropagationWire input{};
  if (!readPropagationWire(info[0], input)) {
    Napi::TypeError::New(env, "roundTripPropagation received an invalid wire value").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  orbit_engine::propagation::PropagationWire output{};
  if (!orbit_engine::propagation::round_trip(input, output)) {
    Napi::RangeError::New(env, "roundTripPropagation received an invalid propagation value").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  return writePropagationWire(env, output);
}

Napi::Value RoundTripRegistry(const Napi::CallbackInfo& info) {
  const auto env = info.Env();
  if (info.Length() != 1) {
    Napi::TypeError::New(env, "roundTripRegistry expects one registry wire value").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  orbit_engine::registry::RegistryWire input{};
  if (!readRegistryWire(info[0], input)) {
    Napi::TypeError::New(env, "roundTripRegistry received an invalid wire value").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  return writeRegistryWire(env, g_registry.command(input));
}

Napi::Value RoundTripFrameRegistry(const Napi::CallbackInfo& info) {
  const auto env = info.Env();
  if (info.Length() != 1) {
    Napi::TypeError::New(env, "roundTripFrameRegistry expects one frame registry wire value").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  orbit_engine::frame_registry::FrameRegistryWire input{};
  if (!readFrameRegistryWire(info[0], input)) {
    Napi::TypeError::New(env, "roundTripFrameRegistry received an invalid wire value").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  return writeFrameRegistryWire(env, g_frame_registry.command(input));
}

Napi::Value RoundTripTwoBody(const Napi::CallbackInfo& info) {
  const auto env = info.Env();
  if (info.Length() != 1) {
    Napi::TypeError::New(env, "roundTripTwoBody expects one two-body wire value").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  orbit_engine::two_body::TwoBodyWire input{};
  if (!readTwoBodyWire(info[0], input)) {
    Napi::TypeError::New(env, "roundTripTwoBody received an invalid wire value").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  return writeTwoBodyWire(env, orbit_engine::two_body::evaluate(input));
}

Napi::Value RoundTripNumerical(const Napi::CallbackInfo& info) {
  const auto env = info.Env();
  if (info.Length() != 1) {
    Napi::TypeError::New(env, "roundTripNumerical expects one numerical wire value").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  orbit_engine::numerical_operation::NumericalWire input{};
  if (!readNumericalWire(info[0], input)) {
    Napi::TypeError::New(env, "roundTripNumerical received an invalid wire value").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  return writeNumericalWire(env, orbit_engine::numerical_operation::evaluate(input));
}

Napi::Value RoundTripCoupled(const Napi::CallbackInfo& info) {
  const auto env = info.Env();
  if (info.Length() != 1) {
    Napi::TypeError::New(env, "roundTripCoupled expects one coupled wire value").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  orbit_engine::coupled_operation::CoupledWire input{};
  if (!readCoupledWire(info[0], input)) {
    Napi::TypeError::New(env, "roundTripCoupled received an invalid wire value").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  return writeCoupledWire(env, orbit_engine::coupled_operation::evaluate(input));
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("protocolVersion", Napi::Number::New(env, orbit_engine::kBindingProtocolVersion));
  exports.Set("initialize", Napi::Function::New(env, Initialize));
  exports.Set("roundTripTime", Napi::Function::New(env, RoundTripTime));
  exports.Set("roundTripDouble", Napi::Function::New(env, RoundTripDouble));
  exports.Set("roundTripObject", Napi::Function::New(env, RoundTripObject));
  exports.Set("roundTripFrame", Napi::Function::New(env, RoundTripFrame));
  exports.Set("roundTripPropagation", Napi::Function::New(env, RoundTripPropagation));
  exports.Set("roundTripRegistry", Napi::Function::New(env, RoundTripRegistry));
  exports.Set("roundTripFrameRegistry", Napi::Function::New(env, RoundTripFrameRegistry));
  exports.Set("roundTripTwoBody", Napi::Function::New(env, RoundTripTwoBody));
  exports.Set("roundTripNumerical", Napi::Function::New(env, RoundTripNumerical));
  exports.Set("roundTripCoupled", Napi::Function::New(env, RoundTripCoupled));
  return exports;
}

}  // namespace

NODE_API_MODULE(orbit_engine, Init)
