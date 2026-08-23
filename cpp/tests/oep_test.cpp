#include "orbit_engine/oep.hpp"

#include <array>
#include <bit>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <iostream>
#include <vector>

#define CHECK(condition) \
  do { \
    if (!(condition)) { \
      std::cerr << "check failed: " #condition "\n"; \
      return 1; \
    } \
  } while (false)

namespace {

void u16(std::vector<std::uint8_t>& bytes, std::uint16_t value) {
  bytes.push_back(static_cast<std::uint8_t>(value));
  bytes.push_back(static_cast<std::uint8_t>(value >> 8U));
}

void u32(std::vector<std::uint8_t>& bytes, std::uint32_t value) {
  for (unsigned shift = 0; shift < 32; shift += 8) bytes.push_back(static_cast<std::uint8_t>(value >> shift));
}

void u64(std::vector<std::uint8_t>& bytes, std::uint64_t value) {
  for (unsigned shift = 0; shift < 64; shift += 8) bytes.push_back(static_cast<std::uint8_t>(value >> shift));
}

void f64(std::vector<std::uint8_t>& bytes, double value) {
  u64(bytes, std::bit_cast<std::uint64_t>(value));
}

void time_value(std::vector<std::uint8_t>& bytes, std::int64_t seconds, std::uint32_t nanoseconds = 0) {
  const auto wire = orbit_engine::time::to_wire(orbit_engine::time::SimulationInstant{seconds, nanoseconds});
  u32(bytes, std::bit_cast<std::uint32_t>(wire.seconds_high));
  u32(bytes, wire.seconds_low);
  u32(bytes, wire.nanoseconds);
}

orbit_engine::time::TimeWire instant_wire(std::int64_t seconds) {
  return orbit_engine::time::to_wire(orbit_engine::time::SimulationInstant{seconds, 0});
}

void raw(std::vector<std::uint8_t>& bytes, const char* value) {
  bytes.insert(bytes.end(), value, value + std::strlen(value));
}

void coefficient_series(std::vector<std::uint8_t>& bytes, std::initializer_list<double> coefficients) {
  for (const auto coefficient : coefficients) f64(bytes, coefficient);
}

std::vector<std::uint8_t> shard() {
  constexpr std::uint32_t first_offset = 152;
  constexpr std::uint32_t first_bytes = 48;
  constexpr std::uint32_t second_offset = first_offset + first_bytes;
  constexpr std::uint32_t second_bytes = 96;
  constexpr std::uint32_t total_bytes = second_offset + second_bytes;

  std::vector<std::uint8_t> bytes;
  bytes.reserve(total_bytes);
  raw(bytes, "OEPB");
  u16(bytes, 1);
  u16(bytes, 0);
  u32(bytes, total_bytes);
  u32(bytes, 2);
  u64(bytes, 0);

  u32(bytes, 1);
  u16(bytes, static_cast<std::uint16_t>(orbit_engine::oep::Representation::position_chebyshev));
  u16(bytes, 3);
  time_value(bytes, -10);
  time_value(bytes, 10);
  f64(bytes, 0.0);
  f64(bytes, 10.0);
  u32(bytes, 2);
  u32(bytes, first_offset);
  u32(bytes, first_bytes);
  u32(bytes, 0);

  u32(bytes, 2);
  u16(bytes, static_cast<std::uint16_t>(orbit_engine::oep::Representation::state_chebyshev));
  u16(bytes, 6);
  time_value(bytes, -5);
  time_value(bytes, 5);
  f64(bytes, 0.0);
  f64(bytes, 5.0);
  u32(bytes, 2);
  u32(bytes, second_offset);
  u32(bytes, second_bytes);
  u32(bytes, 0);

  coefficient_series(bytes, {100.0, 20.0});
  coefficient_series(bytes, {0.0, 0.0});
  coefficient_series(bytes, {0.0, 0.0});
  coefficient_series(bytes, {10.0, 5.0});
  coefficient_series(bytes, {20.0, 0.0});
  coefficient_series(bytes, {30.0, 0.0});
  coefficient_series(bytes, {1.0, 0.5});
  coefficient_series(bytes, {2.0, 0.0});
  coefficient_series(bytes, {3.0, 0.0});
  return bytes;
}

std::vector<std::uint8_t> load_payload(bool corrupt_checksum = false) {
  static constexpr std::array<std::uint8_t, 32> shard_hash{
    0xdf, 0x9b, 0x3e, 0xcf, 0xa7, 0x83, 0x34, 0xc3,
    0xb0, 0xc6, 0x25, 0x17, 0x46, 0x23, 0xd6, 0x98,
    0x80, 0x39, 0x0f, 0x8d, 0x05, 0x0e, 0x89, 0xd1,
    0x51, 0x37, 0x7e, 0x9c, 0xe8, 0xc6, 0xad, 0xbf,
  };
  const auto shard_bytes = shard();
  constexpr char dataset_id[] = "synthetic";
  constexpr char dataset_version[] = "1";
  constexpr char policy[] = "test";
  constexpr char shard_id[] = "system";

  std::vector<std::uint8_t> bytes;
  raw(bytes, "OEPL");
  u16(bytes, 1);
  u16(bytes, 0);
  u32(bytes, sizeof(dataset_id) - 1);
  u32(bytes, sizeof(dataset_version) - 1);
  u32(bytes, sizeof(policy) - 1);
  u32(bytes, 2);
  u32(bytes, 1);
  for (std::uint8_t index = 0; index < 32; ++index) bytes.push_back(static_cast<std::uint8_t>(index + 1));
  raw(bytes, dataset_id);
  raw(bytes, dataset_version);
  raw(bytes, policy);

  u32(bytes, 1);
  u32(bytes, 0);
  u16(bytes, static_cast<std::uint16_t>(orbit_engine::oep::Representation::position_chebyshev));
  u16(bytes, 1);
  time_value(bytes, -10);
  time_value(bytes, 10);
  u64(bytes, 7);
  f64(bytes, 0.01);
  f64(bytes, 0.001);

  u32(bytes, 2);
  u32(bytes, 1);
  u16(bytes, static_cast<std::uint16_t>(orbit_engine::oep::Representation::state_chebyshev));
  u16(bytes, 1);
  time_value(bytes, -5);
  time_value(bytes, 5);
  u64(bytes, 11);
  f64(bytes, 0.02);
  f64(bytes, 0.002);

  u32(bytes, sizeof(shard_id) - 1);
  u32(bytes, static_cast<std::uint32_t>(shard_bytes.size()));
  for (std::size_t index = 0; index < shard_hash.size(); ++index) {
    bytes.push_back(corrupt_checksum && index == 0 ? static_cast<std::uint8_t>(shard_hash[index] ^ 0xffU) : shard_hash[index]);
  }
  raw(bytes, shard_id);
  bytes.insert(bytes.end(), shard_bytes.begin(), shard_bytes.end());
  return bytes;
}

std::uint64_t handle(const orbit_engine::oep::DatasetInfoWire& wire) {
  return (static_cast<std::uint64_t>(wire.handle_high) << 32U) | wire.handle_low;
}

bool close(double left, double right) {
  return std::abs(left - right) <= 1.0e-12;
}

}  // namespace

int main() {
  using orbit_engine::oep::EvaluationMode;
  using orbit_engine::oep::ResultCode;

  orbit_engine::oep::Registry registry;
  const auto payload = load_payload();
  const auto loaded = registry.load(payload);
  CHECK(loaded.result_code == static_cast<std::uint16_t>(ResultCode::success));
  CHECK(loaded.source_count == 2);
  CHECK(handle(loaded) != 0);

  const auto source = registry.source_info(handle(loaded), 2);
  CHECK(source.result_code == static_cast<std::uint16_t>(ResultCode::success));
  CHECK(source.center_source_node_id == 1);
  const auto effective_start = orbit_engine::time::from_wire(source.effective_validity_start);
  const auto effective_end = orbit_engine::time::from_wire(source.effective_validity_end);
  CHECK(effective_start.has_value() && effective_start->seconds == -5);
  CHECK(effective_end.has_value() && effective_end->seconds == 5);

  const auto center = registry.evaluate(
    handle(loaded), 1, EvaluationMode::relative_to_center, instant_wire(0)
  );
  CHECK(center.result_code == static_cast<std::uint16_t>(ResultCode::success));
  CHECK(close(center.position_x, 100.0));
  CHECK(close(center.velocity_x, 2.0));

  const auto relative = registry.evaluate(
    handle(loaded), 2, EvaluationMode::relative_to_center, instant_wire(0)
  );
  CHECK(relative.result_code == static_cast<std::uint16_t>(ResultCode::success));
  CHECK(close(relative.position_x, 10.0));
  CHECK(close(relative.position_y, 20.0));
  CHECK(close(relative.position_z, 30.0));
  CHECK(close(relative.velocity_x, 1.0));
  CHECK(close(relative.velocity_y, 2.0));
  CHECK(close(relative.velocity_z, 3.0));

  const auto root = registry.evaluate(
    handle(loaded), 2, EvaluationMode::root_ssb, instant_wire(0)
  );
  CHECK(root.result_code == static_cast<std::uint16_t>(ResultCode::success));
  CHECK(close(root.position_x, 110.0));
  CHECK(close(root.position_y, 20.0));
  CHECK(close(root.position_z, 30.0));
  CHECK(close(root.velocity_x, 3.0));

  const auto negative_boundary = registry.evaluate(
    handle(loaded), 2, EvaluationMode::relative_to_center, instant_wire(-5)
  );
  CHECK(negative_boundary.result_code == static_cast<std::uint16_t>(ResultCode::success));
  CHECK(close(negative_boundary.position_x, 5.0));
  CHECK(close(negative_boundary.velocity_x, 0.5));

  const auto end_boundary = registry.evaluate(
    handle(loaded), 2, EvaluationMode::relative_to_center, instant_wire(5)
  );
  CHECK(end_boundary.result_code == static_cast<std::uint16_t>(ResultCode::source_out_of_range));

  const auto second = registry.load(payload);
  CHECK(second.result_code == static_cast<std::uint16_t>(ResultCode::success));
  CHECK(second.dataset_revision_high == loaded.dataset_revision_high);
  CHECK(second.dataset_revision_low == loaded.dataset_revision_low);
  const auto second_source = registry.source_info(handle(second), 2);
  CHECK(second_source.source_revision_high == source.source_revision_high);
  CHECK(second_source.source_revision_low == source.source_revision_low);
  CHECK(registry.unload(handle(second)).result_code == static_cast<std::uint16_t>(ResultCode::success));

  CHECK(registry.retain(handle(loaded)).result_code == static_cast<std::uint16_t>(ResultCode::success));
  CHECK(registry.unload(handle(loaded)).result_code == static_cast<std::uint16_t>(ResultCode::dataset_in_use));
  CHECK(registry.release_reference(handle(loaded)).result_code == static_cast<std::uint16_t>(ResultCode::success));

  const auto corrupt = registry.load(load_payload(true));
  CHECK(corrupt.result_code == static_cast<std::uint16_t>(ResultCode::checksum_mismatch));

  auto bad_magic = payload;
  bad_magic[0] = 'X';
  CHECK(registry.load(bad_magic).result_code == static_cast<std::uint16_t>(ResultCode::bad_magic));

  auto bad_schema = payload;
  bad_schema[4] = 2;
  CHECK(registry.load(bad_schema).result_code == static_cast<std::uint16_t>(ResultCode::unsupported_schema));

  auto truncated = payload;
  truncated.resize(20);
  CHECK(registry.load(truncated).result_code == static_cast<std::uint16_t>(ResultCode::truncated));

  CHECK(registry.unload(handle(loaded)).result_code == static_cast<std::uint16_t>(ResultCode::success));
  return 0;
}
