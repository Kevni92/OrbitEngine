#include "orbit_engine/oep.hpp"

#include <cmath>
#include <cstdint>
#include <span>
#include <napi.h>

namespace {

orbit_engine::oep::Registry g_oep_registry;

bool readUint32(const Napi::Value& value, std::uint32_t& output) {
  if (!value.IsNumber()) return false;
  const auto number = value.As<Napi::Number>().DoubleValue();
  if (!std::isfinite(number) || std::trunc(number) != number || number < 0.0 || number > 4'294'967'295.0) return false;
  output = static_cast<std::uint32_t>(number);
  return true;
}

bool readUint16(const Napi::Value& value, std::uint16_t& output) {
  std::uint32_t number = 0;
  if (!readUint32(value, number) || number > 65'535U) return false;
  output = static_cast<std::uint16_t>(number);
  return true;
}

bool readTime(const Napi::Value& value, orbit_engine::time::TimeWire& output) {
  if (!value.IsObject()) return false;
  const auto object = value.As<Napi::Object>();
  const auto high_value = object.Get("secondsHigh");
  const auto low_value = object.Get("secondsLow");
  const auto nanos_value = object.Get("nanoseconds");
  if (!high_value.IsNumber()) return false;
  const auto high = high_value.As<Napi::Number>().DoubleValue();
  if (!std::isfinite(high) || std::trunc(high) != high || high < -2'147'483'648.0 || high > 2'147'483'647.0) return false;
  output.seconds_high = static_cast<std::int32_t>(high);
  return readUint32(low_value, output.seconds_low)
    && readUint32(nanos_value, output.nanoseconds)
    && output.nanoseconds < orbit_engine::time::kNanosecondsPerSecond;
}

std::uint64_t handleFromWords(std::uint32_t high, std::uint32_t low) {
  return (static_cast<std::uint64_t>(high) << 32U) | static_cast<std::uint64_t>(low);
}

Napi::Object writeTime(Napi::Env env, orbit_engine::time::TimeWire value) {
  auto result = Napi::Object::New(env);
  result.Set("secondsHigh", Napi::Number::New(env, value.seconds_high));
  result.Set("secondsLow", Napi::Number::New(env, value.seconds_low));
  result.Set("nanoseconds", Napi::Number::New(env, value.nanoseconds));
  return result;
}

Napi::Object writeDatasetInfo(Napi::Env env, orbit_engine::oep::DatasetInfoWire value) {
  auto result = Napi::Object::New(env);
  result.Set("resultCode", Napi::Number::New(env, value.result_code));
  result.Set("handleHigh", Napi::Number::New(env, value.handle_high));
  result.Set("handleLow", Napi::Number::New(env, value.handle_low));
  result.Set("datasetRevisionHigh", Napi::Number::New(env, value.dataset_revision_high));
  result.Set("datasetRevisionLow", Napi::Number::New(env, value.dataset_revision_low));
  result.Set("sourceCount", Napi::Number::New(env, value.source_count));
  return result;
}

Napi::Object writeSourceInfo(Napi::Env env, orbit_engine::oep::SourceInfoWire value) {
  auto result = Napi::Object::New(env);
  result.Set("resultCode", Napi::Number::New(env, value.result_code));
  result.Set("handleHigh", Napi::Number::New(env, value.handle_high));
  result.Set("handleLow", Napi::Number::New(env, value.handle_low));
  result.Set("sourceNodeId", Napi::Number::New(env, value.source_node_id));
  result.Set("centerSourceNodeId", Napi::Number::New(env, value.center_source_node_id));
  result.Set("representationCode", Napi::Number::New(env, value.representation_code));
  result.Set("sourceRevisionHigh", Napi::Number::New(env, value.source_revision_high));
  result.Set("sourceRevisionLow", Napi::Number::New(env, value.source_revision_low));
  result.Set("validityStart", writeTime(env, value.validity_start));
  result.Set("validityEnd", writeTime(env, value.validity_end));
  result.Set("effectiveValidityStart", writeTime(env, value.effective_validity_start));
  result.Set("effectiveValidityEnd", writeTime(env, value.effective_validity_end));
  result.Set("positionErrorMeters", Napi::Number::New(env, value.position_error_meters));
  result.Set("velocityErrorMetersPerSecond", Napi::Number::New(env, value.velocity_error_meters_per_second));
  return result;
}

Napi::Object writeEvaluation(Napi::Env env, orbit_engine::oep::EvaluationWire value) {
  auto result = Napi::Object::New(env);
  result.Set("resultCode", Napi::Number::New(env, value.result_code));
  result.Set("handleHigh", Napi::Number::New(env, value.handle_high));
  result.Set("handleLow", Napi::Number::New(env, value.handle_low));
  result.Set("sourceNodeId", Napi::Number::New(env, value.source_node_id));
  result.Set("evaluationModeCode", Napi::Number::New(env, value.evaluation_mode_code));
  result.Set("recordIndex", Napi::Number::New(env, value.record_index));
  result.Set("sourceRevisionHigh", Napi::Number::New(env, value.source_revision_high));
  result.Set("sourceRevisionLow", Napi::Number::New(env, value.source_revision_low));
  result.Set("epoch", writeTime(env, value.epoch));
  result.Set("positionX", Napi::Number::New(env, value.position_x));
  result.Set("positionY", Napi::Number::New(env, value.position_y));
  result.Set("positionZ", Napi::Number::New(env, value.position_z));
  result.Set("velocityX", Napi::Number::New(env, value.velocity_x));
  result.Set("velocityY", Napi::Number::New(env, value.velocity_y));
  result.Set("velocityZ", Napi::Number::New(env, value.velocity_z));
  return result;
}

Napi::Value LoadOep(const Napi::CallbackInfo& info) {
  const auto env = info.Env();
  if (info.Length() != 1) {
    Napi::TypeError::New(env, "loadOep expects one Uint8Array").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  const std::uint8_t* data = nullptr;
  std::size_t length = 0;
  if (info[0].IsBuffer()) {
    const auto buffer = info[0].As<Napi::Buffer<std::uint8_t>>();
    data = buffer.Data();
    length = buffer.Length();
  } else if (info[0].IsTypedArray()) {
    const auto array = info[0].As<Napi::TypedArray>();
    if (array.TypedArrayType() != napi_uint8_array) {
      Napi::TypeError::New(env, "loadOep requires Uint8Array bytes").ThrowAsJavaScriptException();
      return env.Undefined();
    }
    const auto bytes = info[0].As<Napi::Uint8Array>();
    data = bytes.Data();
    length = bytes.ByteLength();
  } else {
    Napi::TypeError::New(env, "loadOep requires Uint8Array bytes").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  return writeDatasetInfo(env, g_oep_registry.load(std::span<const std::uint8_t>(data, length)));
}

Napi::Value DatasetCommand(const Napi::CallbackInfo& info, int operation) {
  const auto env = info.Env();
  if (info.Length() != 2) {
    Napi::TypeError::New(env, "OEP dataset command expects handle high/low words").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  std::uint32_t high = 0;
  std::uint32_t low = 0;
  if (!readUint32(info[0], high) || !readUint32(info[1], low)) {
    Napi::TypeError::New(env, "OEP dataset handle words must be uint32").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  const auto handle = handleFromWords(high, low);
  if (operation == 0) return writeDatasetInfo(env, g_oep_registry.retain(handle));
  if (operation == 1) return writeDatasetInfo(env, g_oep_registry.release_reference(handle));
  return writeDatasetInfo(env, g_oep_registry.unload(handle));
}

Napi::Value RetainOep(const Napi::CallbackInfo& info) { return DatasetCommand(info, 0); }
Napi::Value ReleaseOepReference(const Napi::CallbackInfo& info) { return DatasetCommand(info, 1); }
Napi::Value UnloadOep(const Napi::CallbackInfo& info) { return DatasetCommand(info, 2); }

Napi::Value OepSourceInfo(const Napi::CallbackInfo& info) {
  const auto env = info.Env();
  if (info.Length() != 3) {
    Napi::TypeError::New(env, "oepSourceInfo expects handle high/low and source ID").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  std::uint32_t high = 0;
  std::uint32_t low = 0;
  std::uint32_t source = 0;
  if (!readUint32(info[0], high) || !readUint32(info[1], low) || !readUint32(info[2], source)) {
    Napi::TypeError::New(env, "oepSourceInfo arguments must be uint32").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  return writeSourceInfo(env, g_oep_registry.source_info(handleFromWords(high, low), source));
}

Napi::Value EvaluateOep(const Napi::CallbackInfo& info) {
  const auto env = info.Env();
  if (info.Length() != 5) {
    Napi::TypeError::New(env, "evaluateOep expects handle high/low, source ID, mode, and time").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  std::uint32_t high = 0;
  std::uint32_t low = 0;
  std::uint32_t source = 0;
  std::uint16_t mode = 0;
  orbit_engine::time::TimeWire target{};
  if (!readUint32(info[0], high) || !readUint32(info[1], low) || !readUint32(info[2], source)
      || !readUint16(info[3], mode) || !readTime(info[4], target)) {
    Napi::TypeError::New(env, "evaluateOep received invalid arguments").ThrowAsJavaScriptException();
    return env.Undefined();
  }
  return writeEvaluation(env, g_oep_registry.evaluate(
    handleFromWords(high, low),
    source,
    static_cast<orbit_engine::oep::EvaluationMode>(mode),
    target
  ));
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("loadOep", Napi::Function::New(env, LoadOep));
  exports.Set("retainOep", Napi::Function::New(env, RetainOep));
  exports.Set("releaseOepReference", Napi::Function::New(env, ReleaseOepReference));
  exports.Set("unloadOep", Napi::Function::New(env, UnloadOep));
  exports.Set("oepSourceInfo", Napi::Function::New(env, OepSourceInfo));
  exports.Set("evaluateOep", Napi::Function::New(env, EvaluateOep));
  return exports;
}

}  // namespace

NODE_API_MODULE(orbit_engine_oep, Init)
