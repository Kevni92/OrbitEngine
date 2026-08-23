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

orbit_engine::scheduler::SchedulerWire command(
  orbit_engine::scheduler::Scheduler& scheduler,
  orbit_engine::scheduler::Operation operation
) {
  orbit_engine::scheduler::SchedulerWire value{};
  value.operation_code = static_cast<std::uint16_t>(operation);
  value.work.phase = 1;
  value.work.source_kind = 1;
  value.work.source_id_low = 1;
  value.work.payload_kind = 1;
  value.result_work.phase = 1;
  value.result_work.source_kind = 1;
  value.result_work.source_id_low = 1;
  value.result_work.payload_kind = 1;
  for (auto& item : value.results) item = value.result_work;
  return scheduler.command(value);
}

orbit_engine::scheduler::WorkWire work(std::int64_t seconds, std::uint32_t nanoseconds, std::uint16_t phase, std::uint32_t source_id) {
  orbit_engine::scheduler::WorkWire value{};
  value.generation_low = 1;
  value.instant = orbit_engine::time::to_wire(orbit_engine::time::SimulationInstant{seconds, nanoseconds});
  value.phase = phase;
  value.source_kind = 2;
  value.source_id_low = source_id;
  value.payload_kind = 1;
  return value;
}

}  // namespace

int main() {
  orbit_engine::scheduler::Scheduler scheduler;
  auto reset = command(scheduler, orbit_engine::scheduler::Operation::reset);
  CHECK(reset.result_code == 0);
  CHECK(reset.next_work_id_low == 1);

  auto first = command(scheduler, orbit_engine::scheduler::Operation::schedule);
  first.work = work(2, 0, 5, 9);
  first = scheduler.command(first);
  CHECK(first.result_code == 0);
  CHECK(first.result_work_present);
  CHECK(first.result_work.id_low == 1);

  auto second = first;
  second.operation_code = static_cast<std::uint16_t>(orbit_engine::scheduler::Operation::schedule);
  second.work = work(2, 0, 1, 9);
  second = scheduler.command(second);
  CHECK(second.result_code == 0);
  CHECK(second.result_work.id_low == 2);

  auto list = command(scheduler, orbit_engine::scheduler::Operation::list);
  list.list_limit = 64;
  list = scheduler.command(list);
  CHECK(list.result_code == 0);
  CHECK(list.result_count == 2);
  CHECK(list.results[0].id_low == 2);
  CHECK(list.results[1].id_low == 1);

  auto past = command(scheduler, orbit_engine::scheduler::Operation::schedule);
  past.work = work(-1, 999'999'999, 1, 9);
  past = scheduler.command(past);
  CHECK(past.result_code == static_cast<std::uint16_t>(orbit_engine::scheduler::ResultCode::past_event));

  auto current = command(scheduler, orbit_engine::scheduler::Operation::schedule);
  current.work = work(0, 0, 1, 9);
  current = scheduler.command(current);
  CHECK(current.result_code == static_cast<std::uint16_t>(orbit_engine::scheduler::ResultCode::same_time_rejected));

  auto cancel = command(scheduler, orbit_engine::scheduler::Operation::cancel);
  cancel.expected_id_low = 2;
  cancel.expected_generation_low = 1;
  cancel = scheduler.command(cancel);
  CHECK(cancel.result_code == 0);
  CHECK(cancel.result_work.id_low == 2);

  auto stale = cancel;
  stale.expected_generation_low = 1;
  stale = scheduler.command(stale);
  CHECK(stale.result_code == static_cast<std::uint16_t>(orbit_engine::scheduler::ResultCode::not_found));
  return 0;
}
