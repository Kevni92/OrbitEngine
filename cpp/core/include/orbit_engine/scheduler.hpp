#pragma once

#include "orbit_engine/time.hpp"

#include <array>
#include <cstdint>
#include <map>
#include <span>

namespace orbit_engine::scheduler {

inline constexpr std::uint32_t kDefaultMaxScheduledWorkItems = 1'000'000;
inline constexpr std::uint32_t kDefaultMaxWorkItemsPerTimestamp = 4'096;
inline constexpr std::uint32_t kDefaultMaxTimestampTransactionsPerAdvance = 1'000'000;
inline constexpr std::size_t kMaxDiagnostics = 64;
inline constexpr std::size_t kWorkWords = 23;
inline constexpr std::size_t kInputWords = 41;
inline constexpr std::size_t kOutputWords = 2 + 3 + 2 + 2 + 1 + kWorkWords + 1 + kMaxDiagnostics * kWorkWords + 2 + 2 + 1 + 1 + 2 + 2;

enum class Operation : std::uint16_t {
  reset = 0,
  snapshot = 1,
  schedule = 2,
  cancel = 3,
  replace = 4,
  list = 5,
  advance_to = 6,
  advance_by = 7,
};

enum class ResultCode : std::uint16_t {
  success = 0,
  invalid_input = 1,
  past_event = 2,
  same_time_rejected = 3,
  capacity_exceeded = 4,
  not_found = 5,
  stale_generation = 6,
  invalid_phase = 7,
  invalid_payload = 8,
  invalid_operation = 9,
  target_before_current = 10,
  advance_budget_exceeded = 11,
  timestamp_budget_exceeded = 12,
  transaction_failed = 13,
  retroactive_earlier_phase = 14,
  payload_failed = 15,
  invalid_duration = 16,
};

struct WorkWire {
  std::uint32_t id_high = 0;
  std::uint32_t id_low = 0;
  std::uint32_t generation_high = 0;
  std::uint32_t generation_low = 0;
  time::TimeWire instant{};
  std::uint16_t phase = 0;
  std::uint16_t source_kind = 0;
  std::uint32_t source_id_high = 0;
  std::uint32_t source_id_low = 0;
  std::uint32_t source_ordinal_high = 0;
  std::uint32_t source_ordinal_low = 0;
  std::uint32_t dependency_digest_high = 0;
  std::uint32_t dependency_digest_low = 0;
  std::uint16_t payload_kind = 0;
  std::uint32_t payload_object_id_high = 0;
  std::uint32_t payload_object_id_low = 0;
  std::uint32_t related_work_id_high = 0;
  std::uint32_t related_work_id_low = 0;
  std::uint32_t related_generation_high = 0;
  std::uint32_t related_generation_low = 0;
  double payload_value = 0.0;
};

struct SchedulerWire {
  std::uint16_t operation_code = 0;
  std::uint16_t result_code = 0;
  time::TimeWire current_time{};
  time::TimeWire target_time{};
  std::uint32_t expected_id_high = 0;
  std::uint32_t expected_id_low = 0;
  std::uint32_t expected_generation_high = 0;
  std::uint32_t expected_generation_low = 0;
  std::uint32_t list_offset = 0;
  std::uint32_t list_limit = 0;
  bool allow_current_time = false;
  std::uint32_t max_scheduled_work_items = 0;
  std::uint32_t max_work_items_per_timestamp = 0;
  std::uint32_t max_timestamp_transactions_per_advance = 0;
  WorkWire work{};
  std::uint32_t clock_revision_high = 0;
  std::uint32_t clock_revision_low = 0;
  std::uint32_t next_work_id_high = 0;
  std::uint32_t next_work_id_low = 0;
  bool result_work_present = false;
  WorkWire result_work{};
  std::uint32_t result_count = 0;
  std::array<WorkWire, kMaxDiagnostics> results{};
  std::uint32_t processed_timestamp_count = 0;
  std::uint32_t processed_work_count = 0;
  bool reached_target = false;
  bool failure_present = false;
  std::uint32_t failure_id_high = 0;
  std::uint32_t failure_id_low = 0;
  std::uint32_t failure_generation_high = 0;
  std::uint32_t failure_generation_low = 0;
  std::uint16_t failure_phase = 0;
  std::uint16_t failure_source_kind = 0;
};

[[nodiscard]] bool decode_packet(std::span<const double> values, SchedulerWire& output) noexcept;
[[nodiscard]] bool encode_packet(const SchedulerWire& input, std::span<double> values) noexcept;

class Scheduler {
public:
  Scheduler() noexcept;

  [[nodiscard]] SchedulerWire command(SchedulerWire input) noexcept;

private:
  struct WorkRecord {
    std::uint64_t id = 0;
    std::uint64_t generation = 0;
    time::SimulationInstant instant{};
    std::uint16_t phase = 0;
    std::uint16_t source_kind = 0;
    std::uint64_t source_id = 0;
    std::uint64_t source_ordinal = 0;
    std::uint64_t dependency_digest = 0;
    std::uint16_t payload_kind = 0;
    std::uint64_t payload_object_id = 0;
    std::uint64_t related_work_id = 0;
    std::uint64_t related_generation = 0;
    double payload_value = 0.0;
  };

  struct SortKey {
    time::SimulationInstant instant{};
    std::uint16_t phase = 0;
    std::uint16_t source_kind = 0;
    std::uint64_t source_id = 0;
    std::uint64_t source_ordinal = 0;
    std::uint64_t id = 0;

    [[nodiscard]] bool operator<(const SortKey& other) const noexcept;
  };

  std::map<SortKey, WorkRecord> queue_;
  std::map<std::uint64_t, SortKey> index_;
  time::SimulationInstant current_time_{};
  std::uint64_t clock_revision_ = 0;
  std::uint64_t next_work_id_ = 1;
  std::uint32_t max_scheduled_work_items_ = kDefaultMaxScheduledWorkItems;
  std::uint32_t max_work_items_per_timestamp_ = kDefaultMaxWorkItemsPerTimestamp;
  std::uint32_t max_timestamp_transactions_per_advance_ = kDefaultMaxTimestampTransactionsPerAdvance;

  [[nodiscard]] static WorkRecord from_wire(const WorkWire& value) noexcept;
  [[nodiscard]] static WorkWire to_wire(const WorkRecord& value) noexcept;
  [[nodiscard]] static SortKey key(const WorkRecord& value) noexcept;
  [[nodiscard]] static std::uint64_t u64(std::uint32_t high, std::uint32_t low) noexcept;
  static void words(std::uint64_t value, std::uint32_t& high, std::uint32_t& low) noexcept;
  void set_header(SchedulerWire& output) const noexcept;
  [[nodiscard]] bool valid_work(const WorkRecord& value) const noexcept;
  [[nodiscard]] SchedulerWire result(SchedulerWire input, ResultCode code) const noexcept;
  [[nodiscard]] SchedulerWire schedule(SchedulerWire input, bool replacing) noexcept;
  [[nodiscard]] SchedulerWire cancel(SchedulerWire input) noexcept;
  [[nodiscard]] SchedulerWire list(SchedulerWire input) const noexcept;
  [[nodiscard]] SchedulerWire advance(SchedulerWire input, bool by_duration) noexcept;
  [[nodiscard]] SchedulerWire execute_timestamp(SchedulerWire input, const time::SimulationInstant& instant) noexcept;
};

}  // namespace orbit_engine::scheduler
