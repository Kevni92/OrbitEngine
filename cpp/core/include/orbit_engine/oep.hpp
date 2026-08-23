#pragma once

#include "orbit_engine/time.hpp"

#include <cstddef>
#include <cstdint>
#include <map>
#include <optional>
#include <span>
#include <string>
#include <vector>

namespace orbit_engine::oep {

inline constexpr std::uint16_t kSchemaVersion = 1;
inline constexpr std::uint32_t kSsbSourceNodeId = 0;

enum class ResultCode : std::uint16_t {
  success = 0,
  invalid_input = 1,
  bad_magic = 2,
  unsupported_schema = 3,
  truncated = 4,
  out_of_bounds = 5,
  non_finite = 6,
  invalid_code = 7,
  duplicate_source = 8,
  missing_center = 9,
  dependency_cycle = 10,
  missing_shard = 11,
  checksum_mismatch = 12,
  source_out_of_range = 13,
  missing_dataset = 14,
  missing_source = 15,
  dataset_in_use = 16,
  malformed_records = 17,
};

enum class Representation : std::uint16_t {
  position_chebyshev = 1,
  state_chebyshev = 2,
};

enum class EvaluationMode : std::uint16_t {
  relative_to_center = 1,
  root_ssb = 2,
};

struct DatasetInfoWire {
  std::uint16_t result_code;
  std::uint32_t handle_high;
  std::uint32_t handle_low;
  std::uint32_t dataset_revision_high;
  std::uint32_t dataset_revision_low;
  std::uint32_t source_count;
};

struct SourceInfoWire {
  std::uint16_t result_code;
  std::uint32_t handle_high;
  std::uint32_t handle_low;
  std::uint32_t source_node_id;
  std::uint32_t center_source_node_id;
  std::uint16_t representation_code;
  std::uint32_t source_revision_high;
  std::uint32_t source_revision_low;
  time::TimeWire validity_start;
  time::TimeWire validity_end;
  time::TimeWire effective_validity_start;
  time::TimeWire effective_validity_end;
  double position_error_meters;
  double velocity_error_meters_per_second;
};

struct EvaluationWire {
  std::uint16_t result_code;
  std::uint32_t handle_high;
  std::uint32_t handle_low;
  std::uint32_t source_node_id;
  std::uint16_t evaluation_mode_code;
  std::uint32_t record_index;
  std::uint32_t source_revision_high;
  std::uint32_t source_revision_low;
  time::TimeWire epoch;
  double position_x;
  double position_y;
  double position_z;
  double velocity_x;
  double velocity_y;
  double velocity_z;
};

class Registry {
public:
  Registry() noexcept;

  [[nodiscard]] DatasetInfoWire load(std::span<const std::uint8_t> payload) noexcept;
  [[nodiscard]] DatasetInfoWire retain(std::uint64_t handle) noexcept;
  [[nodiscard]] DatasetInfoWire release_reference(std::uint64_t handle) noexcept;
  [[nodiscard]] DatasetInfoWire unload(std::uint64_t handle) noexcept;
  [[nodiscard]] SourceInfoWire source_info(std::uint64_t handle, std::uint32_t source_node_id) const noexcept;
  [[nodiscard]] EvaluationWire evaluate(
    std::uint64_t handle,
    std::uint32_t source_node_id,
    EvaluationMode mode,
    time::TimeWire target
  ) noexcept;

private:
  struct Record {
    std::size_t shard_index;
    std::uint32_t source_node_id;
    Representation representation;
    time::SimulationInstant start;
    time::SimulationInstant end;
    double midpoint_seconds;
    std::int64_t midpoint_floor_seconds;
    double midpoint_fraction_seconds;
    double radius_seconds;
    std::uint32_t coefficient_count;
    std::uint32_t coefficient_offset;
    std::uint32_t coefficient_bytes;
    std::uint32_t record_index;
  };

  struct Source {
    std::uint32_t id;
    std::uint32_t center_id;
    Representation representation;
    time::SimulationInstant validity_start;
    time::SimulationInstant validity_end;
    time::SimulationInstant effective_start;
    time::SimulationInstant effective_end;
    std::uint64_t declared_revision;
    std::uint64_t combined_revision;
    double position_error_meters;
    double velocity_error_meters_per_second;
    std::vector<Record> records;
    std::optional<std::size_t> hot_record;
  };

  struct State {
    double px;
    double py;
    double pz;
    double vx;
    double vy;
    double vz;
    std::uint32_t record_index;
  };

  struct Dataset {
    std::string dataset_id;
    std::string dataset_version;
    std::string normalization_policy_version;
    std::uint64_t revision;
    std::vector<std::vector<std::uint8_t>> shards;
    std::map<std::uint32_t, Source> sources;
    std::optional<time::SimulationInstant> cache_epoch;
    std::map<std::uint32_t, State> root_cache;
  };

  struct Entry {
    Dataset dataset;
    std::uint32_t references;
  };

  std::map<std::uint64_t, Entry> datasets_;
  std::uint64_t next_handle_ = 1;

  [[nodiscard]] static DatasetInfoWire dataset_result(
    ResultCode code,
    std::uint64_t handle,
    std::uint64_t revision,
    std::uint32_t source_count
  ) noexcept;
  [[nodiscard]] static SourceInfoWire source_result(
    ResultCode code,
    std::uint64_t handle,
    std::uint32_t source_node_id
  ) noexcept;
  [[nodiscard]] static EvaluationWire evaluation_result(
    ResultCode code,
    std::uint64_t handle,
    std::uint32_t source_node_id,
    EvaluationMode mode,
    time::TimeWire epoch
  ) noexcept;

  [[nodiscard]] ResultCode evaluate_relative(
    Dataset& dataset,
    Source& source,
    time::SimulationInstant target,
    State& output
  ) noexcept;
  [[nodiscard]] ResultCode evaluate_root(
    Dataset& dataset,
    std::uint32_t source_node_id,
    time::SimulationInstant target,
    State& output,
    std::vector<std::uint32_t>& active
  ) noexcept;
};

}  // namespace orbit_engine::oep
