#pragma once

#include <cstdint>

namespace orbit_engine {

inline constexpr std::int32_t kBindingProtocolVersion = 6;
inline constexpr std::int32_t kCoreVersion = 1;

struct Health {
  std::int32_t core_version;
  std::int32_t health_code;
};

[[nodiscard]] Health health() noexcept;

}  // namespace orbit_engine
