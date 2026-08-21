#include "orbit_engine/core.hpp"

#include <napi.h>

namespace {

Napi::Value Initialize(const Napi::CallbackInfo& info) {
  const auto health = orbit_engine::health();
  auto result = Napi::Object::New(info.Env());
  result.Set("coreVersion", Napi::Number::New(info.Env(), health.core_version));
  result.Set("healthCode", Napi::Number::New(info.Env(), health.health_code));
  return result;
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("protocolVersion", Napi::Number::New(env, orbit_engine::kBindingProtocolVersion));
  exports.Set("initialize", Napi::Function::New(env, Initialize));
  return exports;
}

}  // namespace

NODE_API_MODULE(orbit_engine, Init)
