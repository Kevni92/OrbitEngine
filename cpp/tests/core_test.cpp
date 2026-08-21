#include "orbit_engine/core.hpp"
#include "orbit_engine/time.hpp"

#include <cstdint>
#include <iostream>
#include <limits>

#define CHECK(condition) \
  do { \
    if (!(condition)) { \
      std::cerr << "check failed: " #condition "\n"; \
      return 1; \
    } \
  } while (false)

int main() {
  const auto result = orbit_engine::health();

  if (result.core_version != orbit_engine::kCoreVersion || result.health_code != 42) {
    std::cerr << "unexpected core health result\n";
    return 1;
  }

  if (orbit_engine::kBindingProtocolVersion != 2) {
    std::cerr << "unexpected binding protocol version\n";
    return 1;
  }

  using orbit_engine::time::Duration;
  using orbit_engine::time::SimulationInstant;
  using orbit_engine::time::TimeWire;
  using orbit_engine::time::kNanosecondsPerSecond;

  const auto negative = orbit_engine::time::normalize_duration(0, -500'000'000);
  CHECK(negative.has_value());
  CHECK(negative->seconds == -1);
  CHECK(negative->nanoseconds == 500'000'000);

  const auto carried = orbit_engine::time::normalize_instant(0, 1'000'000'000);
  CHECK(carried.has_value());
  CHECK(carried->seconds == 1);
  CHECK(carried->nanoseconds == 0);

  const auto borrowed = orbit_engine::time::normalize_instant(1, -1);
  CHECK(borrowed.has_value());
  CHECK(borrowed->seconds == 0);
  CHECK(borrowed->nanoseconds == 999'999'999);

  const SimulationInstant before{-1, 999'999'999};
  const SimulationInstant at{0, 0};
  const SimulationInstant after{0, 1};
  CHECK(orbit_engine::time::compare(before, at) < 0);
  CHECK(orbit_engine::time::compare(at, at) == 0);
  CHECK(orbit_engine::time::compare(after, at) > 0);

  const auto difference = orbit_engine::time::subtract(after, before);
  CHECK(difference.has_value());
  CHECK(difference->seconds == 0);
  CHECK(difference->nanoseconds == 2);

  const auto sum = orbit_engine::time::add(at, Duration{-1, 500'000'000});
  CHECK(sum.has_value());
  CHECK(sum->seconds == -1);
  CHECK(sum->nanoseconds == 500'000'000);

  const auto durationSum = orbit_engine::time::add(Duration{1, 750'000'000}, Duration{0, 250'000'000});
  CHECK(durationSum.has_value());
  CHECK(durationSum->seconds == 2);
  CHECK(durationSum->nanoseconds == 0);

  const auto durationDifference = orbit_engine::time::subtract(Duration{1, 0}, Duration{0, 1});
  CHECK(durationDifference.has_value());
  CHECK(durationDifference->seconds == 0);
  CHECK(durationDifference->nanoseconds == 999'999'999);

  const auto negated = orbit_engine::time::negate(Duration{0, 1});
  CHECK(negated.has_value());
  CHECK(negated->seconds == -1);
  CHECK(negated->nanoseconds == 999'999'999);
  CHECK(orbit_engine::time::to_seconds(Duration{1, 500'000'000}) == 1.5);

  const SimulationInstant maximum{std::numeric_limits<std::int64_t>::max(), kNanosecondsPerSecond - 1};
  const SimulationInstant minimum{std::numeric_limits<std::int64_t>::min(), 0};
  const Duration oneNanosecond{0, 1};
  CHECK(!orbit_engine::time::add(maximum, oneNanosecond).has_value());
  CHECK(!orbit_engine::time::subtract(minimum, oneNanosecond).has_value());
  CHECK(!orbit_engine::time::add(
    Duration{std::numeric_limits<std::int64_t>::max(), kNanosecondsPerSecond - 1},
    oneNanosecond
  ).has_value());
  CHECK(!orbit_engine::time::subtract(
    Duration{std::numeric_limits<std::int64_t>::min(), 0},
    oneNanosecond
  ).has_value());
  CHECK(!orbit_engine::time::negate(Duration{std::numeric_limits<std::int64_t>::min(), 0}).has_value());

  const SimulationInstant positiveWide{0x1'0000'0000LL + 123, 999'999'999};
  const TimeWire positiveWire = orbit_engine::time::to_wire(positiveWide);
  CHECK(positiveWire.seconds_high == 1);
  CHECK(positiveWire.seconds_low == 123);
  CHECK(positiveWire.nanoseconds == 999'999'999);
  const auto positiveDecoded = orbit_engine::time::from_wire(positiveWire);
  CHECK(positiveDecoded.has_value());
  CHECK(positiveDecoded->seconds == positiveWide.seconds);
  CHECK(positiveDecoded->nanoseconds == positiveWide.nanoseconds);

  const Duration durationWide{positiveWide.seconds, positiveWide.nanoseconds};
  const TimeWire durationWire = orbit_engine::time::to_wire(durationWide);
  const auto durationDecoded = orbit_engine::time::from_wire_duration(durationWire);
  CHECK(durationDecoded.has_value());
  CHECK(durationDecoded->seconds == durationWide.seconds);
  CHECK(durationDecoded->nanoseconds == durationWide.nanoseconds);

  const SimulationInstant negativeWide{-(0x1'0000'0000LL + 123), 1};
  const TimeWire negativeWire = orbit_engine::time::to_wire(negativeWide);
  CHECK(negativeWire.seconds_high == -2);
  CHECK(negativeWire.seconds_low == 4'294'967'173U);
  TimeWire roundTrippedWire{};
  CHECK(orbit_engine::time::round_trip_wire(negativeWire, roundTrippedWire));
  CHECK(roundTrippedWire.seconds_high == negativeWire.seconds_high);
  CHECK(roundTrippedWire.seconds_low == negativeWire.seconds_low);
  CHECK(roundTrippedWire.nanoseconds == negativeWire.nanoseconds);
  CHECK(!orbit_engine::time::round_trip_wire(TimeWire{0, 0, kNanosecondsPerSecond}, roundTrippedWire));

  constexpr double binary64Sentinel = 3.141592653589793;
  CHECK(orbit_engine::time::round_trip_double(binary64Sentinel) == binary64Sentinel);

  return 0;
}
