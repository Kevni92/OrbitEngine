#include "orbit_engine/coupled_operation.hpp"

#include <cmath>
#include <iostream>

#define CHECK(condition) do { if (!(condition)) { std::cerr << "CHECK failed: " << #condition << " at line " << __LINE__ << "\n"; return 1; } } while (false)

namespace {

orbit_engine::coupled_operation::MemberWire member(std::uint32_t id, double x) {
  orbit_engine::coupled_operation::MemberWire result;
  result.object_id_low = id;
  result.epoch = orbit_engine::time::TimeWire{0, 0, 0};
  result.frame_low = 1;
  result.position_x = x;
  result.mass_present = true;
  result.mass = 1.0;
  result.motion_revision_low = 1;
  return result;
}

orbit_engine::coupled_operation::CoupledWire fixture() {
  orbit_engine::coupled_operation::CoupledWire result;
  result.operation_code = static_cast<std::uint16_t>(orbit_engine::coupled_operation::OperationCode::promote);
  result.target_epoch = orbit_engine::time::TimeWire{0, 0, 0};
  result.member_count = 3;
  result.members[0] = member(1, -1.0);
  result.members[1] = member(2, 0.0);
  result.members[2] = member(3, 1.0);
  result.relative_tolerance = 1e-10;
  result.position_absolute_tolerance_meters = 1e-10;
  result.velocity_absolute_tolerance_meters_per_second = 1e-12;
  result.mass_absolute_tolerance_kilograms = 1e-8;
  result.checkpoint_stride_accepted_steps = 32;
  result.max_checkpoint_count = 64;
  result.max_dense_step_count = 256;
  result.max_accepted_steps_per_extension = 10'000;
  result.max_rejected_steps_per_extension = 1'000;
  result.min_step = orbit_engine::time::TimeWire{0, 0, 1};
  result.max_step = orbit_engine::time::TimeWire{0, 1, 0};
  return result;
}

int promote_batch_and_remove() {
  auto promoted = orbit_engine::coupled_operation::evaluate(fixture());
  CHECK(promoted.result_code == 0);
  CHECK(promoted.authority_id_low != 0);

  auto batch = promoted;
  batch.operation_code = static_cast<std::uint16_t>(orbit_engine::coupled_operation::OperationCode::evaluate);
  batch.requested_count = 3;
  batch.requested_id_low[0] = 1;
  batch.requested_id_low[1] = 2;
  batch.requested_id_low[2] = 3;
  auto evaluated = orbit_engine::coupled_operation::evaluate(batch);
  CHECK(evaluated.result_code == 0);
  CHECK(evaluated.result_count == 3);
  CHECK(evaluated.shared_evaluation_count_low == 1);

  auto removed = promoted;
  removed.operation_code = static_cast<std::uint16_t>(orbit_engine::coupled_operation::OperationCode::remove);
  removed.requested_count = 1;
  removed.requested_id_low[0] = 1;
  auto removed_result = orbit_engine::coupled_operation::evaluate(removed);
  CHECK(removed_result.result_code == 0);
  CHECK(removed_result.result_count == 1);
  CHECK(removed_result.authority_id_low != 0);
  return 0;
}

}  // namespace

int main() { return promote_batch_and_remove(); }
