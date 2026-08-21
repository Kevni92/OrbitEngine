#pragma once

#include <cstdint>
#include <optional>

namespace orbit_engine::time {

inline constexpr std::uint32_t kNanosecondsPerSecond = 1'000'000'000U;

struct SimulationInstant {
  std::int64_t seconds;
  std::uint32_t nanoseconds;
};

struct Duration {
  std::int64_t seconds;
  std::uint32_t nanoseconds;
};

struct TimeWire {
  std::int32_t seconds_high;
  std::uint32_t seconds_low;
  std::uint32_t nanoseconds;
};

[[nodiscard]] bool is_normalized(SimulationInstant value) noexcept;
[[nodiscard]] bool is_normalized(Duration value) noexcept;

[[nodiscard]] std::optional<SimulationInstant> normalize_instant(
  std::int64_t seconds,
  std::int64_t nanoseconds
) noexcept;

[[nodiscard]] std::optional<Duration> normalize_duration(
  std::int64_t seconds,
  std::int64_t nanoseconds
) noexcept;

[[nodiscard]] int compare(SimulationInstant left, SimulationInstant right) noexcept;
[[nodiscard]] int compare(Duration left, Duration right) noexcept;

[[nodiscard]] std::optional<Duration> subtract(
  SimulationInstant left,
  SimulationInstant right
) noexcept;

[[nodiscard]] std::optional<SimulationInstant> add(
  SimulationInstant instant,
  Duration value
) noexcept;

[[nodiscard]] std::optional<SimulationInstant> subtract(
  SimulationInstant instant,
  Duration value
) noexcept;

[[nodiscard]] std::optional<Duration> add(Duration left, Duration right) noexcept;
[[nodiscard]] std::optional<Duration> subtract(Duration left, Duration right) noexcept;
[[nodiscard]] std::optional<Duration> negate(Duration value) noexcept;

[[nodiscard]] double to_seconds(Duration value) noexcept;

[[nodiscard]] TimeWire to_wire(SimulationInstant value) noexcept;
[[nodiscard]] std::optional<SimulationInstant> from_wire(TimeWire value) noexcept;
[[nodiscard]] TimeWire to_wire(Duration value) noexcept;
[[nodiscard]] std::optional<Duration> from_wire_duration(TimeWire value) noexcept;
[[nodiscard]] bool round_trip_wire(TimeWire input, TimeWire& output) noexcept;
[[nodiscard]] double round_trip_double(double value) noexcept;

}  // namespace orbit_engine::time
