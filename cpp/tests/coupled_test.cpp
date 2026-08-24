#include "orbit_engine/coupled.hpp"
#include "orbit_engine/thrust.hpp"

#include <cmath>
#include <iostream>
#include <algorithm>
#include <utility>

#define CHECK(condition) do { if (!(condition)) { std::cerr << "CHECK failed: " << #condition << " at line " << __LINE__ << "\n"; return 1; } } while (false)

namespace {

using namespace orbit_engine;

numerical::Configuration integration() {
  numerical::Configuration value;
  value.position_absolute_tolerance_meters = 1e-10;
  value.velocity_absolute_tolerance_meters_per_second = 1e-10;
  value.max_step = time::Duration{0, 50'000'000};
  value.max_accepted_steps_per_extension = 100'000;
  return value;
}

coupled::Configuration configuration() {
  return coupled::Configuration{
    integration(),
    force::ProviderRuntime({}),
    std::nullopt,
    {},
    time::SimulationInstant{10, 0},
    21,
  };
}

coupled::MemberAnchor member(
  object::ObjectId id,
  double x,
  double y,
  double vx,
  double vy,
  std::optional<double> mass,
  std::optional<double> mu,
  std::uint64_t revision = 1
) {
  return coupled::MemberAnchor{
    id,
    time::SimulationInstant{0, 0},
    frame::kRootReferenceFrameId,
    frame::Vec3{x, y, 0.0},
    frame::Vec3{vx, vy, 0.0},
    mass,
    mu,
    revision,
    revision,
    revision,
  };
}

int mutual_gravity_and_batch() {
  coupled::CoupledAuthority authority(
    {
      member(20, 1.0, 0.0, 0.0, 0.5, 1.0, 1.0),
      member(10, -1.0, 0.0, 0.0, -0.5, 1.0, 1.0),
    },
    configuration(),
    4);
  CHECK(authority.valid());
  CHECK(authority.members()[0].object_id == 10);
  CHECK(authority.members()[1].object_id == 20);
  CHECK(authority.member_slot(10) == 0);
  CHECK(authority.member_slot(20) == 1);

  coupled::Failure failure;
  coupled::MemberState left;
  coupled::MemberState right;
  CHECK(authority.state_at(10, {0, 100'000'000}, left, failure));
  CHECK(authority.state_at(20, {0, 100'000'000}, right, failure));
  CHECK(left.position.x > -1.0);
  CHECK(right.position.x < 1.0);

  const auto before_batch = authority.shared_evaluation_count();
  std::vector<coupled::MemberState> batch;
  CHECK(authority.state_batch({20, 10}, {0, 200'000'000}, batch, failure));
  CHECK(batch.size() == 2);
  CHECK(batch[0].position.x > batch[1].position.x);
  CHECK(authority.shared_evaluation_count() == before_batch + 1);
  return 0;
}

int massless_response_and_figure_eight_order() {
  auto massless = coupled::CoupledAuthority(
    {member(2, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0), member(1, 0.0, 0.0, 0.0, 0.0, 1.0, 1.0)},
    configuration(),
    5);
  CHECK(massless.valid());
  coupled::Failure failure;
  coupled::MemberState test_particle;
  coupled::MemberState source;
  CHECK(massless.state_at(2, {0, 100'000'000}, test_particle, failure));
  CHECK(massless.state_at(1, {0, 100'000'000}, source, failure));
  CHECK(test_particle.velocity.x < 0.0);
  CHECK(std::abs(source.velocity.x) < 1e-12);

  const auto figure = std::vector<coupled::MemberAnchor>{
    member(30, 0.97000436, 0.24308753, 0.466203685, 0.43236573, 1.0, 1.0),
    member(10, -0.97000436, 0.24308753, 0.466203685, 0.43236573, 1.0, 1.0),
    member(20, 0.0, -0.48617507, -0.93240737, -0.86473146, 1.0, 1.0),
  };
  coupled::CoupledAuthority first(figure, configuration(), 6);
  auto reversed = figure;
  std::reverse(reversed.begin(), reversed.end());
  coupled::CoupledAuthority second(reversed, configuration(), 7);
  CHECK(first.valid() && second.valid());
  coupled::MemberState first_state;
  coupled::MemberState second_state;
  CHECK(first.state_at(10, {0, 10'000'000}, first_state, failure));
  CHECK(second.state_at(10, {0, 10'000'000}, second_state, failure));
  CHECK(std::abs(first_state.position.x - second_state.position.x) < 1e-11);
  CHECK(std::abs(first_state.velocity.y - second_state.velocity.y) < 1e-11);
  return 0;
}

int atomic_lifecycle_and_bounds() {
  coupled::CoupledAuthorityManager manager;
  auto candidate = [](object::ObjectId id, double x) {
    return coupled::MemberCandidate{
      id, 1, 2, 3,
      [id, x](time::SimulationInstant target, coupled::MemberAnchor& anchor, coupled::Failure&) {
        anchor = member(id, x, 0.0, 0.0, 0.0, 1.0, 1.0);
        anchor.epoch = target;
        return true;
      },
    };
  };
  coupled::Failure failure;
  CHECK(manager.promote({0, 0}, {candidate(2, 1.0), candidate(1, -1.0)}, configuration(), failure));
  CHECK(manager.authority() != nullptr);
  const auto original_identity = manager.authority()->cache_identity();

  auto invalid_candidate = candidate(3, 0.0);
  invalid_candidate.evaluate = [](time::SimulationInstant, coupled::MemberAnchor&, coupled::Failure& failure) {
    failure = coupled::Failure{coupled::FailureCode::transaction_rejected, "fixture failure"};
    return false;
  };
  CHECK(!manager.promote({1, 0}, {candidate(1, -1.0), invalid_candidate}, configuration(), failure));
  CHECK(manager.authority() != nullptr);
  CHECK(manager.authority()->cache_identity() == original_identity);

  std::vector<coupled::MemberAnchor> demoted;
  CHECK(manager.demote({0, 100'000'000}, {1, 2}, demoted, failure));
  CHECK(manager.authority() == nullptr);
  CHECK(demoted.size() == 2);

  coupled::CoupledAuthority one({member(1, 0, 0, 0, 0, 1, 1)}, configuration(), 1);
  CHECK(!one.valid());
  std::vector<coupled::MemberAnchor> thirty_two;
  for (std::uint64_t id = 1; id <= 32; ++id) thirty_two.push_back(member(id, static_cast<double>(id) * 10.0, 0, 0, 0, 1, 0));
  coupled::CoupledAuthority max_group(std::move(thirty_two), configuration(), 9);
  CHECK(max_group.valid());
  std::vector<coupled::MemberAnchor> thirty_three;
  for (std::uint64_t id = 1; id <= 33; ++id) thirty_three.push_back(member(id, static_cast<double>(id) * 10.0, 0, 0, 0, 1, 0));
  coupled::CoupledAuthority too_large(std::move(thirty_three), configuration(), 10);
  CHECK(!too_large.valid());
  CHECK(too_large.construction_failure().code == coupled::FailureCode::invalid_membership);
  return 0;
}

int member_specific_external_thrust() {
  force::Failure force_failure;
  auto thrust_provider = thrust::make_finite_thrust_provider(thrust::FiniteThrustConfiguration{
    2,
    4,
    force::TimeInterval{time::SimulationInstant{0, 0}, time::SimulationInstant{10, 0}},
    frame::kRootReferenceFrameId,
    {thrust::FiniteThrustStage{
      force::TimeInterval{time::SimulationInstant{0, 0}, time::SimulationInstant{10, 0}},
      1.0,
      1.0,
      thrust::Direction{thrust::ReferenceFrameDirection{frame::kRootReferenceFrameId, 9, {1.0, 0.0, 0.0}, {}}},
      {thrust::MassFlowKind::direct, 0.0},
    }},
    std::nullopt,
    101,
    {},
  }, force_failure);
  CHECK(force_failure.code == force::FailureCode::none);
  auto coupled_configuration = configuration();
  coupled_configuration.external_providers = force::ProviderRuntime({thrust_provider});
  coupled::CoupledAuthority authority(
    {member(1, -10.0, 0.0, 0.0, 0.0, 1.0, 0.0), member(2, 10.0, 0.0, 0.0, 0.0, 1.0, 0.0)},
    std::move(coupled_configuration),
    22);
  CHECK(authority.valid());
  coupled::Failure failure;
  coupled::MemberState target;
  coupled::MemberState other;
  CHECK(authority.state_at(2, {0, 100'000'000}, target, failure));
  CHECK(authority.state_at(1, {0, 100'000'000}, other, failure));
  CHECK(target.velocity.x > 0.0);
  CHECK(std::abs(other.velocity.x) < 1e-12);
  return 0;
}

}  // namespace

int main() {
  if (mutual_gravity_and_batch() != 0) return 1;
  if (massless_response_and_figure_eight_order() != 0) return 1;
  if (atomic_lifecycle_and_bounds() != 0) return 1;
  if (member_specific_external_thrust() != 0) return 1;
  return 0;
}
