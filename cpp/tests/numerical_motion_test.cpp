#include "orbit_engine/numerical_motion.hpp"

#include <cmath>
#include <iostream>
#include <limits>
#include <utility>

#define CHECK(condition) do { if (!(condition)) { std::cerr << "CHECK failed: " << #condition << " at line " << __LINE__ << "\n"; return 1; } } while (false)

namespace {

using namespace orbit_engine;

numerical::Configuration integrator(bool has_mass = false) {
  numerical::Configuration value;
  value.has_mass_component = has_mass;
  value.position_absolute_tolerance_meters = 1e-10;
  value.velocity_absolute_tolerance_meters_per_second = 1e-10;
  value.mass_absolute_tolerance_kilograms = 1e-10;
  value.max_step = time::Duration{0, 250'000'000};
  value.max_accepted_steps_per_extension = 20'000;
  return value;
}

force::Provider constant_acceleration_provider(time::SimulationInstant start, time::SimulationInstant end) {
  force::Provider provider;
  provider.definition.kind = force::ProviderKind::custom;
  provider.definition.order = 0;
  provider.definition.validity = force::TimeInterval{start, end};
  provider.definition.configuration_identity = 12;
  provider.evaluate = [](const force::ForceEvaluationContext&, frame::Vec3& acceleration, force::Failure&) {
    acceleration = frame::Vec3{2.0, -1.0, 0.5};
    return true;
  };
  return provider;
}

numerical_motion::NumericalMotionConfiguration configuration(
  bool has_mass = false,
  std::vector<force::Provider> providers = {}
) {
  numerical_motion::NumericalMotionConfiguration value{
    integrator(has_mass),
    force::ProviderRuntime(std::move(providers)),
    force::TimeInterval{time::SimulationInstant{0, 0}, time::SimulationInstant{10, 0}},
  };
  return value;
}

numerical_motion::NumericalSegmentAnchor anchor(
  frame::ReferenceFrameId propagation_frame = frame::kRootReferenceFrameId,
  std::optional<double> mass = std::nullopt
) {
  return numerical_motion::NumericalSegmentAnchor{
    42,
    time::SimulationInstant{0, 0},
    propagation_frame,
    frame::Vec3{1.0, 2.0, 0.0},
    frame::Vec3{3.0, -4.0, 0.0},
    mass,
    7,
  };
}

int constant_acceleration_and_partition() {
  const auto provider = constant_acceleration_provider({0, 0}, {10, 0});
  auto direct_configuration = configuration(false, {provider});
  numerical_motion::NumericalMotionSegment direct(anchor(), std::move(direct_configuration));
  CHECK(direct.valid());
  numerical_motion::Failure failure;
  numerical_motion::NumericalState direct_state;
  CHECK(direct.state_at({2, 0}, direct_state, failure));
  CHECK(std::abs(direct_state.position.x - 11.0) < 1e-8);
  CHECK(std::abs(direct_state.position.y + 8.0) < 1e-8);
  CHECK(std::abs(direct_state.velocity.x - 7.0) < 1e-9);
  CHECK(std::abs(direct_state.velocity.y + 6.0) < 1e-9);
  CHECK(time::compare(direct_state.epoch, time::SimulationInstant{2, 0}) == 0);

  auto partitioned_configuration = configuration(false, {provider});
  numerical_motion::NumericalMotionSegment partitioned(anchor(), std::move(partitioned_configuration));
  numerical_motion::NumericalState first;
  numerical_motion::NumericalState second;
  CHECK(partitioned.state_at({1, 0}, first, failure));
  CHECK(partitioned.state_at({2, 0}, second, failure));
  CHECK(std::abs(second.position.x - direct_state.position.x) < 1e-8);
  CHECK(std::abs(second.velocity.y - direct_state.velocity.y) < 1e-9);

  auto discontinuous_configuration = configuration(false, {
    constant_acceleration_provider({0, 0}, {1, 0}),
  });
  numerical_motion::NumericalMotionSegment discontinuous(anchor(), std::move(discontinuous_configuration));
  CHECK(discontinuous.valid());
  numerical_motion::NumericalState unchanged;
  CHECK(!discontinuous.state_at({1, 500'000'000}, unchanged, failure));
  CHECK(failure.code == numerical_motion::FailureCode::numerical_failure);
  return 0;
}

int frame_dynamics_and_validation() {
  auto missing_configuration = configuration();
  numerical_motion::NumericalMotionSegment missing(anchor(99), std::move(missing_configuration));
  CHECK(!missing.valid());
  CHECK(missing.construction_failure().code == numerical_motion::FailureCode::missing_frame_dynamics);

  auto frame_configuration = configuration();
  frame_configuration.frame_dynamics = numerical_motion::FrameDynamicsDefinition{
    99,
    force::TimeInterval{time::SimulationInstant{0, 0}, time::SimulationInstant{10, 0}},
    5,
    [](const numerical::NumericalSampleTime& sample_time, numerical_motion::FrameDynamicsSample& sample, numerical_motion::Failure& failure) {
      if (sample_time.offset_seconds < 0.0) {
        failure = numerical_motion::Failure{numerical_motion::FailureCode::invalid_frame_dynamics, "negative stage offset"};
        return false;
      }
      sample = numerical_motion::FrameDynamicsSample{
        frame::Quaternion{1.0, 0.0, 0.0, 0.0},
        frame::Vec3{0.0, 0.0, 0.0},
        frame::Vec3{0.0, 0.0, 1.0},
        frame::Vec3{0.0, 0.0, 0.0},
      };
      failure = {};
      return true;
    },
  };
  numerical_motion::NumericalMotionSegment rotating(anchor(99), std::move(frame_configuration));
  CHECK(rotating.valid());
  numerical_motion::Failure failure;
  numerical_motion::NumericalState state;
  CHECK(rotating.state_at({0, 1'000'000}, state, failure));
  CHECK(std::abs(state.position.x - 1.0029965) < 2e-9);
  CHECK(std::abs(state.position.y - 1.995998) < 2e-9);

  auto invalid_sample_configuration = configuration();
  invalid_sample_configuration.frame_dynamics = numerical_motion::FrameDynamicsDefinition{
    99,
    force::TimeInterval{time::SimulationInstant{0, 0}, time::SimulationInstant{10, 0}},
    6,
    [](const numerical::NumericalSampleTime&, numerical_motion::FrameDynamicsSample& sample, numerical_motion::Failure&) {
      sample.root_from_integration_frame = frame::Quaternion{2.0, 0.0, 0.0, 0.0};
      sample.origin_acceleration = frame::Vec3{0.0, 0.0, 0.0};
      sample.angular_velocity = frame::Vec3{0.0, 0.0, 0.0};
      sample.angular_acceleration = frame::Vec3{0.0, 0.0, 0.0};
      return true;
    },
  };
  numerical_motion::NumericalMotionSegment invalid_sample(anchor(99), std::move(invalid_sample_configuration));
  CHECK(invalid_sample.valid());
  CHECK(!invalid_sample.state_at({0, 1}, state, failure));
  CHECK(failure.code == numerical_motion::FailureCode::numerical_failure);
  return 0;
}

int mass_authority_and_invalidation() {
  auto mass_configuration = configuration(true);
  mass_configuration.mass_flow_providers.push_back(numerical_motion::MassFlowProvider{
    numerical_motion::MassFlowProviderDefinition{
      0,
      force::TimeInterval{time::SimulationInstant{0, 0}, time::SimulationInstant{10, 0}},
      {{force::DependencyKind::mass, 42, 3}},
      33,
    },
    [](const force::ForceEvaluationContext&, double& rate, force::Failure&) {
      rate = -1.0;
      return true;
    },
  });
  numerical_motion::NumericalMotionSegment segment(anchor(frame::kRootReferenceFrameId, 10.0), std::move(mass_configuration));
  CHECK(segment.valid());
  numerical_motion::Failure failure;
  std::optional<double> mass;
  CHECK(segment.mass_at({2, 0}, mass, failure));
  CHECK(mass.has_value());
  CHECK(std::abs(*mass - 8.0) < 1e-8);

  numerical_motion::NumericalState before;
  CHECK(segment.state_at({5, 0}, before, failure));
  CHECK(segment.invalidate_from({2, 0}, 8, failure));
  CHECK(segment.state_at({1, 0}, before, failure));
  numerical_motion::NumericalState after;
  CHECK(segment.state_at({3, 0}, after, failure));
  CHECK(std::abs(*after.mass - 7.0) < 1e-8);
  CHECK(segment.cache_identity() != 0);

  auto negative_anchor = anchor(frame::kRootReferenceFrameId, -1.0);
  numerical_motion::NumericalMotionSegment invalid(std::move(negative_anchor), configuration(true));
  CHECK(!invalid.valid());
  CHECK(invalid.construction_failure().code == numerical_motion::FailureCode::invalid_mass);
  return 0;
}

}  // namespace

int main() {
  if (constant_acceleration_and_partition() != 0) return 1;
  if (frame_dynamics_and_validation() != 0) return 1;
  if (mass_authority_and_invalidation() != 0) return 1;
  return 0;
}
