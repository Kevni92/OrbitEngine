#include "orbit_engine/core.hpp"
#include "orbit_engine/frame.hpp"
#include "orbit_engine/object.hpp"
#include "orbit_engine/time.hpp"

#include <cmath>
#include <cstdint>
#include <type_traits>
#include <napi.h>

namespace {

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

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("protocolVersion", Napi::Number::New(env, orbit_engine::kBindingProtocolVersion));
  exports.Set("initialize", Napi::Function::New(env, Initialize));
  exports.Set("roundTripTime", Napi::Function::New(env, RoundTripTime));
  exports.Set("roundTripDouble", Napi::Function::New(env, RoundTripDouble));
  exports.Set("roundTripObject", Napi::Function::New(env, RoundTripObject));
  exports.Set("roundTripFrame", Napi::Function::New(env, RoundTripFrame));
  return exports;
}

}  // namespace

NODE_API_MODULE(orbit_engine, Init)
