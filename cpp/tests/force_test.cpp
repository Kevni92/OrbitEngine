#include "orbit_engine/force.hpp"
#include "orbit_engine/numerical_motion.hpp"
#include "orbit_engine/thrust.hpp"

#include <algorithm>
#include <cmath>
#include <iostream>
#include <optional>
#include <utility>
#include <vector>

#define CHECK(condition) do { if (!(condition)) { std::cerr << "CHECK failed: " << #condition << " at line " << __LINE__ << "\n"; return 1; } } while (false)

namespace {

orbit_engine::force::GravitySource source(orbit_engine::object::ObjectId id, double mu, double x, std::uint64_t revision = 1) {
  orbit_engine::force::GravitySource value;
  value.id = id;
  value.validity = {orbit_engine::time::SimulationInstant{0, 0}, orbit_engine::time::SimulationInstant{10, 0}};
  value.mu = mu;
  value.revision = revision;
  value.fixed_position = {x, 0.0, 0.0};
  value.has_fixed_position = true;
  return value;
}

int gravity_and_order() {
  using namespace orbit_engine;
  force::Failure failure;
  force::NewtonianGravityConfiguration gravity;
  gravity.order = 4;
  gravity.validity = {time::SimulationInstant{0, 0}, time::SimulationInstant{10, 0}};
  gravity.sources = {source(20, 4.0, 2.0), source(10, 1.0, 1.0)};
  auto provider = force::make_newtonian_gravity_provider(gravity, failure);
  CHECK(failure.code == force::FailureCode::none);
  CHECK(provider.definition.dependencies[0].id == 10);
  CHECK(provider.definition.dependencies[1].id == 20);
  force::ProviderRuntime runtime({provider});
  CHECK(runtime.valid());
  frame::Vec3 acceleration{};
  const numerical::NumericalSampleTime sample{time::SimulationInstant{0, 0}, 0.0};
  CHECK(runtime.evaluate(force::ForceEvaluationContext{99, sample, {0.0, 0.0, 0.0}, std::nullopt}, acceleration, failure));
  CHECK(std::abs(acceleration.x - (1.0 + 4.0 / 4.0)) < 1e-14);
  CHECK(runtime.hard_boundaries().size() == 2);
  return 0;
}

int strength_rules_and_failures() {
  using namespace orbit_engine;
  force::Failure failure;
  force::NewtonianGravityConfiguration gravity;
  gravity.validity = {time::SimulationInstant{0, 0}, time::SimulationInstant{10, 0}};
  auto mass_source = source(7, 0.0, 2.0);
  mass_source.mu.reset(); mass_source.mass = 2.0;
  gravity.sources = {mass_source};
  auto provider = force::make_newtonian_gravity_provider(gravity, failure);
  force::ProviderRuntime runtime({provider});
  frame::Vec3 acceleration{};
  CHECK(runtime.evaluate(force::ForceEvaluationContext{8, {time::SimulationInstant{0, 0}, 0.0}, {0.0, 0.0, 0.0}, std::nullopt}, acceleration, failure));
  CHECK(std::abs(acceleration.x - force::kNewtonianGravitationalConstant * 2.0 / 4.0) < 1e-25);

  auto precedence_source = source(7, 10.0, 2.0);
  precedence_source.mass = 1000.0;
  gravity.sources = {precedence_source};
  provider = force::make_newtonian_gravity_provider(gravity, failure);
  runtime = force::ProviderRuntime({provider});
  CHECK(runtime.evaluate(force::ForceEvaluationContext{8, {time::SimulationInstant{0, 0}, 0.0}, {0.0, 0.0, 0.0}, std::nullopt}, acceleration, failure));
  CHECK(std::abs(acceleration.x - 10.0 / 4.0) < 1e-14);

  auto zero_source = source(8, 0.0, 2.0);
  gravity.sources = {zero_source};
  provider = force::make_newtonian_gravity_provider(gravity, failure);
  runtime = force::ProviderRuntime({provider});
  CHECK(runtime.evaluate(force::ForceEvaluationContext{9, {time::SimulationInstant{0, 0}, 0.0}, {0.0, 0.0, 0.0}, std::nullopt}, acceleration, failure));
  CHECK(acceleration.x == 0.0);

  auto invalid = zero_source; invalid.mu.reset(); invalid.mass.reset();
  gravity.sources = {invalid};
  provider = force::make_newtonian_gravity_provider(gravity, failure);
  CHECK(provider.evaluate == nullptr);
  CHECK(failure.code == force::FailureCode::invalid_gravity_strength);

  gravity.sources = {source(9, 1.0, 0.0)};
  provider = force::make_newtonian_gravity_provider(gravity, failure);
  runtime = force::ProviderRuntime({provider});
  CHECK(runtime.evaluate(force::ForceEvaluationContext{9, {time::SimulationInstant{0, 0}, 0.0}, {0.0, 0.0, 0.0}, std::nullopt}, acceleration, failure));
  CHECK(acceleration.x == 0.0);
  CHECK(!runtime.evaluate(force::ForceEvaluationContext{10, {time::SimulationInstant{0, 0}, 0.0}, {0.0, 0.0, 0.0}, std::nullopt}, acceleration, failure));
  CHECK(failure.code == force::FailureCode::singular_gravity_geometry);
  return 0;
}

int finite_thrust_provider_and_mass() {
  using namespace orbit_engine;
  force::Failure failure;
  auto provider = thrust::make_finite_thrust_provider(thrust::FiniteThrustConfiguration{
    42,
    3,
    force::TimeInterval{time::SimulationInstant{0, 0}, time::SimulationInstant{10, 0}},
    frame::kRootReferenceFrameId,
    {thrust::FiniteThrustStage{
      force::TimeInterval{time::SimulationInstant{0, 0}, time::SimulationInstant{10, 0}},
      2.0,
      0.5,
      thrust::Direction{thrust::ReferenceFrameDirection{frame::kRootReferenceFrameId, 7, {1.0, 0.0, 0.0}, {}}},
      {thrust::MassFlowKind::direct, 1.0},
    }},
    std::nullopt,
    99,
    {},
  }, failure);
  CHECK(failure.code == force::FailureCode::none);
  force::ProviderRuntime runtime({provider});
  CHECK(runtime.valid());
  frame::Vec3 acceleration{};
  double rate = 0.0;
  CHECK(runtime.evaluate(force::ForceEvaluationContext{42, {{0, 0}, 0.5}, {}, 10.0}, acceleration, rate, failure));
  CHECK(std::abs(acceleration.x - 0.1) < 1e-14);
  CHECK(std::abs(rate + 0.5) < 1e-14);

  numerical::Configuration integrator;
  integrator.has_mass_component = true;
  integrator.position_absolute_tolerance_meters = 1e-10;
  integrator.velocity_absolute_tolerance_meters_per_second = 1e-10;
  integrator.mass_absolute_tolerance_kilograms = 1e-10;
  integrator.max_step = time::Duration{0, 100'000'000};
  numerical_motion::NumericalMotionSegment segment(
    numerical_motion::NumericalSegmentAnchor{42, {0, 0}, frame::kRootReferenceFrameId, {}, {}, 10.0, 4},
    numerical_motion::NumericalMotionConfiguration{
      integrator,
      force::ProviderRuntime({provider}),
      force::TimeInterval{time::SimulationInstant{0, 0}, time::SimulationInstant{10, 0}},
      std::nullopt,
      {},
      {},
      77,
    });
  CHECK(segment.valid());
  numerical_motion::Failure motion_failure;
  numerical_motion::NumericalState state;
  CHECK(segment.state_at({2, 0}, state, motion_failure));
  CHECK(std::abs(*state.mass - 9.0) < 1e-8);
  return 0;
}

int finite_thrust_direction_and_minimum_mass() {
  using namespace orbit_engine;
  const auto quarter_turn = frame::Quaternion{std::sqrt(0.5), 0.0, 0.0, std::sqrt(0.5)};
  const auto body = thrust::BodyFrameDirection{
    {1.0, 0.0, 0.0},
    500,
    8,
    [quarter_turn](const numerical::NumericalSampleTime&, frame::Quaternion& output, force::Failure&) {
      output = quarter_turn;
      return true;
    },
  };
  force::Failure failure;
  auto body_provider = thrust::make_finite_thrust_provider(thrust::FiniteThrustConfiguration{
    42, 3, force::TimeInterval{time::SimulationInstant{0, 0}, time::SimulationInstant{10, 0}}, frame::kRootReferenceFrameId,
    {thrust::FiniteThrustStage{force::TimeInterval{time::SimulationInstant{0, 0}, time::SimulationInstant{10, 0}}, 2.0, 1.0, thrust::Direction{body}, {thrust::MassFlowKind::direct, 0.0}}},
    std::nullopt, 99, {},
  }, failure);
  force::ProviderRuntime runtime({body_provider});
  frame::Vec3 acceleration{};
  double rate = 0.0;
  CHECK(runtime.evaluate(force::ForceEvaluationContext{42, {{0, 0}, 0.5}, {}, 10.0}, acceleration, rate, failure));
  CHECK(std::abs(acceleration.x) < 1e-14);
  CHECK(std::abs(acceleration.y - 0.2) < 1e-14);

  auto missing_attitude = body;
  missing_attitude.sample_attitude = {};
  auto missing_provider = thrust::make_finite_thrust_provider(thrust::FiniteThrustConfiguration{
    42, 3, force::TimeInterval{time::SimulationInstant{0, 0}, time::SimulationInstant{10, 0}}, frame::kRootReferenceFrameId,
    {thrust::FiniteThrustStage{force::TimeInterval{time::SimulationInstant{0, 0}, time::SimulationInstant{10, 0}}, 2.0, 1.0, thrust::Direction{missing_attitude}, {thrust::MassFlowKind::direct, 0.0}}},
    std::nullopt, 100, {},
  }, failure);
  CHECK(!missing_provider.evaluate_combined);
  CHECK(failure.code == force::FailureCode::invalid_direction);

  auto stale_attitude = body;
  stale_attitude.sample_attitude = [](const numerical::NumericalSampleTime&, frame::Quaternion&, force::Failure& failure) {
    failure = {force::FailureCode::source_unavailable, "prescribed attitude revision is stale"};
    return false;
  };
  auto stale_provider = thrust::make_finite_thrust_provider(thrust::FiniteThrustConfiguration{
    42, 3, force::TimeInterval{time::SimulationInstant{0, 0}, time::SimulationInstant{10, 0}}, frame::kRootReferenceFrameId,
    {thrust::FiniteThrustStage{force::TimeInterval{time::SimulationInstant{0, 0}, time::SimulationInstant{10, 0}}, 2.0, 1.0, thrust::Direction{stale_attitude}, {thrust::MassFlowKind::direct, 0.0}}},
    std::nullopt, 101, {},
  }, failure);
  CHECK(stale_provider.evaluate_combined);
  force::ProviderRuntime stale_runtime({stale_provider});
  CHECK(!stale_runtime.evaluate(force::ForceEvaluationContext{42, {{0, 0}, 0.5}, {}, 10.0}, acceleration, rate, failure));
  CHECK(failure.code == force::FailureCode::source_unavailable);

  auto minimum_provider = thrust::make_finite_thrust_provider(thrust::FiniteThrustConfiguration{
    42, 3, force::TimeInterval{time::SimulationInstant{0, 0}, time::SimulationInstant{10, 0}}, frame::kRootReferenceFrameId,
    {thrust::FiniteThrustStage{force::TimeInterval{time::SimulationInstant{0, 0}, time::SimulationInstant{10, 0}}, 2.0, 1.0, thrust::Direction{thrust::ReferenceFrameDirection{frame::kRootReferenceFrameId, 7, {1.0, 0.0, 0.0}, {}}}, {thrust::MassFlowKind::direct, 1.0}}},
    8.0, 99, {},
  }, failure);
  numerical::Configuration integrator;
  integrator.has_mass_component = true;
  integrator.position_absolute_tolerance_meters = 1e-10;
  integrator.velocity_absolute_tolerance_meters_per_second = 1e-10;
  integrator.mass_absolute_tolerance_kilograms = 1e-10;
  integrator.max_step = time::Duration{0, 100'000'000};
  numerical_motion::NumericalMotionSegment segment(
    numerical_motion::NumericalSegmentAnchor{42, {0, 0}, frame::kRootReferenceFrameId, {}, {}, 10.0, 4},
    numerical_motion::NumericalMotionConfiguration{
      integrator,
      force::ProviderRuntime({minimum_provider}),
      force::TimeInterval{time::SimulationInstant{0, 0}, time::SimulationInstant{10, 0}},
      std::nullopt, {}, {}, 77,
  });
  CHECK(segment.valid());
  numerical_motion::Failure motion_failure;
  numerical_motion::NumericalState boundary;
  CHECK(segment.state_at({2, 0}, boundary, motion_failure));
  CHECK(std::abs(*boundary.mass - 8.0) < 1e-8);
  numerical_motion::NumericalState after;
  CHECK(segment.state_at({3, 0}, after, motion_failure));
  CHECK(std::abs(*after.mass - 8.0) < 1e-8);
  return 0;
}

}  // namespace

int main() {
  if (gravity_and_order() != 0) return 1;
  if (strength_rules_and_failures() != 0) return 1;
  if (finite_thrust_provider_and_mass() != 0) return 1;
  if (finite_thrust_direction_and_minimum_mass() != 0) return 1;
  return 0;
}
