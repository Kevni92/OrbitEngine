#pragma once

#include "orbit_engine/time.hpp"

#include <cstddef>
#include <cstdint>
#include <functional>
#include <span>
#include <string>
#include <vector>

namespace orbit_engine::numerical {

struct NumericalSampleTime {
  time::SimulationInstant exact_step_start;
  double offset_seconds;
};

enum class FailureCode : std::uint16_t {
  none = 0,
  invalid_configuration = 1,
  invalid_state = 2,
  non_finite_derivative = 3,
  non_finite_candidate = 4,
  unsupported_temporal_direction = 5,
  step_underflow = 6,
  accepted_step_budget = 7,
  rejected_step_budget = 8,
  derivative_failure = 9,
};

struct Failure {
  FailureCode code = FailureCode::none;
  std::string message;
};

struct Configuration {
  double relative_tolerance = 1e-12;
  double position_absolute_tolerance_meters = 1e-3;
  double velocity_absolute_tolerance_meters_per_second = 1e-6;
  double mass_absolute_tolerance_kilograms = 1e-6;
  bool has_mass_component = false;
  time::Duration min_step{0, 1};
  time::Duration max_step{86'400, 0};
  std::size_t checkpoint_stride_accepted_steps = 32;
  std::size_t max_checkpoint_count = 64;
  std::size_t max_dense_step_count = 256;
  std::size_t max_accepted_steps_per_extension = 100'000;
  std::size_t max_rejected_steps_per_extension = 10'000;
  std::uint64_t configuration_identity = 1;

  [[nodiscard]] bool validate(Failure& failure) const noexcept;
};

struct Anchor {
  time::SimulationInstant epoch{};
  std::vector<double> state;
  std::uint64_t segment_identity = 1;
};

struct HardBoundary {
  time::SimulationInstant instant{};
  std::uint64_t identity = 0;
};

// Quantizes a positive binary64 duration to integer nanoseconds using
// round-to-nearest, ties-to-even. It never returns a zero-duration step.
[[nodiscard]] bool quantize_step_seconds(double seconds, time::Duration& duration) noexcept;

using DerivativeFunction = std::function<bool(
  const NumericalSampleTime& sample_time,
  std::span<const double> state,
  std::span<double> derivative,
  Failure& failure
)>;

struct CheckpointInfo {
  time::SimulationInstant epoch{};
  std::size_t state_size = 0;
  double next_step_seconds = 0.0;
  std::size_t accepted_step_ordinal = 0;
  std::uint64_t configuration_identity = 0;
  std::uint64_t segment_identity = 0;
};

struct TapeDiagnostics {
  time::SimulationInstant current_epoch{};
  std::size_t accepted_step_count = 0;
  std::size_t rejected_step_count = 0;
  std::size_t checkpoint_count = 0;
  std::size_t dense_step_count = 0;
};

class DOP853Tape {
public:
  DOP853Tape(
    Anchor anchor,
    Configuration configuration,
    DerivativeFunction derivative,
    std::vector<HardBoundary> hard_boundaries = {}
  );

  [[nodiscard]] bool valid() const noexcept;
  [[nodiscard]] const Failure& construction_failure() const noexcept;

  // Extends the target-independent forward tape and evaluates the requested
  // exact instant through an accepted endpoint or dense output. The anchor is
  // the lower bound; v1 does not integrate backwards before it.
  [[nodiscard]] bool evaluate(
    time::SimulationInstant target,
    std::vector<double>& state,
    Failure& failure
  );

  [[nodiscard]] bool invalidate_from(
    time::SimulationInstant instant,
    std::uint64_t new_segment_identity,
    Failure& failure
  );

  [[nodiscard]] TapeDiagnostics diagnostics() const noexcept;
  [[nodiscard]] std::vector<CheckpointInfo> checkpoints() const;

private:
  struct DenseRecord {
    time::SimulationInstant start{};
    time::SimulationInstant end{};
    double step_seconds = 0.0;
    std::vector<double> start_state;
    std::vector<double> coefficients;
    std::uint64_t configuration_identity = 0;
    std::uint64_t segment_identity = 0;
  };

  struct Checkpoint {
    CheckpointInfo info;
    std::vector<double> state;
  };

  Anchor anchor_;
  Configuration configuration_;
  DerivativeFunction derivative_;
  std::vector<HardBoundary> hard_boundaries_;
  Failure construction_failure_;
  bool valid_ = false;
  bool initialized_ = false;
  time::SimulationInstant current_epoch_{};
  std::vector<double> current_state_;
  double next_step_seconds_ = 0.0;
  std::size_t accepted_step_count_ = 0;
  std::size_t rejected_step_count_ = 0;
  std::vector<DenseRecord> dense_records_;
  std::vector<Checkpoint> checkpoints_;

  [[nodiscard]] bool initialize(Failure& failure);
  [[nodiscard]] bool extend_until(time::SimulationInstant target, Failure& failure);
  [[nodiscard]] bool attempt_step(
    double proposed_seconds,
    time::SimulationInstant exact_start,
    std::vector<double>& state,
    time::SimulationInstant& exact_end,
    double& next_proposed_seconds,
    DenseRecord& dense,
    bool& accepted,
    Failure& failure
  );
  [[nodiscard]] bool evaluate_dense(
    const DenseRecord& record,
    time::SimulationInstant target,
    std::vector<double>& state,
    Failure& failure
  ) const;
  [[nodiscard]] bool replay_from_anchor(
    time::SimulationInstant target,
    std::vector<double>& state,
    Failure& failure
  ) const;
  [[nodiscard]] double component_absolute_tolerance(std::size_t index) const noexcept;
  [[nodiscard]] double next_boundary_seconds(time::SimulationInstant start) const noexcept;
  void retain_dense(DenseRecord record) noexcept;
  void retain_checkpoint() noexcept;
  void fail(Failure& failure, FailureCode code, const char* message) const noexcept;
};

}  // namespace orbit_engine::numerical
