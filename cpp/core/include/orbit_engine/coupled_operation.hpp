#pragma once

#include "orbit_engine/coupled.hpp"

#include <array>
#include <cstdint>
#include <span>

namespace orbit_engine::coupled_operation {

inline constexpr std::size_t kMaxMembers = 32;
inline constexpr std::size_t kMemberWords = 23;
inline constexpr std::size_t kInputWords = 31 + kMaxMembers * kMemberWords + kMaxMembers * 2;
inline constexpr std::size_t kOutputWords = 9 + kMaxMembers * kMemberWords;

enum class OperationCode : std::uint16_t { promote = 1, evaluate = 2, demote = 3, remove = 4 };
enum class ResultCode : std::uint16_t {
  success = 0,
  invalid_input = 1,
  invalid_membership = 2,
  invalid_configuration = 3,
  unsupported_temporal_direction = 4,
  numerical_failure = 5,
  transaction_rejected = 6,
};

struct MemberWire {
  std::uint32_t object_id_high = 0;
  std::uint32_t object_id_low = 0;
  time::TimeWire epoch{};
  std::uint32_t frame_high = 0;
  std::uint32_t frame_low = 0;
  double position_x = 0.0;
  double position_y = 0.0;
  double position_z = 0.0;
  double velocity_x = 0.0;
  double velocity_y = 0.0;
  double velocity_z = 0.0;
  bool mass_present = false;
  double mass = 0.0;
  bool mu_present = false;
  double mu = 0.0;
  std::uint32_t motion_revision_high = 0;
  std::uint32_t motion_revision_low = 0;
  std::uint32_t property_revision_high = 0;
  std::uint32_t property_revision_low = 0;
  std::uint32_t mass_revision_high = 0;
  std::uint32_t mass_revision_low = 0;
};

struct CoupledWire {
  std::uint16_t result_code = 0;
  std::uint16_t operation_code = 0;
  time::TimeWire target_epoch{};
  std::uint32_t authority_id_high = 0;
  std::uint32_t authority_id_low = 0;
  std::uint32_t group_revision_high = 0;
  std::uint32_t group_revision_low = 0;
  std::uint32_t member_count = 0;
  std::array<MemberWire, kMaxMembers> members{};
  std::uint32_t requested_count = 0;
  std::array<std::uint32_t, kMaxMembers> requested_id_high{};
  std::array<std::uint32_t, kMaxMembers> requested_id_low{};
  std::uint32_t configuration_revision_high = 0;
  std::uint32_t configuration_revision_low = 0;
  double relative_tolerance = 0.0;
  double position_absolute_tolerance_meters = 0.0;
  double velocity_absolute_tolerance_meters_per_second = 0.0;
  double mass_absolute_tolerance_kilograms = 0.0;
  std::uint32_t checkpoint_stride_accepted_steps = 0;
  std::uint32_t max_checkpoint_count = 0;
  std::uint32_t max_dense_step_count = 0;
  std::uint32_t max_accepted_steps_per_extension = 0;
  std::uint32_t max_rejected_steps_per_extension = 0;
  time::TimeWire min_step{};
  time::TimeWire max_step{};
  double constant_acceleration_x = 0.0;
  double constant_acceleration_y = 0.0;
  double constant_acceleration_z = 0.0;
  std::uint32_t result_count = 0;
  std::array<MemberWire, kMaxMembers> results{};
  std::uint32_t shared_evaluation_count_high = 0;
  std::uint32_t shared_evaluation_count_low = 0;
};

[[nodiscard]] bool decode_packet(std::span<const double> values, CoupledWire& output) noexcept;
[[nodiscard]] bool encode_packet(const CoupledWire& input, std::span<double> values) noexcept;
[[nodiscard]] CoupledWire evaluate(CoupledWire input);

}  // namespace orbit_engine::coupled_operation
