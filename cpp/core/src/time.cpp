#include "orbit_engine/time.hpp"

#include <bit>
#include <limits>

namespace orbit_engine::time {
namespace {

bool checked_add(std::int64_t left, std::int64_t right, std::int64_t& result) noexcept {
  if ((right > 0 && left > std::numeric_limits<std::int64_t>::max() - right)
      || (right < 0 && left < std::numeric_limits<std::int64_t>::min() - right)) {
    return false;
  }
  result = left + right;
  return true;
}

bool checked_subtract(std::int64_t left, std::int64_t right, std::int64_t& result) noexcept {
  if ((right > 0 && left < std::numeric_limits<std::int64_t>::min() + right)
      || (right < 0 && left > std::numeric_limits<std::int64_t>::max() + right)) {
    return false;
  }
  result = left - right;
  return true;
}

template <typename Value>
std::optional<Value> normalize_value(std::int64_t seconds, std::int64_t nanoseconds) noexcept {
  std::int64_t carry = nanoseconds / static_cast<std::int64_t>(kNanosecondsPerSecond);
  std::int64_t remainder = nanoseconds % static_cast<std::int64_t>(kNanosecondsPerSecond);
  if (remainder < 0) {
    --carry;
    remainder += static_cast<std::int64_t>(kNanosecondsPerSecond);
  }

  std::int64_t normalizedSeconds = 0;
  if (!checked_add(seconds, carry, normalizedSeconds)) {
    return std::nullopt;
  }

  return Value{normalizedSeconds, static_cast<std::uint32_t>(remainder)};
}

template <typename Value>
bool valid(Value value) noexcept {
  return value.nanoseconds < kNanosecondsPerSecond;
}

}  // namespace

bool is_normalized(SimulationInstant value) noexcept {
  return valid(value);
}

bool is_normalized(Duration value) noexcept {
  return valid(value);
}

std::optional<SimulationInstant> normalize_instant(
  std::int64_t seconds,
  std::int64_t nanoseconds
) noexcept {
  return normalize_value<SimulationInstant>(seconds, nanoseconds);
}

std::optional<Duration> normalize_duration(
  std::int64_t seconds,
  std::int64_t nanoseconds
) noexcept {
  return normalize_value<Duration>(seconds, nanoseconds);
}

int compare(SimulationInstant left, SimulationInstant right) noexcept {
  if (left.seconds != right.seconds) {
    return left.seconds < right.seconds ? -1 : 1;
  }
  if (left.nanoseconds != right.nanoseconds) {
    return left.nanoseconds < right.nanoseconds ? -1 : 1;
  }
  return 0;
}

int compare(Duration left, Duration right) noexcept {
  if (left.seconds != right.seconds) {
    return left.seconds < right.seconds ? -1 : 1;
  }
  if (left.nanoseconds != right.nanoseconds) {
    return left.nanoseconds < right.nanoseconds ? -1 : 1;
  }
  return 0;
}

std::optional<Duration> subtract(SimulationInstant left, SimulationInstant right) noexcept {
  if (!is_normalized(left) || !is_normalized(right)) {
    return std::nullopt;
  }

  std::int64_t seconds = 0;
  if (!checked_subtract(left.seconds, right.seconds, seconds)) {
    return std::nullopt;
  }
  const auto nanoseconds = static_cast<std::int64_t>(left.nanoseconds)
    - static_cast<std::int64_t>(right.nanoseconds);
  return normalize_duration(seconds, nanoseconds);
}

std::optional<SimulationInstant> add(SimulationInstant instant, Duration value) noexcept {
  if (!is_normalized(instant) || !is_normalized(value)) {
    return std::nullopt;
  }

  std::int64_t seconds = 0;
  if (!checked_add(instant.seconds, value.seconds, seconds)) {
    return std::nullopt;
  }
  const auto nanoseconds = static_cast<std::int64_t>(instant.nanoseconds)
    + static_cast<std::int64_t>(value.nanoseconds);
  return normalize_instant(seconds, nanoseconds);
}

std::optional<SimulationInstant> subtract(SimulationInstant instant, Duration value) noexcept {
  if (!is_normalized(instant) || !is_normalized(value)) {
    return std::nullopt;
  }

  std::int64_t seconds = 0;
  if (!checked_subtract(instant.seconds, value.seconds, seconds)) {
    return std::nullopt;
  }
  const auto nanoseconds = static_cast<std::int64_t>(instant.nanoseconds)
    - static_cast<std::int64_t>(value.nanoseconds);
  return normalize_instant(seconds, nanoseconds);
}

std::optional<Duration> add(Duration left, Duration right) noexcept {
  if (!is_normalized(left) || !is_normalized(right)) {
    return std::nullopt;
  }

  std::int64_t seconds = 0;
  if (!checked_add(left.seconds, right.seconds, seconds)) {
    return std::nullopt;
  }
  const auto nanoseconds = static_cast<std::int64_t>(left.nanoseconds)
    + static_cast<std::int64_t>(right.nanoseconds);
  return normalize_duration(seconds, nanoseconds);
}

std::optional<Duration> subtract(Duration left, Duration right) noexcept {
  if (!is_normalized(left) || !is_normalized(right)) {
    return std::nullopt;
  }

  std::int64_t seconds = 0;
  if (!checked_subtract(left.seconds, right.seconds, seconds)) {
    return std::nullopt;
  }
  const auto nanoseconds = static_cast<std::int64_t>(left.nanoseconds)
    - static_cast<std::int64_t>(right.nanoseconds);
  return normalize_duration(seconds, nanoseconds);
}

std::optional<Duration> negate(Duration value) noexcept {
  if (!is_normalized(value) || value.seconds == std::numeric_limits<std::int64_t>::min()) {
    return std::nullopt;
  }
  return normalize_duration(-value.seconds, -static_cast<std::int64_t>(value.nanoseconds));
}

double to_seconds(Duration value) noexcept {
  return static_cast<double>(value.seconds)
    + static_cast<double>(value.nanoseconds) / static_cast<double>(kNanosecondsPerSecond);
}

TimeWire to_wire(SimulationInstant value) noexcept {
  const auto bits = std::bit_cast<std::uint64_t>(value.seconds);
  return TimeWire{
    std::bit_cast<std::int32_t>(static_cast<std::uint32_t>(bits >> 32U)),
    static_cast<std::uint32_t>(bits),
    value.nanoseconds,
  };
}

std::optional<SimulationInstant> from_wire(TimeWire value) noexcept {
  if (value.nanoseconds >= kNanosecondsPerSecond) {
    return std::nullopt;
  }

  const auto high = std::bit_cast<std::uint32_t>(value.seconds_high);
  const auto bits = (static_cast<std::uint64_t>(high) << 32U) | value.seconds_low;
  return SimulationInstant{std::bit_cast<std::int64_t>(bits), value.nanoseconds};
}

TimeWire to_wire(Duration value) noexcept {
  return to_wire(SimulationInstant{value.seconds, value.nanoseconds});
}

std::optional<Duration> from_wire_duration(TimeWire value) noexcept {
  const auto instant = from_wire(value);
  if (!instant.has_value()) {
    return std::nullopt;
  }
  return Duration{instant->seconds, instant->nanoseconds};
}

bool round_trip_wire(TimeWire input, TimeWire& output) noexcept {
  const auto decoded = from_wire(input);
  if (!decoded.has_value()) {
    return false;
  }
  output = to_wire(*decoded);
  return true;
}

double round_trip_double(double value) noexcept {
  return value;
}

}  // namespace orbit_engine::time
