#include "orbit_engine/scheduler.hpp"

#include <cmath>
#include <limits>

namespace orbit_engine::scheduler {
namespace {

bool valid_time(time::TimeWire value) noexcept { return time::from_wire(value).has_value(); }

bool finite(double value) noexcept { return std::isfinite(value); }

}  // namespace

std::uint64_t Scheduler::u64(std::uint32_t high, std::uint32_t low) noexcept {
  return (static_cast<std::uint64_t>(high) << 32U) | low;
}

void Scheduler::words(std::uint64_t value, std::uint32_t& high, std::uint32_t& low) noexcept {
  high = static_cast<std::uint32_t>(value >> 32U);
  low = static_cast<std::uint32_t>(value);
}

Scheduler::WorkRecord Scheduler::from_wire(const WorkWire& value) noexcept {
  return WorkRecord{
    u64(value.id_high, value.id_low),
    u64(value.generation_high, value.generation_low),
    time::from_wire(value.instant).value_or(time::SimulationInstant{}),
    value.phase,
    value.source_kind,
    u64(value.source_id_high, value.source_id_low),
    u64(value.source_ordinal_high, value.source_ordinal_low),
    u64(value.dependency_digest_high, value.dependency_digest_low),
    value.payload_kind,
    u64(value.payload_object_id_high, value.payload_object_id_low),
    u64(value.related_work_id_high, value.related_work_id_low),
    u64(value.related_generation_high, value.related_generation_low),
    value.payload_value,
  };
}

WorkWire Scheduler::to_wire(const WorkRecord& value) noexcept {
  WorkWire result;
  words(value.id, result.id_high, result.id_low);
  words(value.generation, result.generation_high, result.generation_low);
  result.instant = time::to_wire(value.instant);
  result.phase = value.phase;
  result.source_kind = value.source_kind;
  words(value.source_id, result.source_id_high, result.source_id_low);
  words(value.source_ordinal, result.source_ordinal_high, result.source_ordinal_low);
  words(value.dependency_digest, result.dependency_digest_high, result.dependency_digest_low);
  result.payload_kind = value.payload_kind;
  words(value.payload_object_id, result.payload_object_id_high, result.payload_object_id_low);
  words(value.related_work_id, result.related_work_id_high, result.related_work_id_low);
  words(value.related_generation, result.related_generation_high, result.related_generation_low);
  result.payload_value = value.payload_value;
  return result;
}

Scheduler::SortKey Scheduler::key(const WorkRecord& value) noexcept {
  return SortKey{value.instant, value.phase, value.source_kind, value.source_id, value.source_ordinal, value.id};
}

bool Scheduler::SortKey::operator<(const SortKey& other) const noexcept {
  const auto instant_order = time::compare(instant, other.instant);
  if (instant_order != 0) return instant_order < 0;
  if (phase != other.phase) return phase < other.phase;
  if (source_kind != other.source_kind) return source_kind < other.source_kind;
  if (source_id != other.source_id) return source_id < other.source_id;
  if (source_ordinal != other.source_ordinal) return source_ordinal < other.source_ordinal;
  return id < other.id;
}

Scheduler::Scheduler() noexcept = default;

void Scheduler::set_header(SchedulerWire& output) const noexcept {
  output.current_time = time::to_wire(current_time_);
  words(clock_revision_, output.clock_revision_high, output.clock_revision_low);
  words(next_work_id_, output.next_work_id_high, output.next_work_id_low);
}

bool Scheduler::valid_work(const WorkRecord& value) const noexcept {
  return value.id == 0
    && value.generation > 0
    && time::is_normalized(value.instant)
    && value.phase >= 1 && value.phase <= 5
    && value.source_kind > 0
    && value.source_id > 0
    && value.payload_kind > 0
    && finite(value.payload_value);
}

SchedulerWire Scheduler::result(SchedulerWire input, ResultCode code) const noexcept {
  input.result_code = static_cast<std::uint16_t>(code);
  set_header(input);
  return input;
}

SchedulerWire Scheduler::schedule(SchedulerWire input, bool replacing) noexcept {
  auto value = from_wire(input.work);
  if (!valid_work(value)) return result(input, ResultCode::invalid_input);
  if (time::compare(value.instant, current_time_) < 0) return result(input, ResultCode::past_event);
  if (!input.allow_current_time && time::compare(value.instant, current_time_) == 0) {
    return result(input, ResultCode::same_time_rejected);
  }
  if (replacing) {
    const auto existing_id = u64(input.expected_id_high, input.expected_id_low);
    const auto existing_generation = u64(input.expected_generation_high, input.expected_generation_low);
    const auto found = index_.find(existing_id);
    if (found == index_.end()) return result(input, ResultCode::not_found);
    const auto existing = queue_.find(found->second);
    if (existing == queue_.end() || existing->second.generation != existing_generation) {
      return result(input, ResultCode::stale_generation);
    }
    if (existing->second.generation == std::numeric_limits<std::uint64_t>::max()) {
      return result(input, ResultCode::invalid_input);
    }
    value.id = existing_id;
    value.generation = existing_generation + 1;
    queue_.erase(existing);
    index_.erase(found);
  } else {
    if (queue_.size() >= max_scheduled_work_items_) return result(input, ResultCode::capacity_exceeded);
    value.id = next_work_id_++;
    if (next_work_id_ == 0) return result(input, ResultCode::capacity_exceeded);
  }

  const auto ordered = key(value);
  queue_.emplace(ordered, value);
  index_[value.id] = ordered;
  input.result_work_present = true;
  input.result_work = to_wire(value);
  input.result_code = static_cast<std::uint16_t>(ResultCode::success);
  set_header(input);
  return input;
}

SchedulerWire Scheduler::cancel(SchedulerWire input) noexcept {
  const auto id = u64(input.expected_id_high, input.expected_id_low);
  const auto generation = u64(input.expected_generation_high, input.expected_generation_low);
  const auto found = index_.find(id);
  if (found == index_.end()) return result(input, ResultCode::not_found);
  const auto entry = queue_.find(found->second);
  if (entry == queue_.end()) return result(input, ResultCode::not_found);
  if (entry->second.generation != generation) return result(input, ResultCode::stale_generation);
  input.result_work_present = true;
  input.result_work = to_wire(entry->second);
  queue_.erase(entry);
  index_.erase(found);
  input.result_code = static_cast<std::uint16_t>(ResultCode::success);
  set_header(input);
  return input;
}

SchedulerWire Scheduler::list(SchedulerWire input) const noexcept {
  const auto limit = input.list_limit == 0 ? static_cast<std::uint32_t>(kMaxDiagnostics) : input.list_limit;
  if (limit > kMaxDiagnostics) return result(input, ResultCode::invalid_input);
  input.result_count = 0;
  std::uint32_t index = 0;
  for (const auto& [ordered, value] : queue_) {
    (void)ordered;
    if (index++ < input.list_offset) continue;
    if (input.result_count >= limit) break;
    input.results[input.result_count++] = to_wire(value);
  }
  input.result_code = static_cast<std::uint16_t>(ResultCode::success);
  set_header(input);
  return input;
}

SchedulerWire Scheduler::execute_timestamp(SchedulerWire input, const time::SimulationInstant& instant) noexcept {
  const auto queue_snapshot = queue_;
  const auto index_snapshot = index_;
  const auto time_snapshot = current_time_;
  const auto revision_snapshot = clock_revision_;
  const auto next_id_snapshot = next_work_id_;
  const auto work_before = input.processed_work_count;
  std::uint16_t current_phase = 0;
  const auto set_failure = [&](const WorkRecord& value) {
    input.failure_present = true;
    words(value.id, input.failure_id_high, input.failure_id_low);
    words(value.generation, input.failure_generation_high, input.failure_generation_low);
    input.failure_phase = value.phase;
    input.failure_source_kind = value.source_kind;
  };

  const auto rollback = [&](ResultCode code, const WorkRecord* failed) {
    queue_ = queue_snapshot;
    index_ = index_snapshot;
    current_time_ = time_snapshot;
    clock_revision_ = revision_snapshot;
    next_work_id_ = next_id_snapshot;
    input.result_code = static_cast<std::uint16_t>(code);
    input.reached_target = false;
    input.failure_present = failed != nullptr;
    if (failed != nullptr) set_failure(*failed);
    input.processed_work_count = work_before;
    set_header(input);
    return input;
  };

  for (;;) {
    const auto found = queue_.begin();
    if (found == queue_.end() || time::compare(found->second.instant, instant) != 0) {
      current_time_ = instant;
      ++clock_revision_;
      input.result_code = static_cast<std::uint16_t>(ResultCode::success);
      set_header(input);
      return input;
    }
    if (input.processed_work_count - work_before >= max_work_items_per_timestamp_) {
      return rollback(ResultCode::timestamp_budget_exceeded, &found->second);
    }

    const auto item = found->second;
    if (item.phase < current_phase) return rollback(ResultCode::retroactive_earlier_phase, &item);
    current_phase = item.phase;
    queue_.erase(found);
    index_.erase(item.id);
    ++input.processed_work_count;

    const auto payload = static_cast<std::uint16_t>(item.payload_kind);
    if (payload == 2) return rollback(ResultCode::payload_failed, &item);

    if (payload == 3) {
      const auto phase_value = static_cast<double>(item.payload_value);
      if (!std::isfinite(phase_value) || std::trunc(phase_value) != phase_value || phase_value < 1 || phase_value > 5) {
        return rollback(ResultCode::invalid_payload, &item);
      }
      const auto new_phase = static_cast<std::uint16_t>(phase_value);
      if (new_phase < current_phase) return rollback(ResultCode::retroactive_earlier_phase, &item);
      if (queue_.size() >= max_scheduled_work_items_) return rollback(ResultCode::capacity_exceeded, &item);
      if (item.source_ordinal == std::numeric_limits<std::uint64_t>::max()) return rollback(ResultCode::invalid_payload, &item);
      WorkRecord generated{};
      generated.id = next_work_id_++;
      generated.generation = 1;
      generated.instant = instant;
      generated.phase = new_phase;
      generated.source_kind = item.source_kind;
      generated.source_id = item.source_id;
      generated.source_ordinal = item.source_ordinal + 1;
      generated.dependency_digest = item.dependency_digest;
      generated.payload_kind = 1;
      const auto ordered = key(generated);
      queue_.emplace(ordered, generated);
      index_[generated.id] = ordered;
      if (next_work_id_ == 0) return rollback(ResultCode::capacity_exceeded, &item);
    } else if (payload == 4) {
      const auto target = index_.find(item.related_work_id);
      if (target == index_.end()) return rollback(ResultCode::not_found, &item);
      const auto target_entry = queue_.find(target->second);
      if (target_entry == queue_.end() || target_entry->second.generation != item.related_generation) return rollback(ResultCode::stale_generation, &item);
      queue_.erase(target_entry);
      index_.erase(target);
    }
  }
}

SchedulerWire Scheduler::advance(SchedulerWire input, bool by_duration) noexcept {
  std::optional<time::SimulationInstant> target;
  if (by_duration) {
    const auto delta = time::from_wire_duration(input.target_time);
    if (!delta.has_value() || time::compare(*delta, time::Duration{0, 0}) < 0) return result(input, ResultCode::invalid_duration);
    target = time::add(current_time_, *delta);
    if (!target.has_value()) return result(input, ResultCode::invalid_duration);
  } else {
    target = time::from_wire(input.target_time);
    if (!target.has_value()) return result(input, ResultCode::invalid_input);
  }
  input.processed_timestamp_count = 0;
  input.processed_work_count = 0;
  input.reached_target = false;
  input.failure_present = false;
  if (time::compare(*target, current_time_) < 0) return result(input, ResultCode::target_before_current);
  if (time::compare(*target, current_time_) == 0) {
    input.reached_target = true;
    input.result_code = static_cast<std::uint16_t>(ResultCode::success);
    set_header(input);
    return input;
  }

  for (;;) {
    if (time::compare(current_time_, *target) == 0) {
      input.reached_target = true;
      input.result_code = static_cast<std::uint16_t>(ResultCode::success);
      set_header(input);
      return input;
    }
    if (input.processed_timestamp_count >= max_timestamp_transactions_per_advance_) {
      return result(input, ResultCode::advance_budget_exceeded);
    }
    auto next = queue_.begin();
    while (next != queue_.end() && time::compare(next->second.instant, current_time_) <= 0) {
      index_.erase(next->second.id);
      next = queue_.erase(next);
    }
    if (next == queue_.end() || time::compare(next->second.instant, *target) > 0) {
      current_time_ = *target;
      ++clock_revision_;
      input.reached_target = true;
      input.result_code = static_cast<std::uint16_t>(ResultCode::success);
      set_header(input);
      return input;
    }
    const auto timestamp = next->second.instant;
    input = execute_timestamp(input, timestamp);
    if (input.result_code != static_cast<std::uint16_t>(ResultCode::success)) return input;
    ++input.processed_timestamp_count;
  }
}

SchedulerWire Scheduler::command(SchedulerWire input) noexcept {
  const auto operation = static_cast<Operation>(input.operation_code);
  if (operation == Operation::reset) {
    queue_.clear();
    index_.clear();
    current_time_ = time::SimulationInstant{};
    clock_revision_ = 0;
    next_work_id_ = 1;
    max_scheduled_work_items_ = input.max_scheduled_work_items == 0 ? kDefaultMaxScheduledWorkItems : input.max_scheduled_work_items;
    max_work_items_per_timestamp_ = input.max_work_items_per_timestamp == 0 ? kDefaultMaxWorkItemsPerTimestamp : input.max_work_items_per_timestamp;
    max_timestamp_transactions_per_advance_ = input.max_timestamp_transactions_per_advance == 0 ? kDefaultMaxTimestampTransactionsPerAdvance : input.max_timestamp_transactions_per_advance;
    input.result_code = static_cast<std::uint16_t>(ResultCode::success);
    set_header(input);
    return input;
  }
  if (operation == Operation::snapshot) {
    input.result_code = static_cast<std::uint16_t>(ResultCode::success);
    set_header(input);
    return input;
  }
  if (operation == Operation::schedule) return schedule(input, false);
  if (operation == Operation::cancel) return cancel(input);
  if (operation == Operation::replace) return schedule(input, true);
  if (operation == Operation::list) return list(input);
  if (operation == Operation::advance_to) return advance(input, false);
  if (operation == Operation::advance_by) return advance(input, true);
  return result(input, ResultCode::invalid_operation);
}

namespace {

bool valid_word(double value, std::uint32_t& output) noexcept {
  if (!std::isfinite(value) || std::trunc(value) != value || value < 0.0 || value > 4'294'967'295.0) return false;
  output = static_cast<std::uint32_t>(value);
  return true;
}

bool valid_signed_word(double value, std::int32_t& output) noexcept {
  if (!std::isfinite(value) || std::trunc(value) != value || value < -2'147'483'648.0 || value > 2'147'483'647.0) return false;
  output = static_cast<std::int32_t>(value);
  return true;
}

bool read_work(std::span<const double> values, std::size_t& offset, WorkWire& output) noexcept {
  auto word = [&](std::uint32_t& result) { return offset < values.size() && valid_word(values[offset++], result); };
  auto signed_word = [&](std::int32_t& result) { return offset < values.size() && valid_signed_word(values[offset++], result); };
  auto phase = [&](std::uint16_t& result) { std::uint32_t value = 0; if (!word(value) || value > 65'535) return false; result = static_cast<std::uint16_t>(value); return true; };
  return word(output.id_high) && word(output.id_low) && word(output.generation_high) && word(output.generation_low)
    && signed_word(output.instant.seconds_high) && word(output.instant.seconds_low) && word(output.instant.nanoseconds)
    && phase(output.phase) && phase(output.source_kind) && word(output.source_id_high) && word(output.source_id_low)
    && word(output.source_ordinal_high) && word(output.source_ordinal_low) && word(output.dependency_digest_high) && word(output.dependency_digest_low)
    && phase(output.payload_kind) && word(output.payload_object_id_high) && word(output.payload_object_id_low)
    && word(output.related_work_id_high) && word(output.related_work_id_low) && word(output.related_generation_high) && word(output.related_generation_low)
    && offset < values.size() && std::isfinite(values[offset]) && ((output.payload_value = values[offset]), ++offset, true);
}

void write_work(std::span<double> values, std::size_t& offset, const WorkWire& value) noexcept {
  const auto write = [&](double item) { values[offset++] = item; };
  write(value.id_high); write(value.id_low); write(value.generation_high); write(value.generation_low);
  write(value.instant.seconds_high); write(value.instant.seconds_low); write(value.instant.nanoseconds);
  write(value.phase); write(value.source_kind); write(value.source_id_high); write(value.source_id_low);
  write(value.source_ordinal_high); write(value.source_ordinal_low); write(value.dependency_digest_high); write(value.dependency_digest_low);
  write(value.payload_kind); write(value.payload_object_id_high); write(value.payload_object_id_low);
  write(value.related_work_id_high); write(value.related_work_id_low); write(value.related_generation_high); write(value.related_generation_low);
  write(value.payload_value);
}

}  // namespace

bool decode_packet(std::span<const double> values, SchedulerWire& output) noexcept {
  if (values.size() != kInputWords) return false;
  std::size_t offset = 0;
  std::uint32_t value = 0;
  auto word = [&]() { return valid_word(values[offset++], value); };
  auto signed_word = [&](std::int32_t& target) { return valid_signed_word(values[offset++], target); };
  if (!word() || value > 65'535) return false; output.operation_code = static_cast<std::uint16_t>(value);
  if (!word() || value > 65'535) return false; output.result_code = static_cast<std::uint16_t>(value);
  if (!signed_word(output.current_time.seconds_high) || !word()) return false;
  output.current_time.seconds_low = value; if (!word()) return false; output.current_time.nanoseconds = value;
  if (!signed_word(output.target_time.seconds_high) || !word()) return false; output.target_time.seconds_low = value;
  if (!word()) return false; output.target_time.nanoseconds = value;
  if (!word()) return false; output.expected_id_high = value; if (!word()) return false; output.expected_id_low = value;
  if (!word()) return false; output.expected_generation_high = value; if (!word()) return false; output.expected_generation_low = value;
  if (!word()) return false; output.list_offset = value; if (!word()) return false; output.list_limit = value;
  if (!word() || value > 1) return false; output.allow_current_time = value != 0;
  if (!word()) return false; output.max_scheduled_work_items = value;
  if (!word()) return false; output.max_work_items_per_timestamp = value;
  if (!word()) return false; output.max_timestamp_transactions_per_advance = value;
  if (!read_work(values, offset, output.work) || offset != values.size()) return false;
  WorkWire neutral{};
  neutral.phase = 1;
  neutral.source_kind = 1;
  neutral.source_id_low = 1;
  neutral.payload_kind = 1;
  output.result_work = neutral;
  output.results.fill(neutral);
  return true;
}

bool encode_packet(const SchedulerWire& input, std::span<double> values) noexcept {
  if (values.size() != kOutputWords || input.result_count > kMaxDiagnostics) return false;
  std::size_t offset = 0;
  const auto write = [&](double value) { values[offset++] = value; };
  write(input.result_code); write(input.operation_code);
  write(input.current_time.seconds_high); write(input.current_time.seconds_low); write(input.current_time.nanoseconds);
  write(input.clock_revision_high); write(input.clock_revision_low);
  write(input.next_work_id_high); write(input.next_work_id_low);
  write(input.result_work_present ? 1 : 0); write_work(values, offset, input.result_work);
  write(input.result_count);
  for (std::size_t index = 0; index < kMaxDiagnostics; ++index) write_work(values, offset, input.results[index]);
  write(input.processed_timestamp_count); write(input.processed_work_count); write(input.reached_target ? 1 : 0); write(input.failure_present ? 1 : 0);
  write(input.failure_id_high); write(input.failure_id_low); write(input.failure_generation_high); write(input.failure_generation_low);
  write(input.failure_phase); write(input.failure_source_kind);
  return offset == values.size();
}

}  // namespace orbit_engine::scheduler
