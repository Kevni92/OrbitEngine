#include "orbit_engine/force.hpp"

#include <cmath>
#include <iostream>
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

}  // namespace

int main() {
  if (gravity_and_order() != 0) return 1;
  if (strength_rules_and_failures() != 0) return 1;
  return 0;
}
