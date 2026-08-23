import type { EphemerisBackend } from "./ephemeris-backend.js";
import {
  validateOepDatasetInfoWire,
  validateOepEvaluationWire,
  validateOepSourceInfoWire,
} from "./oep-wire.js";
import type { TimeWire } from "./time-wire.js";
import { BackendInitializationError } from "./backends/errors.js";

interface OepWasmModule {
  readonly HEAPU8: Uint8Array;
  _malloc(size: number): number;
  _free(pointer: number): void;
  _orbit_engine_oep_load(pointer: number, length: number): number;
  _orbit_engine_oep_retain(handleHigh: number, handleLow: number): number;
  _orbit_engine_oep_release_reference(handleHigh: number, handleLow: number): number;
  _orbit_engine_oep_unload(handleHigh: number, handleLow: number): number;
  _orbit_engine_oep_source_info(handleHigh: number, handleLow: number, sourceNodeId: number): number;
  _orbit_engine_oep_evaluate(
    handleHigh: number,
    handleLow: number,
    sourceNodeId: number,
    mode: number,
    targetSecondsHigh: number,
    targetSecondsLow: number,
    targetNanoseconds: number,
  ): number;
  _orbit_engine_oep_dataset_result_code(): number;
  _orbit_engine_oep_dataset_handle_high(): number;
  _orbit_engine_oep_dataset_handle_low(): number;
  _orbit_engine_oep_dataset_revision_high(): number;
  _orbit_engine_oep_dataset_revision_low(): number;
  _orbit_engine_oep_dataset_source_count(): number;
  _orbit_engine_oep_source_result_code(): number;
  _orbit_engine_oep_source_handle_high(): number;
  _orbit_engine_oep_source_handle_low(): number;
  _orbit_engine_oep_source_node_id(): number;
  _orbit_engine_oep_source_center_node_id(): number;
  _orbit_engine_oep_source_representation_code(): number;
  _orbit_engine_oep_source_revision_high(): number;
  _orbit_engine_oep_source_revision_low(): number;
  _orbit_engine_oep_source_validity_start_seconds_high(): number;
  _orbit_engine_oep_source_validity_start_seconds_low(): number;
  _orbit_engine_oep_source_validity_start_nanoseconds(): number;
  _orbit_engine_oep_source_validity_end_seconds_high(): number;
  _orbit_engine_oep_source_validity_end_seconds_low(): number;
  _orbit_engine_oep_source_validity_end_nanoseconds(): number;
  _orbit_engine_oep_source_effective_start_seconds_high(): number;
  _orbit_engine_oep_source_effective_start_seconds_low(): number;
  _orbit_engine_oep_source_effective_start_nanoseconds(): number;
  _orbit_engine_oep_source_effective_end_seconds_high(): number;
  _orbit_engine_oep_source_effective_end_seconds_low(): number;
  _orbit_engine_oep_source_effective_end_nanoseconds(): number;
  _orbit_engine_oep_source_position_error_meters(): number;
  _orbit_engine_oep_source_velocity_error_meters_per_second(): number;
  _orbit_engine_oep_evaluation_result_code(): number;
  _orbit_engine_oep_evaluation_handle_high(): number;
  _orbit_engine_oep_evaluation_handle_low(): number;
  _orbit_engine_oep_evaluation_source_node_id(): number;
  _orbit_engine_oep_evaluation_mode_code(): number;
  _orbit_engine_oep_evaluation_record_index(): number;
  _orbit_engine_oep_evaluation_source_revision_high(): number;
  _orbit_engine_oep_evaluation_source_revision_low(): number;
  _orbit_engine_oep_evaluation_epoch_seconds_high(): number;
  _orbit_engine_oep_evaluation_epoch_seconds_low(): number;
  _orbit_engine_oep_evaluation_epoch_nanoseconds(): number;
  _orbit_engine_oep_evaluation_position_x(): number;
  _orbit_engine_oep_evaluation_position_y(): number;
  _orbit_engine_oep_evaluation_position_z(): number;
  _orbit_engine_oep_evaluation_velocity_x(): number;
  _orbit_engine_oep_evaluation_velocity_y(): number;
  _orbit_engine_oep_evaluation_velocity_z(): number;
}

type OepWasmFactory = (options: {
  locateFile(fileName: string): string;
}) => Promise<OepWasmModule>;

function datasetWire(module: OepWasmModule) {
  return validateOepDatasetInfoWire({
    resultCode: module._orbit_engine_oep_dataset_result_code() >>> 0,
    handleHigh: module._orbit_engine_oep_dataset_handle_high() >>> 0,
    handleLow: module._orbit_engine_oep_dataset_handle_low() >>> 0,
    datasetRevisionHigh: module._orbit_engine_oep_dataset_revision_high() >>> 0,
    datasetRevisionLow: module._orbit_engine_oep_dataset_revision_low() >>> 0,
    sourceCount: module._orbit_engine_oep_dataset_source_count() >>> 0,
  });
}

function sourceWire(module: OepWasmModule) {
  return validateOepSourceInfoWire({
    resultCode: module._orbit_engine_oep_source_result_code() >>> 0,
    handleHigh: module._orbit_engine_oep_source_handle_high() >>> 0,
    handleLow: module._orbit_engine_oep_source_handle_low() >>> 0,
    sourceNodeId: module._orbit_engine_oep_source_node_id() >>> 0,
    centerSourceNodeId: module._orbit_engine_oep_source_center_node_id() >>> 0,
    representationCode: module._orbit_engine_oep_source_representation_code() >>> 0,
    sourceRevisionHigh: module._orbit_engine_oep_source_revision_high() >>> 0,
    sourceRevisionLow: module._orbit_engine_oep_source_revision_low() >>> 0,
    validityStart: {
      secondsHigh: module._orbit_engine_oep_source_validity_start_seconds_high(),
      secondsLow: module._orbit_engine_oep_source_validity_start_seconds_low() >>> 0,
      nanoseconds: module._orbit_engine_oep_source_validity_start_nanoseconds() >>> 0,
    },
    validityEnd: {
      secondsHigh: module._orbit_engine_oep_source_validity_end_seconds_high(),
      secondsLow: module._orbit_engine_oep_source_validity_end_seconds_low() >>> 0,
      nanoseconds: module._orbit_engine_oep_source_validity_end_nanoseconds() >>> 0,
    },
    effectiveValidityStart: {
      secondsHigh: module._orbit_engine_oep_source_effective_start_seconds_high(),
      secondsLow: module._orbit_engine_oep_source_effective_start_seconds_low() >>> 0,
      nanoseconds: module._orbit_engine_oep_source_effective_start_nanoseconds() >>> 0,
    },
    effectiveValidityEnd: {
      secondsHigh: module._orbit_engine_oep_source_effective_end_seconds_high(),
      secondsLow: module._orbit_engine_oep_source_effective_end_seconds_low() >>> 0,
      nanoseconds: module._orbit_engine_oep_source_effective_end_nanoseconds() >>> 0,
    },
    positionErrorMeters: module._orbit_engine_oep_source_position_error_meters(),
    velocityErrorMetersPerSecond: module._orbit_engine_oep_source_velocity_error_meters_per_second(),
  });
}

function evaluationWire(module: OepWasmModule) {
  return validateOepEvaluationWire({
    resultCode: module._orbit_engine_oep_evaluation_result_code() >>> 0,
    handleHigh: module._orbit_engine_oep_evaluation_handle_high() >>> 0,
    handleLow: module._orbit_engine_oep_evaluation_handle_low() >>> 0,
    sourceNodeId: module._orbit_engine_oep_evaluation_source_node_id() >>> 0,
    evaluationModeCode: module._orbit_engine_oep_evaluation_mode_code() >>> 0,
    recordIndex: module._orbit_engine_oep_evaluation_record_index() >>> 0,
    sourceRevisionHigh: module._orbit_engine_oep_evaluation_source_revision_high() >>> 0,
    sourceRevisionLow: module._orbit_engine_oep_evaluation_source_revision_low() >>> 0,
    epoch: {
      secondsHigh: module._orbit_engine_oep_evaluation_epoch_seconds_high(),
      secondsLow: module._orbit_engine_oep_evaluation_epoch_seconds_low() >>> 0,
      nanoseconds: module._orbit_engine_oep_evaluation_epoch_nanoseconds() >>> 0,
    },
    positionX: module._orbit_engine_oep_evaluation_position_x(),
    positionY: module._orbit_engine_oep_evaluation_position_y(),
    positionZ: module._orbit_engine_oep_evaluation_position_z(),
    velocityX: module._orbit_engine_oep_evaluation_velocity_x(),
    velocityY: module._orbit_engine_oep_evaluation_velocity_y(),
    velocityZ: module._orbit_engine_oep_evaluation_velocity_z(),
  });
}

export async function loadWasmEphemerisBackend(): Promise<EphemerisBackend> {
  const wasmBinaryUrl = new URL("../../../wasm/orbit_engine_oep_wasm.wasm", import.meta.url);
  let imported: { default?: unknown };
  try {
    // @ts-expect-error Generated only when the WASM build is present.
    imported = await import("../../../wasm/orbit_engine_oep_wasm.js");
  } catch (cause) {
    throw new BackendInitializationError("wasm", "OEP WASM module could not be loaded", cause);
  }
  if (typeof imported.default !== "function") {
    throw new BackendInitializationError("wasm", "OEP WASM module has no ESM factory export");
  }

  let module: OepWasmModule;
  try {
    module = await (imported.default as OepWasmFactory)({
      locateFile: (fileName) => {
        if (fileName !== "orbit_engine_oep_wasm.wasm") throw new Error(`Unexpected OEP WASM sidecar: ${fileName}`);
        return wasmBinaryUrl.href;
      },
    });
  } catch (cause) {
    throw new BackendInitializationError("wasm", "OEP WASM module initialization failed", cause);
  }

  return Object.freeze({
    kind: "wasm" as const,
    load: (payload: Uint8Array) => {
      const pointer = module._malloc(payload.byteLength);
      if (pointer === 0 && payload.byteLength !== 0) throw new RangeError("OEP WASM allocation failed");
      try {
        module.HEAPU8.set(payload, pointer);
        module._orbit_engine_oep_load(pointer, payload.byteLength);
        return datasetWire(module);
      } finally {
        module._free(pointer);
      }
    },
    retain: (high: number, low: number) => {
      module._orbit_engine_oep_retain(high, low);
      return datasetWire(module);
    },
    releaseReference: (high: number, low: number) => {
      module._orbit_engine_oep_release_reference(high, low);
      return datasetWire(module);
    },
    unload: (high: number, low: number) => {
      module._orbit_engine_oep_unload(high, low);
      return datasetWire(module);
    },
    sourceInfo: (high: number, low: number, sourceNodeId: number) => {
      module._orbit_engine_oep_source_info(high, low, sourceNodeId);
      return sourceWire(module);
    },
    evaluate: (high: number, low: number, sourceNodeId: number, mode: number, target: TimeWire) => {
      module._orbit_engine_oep_evaluate(
        high,
        low,
        sourceNodeId,
        mode,
        target.secondsHigh,
        target.secondsLow,
        target.nanoseconds,
      );
      return evaluationWire(module);
    },
  });
}
