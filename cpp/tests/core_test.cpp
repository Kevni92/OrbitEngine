#include "orbit_engine/core.hpp"

#include <iostream>

int main() {
  const auto result = orbit_engine::health();

  if (result.core_version != orbit_engine::kCoreVersion || result.health_code != 42) {
    std::cerr << "unexpected core health result\n";
    return 1;
  }

  if (orbit_engine::kBindingProtocolVersion != 1) {
    std::cerr << "unexpected binding protocol version\n";
    return 1;
  }

  return 0;
}
