#include "orbit_engine/core.hpp"

#include <emscripten/emscripten.h>

extern "C" {

EMSCRIPTEN_KEEPALIVE int orbit_engine_binding_protocol_version() {
  return orbit_engine::kBindingProtocolVersion;
}

EMSCRIPTEN_KEEPALIVE int orbit_engine_core_version() {
  return orbit_engine::kCoreVersion;
}

EMSCRIPTEN_KEEPALIVE int orbit_engine_health() {
  return orbit_engine::health().health_code;
}

}
