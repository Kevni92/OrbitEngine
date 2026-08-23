#include "orbit_engine/oep.hpp"

#include <algorithm>
#include <array>
#include <bit>
#include <cmath>
#include <cstring>
#include <functional>
#include <limits>
#include <set>

namespace orbit_engine::oep {
namespace {

constexpr std::array<std::uint8_t, 4> kLoadMagic{'O', 'E', 'P', 'L'};
constexpr std::array<std::uint8_t, 4> kShardMagic{'O', 'E', 'P', 'B'};
constexpr std::size_t kShardHeaderBytes = 24;
constexpr std::size_t kRecordHeaderBytes = 64;
constexpr std::uint16_t kCanonicalAxesCode = 1;
constexpr std::size_t kSha256Bytes = 32;
constexpr std::uint32_t kMaxSourceCount = 1'000'000;
constexpr std::uint32_t kMaxShardCount = 100'000;
constexpr std::uint32_t kMaxStringBytes = 1U << 20U;

struct Reader {
  std::span<const std::uint8_t> bytes;
  std::size_t offset = 0;

  [[nodiscard]] bool take(std::size_t count, std::span<const std::uint8_t>& output) noexcept {
    if (count > bytes.size() - std::min(offset, bytes.size())) return false;
    output = bytes.subspan(offset, count);
    offset += count;
    return true;
  }

  [[nodiscard]] bool u16(std::uint16_t& output) noexcept {
    std::span<const std::uint8_t> value;
    if (!take(2, value)) return false;
    output = static_cast<std::uint16_t>(value[0])
      | static_cast<std::uint16_t>(static_cast<std::uint16_t>(value[1]) << 8U);
    return true;
  }

  [[nodiscard]] bool u32(std::uint32_t& output) noexcept {
    std::span<const std::uint8_t> value;
    if (!take(4, value)) return false;
    output = static_cast<std::uint32_t>(value[0])
      | (static_cast<std::uint32_t>(value[1]) << 8U)
      | (static_cast<std::uint32_t>(value[2]) << 16U)
      | (static_cast<std::uint32_t>(value[3]) << 24U);
    return true;
  }

  [[nodiscard]] bool u64(std::uint64_t& output) noexcept {
    std::span<const std::uint8_t> value;
    if (!take(8, value)) return false;
    output = 0;
    for (std::size_t index = 0; index < 8; ++index) {
      output |= static_cast<std::uint64_t>(value[index]) << static_cast<unsigned>(index * 8U);
    }
    return true;
  }

  [[nodiscard]] bool f64(double& output) noexcept {
    std::uint64_t bits = 0;
    if (!u64(bits)) return false;
    output = std::bit_cast<double>(bits);
    return true;
  }

  [[nodiscard]] bool time_value(time::SimulationInstant& output) noexcept {
    std::uint32_t high_bits = 0;
    std::uint32_t low = 0;
    std::uint32_t nanoseconds = 0;
    if (!u32(high_bits) || !u32(low) || !u32(nanoseconds)) return false;
    const auto high = std::bit_cast<std::int32_t>(high_bits);
    const auto result = time::from_wire(time::TimeWire{high, low, nanoseconds});
    if (!result.has_value()) return false;
    output = *result;
    return true;
  }
};

[[nodiscard]] bool same_time(time::SimulationInstant left, time::SimulationInstant right) noexcept {
  return time::compare(left, right) == 0;
}

[[nodiscard]] bool contains(
  time::SimulationInstant start,
  time::SimulationInstant end,
  time::SimulationInstant target
) noexcept {
  return time::compare(target, start) >= 0 && time::compare(target, end) < 0;
}

[[nodiscard]] std::uint64_t words_to_u64(std::uint32_t high, std::uint32_t low) noexcept {
  return (static_cast<std::uint64_t>(high) << 32U) | static_cast<std::uint64_t>(low);
}

void u64_to_words(std::uint64_t value, std::uint32_t& high, std::uint32_t& low) noexcept {
  high = static_cast<std::uint32_t>(value >> 32U);
  low = static_cast<std::uint32_t>(value & 0xffff'ffffULL);
}

[[nodiscard]] std::uint64_t fnv1a64(std::span<const std::uint8_t> bytes, std::uint64_t hash = 14695981039346656037ULL) noexcept {
  for (const auto value : bytes) {
    hash ^= value;
    hash *= 1099511628211ULL;
  }
  return hash;
}

[[nodiscard]] std::uint64_t fnv1a64_string(const std::string& value, std::uint64_t hash) noexcept {
  return fnv1a64(std::span<const std::uint8_t>(reinterpret_cast<const std::uint8_t*>(value.data()), value.size()), hash);
}

[[nodiscard]] std::uint64_t mix_revision(std::uint64_t dataset_revision, std::uint64_t source_revision) noexcept {
  std::array<std::uint8_t, 16> bytes{};
  for (std::size_t index = 0; index < 8; ++index) {
    bytes[index] = static_cast<std::uint8_t>((dataset_revision >> (index * 8U)) & 0xffU);
    bytes[8 + index] = static_cast<std::uint8_t>((source_revision >> (index * 8U)) & 0xffU);
  }
  return fnv1a64(bytes);
}

[[nodiscard]] std::uint32_t rotate_right(std::uint32_t value, unsigned shift) noexcept {
  return std::rotr(value, static_cast<int>(shift));
}

[[nodiscard]] std::array<std::uint8_t, kSha256Bytes> sha256(std::span<const std::uint8_t> input) noexcept {
  static constexpr std::array<std::uint32_t, 64> k{
    0x428a2f98U, 0x71374491U, 0xb5c0fbcfU, 0xe9b5dba5U, 0x3956c25bU, 0x59f111f1U, 0x923f82a4U, 0xab1c5ed5U,
    0xd807aa98U, 0x12835b01U, 0x243185beU, 0x550c7dc3U, 0x72be5d74U, 0x80deb1feU, 0x9bdc06a7U, 0xc19bf174U,
    0xe49b69c1U, 0xefbe4786U, 0x0fc19dc6U, 0x240ca1ccU, 0x2de92c6fU, 0x4a7484aaU, 0x5cb0a9dcU, 0x76f988daU,
    0x983e5152U, 0xa831c66dU, 0xb00327c8U, 0xbf597fc7U, 0xc6e00bf3U, 0xd5a79147U, 0x06ca6351U, 0x14292967U,
    0x27b70a85U, 0x2e1b2138U, 0x4d2c6dfcU, 0x53380d13U, 0x650a7354U, 0x766a0abbU, 0x81c2c92eU, 0x92722c85U,
    0xa2bfe8a1U, 0xa81a664bU, 0xc24b8b70U, 0xc76c51a3U, 0xd192e819U, 0xd6990624U, 0xf40e3585U, 0x106aa070U,
    0x19a4c116U, 0x1e376c08U, 0x2748774cU, 0x34b0bcb5U, 0x391c0cb3U, 0x4ed8aa4aU, 0x5b9cca4fU, 0x682e6ff3U,
    0x748f82eeU, 0x78a5636fU, 0x84c87814U, 0x8cc70208U, 0x90befffaU, 0xa4506cebU, 0xbef9a3f7U, 0xc67178f2U,
  };

  std::array<std::uint32_t, 8> h{
    0x6a09e667U, 0xbb67ae85U, 0x3c6ef372U, 0xa54ff53aU,
    0x510e527fU, 0x9b05688cU, 0x1f83d9abU, 0x5be0cd19U,
  };

  const std::uint64_t bit_length = static_cast<std::uint64_t>(input.size()) * 8ULL;
  const std::size_t padded_size = ((input.size() + 9U + 63U) / 64U) * 64U;
  std::vector<std::uint8_t> padded(padded_size, 0);
  if (!input.empty()) std::memcpy(padded.data(), input.data(), input.size());
  padded[input.size()] = 0x80U;
  for (std::size_t index = 0; index < 8; ++index) {
    padded[padded_size - 1U - index] = static_cast<std::uint8_t>((bit_length >> (index * 8U)) & 0xffU);
  }

  std::array<std::uint32_t, 64> w{};
  for (std::size_t chunk = 0; chunk < padded_size; chunk += 64U) {
    for (std::size_t index = 0; index < 16; ++index) {
      const auto base = chunk + index * 4U;
      w[index] = (static_cast<std::uint32_t>(padded[base]) << 24U)
        | (static_cast<std::uint32_t>(padded[base + 1]) << 16U)
        | (static_cast<std::uint32_t>(padded[base + 2]) << 8U)
        | static_cast<std::uint32_t>(padded[base + 3]);
    }
    for (std::size_t index = 16; index < 64; ++index) {
      const auto s0 = rotate_right(w[index - 15], 7) ^ rotate_right(w[index - 15], 18) ^ (w[index - 15] >> 3U);
      const auto s1 = rotate_right(w[index - 2], 17) ^ rotate_right(w[index - 2], 19) ^ (w[index - 2] >> 10U);
      w[index] = w[index - 16] + s0 + w[index - 7] + s1;
    }

    auto a = h[0];
    auto b = h[1];
    auto c = h[2];
    auto d = h[3];
    auto e = h[4];
    auto f = h[5];
    auto g = h[6];
    auto hh = h[7];
    for (std::size_t index = 0; index < 64; ++index) {
      const auto s1 = rotate_right(e, 6) ^ rotate_right(e, 11) ^ rotate_right(e, 25);
      const auto ch = (e & f) ^ ((~e) & g);
      const auto temp1 = hh + s1 + ch + k[index] + w[index];
      const auto s0 = rotate_right(a, 2) ^ rotate_right(a, 13) ^ rotate_right(a, 22);
      const auto maj = (a & b) ^ (a & c) ^ (b & c);
      const auto temp2 = s0 + maj;
      hh = g;
      g = f;
      f = e;
      e = d + temp1;
      d = c;
      c = b;
      b = a;
      a = temp1 + temp2;
    }
    h[0] += a;
    h[1] += b;
    h[2] += c;
    h[3] += d;
    h[4] += e;
    h[5] += f;
    h[6] += g;
    h[7] += hh;
  }

  std::array<std::uint8_t, kSha256Bytes> output{};
  for (std::size_t index = 0; index < h.size(); ++index) {
    output[index * 4U] = static_cast<std::uint8_t>(h[index] >> 24U);
    output[index * 4U + 1U] = static_cast<std::uint8_t>(h[index] >> 16U);
    output[index * 4U + 2U] = static_cast<std::uint8_t>(h[index] >> 8U);
    output[index * 4U + 3U] = static_cast<std::uint8_t>(h[index]);
  }
  return output;
}

[[nodiscard]] bool read_string(Reader& reader, std::uint32_t length, std::string& output) {
  if (length == 0 || length > kMaxStringBytes) return false;
  std::span<const std::uint8_t> bytes;
  if (!reader.take(length, bytes)) return false;
  for (const auto value : bytes) {
    if (value == 0) return false;
  }
  output.assign(reinterpret_cast<const char*>(bytes.data()), bytes.size());
  return true;
}

[[nodiscard]] bool read_f64_at(std::span<const std::uint8_t> bytes, std::size_t offset, double& output) noexcept {
  if (offset > bytes.size() || bytes.size() - offset < 8U) return false;
  std::uint64_t bits = 0;
  for (std::size_t index = 0; index < 8; ++index) {
    bits |= static_cast<std::uint64_t>(bytes[offset + index]) << static_cast<unsigned>(index * 8U);
  }
  output = std::bit_cast<double>(bits);
  return true;
}

[[nodiscard]] bool evaluate_chebyshev(
  std::span<const std::uint8_t> shard,
  std::size_t coefficient_offset,
  std::uint32_t coefficient_count,
  double x,
  double& value,
  double* derivative
) noexcept {
  if (coefficient_count == 0) return false;
  double t_previous = 1.0;
  double dt_previous = 0.0;
  double coefficient = 0.0;
  if (!read_f64_at(shard, coefficient_offset, coefficient) || !std::isfinite(coefficient)) return false;
  value = coefficient;
  double derivative_value = 0.0;
  if (coefficient_count == 1) {
    if (derivative != nullptr) *derivative = 0.0;
    return std::isfinite(value);
  }

  double t_current = x;
  double dt_current = 1.0;
  if (!read_f64_at(shard, coefficient_offset + 8U, coefficient) || !std::isfinite(coefficient)) return false;
  value += coefficient * t_current;
  derivative_value += coefficient * dt_current;
  for (std::uint32_t index = 2; index < coefficient_count; ++index) {
    const double t_next = 2.0 * x * t_current - t_previous;
    const double dt_next = 2.0 * t_current + 2.0 * x * dt_current - dt_previous;
    if (!read_f64_at(shard, coefficient_offset + static_cast<std::size_t>(index) * 8U, coefficient)
        || !std::isfinite(coefficient)) {
      return false;
    }
    value += coefficient * t_next;
    derivative_value += coefficient * dt_next;
    t_previous = t_current;
    t_current = t_next;
    dt_previous = dt_current;
    dt_current = dt_next;
  }
  if (!std::isfinite(value) || !std::isfinite(derivative_value)) return false;
  if (derivative != nullptr) *derivative = derivative_value;
  return true;
}

[[nodiscard]] ResultCode parse_shard(
  const std::vector<std::uint8_t>& shard,
  std::size_t shard_index,
  std::map<std::uint32_t, Registry::Source>& sources,
  std::uint32_t& next_record_index
) noexcept {
  Reader reader{std::span<const std::uint8_t>(shard.data(), shard.size())};
  std::span<const std::uint8_t> magic;
  if (!reader.take(kShardMagic.size(), magic)) return ResultCode::truncated;
  if (!std::equal(magic.begin(), magic.end(), kShardMagic.begin())) return ResultCode::bad_magic;

  std::uint16_t version = 0;
  std::uint16_t flags = 0;
  std::uint32_t total_bytes = 0;
  std::uint32_t record_count = 0;
  std::uint64_t reserved = 0;
  if (!reader.u16(version) || !reader.u16(flags) || !reader.u32(total_bytes)
      || !reader.u32(record_count) || !reader.u64(reserved)) {
    return ResultCode::truncated;
  }
  if (version != kSchemaVersion) return ResultCode::unsupported_schema;
  if (flags != 0 || reserved != 0) return ResultCode::invalid_code;
  if (total_bytes != shard.size()) return ResultCode::out_of_bounds;
  const auto table_bytes = static_cast<std::uint64_t>(kShardHeaderBytes)
    + static_cast<std::uint64_t>(record_count) * static_cast<std::uint64_t>(kRecordHeaderBytes);
  if (table_bytes > shard.size()) return ResultCode::truncated;

  for (std::uint32_t record_number = 0; record_number < record_count; ++record_number) {
    std::uint32_t source_id = 0;
    std::uint16_t representation_code = 0;
    std::uint16_t component_count = 0;
    time::SimulationInstant start{};
    time::SimulationInstant end{};
    double midpoint_seconds = 0.0;
    double radius_seconds = 0.0;
    std::uint32_t coefficient_count = 0;
    std::uint32_t coefficient_offset = 0;
    std::uint32_t coefficient_bytes = 0;
    std::uint32_t record_reserved = 0;
    if (!reader.u32(source_id) || !reader.u16(representation_code) || !reader.u16(component_count)
        || !reader.time_value(start) || !reader.time_value(end)
        || !reader.f64(midpoint_seconds) || !reader.f64(radius_seconds)
        || !reader.u32(coefficient_count) || !reader.u32(coefficient_offset)
        || !reader.u32(coefficient_bytes) || !reader.u32(record_reserved)) {
      return ResultCode::truncated;
    }
    if (record_reserved != 0) return ResultCode::invalid_code;
    const auto source_it = sources.find(source_id);
    if (source_it == sources.end()) return ResultCode::missing_source;
    if (representation_code != static_cast<std::uint16_t>(source_it->second.representation)) {
      return ResultCode::invalid_code;
    }
    const auto representation = static_cast<Representation>(representation_code);
    const auto expected_components = representation == Representation::position_chebyshev ? 3U : 6U;
    if (component_count != expected_components || coefficient_count == 0) return ResultCode::invalid_code;
    if (!std::isfinite(midpoint_seconds) || !std::isfinite(radius_seconds) || radius_seconds <= 0.0) {
      return ResultCode::non_finite;
    }
    if (time::compare(start, end) >= 0) return ResultCode::malformed_records;
    const auto expected_bytes = static_cast<std::uint64_t>(component_count)
      * static_cast<std::uint64_t>(coefficient_count) * 8ULL;
    if (expected_bytes != coefficient_bytes || coefficient_offset % 8U != 0) return ResultCode::out_of_bounds;
    if (coefficient_offset < table_bytes) return ResultCode::out_of_bounds;
    const auto coefficient_end = static_cast<std::uint64_t>(coefficient_offset) + coefficient_bytes;
    if (coefficient_end > shard.size()) return ResultCode::out_of_bounds;
    for (std::uint64_t offset = coefficient_offset; offset < coefficient_end; offset += 8ULL) {
      double coefficient = 0.0;
      if (!read_f64_at(shard, static_cast<std::size_t>(offset), coefficient)) return ResultCode::out_of_bounds;
      if (!std::isfinite(coefficient)) return ResultCode::non_finite;
    }

    const double midpoint_floor_double = std::floor(midpoint_seconds);
    constexpr double kInt64MinAsDouble = -9223372036854775808.0;
    constexpr double kInt64MaxExclusiveAsDouble = 9223372036854775808.0;
    if (midpoint_floor_double < kInt64MinAsDouble || midpoint_floor_double >= kInt64MaxExclusiveAsDouble) {
      return ResultCode::out_of_bounds;
    }
    const auto midpoint_floor = static_cast<std::int64_t>(midpoint_floor_double);
    const double midpoint_fraction = midpoint_seconds - midpoint_floor_double;
    if (!std::isfinite(midpoint_fraction) || midpoint_fraction < 0.0 || midpoint_fraction >= 1.0) {
      return ResultCode::non_finite;
    }

    source_it->second.records.push_back(Registry::Record{
      shard_index,
      source_id,
      representation,
      start,
      end,
      midpoint_seconds,
      midpoint_floor,
      midpoint_fraction,
      radius_seconds,
      coefficient_count,
      coefficient_offset,
      coefficient_bytes,
      next_record_index++,
    });
  }
  return ResultCode::success;
}

[[nodiscard]] bool time_offset_from_midpoint(
  time::SimulationInstant target,
  const Registry::Record& record,
  double& output
) noexcept {
  const auto midpoint_floor = time::SimulationInstant{record.midpoint_floor_seconds, 0};
  const auto delta = time::subtract(target, midpoint_floor);
  if (!delta.has_value()) return false;
  output = time::to_seconds(*delta) - record.midpoint_fraction_seconds;
  return std::isfinite(output);
}

}  // namespace

Registry::Registry() noexcept = default;

DatasetInfoWire Registry::dataset_result(
  ResultCode code,
  std::uint64_t handle,
  std::uint64_t revision,
  std::uint32_t source_count
) noexcept {
  DatasetInfoWire result{};
  result.result_code = static_cast<std::uint16_t>(code);
  u64_to_words(handle, result.handle_high, result.handle_low);
  u64_to_words(revision, result.dataset_revision_high, result.dataset_revision_low);
  result.source_count = source_count;
  return result;
}

SourceInfoWire Registry::source_result(
  ResultCode code,
  std::uint64_t handle,
  std::uint32_t source_node_id
) noexcept {
  SourceInfoWire result{};
  result.result_code = static_cast<std::uint16_t>(code);
  u64_to_words(handle, result.handle_high, result.handle_low);
  result.source_node_id = source_node_id;
  return result;
}

EvaluationWire Registry::evaluation_result(
  ResultCode code,
  std::uint64_t handle,
  std::uint32_t source_node_id,
  EvaluationMode mode,
  time::TimeWire epoch
) noexcept {
  EvaluationWire result{};
  result.result_code = static_cast<std::uint16_t>(code);
  u64_to_words(handle, result.handle_high, result.handle_low);
  result.source_node_id = source_node_id;
  result.evaluation_mode_code = static_cast<std::uint16_t>(mode);
  result.epoch = epoch;
  return result;
}

DatasetInfoWire Registry::load(std::span<const std::uint8_t> payload) noexcept {
  Reader reader{payload};
  std::span<const std::uint8_t> magic;
  if (!reader.take(kLoadMagic.size(), magic)) return dataset_result(ResultCode::truncated, 0, 0, 0);
  if (!std::equal(magic.begin(), magic.end(), kLoadMagic.begin())) return dataset_result(ResultCode::bad_magic, 0, 0, 0);

  std::uint16_t version = 0;
  std::uint16_t reserved = 0;
  std::uint32_t dataset_id_length = 0;
  std::uint32_t dataset_version_length = 0;
  std::uint32_t normalization_policy_length = 0;
  std::uint32_t source_count = 0;
  std::uint32_t shard_count = 0;
  if (!reader.u16(version) || !reader.u16(reserved)
      || !reader.u32(dataset_id_length) || !reader.u32(dataset_version_length)
      || !reader.u32(normalization_policy_length) || !reader.u32(source_count) || !reader.u32(shard_count)) {
    return dataset_result(ResultCode::truncated, 0, 0, 0);
  }
  if (version != kSchemaVersion) return dataset_result(ResultCode::unsupported_schema, 0, 0, 0);
  if (reserved != 0) return dataset_result(ResultCode::invalid_code, 0, 0, 0);
  if (source_count == 0 || source_count > kMaxSourceCount || shard_count == 0 || shard_count > kMaxShardCount) {
    return dataset_result(ResultCode::invalid_input, 0, 0, 0);
  }

  std::span<const std::uint8_t> manifest_hash;
  if (!reader.take(kSha256Bytes, manifest_hash)) return dataset_result(ResultCode::truncated, 0, 0, 0);
  bool manifest_hash_nonzero = false;
  for (const auto value : manifest_hash) manifest_hash_nonzero = manifest_hash_nonzero || value != 0;
  if (!manifest_hash_nonzero) return dataset_result(ResultCode::invalid_input, 0, 0, 0);

  Dataset dataset{};
  if (!read_string(reader, dataset_id_length, dataset.dataset_id)
      || !read_string(reader, dataset_version_length, dataset.dataset_version)
      || !read_string(reader, normalization_policy_length, dataset.normalization_policy_version)) {
    return dataset_result(ResultCode::invalid_input, 0, 0, 0);
  }

  for (std::uint32_t index = 0; index < source_count; ++index) {
    std::uint32_t id = 0;
    std::uint32_t center_id = 0;
    std::uint16_t representation_code = 0;
    std::uint16_t axes_code = 0;
    time::SimulationInstant validity_start{};
    time::SimulationInstant validity_end{};
    std::uint64_t source_revision = 0;
    double position_error = 0.0;
    double velocity_error = 0.0;
    if (!reader.u32(id) || !reader.u32(center_id) || !reader.u16(representation_code) || !reader.u16(axes_code)
        || !reader.time_value(validity_start) || !reader.time_value(validity_end)
        || !reader.u64(source_revision) || !reader.f64(position_error) || !reader.f64(velocity_error)) {
      return dataset_result(ResultCode::truncated, 0, 0, 0);
    }
    if (id == kSsbSourceNodeId || id == center_id || axes_code != kCanonicalAxesCode) {
      return dataset_result(ResultCode::invalid_code, 0, 0, 0);
    }
    if (representation_code != static_cast<std::uint16_t>(Representation::position_chebyshev)
        && representation_code != static_cast<std::uint16_t>(Representation::state_chebyshev)) {
      return dataset_result(ResultCode::invalid_code, 0, 0, 0);
    }
    if (time::compare(validity_start, validity_end) >= 0) return dataset_result(ResultCode::invalid_input, 0, 0, 0);
    if (!std::isfinite(position_error) || !std::isfinite(velocity_error) || position_error < 0.0 || velocity_error < 0.0) {
      return dataset_result(ResultCode::non_finite, 0, 0, 0);
    }
    if (dataset.sources.contains(id)) return dataset_result(ResultCode::duplicate_source, 0, 0, 0);
    dataset.sources.emplace(id, Source{
      id,
      center_id,
      static_cast<Representation>(representation_code),
      validity_start,
      validity_end,
      validity_start,
      validity_end,
      source_revision,
      0,
      position_error,
      velocity_error,
      {},
      std::nullopt,
    });
  }

  std::set<std::string> shard_ids;
  dataset.shards.reserve(shard_count);
  std::uint32_t next_record_index = 0;
  for (std::uint32_t shard_index = 0; shard_index < shard_count; ++shard_index) {
    std::uint32_t shard_id_length = 0;
    std::uint32_t shard_bytes_length = 0;
    if (!reader.u32(shard_id_length) || !reader.u32(shard_bytes_length)) {
      return dataset_result(ResultCode::truncated, 0, 0, 0);
    }
    std::span<const std::uint8_t> expected_hash;
    if (!reader.take(kSha256Bytes, expected_hash)) return dataset_result(ResultCode::truncated, 0, 0, 0);
    std::string shard_id;
    if (!read_string(reader, shard_id_length, shard_id)) return dataset_result(ResultCode::invalid_input, 0, 0, 0);
    if (!shard_ids.insert(shard_id).second) return dataset_result(ResultCode::invalid_input, 0, 0, 0);
    std::span<const std::uint8_t> shard_bytes;
    if (!reader.take(shard_bytes_length, shard_bytes)) return dataset_result(ResultCode::missing_shard, 0, 0, 0);
    const auto actual_hash = sha256(shard_bytes);
    if (!std::equal(actual_hash.begin(), actual_hash.end(), expected_hash.begin())) {
      return dataset_result(ResultCode::checksum_mismatch, 0, 0, 0);
    }
    dataset.shards.emplace_back(shard_bytes.begin(), shard_bytes.end());
    const auto parse_result = parse_shard(dataset.shards.back(), shard_index, dataset.sources, next_record_index);
    if (parse_result != ResultCode::success) return dataset_result(parse_result, 0, 0, 0);
  }
  if (reader.offset != payload.size()) return dataset_result(ResultCode::invalid_input, 0, 0, 0);

  for (const auto& [id, source] : dataset.sources) {
    if (source.center_id != kSsbSourceNodeId && !dataset.sources.contains(source.center_id)) {
      return dataset_result(ResultCode::missing_center, 0, 0, 0);
    }
  }

  std::map<std::uint32_t, std::uint8_t> visit;
  std::function<bool(std::uint32_t)> graph_valid = [&](std::uint32_t id) -> bool {
    if (id == kSsbSourceNodeId) return true;
    const auto state = visit[id];
    if (state == 1) return false;
    if (state == 2) return true;
    visit[id] = 1;
    const auto source_it = dataset.sources.find(id);
    if (source_it == dataset.sources.end()) return false;
    if (!graph_valid(source_it->second.center_id)) return false;
    visit[id] = 2;
    return true;
  };
  for (const auto& [id, source] : dataset.sources) {
    (void)source;
    if (!graph_valid(id)) return dataset_result(ResultCode::dependency_cycle, 0, 0, 0);
  }

  for (auto& [id, source] : dataset.sources) {
    (void)id;
    if (source.records.empty()) return dataset_result(ResultCode::missing_shard, 0, 0, 0);
    std::sort(source.records.begin(), source.records.end(), [](const Record& left, const Record& right) {
      const auto comparison = time::compare(left.start, right.start);
      return comparison < 0 || (comparison == 0 && left.record_index < right.record_index);
    });
    if (!same_time(source.records.front().start, source.validity_start)
        || !same_time(source.records.back().end, source.validity_end)) {
      return dataset_result(ResultCode::malformed_records, 0, 0, 0);
    }
    for (std::size_t index = 0; index < source.records.size(); ++index) {
      const auto& record = source.records[index];
      if (record.representation != source.representation) return dataset_result(ResultCode::invalid_code, 0, 0, 0);
      if (index != 0 && !same_time(source.records[index - 1].end, record.start)) {
        return dataset_result(ResultCode::malformed_records, 0, 0, 0);
      }
      double start_offset = 0.0;
      double end_offset = 0.0;
      if (!time_offset_from_midpoint(record.start, record, start_offset)
          || !time_offset_from_midpoint(record.end, record, end_offset)) {
        return dataset_result(ResultCode::malformed_records, 0, 0, 0);
      }
      if (start_offset < -record.radius_seconds || start_offset > record.radius_seconds
          || end_offset < -record.radius_seconds || end_offset > record.radius_seconds) {
        return dataset_result(ResultCode::malformed_records, 0, 0, 0);
      }
    }
  }

  std::map<std::uint32_t, bool> effective_done;
  std::function<bool(std::uint32_t)> compute_effective = [&](std::uint32_t id) -> bool {
    if (id == kSsbSourceNodeId) return true;
    if (effective_done[id]) return true;
    auto& source = dataset.sources.at(id);
    if (source.center_id != kSsbSourceNodeId) {
      if (!compute_effective(source.center_id)) return false;
      const auto& center = dataset.sources.at(source.center_id);
      if (time::compare(center.effective_start, source.effective_start) > 0) source.effective_start = center.effective_start;
      if (time::compare(center.effective_end, source.effective_end) < 0) source.effective_end = center.effective_end;
    }
    if (time::compare(source.effective_start, source.effective_end) >= 0) return false;
    effective_done[id] = true;
    return true;
  };
  for (const auto& [id, source] : dataset.sources) {
    (void)source;
    if (!compute_effective(id)) return dataset_result(ResultCode::missing_center, 0, 0, 0);
  }

  std::uint64_t revision = fnv1a64(manifest_hash);
  revision = fnv1a64_string(dataset.dataset_id, revision);
  revision = fnv1a64_string(dataset.dataset_version, revision);
  revision = fnv1a64_string(dataset.normalization_policy_version, revision);
  dataset.revision = revision;
  for (auto& [id, source] : dataset.sources) {
    (void)id;
    source.combined_revision = mix_revision(dataset.revision, source.declared_revision);
  }

  const auto handle = next_handle_++;
  if (handle == 0) return dataset_result(ResultCode::invalid_input, 0, 0, 0);
  datasets_.emplace(handle, Entry{std::move(dataset), 1});
  return dataset_result(ResultCode::success, handle, revision, source_count);
}

DatasetInfoWire Registry::retain(std::uint64_t handle) noexcept {
  const auto entry = datasets_.find(handle);
  if (entry == datasets_.end()) return dataset_result(ResultCode::missing_dataset, handle, 0, 0);
  if (entry->second.references == std::numeric_limits<std::uint32_t>::max()) {
    return dataset_result(ResultCode::invalid_input, handle, entry->second.dataset.revision, static_cast<std::uint32_t>(entry->second.dataset.sources.size()));
  }
  ++entry->second.references;
  return dataset_result(ResultCode::success, handle, entry->second.dataset.revision, static_cast<std::uint32_t>(entry->second.dataset.sources.size()));
}

DatasetInfoWire Registry::release_reference(std::uint64_t handle) noexcept {
  const auto entry = datasets_.find(handle);
  if (entry == datasets_.end()) return dataset_result(ResultCode::missing_dataset, handle, 0, 0);
  if (entry->second.references <= 1) {
    return dataset_result(ResultCode::invalid_input, handle, entry->second.dataset.revision, static_cast<std::uint32_t>(entry->second.dataset.sources.size()));
  }
  --entry->second.references;
  return dataset_result(ResultCode::success, handle, entry->second.dataset.revision, static_cast<std::uint32_t>(entry->second.dataset.sources.size()));
}

DatasetInfoWire Registry::unload(std::uint64_t handle) noexcept {
  const auto entry = datasets_.find(handle);
  if (entry == datasets_.end()) return dataset_result(ResultCode::missing_dataset, handle, 0, 0);
  if (entry->second.references != 1) {
    return dataset_result(ResultCode::dataset_in_use, handle, entry->second.dataset.revision, static_cast<std::uint32_t>(entry->second.dataset.sources.size()));
  }
  const auto revision = entry->second.dataset.revision;
  const auto source_count = static_cast<std::uint32_t>(entry->second.dataset.sources.size());
  datasets_.erase(entry);
  return dataset_result(ResultCode::success, handle, revision, source_count);
}

SourceInfoWire Registry::source_info(std::uint64_t handle, std::uint32_t source_node_id) const noexcept {
  const auto entry = datasets_.find(handle);
  if (entry == datasets_.end()) return source_result(ResultCode::missing_dataset, handle, source_node_id);
  const auto source_it = entry->second.dataset.sources.find(source_node_id);
  if (source_it == entry->second.dataset.sources.end()) return source_result(ResultCode::missing_source, handle, source_node_id);
  const auto& source = source_it->second;
  auto result = source_result(ResultCode::success, handle, source_node_id);
  result.center_source_node_id = source.center_id;
  result.representation_code = static_cast<std::uint16_t>(source.representation);
  u64_to_words(source.combined_revision, result.source_revision_high, result.source_revision_low);
  result.validity_start = time::to_wire(source.validity_start);
  result.validity_end = time::to_wire(source.validity_end);
  result.effective_validity_start = time::to_wire(source.effective_start);
  result.effective_validity_end = time::to_wire(source.effective_end);
  result.position_error_meters = source.position_error_meters;
  result.velocity_error_meters_per_second = source.velocity_error_meters_per_second;
  return result;
}

ResultCode Registry::evaluate_relative(
  Dataset& dataset,
  Source& source,
  time::SimulationInstant target,
  State& output
) noexcept {
  if (!contains(source.effective_start, source.effective_end, target)) return ResultCode::source_out_of_range;

  std::size_t record_index = source.records.size();
  if (source.hot_record.has_value() && *source.hot_record < source.records.size()) {
    const auto& hot = source.records[*source.hot_record];
    if (contains(hot.start, hot.end, target)) record_index = *source.hot_record;
  }
  if (record_index == source.records.size()) {
    std::size_t low = 0;
    std::size_t high = source.records.size();
    while (low < high) {
      const auto middle = low + (high - low) / 2U;
      if (time::compare(source.records[middle].start, target) <= 0) low = middle + 1U;
      else high = middle;
    }
    if (low == 0) return ResultCode::source_out_of_range;
    record_index = low - 1U;
    if (!contains(source.records[record_index].start, source.records[record_index].end, target)) {
      return ResultCode::source_out_of_range;
    }
    source.hot_record = record_index;
  }

  const auto& record = source.records[record_index];
  double time_offset = 0.0;
  if (!time_offset_from_midpoint(target, record, time_offset)) return ResultCode::malformed_records;
  const double x = time_offset / record.radius_seconds;
  if (!std::isfinite(x) || x < -1.0 || x > 1.0) return ResultCode::malformed_records;
  const auto& shard = dataset.shards[record.shard_index];
  const auto component_stride = static_cast<std::size_t>(record.coefficient_count) * 8U;
  std::array<double, 6> values{};
  std::array<double, 3> position_derivatives{};
  const std::uint32_t components = record.representation == Representation::position_chebyshev ? 3U : 6U;
  for (std::uint32_t component = 0; component < components; ++component) {
    double derivative = 0.0;
    if (!evaluate_chebyshev(
          std::span<const std::uint8_t>(shard.data(), shard.size()),
          static_cast<std::size_t>(record.coefficient_offset) + static_cast<std::size_t>(component) * component_stride,
          record.coefficient_count,
          x,
          values[component],
          component < 3U ? &derivative : nullptr)) {
      return ResultCode::non_finite;
    }
    if (component < 3U) position_derivatives[component] = derivative;
  }

  output.px = values[0];
  output.py = values[1];
  output.pz = values[2];
  if (record.representation == Representation::position_chebyshev) {
    output.vx = position_derivatives[0] / record.radius_seconds;
    output.vy = position_derivatives[1] / record.radius_seconds;
    output.vz = position_derivatives[2] / record.radius_seconds;
  } else {
    output.vx = values[3];
    output.vy = values[4];
    output.vz = values[5];
  }
  output.record_index = record.record_index;
  if (!std::isfinite(output.px) || !std::isfinite(output.py) || !std::isfinite(output.pz)
      || !std::isfinite(output.vx) || !std::isfinite(output.vy) || !std::isfinite(output.vz)) {
    return ResultCode::non_finite;
  }
  return ResultCode::success;
}

ResultCode Registry::evaluate_root(
  Dataset& dataset,
  std::uint32_t source_node_id,
  time::SimulationInstant target,
  State& output,
  std::vector<std::uint32_t>& active
) noexcept {
  if (!dataset.cache_epoch.has_value() || time::compare(*dataset.cache_epoch, target) != 0) {
    dataset.cache_epoch = target;
    dataset.root_cache.clear();
  }
  if (source_node_id == kSsbSourceNodeId) {
    output = State{0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0};
    return ResultCode::success;
  }
  const auto cached = dataset.root_cache.find(source_node_id);
  if (cached != dataset.root_cache.end()) {
    output = cached->second;
    return ResultCode::success;
  }
  if (std::find(active.begin(), active.end(), source_node_id) != active.end()) return ResultCode::dependency_cycle;
  const auto source_it = dataset.sources.find(source_node_id);
  if (source_it == dataset.sources.end()) return ResultCode::missing_source;
  active.push_back(source_node_id);
  State relative{};
  auto result = evaluate_relative(dataset, source_it->second, target, relative);
  if (result != ResultCode::success) {
    active.pop_back();
    return result;
  }
  State center{};
  result = evaluate_root(dataset, source_it->second.center_id, target, center, active);
  active.pop_back();
  if (result != ResultCode::success) return result;
  output = State{
    relative.px + center.px,
    relative.py + center.py,
    relative.pz + center.pz,
    relative.vx + center.vx,
    relative.vy + center.vy,
    relative.vz + center.vz,
    relative.record_index,
  };
  if (!std::isfinite(output.px) || !std::isfinite(output.py) || !std::isfinite(output.pz)
      || !std::isfinite(output.vx) || !std::isfinite(output.vy) || !std::isfinite(output.vz)) {
    return ResultCode::non_finite;
  }
  dataset.root_cache.emplace(source_node_id, output);
  return ResultCode::success;
}

EvaluationWire Registry::evaluate(
  std::uint64_t handle,
  std::uint32_t source_node_id,
  EvaluationMode mode,
  time::TimeWire target_wire
) noexcept {
  const auto entry = datasets_.find(handle);
  if (entry == datasets_.end()) return evaluation_result(ResultCode::missing_dataset, handle, source_node_id, mode, target_wire);
  auto source_it = entry->second.dataset.sources.find(source_node_id);
  if (source_it == entry->second.dataset.sources.end()) {
    return evaluation_result(ResultCode::missing_source, handle, source_node_id, mode, target_wire);
  }
  const auto target = time::from_wire(target_wire);
  if (!target.has_value()) return evaluation_result(ResultCode::invalid_input, handle, source_node_id, mode, target_wire);
  if (mode != EvaluationMode::relative_to_center && mode != EvaluationMode::root_ssb) {
    return evaluation_result(ResultCode::invalid_code, handle, source_node_id, mode, target_wire);
  }
  if (!contains(source_it->second.effective_start, source_it->second.effective_end, *target)) {
    return evaluation_result(ResultCode::source_out_of_range, handle, source_node_id, mode, target_wire);
  }

  State state{};
  ResultCode code = ResultCode::success;
  if (mode == EvaluationMode::relative_to_center) {
    code = evaluate_relative(entry->second.dataset, source_it->second, *target, state);
  } else {
    std::vector<std::uint32_t> active;
    active.reserve(16);
    code = evaluate_root(entry->second.dataset, source_node_id, *target, state, active);
  }
  auto result = evaluation_result(code, handle, source_node_id, mode, target_wire);
  if (code != ResultCode::success) return result;
  result.record_index = state.record_index;
  u64_to_words(source_it->second.combined_revision, result.source_revision_high, result.source_revision_low);
  result.position_x = state.px;
  result.position_y = state.py;
  result.position_z = state.pz;
  result.velocity_x = state.vx;
  result.velocity_y = state.vy;
  result.velocity_z = state.vz;
  return result;
}

}  // namespace orbit_engine::oep
