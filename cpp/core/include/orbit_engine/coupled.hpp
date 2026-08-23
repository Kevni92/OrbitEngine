#pragma once

#include "orbit_engine/force.hpp"
#include "orbit_engine/numerical.hpp"
#include "orbit_engine/numerical_motion.hpp"
#include "orbit_engine/object.hpp"

#include <cstdint>
#include <functional>
#include <memory>
#include <optional>
#include <span>
#include <string>
#include <vector>

namespace orbit_engine::coupled {

using CoupledAuthorityId = std::uint64_t;

enum class FailureCode : std::uint16_t {
  none = 0,
  invalid_configuration = 1,
  invalid_membership = 2,
  invalid_state = 3,
  target_outside_validity = 4,
  unsupported_temporal_direction = 5,
  numerical_failure = 6,
  singular_geometry = 7,
  transaction_rejected = 8,
};

struct Failure {
  FailureCode code = FailureCode::none;
  std::string message;
};

struct MemberAnchor {
  object::ObjectId object_id = 0;
  time::SimulationInstant epoch{};
  frame::ReferenceFrameId propagation_frame = 0;
  frame::Vec3 position{};
  frame::Vec3 velocity{};
  std::optional<double> mass;
  std::optional<double> mu;
  std::uint64_t motion_revision = 0;
  std::uint64_t property_revision = 0;
  std::uint64_t mass_revision = 0;
};

struct MemberState {
  time::SimulationInstant epoch{};
  frame::ReferenceFrameId propagation_frame = 0;
  frame::Vec3 position{};
  frame::Vec3 velocity{};
  std::optional<double> mass;
};

struct Configuration {
  numerical::Configuration integrator;
  force::ProviderRuntime external_providers;
  std::optional<numerical_motion::FrameDynamicsDefinition> frame_dynamics;
  std::vector<numerical::HardBoundary> hard_boundaries;
  std::optional<time::SimulationInstant> validity_end;
  std::uint64_t configuration_identity = 1;
};

class CoupledAuthority {
public:
  CoupledAuthority(
    std::vector<MemberAnchor> members,
    Configuration configuration,
    std::uint64_t group_revision = 0
  );
  ~CoupledAuthority();

  CoupledAuthority(const CoupledAuthority&) = delete;
  CoupledAuthority& operator=(const CoupledAuthority&) = delete;
  CoupledAuthority(CoupledAuthority&&) = delete;
  CoupledAuthority& operator=(CoupledAuthority&&) = delete;

  [[nodiscard]] bool valid() const noexcept;
  [[nodiscard]] const Failure& construction_failure() const noexcept;
  [[nodiscard]] CoupledAuthorityId authority_id() const noexcept;
  [[nodiscard]] std::uint64_t group_revision() const noexcept;
  [[nodiscard]] std::uint64_t cache_identity() const noexcept;
  [[nodiscard]] const std::vector<MemberAnchor>& members() const noexcept;
  [[nodiscard]] const Configuration& configuration() const noexcept;
  [[nodiscard]] std::vector<numerical::HardBoundary> hard_boundaries() const;
  [[nodiscard]] std::size_t member_slot(object::ObjectId object_id) const noexcept;

  [[nodiscard]] bool state_at(
    object::ObjectId object_id,
    time::SimulationInstant target,
    MemberState& state,
    Failure& failure
  );

  // One shared tape evaluation serves all requested members. Results are
  // returned in the caller's requested order; internal integration remains in
  // canonical ObjectId order.
  [[nodiscard]] bool state_batch(
    const std::vector<object::ObjectId>& object_ids,
    time::SimulationInstant target,
    std::vector<MemberState>& states,
    Failure& failure
  );

  [[nodiscard]] std::size_t shared_evaluation_count() const noexcept;
  [[nodiscard]] numerical::TapeDiagnostics diagnostics() const noexcept;

private:
  std::vector<MemberAnchor> members_;
  Configuration configuration_;
  CoupledAuthorityId authority_id_ = 0;
  std::uint64_t group_revision_ = 0;
  std::uint64_t cache_identity_ = 0;
  Failure construction_failure_;
  bool valid_ = false;
  std::vector<numerical::HardBoundary> hard_boundaries_;
  std::unique_ptr<numerical::DOP853Tape> tape_;
  std::size_t shared_evaluation_count_ = 0;

  [[nodiscard]] bool evaluate_shared(
    time::SimulationInstant target,
    std::vector<double>& values,
    Failure& failure
  );
  [[nodiscard]] bool extract_state(
    object::ObjectId object_id,
    time::SimulationInstant target,
    const std::vector<double>& values,
    MemberState& state,
    Failure& failure
  ) const;
  [[nodiscard]] static bool evaluate_derivative(
    const CoupledAuthority& authority,
    const numerical::NumericalSampleTime& sample_time,
    std::span<const double> state,
    std::span<double> derivative,
    numerical::Failure& failure
  );
};

struct MemberCandidate {
  object::ObjectId object_id = 0;
  std::uint64_t motion_revision = 0;
  std::uint64_t property_revision = 0;
  std::uint64_t mass_revision = 0;
  std::function<bool(time::SimulationInstant, MemberAnchor&, Failure&)> evaluate;
};

class CoupledAuthorityManager {
public:
  CoupledAuthorityManager() = default;

  [[nodiscard]] const CoupledAuthority* authority() const noexcept;
  [[nodiscard]] CoupledAuthority* authority() noexcept;

  [[nodiscard]] bool promote(
    time::SimulationInstant target,
    std::vector<MemberCandidate> candidates,
    Configuration configuration,
    Failure& failure
  );

  [[nodiscard]] bool demote(
    time::SimulationInstant target,
    const std::vector<object::ObjectId>& object_ids,
    std::vector<MemberAnchor>& successor_anchors,
    Failure& failure
  );

  [[nodiscard]] bool remove(
    time::SimulationInstant target,
    object::ObjectId object_id,
    MemberAnchor& removed_anchor,
    Failure& failure
  );

private:
  std::unique_ptr<CoupledAuthority> authority_;
  std::uint64_t next_group_revision_ = 1;

  [[nodiscard]] std::unique_ptr<CoupledAuthority> make_successor(
    time::SimulationInstant target,
    const std::vector<MemberAnchor>& anchors,
    const Configuration& configuration,
    Failure& failure
  );
};

}  // namespace orbit_engine::coupled
