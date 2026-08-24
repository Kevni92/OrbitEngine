#pragma once

#include "orbit_engine/frame.hpp"

#include <cstddef>
#include <cstdint>
#include <span>

namespace orbit_engine::lambert {

inline constexpr std::size_t kInputWords = 26;
inline constexpr std::size_t kOutputWords = 13;

enum class ResultCode : std::uint16_t {
  success = 0,
  invalid_input = 1,
  invalid_mu = 2,
  unsupported_revolution_count = 3,
  invalid_branch = 4,
  degenerate_geometry = 5,
  non_convergent = 6,
  numerical_failure = 7,
};

struct GeometryWire {
  std::uint32_t central_body_high = 0;
  std::uint32_t central_body_low = 0;
  std::uint32_t planning_frame_high = 0;
  std::uint32_t planning_frame_low = 0;
  double mu = 0.0;
  double time_of_flight_seconds = 0.0;
  std::uint32_t time_of_flight_nanoseconds = 0;
  frame::Vec3 departure_position{};
  frame::Vec3 arrival_position{};
  std::uint16_t motion_sense = 0;
  std::uint16_t path = 0;
  std::uint16_t revolutions = 0;
  frame::Vec3 reference_normal{};
  double relative_time_of_flight_tolerance = 0.0;
  double velocity_tolerance = 0.0;
  std::uint32_t max_iterations = 0;
  double minimum_geometry_scale = 0.0;
  bool provenance_present = false;
  std::uint32_t provenance_high = 0;
  std::uint32_t provenance_low = 0;

  ResultCode result_code = ResultCode::invalid_input;
  std::uint32_t iterations = 0;
  double residual = 0.0;
  frame::Vec3 transfer_departure_velocity{};
  frame::Vec3 transfer_arrival_velocity{};
  bool periapsis_present = false;
  double periapsis_radius = 0.0;
  double semi_major_axis = 0.0;
  double eccentricity = 0.0;
};

[[nodiscard]] bool decode_packet(std::span<const double> values, GeometryWire& output) noexcept;
[[nodiscard]] bool encode_packet(const GeometryWire& input, std::span<double> values) noexcept;
[[nodiscard]] GeometryWire evaluate(GeometryWire input) noexcept;

}  // namespace orbit_engine::lambert
