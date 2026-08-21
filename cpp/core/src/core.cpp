#include "orbit_engine/core.hpp"

namespace orbit_engine {

Health health() noexcept {
  return Health{.core_version = kCoreVersion, .health_code = 42};
}

}  // namespace orbit_engine
