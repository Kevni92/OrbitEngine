#include "orbit_engine/numerical.hpp"

#include <cmath>
#include <iostream>
#include <limits>
#include <vector>

#define CHECK(condition) do { if (!(condition)) { std::cerr << "CHECK failed: " << #condition << " at line " << __LINE__ << "\n"; return 1; } } while (false)

namespace {

orbit_engine::numerical::Configuration config() {
  orbit_engine::numerical::Configuration value;
  value.relative_tolerance = 1e-12;
  value.position_absolute_tolerance_meters = 1e-12;
  value.velocity_absolute_tolerance_meters_per_second = 1e-12;
  value.min_step = orbit_engine::time::Duration{0, 1};
  value.max_step = orbit_engine::time::Duration{0, 500'000'000};
  value.max_accepted_steps_per_extension = 10'000;
  return value;
}

int constant_acceleration() {
  using namespace orbit_engine;
  numerical::Anchor anchor{time::SimulationInstant{0, 0}, {1.0, 2.0, 0.0, 3.0, -4.0, 0.0}, 7};
  auto derivative = [](const numerical::NumericalSampleTime&, std::span<const double> state, std::span<double> output, numerical::Failure&) {
    output[0] = state[3]; output[1] = state[4]; output[2] = state[5];
    output[3] = 2.0; output[4] = -1.0; output[5] = 0.5;
    return true;
  };
  numerical::DOP853Tape tape(anchor, config(), derivative);
  CHECK(tape.valid());
  std::vector<double> result;
  numerical::Failure failure;
  CHECK(tape.evaluate(time::SimulationInstant{2, 0}, result, failure));
  CHECK(std::abs(result[0] - 11.0) < 1e-9);
  CHECK(std::abs(result[1] + 8.0) < 1e-9);
  CHECK(std::abs(result[2] - 1.0) < 1e-9);
  CHECK(std::abs(result[3] - 7.0) < 1e-10);
  CHECK(std::abs(result[4] + 6.0) < 1e-10);
  CHECK(std::abs(result[5] - 1.0) < 1e-10);
  std::vector<double> interior;
  CHECK(tape.evaluate(time::SimulationInstant{1, 250'000'000}, interior, failure));
  CHECK(std::abs(interior[0] - 6.3125) < 1e-8);
  return 0;
}

int hard_boundary_and_partition() {
  using namespace orbit_engine;
  numerical::Anchor anchor{time::SimulationInstant{0, 0}, {0.0}, 8};
  auto derivative = [](const numerical::NumericalSampleTime&, std::span<const double>, std::span<double> output, numerical::Failure&) { output[0] = 1.0; return true; };
  auto boundary = time::SimulationInstant{1, 500'000'000};
  auto value = config(); value.max_step = time::Duration{10, 0}; value.min_step = time::Duration{0, 1}; value.max_dense_step_count = 2;
  numerical::DOP853Tape tape(anchor, value, derivative, {{boundary, 9}});
  numerical::Failure failure; std::vector<double> first; std::vector<double> second;
  CHECK(tape.evaluate(time::SimulationInstant{1, 0}, first, failure));
  CHECK(tape.evaluate(time::SimulationInstant{2, 0}, second, failure));
  CHECK(std::abs(first[0] - 1.0) < 1e-10);
  CHECK(std::abs(second[0] - 2.0) < 1e-10);
  const auto diagnostics = tape.diagnostics();
  CHECK(diagnostics.dense_step_count <= value.max_dense_step_count);
  CHECK(diagnostics.checkpoint_count >= 1);
  numerical::DOP853Tape direct(anchor, value, derivative, {{boundary, 9}});
  std::vector<double> direct_result; CHECK(direct.evaluate(time::SimulationInstant{2, 0}, direct_result, failure));
  CHECK(std::abs(direct_result[0] - second[0]) < 1e-12);
  return 0;
}

int exact_quantization_and_failures() {
  using namespace orbit_engine;
  time::Duration duration{};
  CHECK(numerical::quantize_step_seconds(1.5e-9, duration));
  CHECK(duration.seconds == 0 && duration.nanoseconds == 2);
  CHECK(numerical::quantize_step_seconds(2.5e-9, duration));
  CHECK(duration.seconds == 0 && duration.nanoseconds == 2);
  CHECK(numerical::quantize_step_seconds(3.5e-9, duration));
  CHECK(duration.seconds == 0 && duration.nanoseconds == 4);

  numerical::Anchor anchor{time::SimulationInstant{0, 0}, {0.0}, 10};
  auto invalidDerivative = [](const numerical::NumericalSampleTime&, std::span<const double>, std::span<double> output, numerical::Failure&) {
    output[0] = std::numeric_limits<double>::infinity();
    return true;
  };
  numerical::DOP853Tape nonFinite(anchor, config(), invalidDerivative);
  numerical::Failure failure; std::vector<double> state;
  CHECK(!nonFinite.evaluate(time::SimulationInstant{1, 0}, state, failure));
  CHECK(failure.code == numerical::FailureCode::non_finite_derivative);

  auto failedDerivative = [](const numerical::NumericalSampleTime&, std::span<const double>, std::span<double>, numerical::Failure& output) {
    output = numerical::Failure{numerical::FailureCode::derivative_failure, "fixture failure"};
    return false;
  };
  numerical::DOP853Tape failed(anchor, config(), failedDerivative);
  failure = {};
  CHECK(!failed.evaluate(time::SimulationInstant{1, 0}, state, failure));
  CHECK(failure.code == numerical::FailureCode::derivative_failure);
  CHECK(failed.diagnostics().accepted_step_count == 0);
  return 0;
}

}  // namespace

int main() {
  if (constant_acceleration() != 0) return 1;
  if (hard_boundary_and_partition() != 0) return 1;
  if (exact_quantization_and_failures() != 0) return 1;
  return 0;
}
