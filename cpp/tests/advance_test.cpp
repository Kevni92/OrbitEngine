#include "orbit_engine/scheduler.hpp"

#include <iostream>

#define CHECK(condition) \
  do { \
    if (!(condition)) { \
      std::cerr << "check failed: " #condition "\n"; \
      return 1; \
    } \
  } while (false)

namespace {

orbit_engine::scheduler::SchedulerWire wire(orbit_engine::scheduler::Operation operation) {
  orbit_engine::scheduler::SchedulerWire value{};
  value.operation_code = static_cast<std::uint16_t>(operation);
  value.work.phase = 1; value.work.source_kind = 1; value.work.source_id_low = 1; value.work.payload_kind = 1;
  value.result_work.phase = 1; value.result_work.source_kind = 1; value.result_work.source_id_low = 1; value.result_work.payload_kind = 1;
  for (auto& item : value.results) item = value.result_work;
  return value;
}

orbit_engine::scheduler::WorkWire work(std::int64_t seconds, std::uint16_t phase, std::uint16_t payload_kind, double payload_value = 0.0) {
  orbit_engine::scheduler::WorkWire value{};
  value.generation_low = 1;
  value.instant = orbit_engine::time::to_wire(orbit_engine::time::SimulationInstant{seconds, 0});
  value.phase = phase; value.source_kind = 2; value.source_id_low = 7; value.payload_kind = payload_kind; value.payload_value = payload_value;
  return value;
}

orbit_engine::scheduler::SchedulerWire reset(orbit_engine::scheduler::Scheduler& scheduler, std::uint32_t max_work = 0, std::uint32_t max_timestamps = 0) {
  auto value = wire(orbit_engine::scheduler::Operation::reset);
  value.max_work_items_per_timestamp = max_work;
  value.max_timestamp_transactions_per_advance = max_timestamps;
  return scheduler.command(value);
}

orbit_engine::scheduler::SchedulerWire schedule(orbit_engine::scheduler::Scheduler& scheduler, orbit_engine::scheduler::WorkWire value) {
  auto input = wire(orbit_engine::scheduler::Operation::schedule);
  input.work = value;
  return scheduler.command(input);
}

orbit_engine::scheduler::SchedulerWire advance(orbit_engine::scheduler::Scheduler& scheduler, std::int64_t target) {
  auto input = wire(orbit_engine::scheduler::Operation::advance_to);
  input.target_time = orbit_engine::time::to_wire(orbit_engine::time::SimulationInstant{target, 0});
  return scheduler.command(input);
}

}  // namespace

int main() {
  orbit_engine::scheduler::Scheduler scheduler;
  CHECK(reset(scheduler).result_code == 0);
  CHECK(schedule(scheduler, work(2, 2, 1)).result_code == 0);
  auto result = advance(scheduler, 5);
  CHECK(result.result_code == 0 && result.reached_target);
  CHECK(result.processed_timestamp_count == 1 && result.processed_work_count == 1);
  CHECK(result.current_time.seconds_low == 5);

  CHECK(reset(scheduler).result_code == 0);
  CHECK(schedule(scheduler, work(2, 2, 3, 2)).result_code == 0);
  result = advance(scheduler, 2);
  CHECK(result.result_code == 0 && result.processed_work_count == 2);

  CHECK(reset(scheduler).result_code == 0);
  CHECK(schedule(scheduler, work(2, 2, 2)).result_code == 0);
  result = advance(scheduler, 5);
  CHECK(result.result_code == static_cast<std::uint16_t>(orbit_engine::scheduler::ResultCode::payload_failed));
  CHECK(result.current_time.seconds_high == 0 && result.current_time.seconds_low == 0);
  CHECK(result.failure_present && result.failure_id_low == 1);
  auto remaining = wire(orbit_engine::scheduler::Operation::list);
  remaining.list_limit = 64;
  remaining = scheduler.command(remaining);
  CHECK(remaining.result_count == 1 && remaining.results[0].id_low == 1);

  CHECK(reset(scheduler, 1).result_code == 0);
  CHECK(schedule(scheduler, work(2, 2, 1)).result_code == 0);
  CHECK(schedule(scheduler, work(2, 2, 1)).result_code == 0);
  result = advance(scheduler, 2);
  CHECK(result.result_code == static_cast<std::uint16_t>(orbit_engine::scheduler::ResultCode::timestamp_budget_exceeded));
  CHECK(result.current_time.seconds_high == 0 && result.current_time.seconds_low == 0);
  return 0;
}
