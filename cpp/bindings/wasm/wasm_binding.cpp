#include "orbit_engine/core.hpp"
#include "orbit_engine/time.hpp"

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

}
