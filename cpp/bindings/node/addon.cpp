#include "orbit_engine/core.hpp"
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

Napi::Object writeWire(Napi::Env env, orbit_engine::time::TimeWire value) {
  auto result = Napi::Object::New(env);
  result.Set("secondsHigh", Napi::Number::New(env, value.seconds_high));
  result.Set("secondsLow", Napi::Number::New(env, value.seconds_low));
  result.Set("nanoseconds", Napi::Number::New(env, value.nanoseconds));
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

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("protocolVersion", Napi::Number::New(env, orbit_engine::kBindingProtocolVersion));
  exports.Set("initialize", Napi::Function::New(env, Initialize));
  exports.Set("roundTripTime", Napi::Function::New(env, RoundTripTime));
  exports.Set("roundTripDouble", Napi::Function::New(env, RoundTripDouble));
  return exports;
}

}  // namespace

NODE_API_MODULE(orbit_engine, Init)
