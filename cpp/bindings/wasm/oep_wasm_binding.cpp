#include "orbit_engine/oep.hpp"

#include <cstddef>
#include <cstdint>
#include <span>
#include <emscripten/emscripten.h>

namespace {

orbit_engine::oep::Registry g_oep_registry;
orbit_engine::oep::DatasetInfoWire g_dataset_output{};
orbit_engine::oep::SourceInfoWire g_source_output{};
orbit_engine::oep::EvaluationWire g_evaluation_output{};

std::uint64_t handle_from_words(std::uint32_t high, std::uint32_t low) {
  return (static_cast<std::uint64_t>(high) << 32U) | static_cast<std::uint64_t>(low);
}

}  // namespace

extern "C" {

EMSCRIPTEN_KEEPALIVE std::uint16_t orbit_engine_oep_load(const std::uint8_t* data, std::uint32_t length) {
  if (data == nullptr && length != 0) {
    g_dataset_output = orbit_engine::oep::DatasetInfoWire{
      static_cast<std::uint16_t>(orbit_engine::oep::ResultCode::invalid_input), 0, 0, 0, 0, 0,
    };
  } else {
    g_dataset_output = g_oep_registry.load(std::span<const std::uint8_t>(data, length));
  }
  return g_dataset_output.result_code;
}

EMSCRIPTEN_KEEPALIVE std::uint16_t orbit_engine_oep_retain(std::uint32_t handle_high, std::uint32_t handle_low) {
  g_dataset_output = g_oep_registry.retain(handle_from_words(handle_high, handle_low));
  return g_dataset_output.result_code;
}

EMSCRIPTEN_KEEPALIVE std::uint16_t orbit_engine_oep_release_reference(std::uint32_t handle_high, std::uint32_t handle_low) {
  g_dataset_output = g_oep_registry.release_reference(handle_from_words(handle_high, handle_low));
  return g_dataset_output.result_code;
}

EMSCRIPTEN_KEEPALIVE std::uint16_t orbit_engine_oep_unload(std::uint32_t handle_high, std::uint32_t handle_low) {
  g_dataset_output = g_oep_registry.unload(handle_from_words(handle_high, handle_low));
  return g_dataset_output.result_code;
}

EMSCRIPTEN_KEEPALIVE std::uint16_t orbit_engine_oep_source_info(
  std::uint32_t handle_high,
  std::uint32_t handle_low,
  std::uint32_t source_node_id
) {
  g_source_output = g_oep_registry.source_info(handle_from_words(handle_high, handle_low), source_node_id);
  return g_source_output.result_code;
}

EMSCRIPTEN_KEEPALIVE std::uint16_t orbit_engine_oep_evaluate(
  std::uint32_t handle_high,
  std::uint32_t handle_low,
  std::uint32_t source_node_id,
  std::uint16_t evaluation_mode_code,
  std::int32_t target_seconds_high,
  std::uint32_t target_seconds_low,
  std::uint32_t target_nanoseconds
) {
  g_evaluation_output = g_oep_registry.evaluate(
    handle_from_words(handle_high, handle_low),
    source_node_id,
    static_cast<orbit_engine::oep::EvaluationMode>(evaluation_mode_code),
    orbit_engine::time::TimeWire{target_seconds_high, target_seconds_low, target_nanoseconds}
  );
  return g_evaluation_output.result_code;
}

#define OEP_DATASET_GETTER(name, field, type) \
  EMSCRIPTEN_KEEPALIVE type name() { return g_dataset_output.field; }

OEP_DATASET_GETTER(orbit_engine_oep_dataset_result_code, result_code, std::uint16_t)
OEP_DATASET_GETTER(orbit_engine_oep_dataset_handle_high, handle_high, std::uint32_t)
OEP_DATASET_GETTER(orbit_engine_oep_dataset_handle_low, handle_low, std::uint32_t)
OEP_DATASET_GETTER(orbit_engine_oep_dataset_revision_high, dataset_revision_high, std::uint32_t)
OEP_DATASET_GETTER(orbit_engine_oep_dataset_revision_low, dataset_revision_low, std::uint32_t)
OEP_DATASET_GETTER(orbit_engine_oep_dataset_source_count, source_count, std::uint32_t)

#undef OEP_DATASET_GETTER

#define OEP_SOURCE_GETTER(name, field, type) \
  EMSCRIPTEN_KEEPALIVE type name() { return g_source_output.field; }

OEP_SOURCE_GETTER(orbit_engine_oep_source_result_code, result_code, std::uint16_t)
OEP_SOURCE_GETTER(orbit_engine_oep_source_handle_high, handle_high, std::uint32_t)
OEP_SOURCE_GETTER(orbit_engine_oep_source_handle_low, handle_low, std::uint32_t)
OEP_SOURCE_GETTER(orbit_engine_oep_source_node_id, source_node_id, std::uint32_t)
OEP_SOURCE_GETTER(orbit_engine_oep_source_center_node_id, center_source_node_id, std::uint32_t)
OEP_SOURCE_GETTER(orbit_engine_oep_source_representation_code, representation_code, std::uint16_t)
OEP_SOURCE_GETTER(orbit_engine_oep_source_revision_high, source_revision_high, std::uint32_t)
OEP_SOURCE_GETTER(orbit_engine_oep_source_revision_low, source_revision_low, std::uint32_t)
OEP_SOURCE_GETTER(orbit_engine_oep_source_validity_start_seconds_high, validity_start.seconds_high, std::int32_t)
OEP_SOURCE_GETTER(orbit_engine_oep_source_validity_start_seconds_low, validity_start.seconds_low, std::uint32_t)
OEP_SOURCE_GETTER(orbit_engine_oep_source_validity_start_nanoseconds, validity_start.nanoseconds, std::uint32_t)
OEP_SOURCE_GETTER(orbit_engine_oep_source_validity_end_seconds_high, validity_end.seconds_high, std::int32_t)
OEP_SOURCE_GETTER(orbit_engine_oep_source_validity_end_seconds_low, validity_end.seconds_low, std::uint32_t)
OEP_SOURCE_GETTER(orbit_engine_oep_source_validity_end_nanoseconds, validity_end.nanoseconds, std::uint32_t)
OEP_SOURCE_GETTER(orbit_engine_oep_source_effective_start_seconds_high, effective_validity_start.seconds_high, std::int32_t)
OEP_SOURCE_GETTER(orbit_engine_oep_source_effective_start_seconds_low, effective_validity_start.seconds_low, std::uint32_t)
OEP_SOURCE_GETTER(orbit_engine_oep_source_effective_start_nanoseconds, effective_validity_start.nanoseconds, std::uint32_t)
OEP_SOURCE_GETTER(orbit_engine_oep_source_effective_end_seconds_high, effective_validity_end.seconds_high, std::int32_t)
OEP_SOURCE_GETTER(orbit_engine_oep_source_effective_end_seconds_low, effective_validity_end.seconds_low, std::uint32_t)
OEP_SOURCE_GETTER(orbit_engine_oep_source_effective_end_nanoseconds, effective_validity_end.nanoseconds, std::uint32_t)
OEP_SOURCE_GETTER(orbit_engine_oep_source_position_error_meters, position_error_meters, double)
OEP_SOURCE_GETTER(orbit_engine_oep_source_velocity_error_meters_per_second, velocity_error_meters_per_second, double)

#undef OEP_SOURCE_GETTER

#define OEP_EVALUATION_GETTER(name, field, type) \
  EMSCRIPTEN_KEEPALIVE type name() { return g_evaluation_output.field; }

OEP_EVALUATION_GETTER(orbit_engine_oep_evaluation_result_code, result_code, std::uint16_t)
OEP_EVALUATION_GETTER(orbit_engine_oep_evaluation_handle_high, handle_high, std::uint32_t)
OEP_EVALUATION_GETTER(orbit_engine_oep_evaluation_handle_low, handle_low, std::uint32_t)
OEP_EVALUATION_GETTER(orbit_engine_oep_evaluation_source_node_id, source_node_id, std::uint32_t)
OEP_EVALUATION_GETTER(orbit_engine_oep_evaluation_mode_code, evaluation_mode_code, std::uint16_t)
OEP_EVALUATION_GETTER(orbit_engine_oep_evaluation_record_index, record_index, std::uint32_t)
OEP_EVALUATION_GETTER(orbit_engine_oep_evaluation_source_revision_high, source_revision_high, std::uint32_t)
OEP_EVALUATION_GETTER(orbit_engine_oep_evaluation_source_revision_low, source_revision_low, std::uint32_t)
OEP_EVALUATION_GETTER(orbit_engine_oep_evaluation_epoch_seconds_high, epoch.seconds_high, std::int32_t)
OEP_EVALUATION_GETTER(orbit_engine_oep_evaluation_epoch_seconds_low, epoch.seconds_low, std::uint32_t)
OEP_EVALUATION_GETTER(orbit_engine_oep_evaluation_epoch_nanoseconds, epoch.nanoseconds, std::uint32_t)
OEP_EVALUATION_GETTER(orbit_engine_oep_evaluation_position_x, position_x, double)
OEP_EVALUATION_GETTER(orbit_engine_oep_evaluation_position_y, position_y, double)
OEP_EVALUATION_GETTER(orbit_engine_oep_evaluation_position_z, position_z, double)
OEP_EVALUATION_GETTER(orbit_engine_oep_evaluation_velocity_x, velocity_x, double)
OEP_EVALUATION_GETTER(orbit_engine_oep_evaluation_velocity_y, velocity_y, double)
OEP_EVALUATION_GETTER(orbit_engine_oep_evaluation_velocity_z, velocity_z, double)

#undef OEP_EVALUATION_GETTER

}
