import type { Backend } from "./contract.js";
import { backendFromRawBinding } from "./binding.js";
import { BackendInitializationError } from "./errors.js";
import type { TimeWire } from "../time-wire.js";
import type { ObjectWire } from "../object-wire.js";
import type { FrameWire } from "../frame-wire.js";
import type { PropagationWire } from "../propagation-wire.js";
import type { RegistryWire } from "../registry-wire.js";
import type { FrameRegistryWire } from "../frame-registry-wire.js";
import type { TwoBodyWire } from "../two-body-wire.js";
import type { NumericalWire } from "../numerical-wire.js";
import { decodeCoupledPacket, encodeCoupledPacket, type CoupledWire } from "../coupled-wire.js";
import { decodeSchedulerPacket, encodeSchedulerPacket, SCHEDULER_OUTPUT_WORDS, type SchedulerWire } from "../scheduler-wire.js";
import type { EmscriptenWasmFactoryModule } from "../wasm-factory.js";

type ObjectRoundTripArgs = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

type FrameRoundTripArgs = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

type PropagationRoundTripArgs = [
  number, number, number, number, number, number, number, number, number, number, number,
  number, number, number, number, number, number, number, number, number, number, number,
  number, number, number, number, number, number, number, number, number, number, number, number,
];

type RegistryRoundTripArgs = number[];
type FrameRegistryRoundTripArgs = number[];
type TwoBodyRoundTripArgs = number[];
type NumericalRoundTripArgs = number[];

interface WasmModule {
  readonly _malloc: (size: number) => number;
  readonly _free: (pointer: number) => void;
  readonly HEAPF64: Float64Array;
  readonly _orbit_engine_binding_protocol_version: () => number;
  readonly _orbit_engine_core_version: () => number;
  readonly _orbit_engine_health: () => number;
  readonly _orbit_engine_round_trip_time_seconds_high: (secondsHigh: number, secondsLow: number, nanoseconds: number) => number;
  readonly _orbit_engine_round_trip_time_seconds_low: (secondsHigh: number, secondsLow: number, nanoseconds: number) => number;
  readonly _orbit_engine_round_trip_time_nanoseconds: (secondsHigh: number, secondsLow: number, nanoseconds: number) => number;
  readonly _orbit_engine_round_trip_double: (value: number) => number;
  readonly _orbit_engine_round_trip_propagation: (...args: PropagationRoundTripArgs) => number;
  readonly _orbit_engine_propagation_object_id_high: () => number;
  readonly _orbit_engine_propagation_object_id_low: () => number;
  readonly _orbit_engine_propagation_model_kind_code: () => number;
  readonly _orbit_engine_propagation_direction_code: () => number;
  readonly _orbit_engine_propagation_bounded_direction_code: () => number;
  readonly _orbit_engine_propagation_frame_high: () => number;
  readonly _orbit_engine_propagation_frame_low: () => number;
  readonly _orbit_engine_propagation_configuration_revision_high: () => number;
  readonly _orbit_engine_propagation_configuration_revision_low: () => number;
  readonly _orbit_engine_propagation_motion_revision_high: () => number;
  readonly _orbit_engine_propagation_motion_revision_low: () => number;
  readonly _orbit_engine_propagation_segment_start_seconds_high: () => number;
  readonly _orbit_engine_propagation_segment_start_seconds_low: () => number;
  readonly _orbit_engine_propagation_segment_start_nanoseconds: () => number;
  readonly _orbit_engine_propagation_segment_end_present: () => number;
  readonly _orbit_engine_propagation_segment_end_seconds_high: () => number;
  readonly _orbit_engine_propagation_segment_end_seconds_low: () => number;
  readonly _orbit_engine_propagation_segment_end_nanoseconds: () => number;
  readonly _orbit_engine_propagation_target_seconds_high: () => number;
  readonly _orbit_engine_propagation_target_seconds_low: () => number;
  readonly _orbit_engine_propagation_target_nanoseconds: () => number;
  readonly _orbit_engine_propagation_outcome_code: () => number;
  readonly _orbit_engine_propagation_result_frame_high: () => number;
  readonly _orbit_engine_propagation_result_frame_low: () => number;
  readonly _orbit_engine_propagation_position_x: () => number;
  readonly _orbit_engine_propagation_position_y: () => number;
  readonly _orbit_engine_propagation_position_z: () => number;
  readonly _orbit_engine_propagation_velocity_x: () => number;
  readonly _orbit_engine_propagation_velocity_y: () => number;
  readonly _orbit_engine_propagation_velocity_z: () => number;
  readonly _orbit_engine_propagation_position_absolute_meters: () => number;
  readonly _orbit_engine_propagation_position_relative: () => number;
  readonly _orbit_engine_propagation_velocity_absolute_meters_per_second: () => number;
  readonly _orbit_engine_propagation_velocity_relative: () => number;
  readonly _orbit_engine_round_trip_frame_reference_frame_id_high: (...args: FrameRoundTripArgs) => number;
  readonly _orbit_engine_round_trip_frame_reference_frame_id_low: (...args: FrameRoundTripArgs) => number;
  readonly _orbit_engine_round_trip_frame_epoch_seconds_high: (...args: FrameRoundTripArgs) => number;
  readonly _orbit_engine_round_trip_frame_epoch_seconds_low: (...args: FrameRoundTripArgs) => number;
  readonly _orbit_engine_round_trip_frame_epoch_nanoseconds: (...args: FrameRoundTripArgs) => number;
  readonly _orbit_engine_round_trip_frame_translation_x: (...args: FrameRoundTripArgs) => number;
  readonly _orbit_engine_round_trip_frame_translation_y: (...args: FrameRoundTripArgs) => number;
  readonly _orbit_engine_round_trip_frame_translation_z: (...args: FrameRoundTripArgs) => number;
  readonly _orbit_engine_round_trip_frame_origin_velocity_x: (...args: FrameRoundTripArgs) => number;
  readonly _orbit_engine_round_trip_frame_origin_velocity_y: (...args: FrameRoundTripArgs) => number;
  readonly _orbit_engine_round_trip_frame_origin_velocity_z: (...args: FrameRoundTripArgs) => number;
  readonly _orbit_engine_round_trip_frame_rotation_w: (...args: FrameRoundTripArgs) => number;
  readonly _orbit_engine_round_trip_frame_rotation_x: (...args: FrameRoundTripArgs) => number;
  readonly _orbit_engine_round_trip_frame_rotation_y: (...args: FrameRoundTripArgs) => number;
  readonly _orbit_engine_round_trip_frame_rotation_z: (...args: FrameRoundTripArgs) => number;
  readonly _orbit_engine_round_trip_frame_angular_velocity_x: (...args: FrameRoundTripArgs) => number;
  readonly _orbit_engine_round_trip_frame_angular_velocity_y: (...args: FrameRoundTripArgs) => number;
  readonly _orbit_engine_round_trip_frame_angular_velocity_z: (...args: FrameRoundTripArgs) => number;
  readonly _orbit_engine_round_trip_object_id_high: (...args: ObjectRoundTripArgs) => number;
  readonly _orbit_engine_round_trip_object_id_low: (...args: ObjectRoundTripArgs) => number;
  readonly _orbit_engine_round_trip_object_type_code: (...args: ObjectRoundTripArgs) => number;
  readonly _orbit_engine_round_trip_object_mass_present: (...args: ObjectRoundTripArgs) => number;
  readonly _orbit_engine_round_trip_object_mass: (...args: ObjectRoundTripArgs) => number;
  readonly _orbit_engine_round_trip_object_mu_present: (...args: ObjectRoundTripArgs) => number;
  readonly _orbit_engine_round_trip_object_mu: (...args: ObjectRoundTripArgs) => number;
  readonly _orbit_engine_round_trip_object_physical_radius_present: (...args: ObjectRoundTripArgs) => number;
  readonly _orbit_engine_round_trip_object_physical_radius: (...args: ObjectRoundTripArgs) => number;
  readonly _orbit_engine_round_trip_object_collision_radius_present: (...args: ObjectRoundTripArgs) => number;
  readonly _orbit_engine_round_trip_object_collision_radius: (...args: ObjectRoundTripArgs) => number;
  readonly _orbit_engine_round_trip_registry: (...args: RegistryRoundTripArgs) => number;
  readonly _orbit_engine_registry_operation_code: () => number;
  readonly _orbit_engine_registry_result_code: () => number;
  readonly _orbit_engine_registry_object_id_high: () => number;
  readonly _orbit_engine_registry_object_id_low: () => number;
  readonly _orbit_engine_registry_object_type_code: () => number;
  readonly _orbit_engine_registry_mass_present: () => number;
  readonly _orbit_engine_registry_mass: () => number;
  readonly _orbit_engine_registry_mu_present: () => number;
  readonly _orbit_engine_registry_mu: () => number;
  readonly _orbit_engine_registry_physical_radius_present: () => number;
  readonly _orbit_engine_registry_physical_radius: () => number;
  readonly _orbit_engine_registry_collision_bounding_radius_present: () => number;
  readonly _orbit_engine_registry_collision_bounding_radius: () => number;
  readonly _orbit_engine_registry_state_present: () => number;
  readonly _orbit_engine_registry_state_epoch_seconds_high: () => number;
  readonly _orbit_engine_registry_state_epoch_seconds_low: () => number;
  readonly _orbit_engine_registry_state_epoch_nanoseconds: () => number;
  readonly _orbit_engine_registry_state_frame_high: () => number;
  readonly _orbit_engine_registry_state_frame_low: () => number;
  readonly _orbit_engine_registry_position_x: () => number;
  readonly _orbit_engine_registry_position_y: () => number;
  readonly _orbit_engine_registry_position_z: () => number;
  readonly _orbit_engine_registry_velocity_x: () => number;
  readonly _orbit_engine_registry_velocity_y: () => number;
  readonly _orbit_engine_registry_velocity_z: () => number;
  readonly _orbit_engine_registry_model_kind_code: () => number;
  readonly _orbit_engine_registry_direction_code: () => number;
  readonly _orbit_engine_registry_segment_start_seconds_high: () => number;
  readonly _orbit_engine_registry_segment_start_seconds_low: () => number;
  readonly _orbit_engine_registry_segment_start_nanoseconds: () => number;
  readonly _orbit_engine_registry_segment_end_present: () => number;
  readonly _orbit_engine_registry_segment_end_seconds_high: () => number;
  readonly _orbit_engine_registry_segment_end_seconds_low: () => number;
  readonly _orbit_engine_registry_segment_end_nanoseconds: () => number;
  readonly _orbit_engine_registry_configuration_revision_high: () => number;
  readonly _orbit_engine_registry_configuration_revision_low: () => number;
  readonly _orbit_engine_registry_motion_revision_high: () => number;
  readonly _orbit_engine_registry_motion_revision_low: () => number;
  readonly _orbit_engine_registry_reference_status_code: () => number;
  readonly _orbit_engine_registry_property_revision_high: () => number;
  readonly _orbit_engine_registry_property_revision_low: () => number;
  readonly _orbit_engine_registry_effective_epoch_seconds_high: () => number;
  readonly _orbit_engine_registry_effective_epoch_seconds_low: () => number;
  readonly _orbit_engine_registry_effective_epoch_nanoseconds: () => number;
  readonly _orbit_engine_registry_structural_parent_present: () => number;
  readonly _orbit_engine_registry_structural_parent_high: () => number;
  readonly _orbit_engine_registry_structural_parent_low: () => number;
  readonly _orbit_engine_round_trip_frame_registry: (...args: FrameRegistryRoundTripArgs) => number;
  readonly _orbit_engine_frame_registry_operation_code: () => number;
  readonly _orbit_engine_frame_registry_result_code: () => number;
  readonly _orbit_engine_frame_registry_frame_id_high: () => number;
  readonly _orbit_engine_frame_registry_frame_id_low: () => number;
  readonly _orbit_engine_frame_registry_parent_present: () => number;
  readonly _orbit_engine_frame_registry_parent_high: () => number;
  readonly _orbit_engine_frame_registry_parent_low: () => number;
  readonly _orbit_engine_frame_registry_provider_code: () => number;
  readonly _orbit_engine_frame_registry_dependency_present: () => number;
  readonly _orbit_engine_frame_registry_dependency_high: () => number;
  readonly _orbit_engine_frame_registry_dependency_low: () => number;
  readonly _orbit_engine_frame_registry_transform_reference_frame_id_high: () => number;
  readonly _orbit_engine_frame_registry_transform_reference_frame_id_low: () => number;
  readonly _orbit_engine_frame_registry_transform_epoch_seconds_high: () => number;
  readonly _orbit_engine_frame_registry_transform_epoch_seconds_low: () => number;
  readonly _orbit_engine_frame_registry_transform_epoch_nanoseconds: () => number;
  readonly _orbit_engine_frame_registry_transform_translation_x: () => number;
  readonly _orbit_engine_frame_registry_transform_translation_y: () => number;
  readonly _orbit_engine_frame_registry_transform_translation_z: () => number;
  readonly _orbit_engine_frame_registry_transform_origin_velocity_x: () => number;
  readonly _orbit_engine_frame_registry_transform_origin_velocity_y: () => number;
  readonly _orbit_engine_frame_registry_transform_origin_velocity_z: () => number;
  readonly _orbit_engine_frame_registry_transform_rotation_w: () => number;
  readonly _orbit_engine_frame_registry_transform_rotation_x: () => number;
  readonly _orbit_engine_frame_registry_transform_rotation_y: () => number;
  readonly _orbit_engine_frame_registry_transform_rotation_z: () => number;
  readonly _orbit_engine_frame_registry_transform_angular_velocity_x: () => number;
  readonly _orbit_engine_frame_registry_transform_angular_velocity_y: () => number;
  readonly _orbit_engine_frame_registry_transform_angular_velocity_z: () => number;
  readonly _orbit_engine_round_trip_two_body: (...args: TwoBodyRoundTripArgs) => number;
  readonly _orbit_engine_two_body_result_code: () => number;
  readonly _orbit_engine_two_body_central_object_id_high: () => number;
  readonly _orbit_engine_two_body_central_object_id_low: () => number;
  readonly _orbit_engine_two_body_mu: () => number;
  readonly _orbit_engine_two_body_anchor_frame_high: () => number;
  readonly _orbit_engine_two_body_anchor_frame_low: () => number;
  readonly _orbit_engine_two_body_anchor_epoch_seconds_high: () => number;
  readonly _orbit_engine_two_body_anchor_epoch_seconds_low: () => number;
  readonly _orbit_engine_two_body_anchor_epoch_nanoseconds: () => number;
  readonly _orbit_engine_two_body_anchor_position_x: () => number;
  readonly _orbit_engine_two_body_anchor_position_y: () => number;
  readonly _orbit_engine_two_body_anchor_position_z: () => number;
  readonly _orbit_engine_two_body_anchor_velocity_x: () => number;
  readonly _orbit_engine_two_body_anchor_velocity_y: () => number;
  readonly _orbit_engine_two_body_anchor_velocity_z: () => number;
  readonly _orbit_engine_two_body_target_epoch_seconds_high: () => number;
  readonly _orbit_engine_two_body_target_epoch_seconds_low: () => number;
  readonly _orbit_engine_two_body_target_epoch_nanoseconds: () => number;
  readonly _orbit_engine_two_body_result_frame_high: () => number;
  readonly _orbit_engine_two_body_result_frame_low: () => number;
  readonly _orbit_engine_two_body_result_epoch_seconds_high: () => number;
  readonly _orbit_engine_two_body_result_epoch_seconds_low: () => number;
  readonly _orbit_engine_two_body_result_epoch_nanoseconds: () => number;
  readonly _orbit_engine_two_body_result_position_x: () => number;
  readonly _orbit_engine_two_body_result_position_y: () => number;
  readonly _orbit_engine_two_body_result_position_z: () => number;
  readonly _orbit_engine_two_body_result_velocity_x: () => number;
  readonly _orbit_engine_two_body_result_velocity_y: () => number;
  readonly _orbit_engine_two_body_result_velocity_z: () => number;
  readonly _orbit_engine_round_trip_numerical: (...args: NumericalRoundTripArgs) => number;
  readonly _orbit_engine_numerical_result_code: () => number;
  readonly _orbit_engine_numerical_result_epoch_seconds_high: () => number;
  readonly _orbit_engine_numerical_result_epoch_seconds_low: () => number;
  readonly _orbit_engine_numerical_result_epoch_nanoseconds: () => number;
  readonly _orbit_engine_numerical_result_position_x: () => number;
  readonly _orbit_engine_numerical_result_position_y: () => number;
  readonly _orbit_engine_numerical_result_position_z: () => number;
  readonly _orbit_engine_numerical_result_velocity_x: () => number;
  readonly _orbit_engine_numerical_result_velocity_y: () => number;
  readonly _orbit_engine_numerical_result_velocity_z: () => number;
  readonly _orbit_engine_numerical_result_mass_present: () => number;
  readonly _orbit_engine_numerical_result_mass: () => number;
  readonly _orbit_engine_round_trip_coupled: (inputPointer: number, inputLength: number, outputPointer: number, outputLength: number) => number;
  readonly _orbit_engine_round_trip_scheduler: (inputPointer: number, inputLength: number, outputPointer: number, outputLength: number) => number;
}

interface WasmModuleFactory {
  (options: { locateFile: (fileName: string) => string }): Promise<WasmModule>;
}

export async function loadWasmBackend(): Promise<Backend> {
  const wasmBinaryUrl = new URL("../../../../wasm/orbit_engine_wasm.wasm", import.meta.url);

  let imported: EmscriptenWasmFactoryModule;
  try {
    // The generated Emscripten module is supplied by the WASM build/package step.
    // @ts-expect-error The generated module is intentionally absent from source-only builds.
    imported = (await import("../../../../wasm/orbit_engine_wasm.js")) as EmscriptenWasmFactoryModule;
  } catch (cause) {
    throw new BackendInitializationError("wasm", "WASM backend module could not be loaded", cause);
  }

  const factory = imported.default;
  if (typeof factory !== "function") {
    throw new BackendInitializationError("wasm", "WASM backend module has no ESM factory export");
  }

  let module: WasmModule;
  try {
    module = await (factory as WasmModuleFactory)({
      locateFile: (fileName) => {
        if (fileName !== "orbit_engine_wasm.wasm") {
          throw new Error(`Unexpected Emscripten sidecar requested: ${fileName}`);
        }
        return wasmBinaryUrl.href;
      },
    });
  } catch (cause) {
    throw new BackendInitializationError("wasm", "WASM backend module initialization failed", cause);
  }

  const raw = {
    protocolVersion: module._orbit_engine_binding_protocol_version(),
    initialize: () => ({
      coreVersion: module._orbit_engine_core_version(),
      healthCode: module._orbit_engine_health(),
    }),
    roundTripTime: (value: TimeWire) => ({
      secondsHigh: module._orbit_engine_round_trip_time_seconds_high(
        value.secondsHigh,
        value.secondsLow,
        value.nanoseconds,
      ),
      secondsLow: module._orbit_engine_round_trip_time_seconds_low(
        value.secondsHigh,
        value.secondsLow,
        value.nanoseconds,
      ) >>> 0,
      nanoseconds: module._orbit_engine_round_trip_time_nanoseconds(
        value.secondsHigh,
        value.secondsLow,
        value.nanoseconds,
      ) >>> 0,
    }),
    roundTripDouble: (value: number) => module._orbit_engine_round_trip_double(value),
    roundTripPropagation: (value: PropagationWire) => {
      const args: PropagationRoundTripArgs = [
        value.objectIdHigh,
        value.objectIdLow,
        value.modelKindCode,
        value.directionCode,
        value.boundedDirectionCode,
        value.propagationFrameHigh,
        value.propagationFrameLow,
        value.configurationRevisionHigh,
        value.configurationRevisionLow,
        value.motionRevisionHigh,
        value.motionRevisionLow,
        value.segmentStartSecondsHigh,
        value.segmentStartSecondsLow,
        value.segmentStartNanoseconds,
        value.segmentEndPresent ? 1 : 0,
        value.segmentEndSecondsHigh,
        value.segmentEndSecondsLow,
        value.segmentEndNanoseconds,
        value.targetSecondsHigh,
        value.targetSecondsLow,
        value.targetNanoseconds,
        value.outcomeCode,
        value.resultFrameHigh,
        value.resultFrameLow,
        value.positionX,
        value.positionY,
        value.positionZ,
        value.velocityX,
        value.velocityY,
        value.velocityZ,
        value.positionAbsoluteMeters,
        value.positionRelative,
        value.velocityAbsoluteMetersPerSecond,
        value.velocityRelative,
      ];
      if (module._orbit_engine_round_trip_propagation(...args) === 0) {
        throw new RangeError("WASM propagation round-trip rejected the wire value");
      }
      return {
        objectIdHigh: module._orbit_engine_propagation_object_id_high() >>> 0,
        objectIdLow: module._orbit_engine_propagation_object_id_low() >>> 0,
        modelKindCode: module._orbit_engine_propagation_model_kind_code() >>> 0,
        directionCode: module._orbit_engine_propagation_direction_code() >>> 0,
        boundedDirectionCode: module._orbit_engine_propagation_bounded_direction_code() >>> 0,
        propagationFrameHigh: module._orbit_engine_propagation_frame_high() >>> 0,
        propagationFrameLow: module._orbit_engine_propagation_frame_low() >>> 0,
        configurationRevisionHigh: module._orbit_engine_propagation_configuration_revision_high() >>> 0,
        configurationRevisionLow: module._orbit_engine_propagation_configuration_revision_low() >>> 0,
        motionRevisionHigh: module._orbit_engine_propagation_motion_revision_high() >>> 0,
        motionRevisionLow: module._orbit_engine_propagation_motion_revision_low() >>> 0,
        segmentStartSecondsHigh: module._orbit_engine_propagation_segment_start_seconds_high(),
        segmentStartSecondsLow: module._orbit_engine_propagation_segment_start_seconds_low() >>> 0,
        segmentStartNanoseconds: module._orbit_engine_propagation_segment_start_nanoseconds() >>> 0,
        segmentEndPresent: module._orbit_engine_propagation_segment_end_present() !== 0,
        segmentEndSecondsHigh: module._orbit_engine_propagation_segment_end_seconds_high(),
        segmentEndSecondsLow: module._orbit_engine_propagation_segment_end_seconds_low() >>> 0,
        segmentEndNanoseconds: module._orbit_engine_propagation_segment_end_nanoseconds() >>> 0,
        targetSecondsHigh: module._orbit_engine_propagation_target_seconds_high(),
        targetSecondsLow: module._orbit_engine_propagation_target_seconds_low() >>> 0,
        targetNanoseconds: module._orbit_engine_propagation_target_nanoseconds() >>> 0,
        outcomeCode: module._orbit_engine_propagation_outcome_code() >>> 0,
        resultFrameHigh: module._orbit_engine_propagation_result_frame_high() >>> 0,
        resultFrameLow: module._orbit_engine_propagation_result_frame_low() >>> 0,
        positionX: module._orbit_engine_propagation_position_x(),
        positionY: module._orbit_engine_propagation_position_y(),
        positionZ: module._orbit_engine_propagation_position_z(),
        velocityX: module._orbit_engine_propagation_velocity_x(),
        velocityY: module._orbit_engine_propagation_velocity_y(),
        velocityZ: module._orbit_engine_propagation_velocity_z(),
        positionAbsoluteMeters: module._orbit_engine_propagation_position_absolute_meters(),
        positionRelative: module._orbit_engine_propagation_position_relative(),
        velocityAbsoluteMetersPerSecond: module._orbit_engine_propagation_velocity_absolute_meters_per_second(),
        velocityRelative: module._orbit_engine_propagation_velocity_relative(),
      };
    },
    roundTripRegistry: (value: RegistryWire) => {
      const args: RegistryRoundTripArgs = [
        value.operationCode,
        value.resultCode,
        value.objectIdHigh,
        value.objectIdLow,
        value.objectTypeCode,
        value.massPresent ? 1 : 0,
        value.mass,
        value.muPresent ? 1 : 0,
        value.mu,
        value.physicalRadiusPresent ? 1 : 0,
        value.physicalRadius,
        value.collisionBoundingRadiusPresent ? 1 : 0,
        value.collisionBoundingRadius,
        value.statePresent ? 1 : 0,
        value.stateEpochSecondsHigh,
        value.stateEpochSecondsLow,
        value.stateEpochNanoseconds,
        value.stateFrameHigh,
        value.stateFrameLow,
        value.positionX,
        value.positionY,
        value.positionZ,
        value.velocityX,
        value.velocityY,
        value.velocityZ,
        value.modelKindCode,
        value.directionCode,
        value.segmentStartSecondsHigh,
        value.segmentStartSecondsLow,
        value.segmentStartNanoseconds,
        value.segmentEndPresent ? 1 : 0,
        value.segmentEndSecondsHigh,
        value.segmentEndSecondsLow,
        value.segmentEndNanoseconds,
        value.configurationRevisionHigh,
        value.configurationRevisionLow,
        value.motionRevisionHigh,
        value.motionRevisionLow,
        value.referenceStatusCode,
        value.propertyRevisionHigh,
        value.propertyRevisionLow,
        value.effectiveEpochSecondsHigh,
        value.effectiveEpochSecondsLow,
        value.effectiveEpochNanoseconds,
        value.structuralParentPresent ? 1 : 0,
        value.structuralParentHigh,
        value.structuralParentLow,
      ];
      if (module._orbit_engine_round_trip_registry(...args) === 0) {
        throw new RangeError("WASM registry operation was rejected");
      }
      return {
        operationCode: module._orbit_engine_registry_operation_code() >>> 0,
        resultCode: module._orbit_engine_registry_result_code() >>> 0,
        objectIdHigh: module._orbit_engine_registry_object_id_high() >>> 0,
        objectIdLow: module._orbit_engine_registry_object_id_low() >>> 0,
        objectTypeCode: module._orbit_engine_registry_object_type_code() >>> 0,
        massPresent: module._orbit_engine_registry_mass_present() !== 0,
        mass: module._orbit_engine_registry_mass(),
        muPresent: module._orbit_engine_registry_mu_present() !== 0,
        mu: module._orbit_engine_registry_mu(),
        physicalRadiusPresent: module._orbit_engine_registry_physical_radius_present() !== 0,
        physicalRadius: module._orbit_engine_registry_physical_radius(),
        collisionBoundingRadiusPresent: module._orbit_engine_registry_collision_bounding_radius_present() !== 0,
        collisionBoundingRadius: module._orbit_engine_registry_collision_bounding_radius(),
        statePresent: module._orbit_engine_registry_state_present() !== 0,
        stateEpochSecondsHigh: module._orbit_engine_registry_state_epoch_seconds_high(),
        stateEpochSecondsLow: module._orbit_engine_registry_state_epoch_seconds_low() >>> 0,
        stateEpochNanoseconds: module._orbit_engine_registry_state_epoch_nanoseconds() >>> 0,
        stateFrameHigh: module._orbit_engine_registry_state_frame_high() >>> 0,
        stateFrameLow: module._orbit_engine_registry_state_frame_low() >>> 0,
        positionX: module._orbit_engine_registry_position_x(),
        positionY: module._orbit_engine_registry_position_y(),
        positionZ: module._orbit_engine_registry_position_z(),
        velocityX: module._orbit_engine_registry_velocity_x(),
        velocityY: module._orbit_engine_registry_velocity_y(),
        velocityZ: module._orbit_engine_registry_velocity_z(),
        modelKindCode: module._orbit_engine_registry_model_kind_code() >>> 0,
        directionCode: module._orbit_engine_registry_direction_code() >>> 0,
        segmentStartSecondsHigh: module._orbit_engine_registry_segment_start_seconds_high(),
        segmentStartSecondsLow: module._orbit_engine_registry_segment_start_seconds_low() >>> 0,
        segmentStartNanoseconds: module._orbit_engine_registry_segment_start_nanoseconds() >>> 0,
        segmentEndPresent: module._orbit_engine_registry_segment_end_present() !== 0,
        segmentEndSecondsHigh: module._orbit_engine_registry_segment_end_seconds_high(),
        segmentEndSecondsLow: module._orbit_engine_registry_segment_end_seconds_low() >>> 0,
        segmentEndNanoseconds: module._orbit_engine_registry_segment_end_nanoseconds() >>> 0,
        configurationRevisionHigh: module._orbit_engine_registry_configuration_revision_high() >>> 0,
        configurationRevisionLow: module._orbit_engine_registry_configuration_revision_low() >>> 0,
        motionRevisionHigh: module._orbit_engine_registry_motion_revision_high() >>> 0,
        motionRevisionLow: module._orbit_engine_registry_motion_revision_low() >>> 0,
        referenceStatusCode: module._orbit_engine_registry_reference_status_code() >>> 0,
        propertyRevisionHigh: module._orbit_engine_registry_property_revision_high() >>> 0,
        propertyRevisionLow: module._orbit_engine_registry_property_revision_low() >>> 0,
        effectiveEpochSecondsHigh: module._orbit_engine_registry_effective_epoch_seconds_high(),
        effectiveEpochSecondsLow: module._orbit_engine_registry_effective_epoch_seconds_low() >>> 0,
        effectiveEpochNanoseconds: module._orbit_engine_registry_effective_epoch_nanoseconds() >>> 0,
        structuralParentPresent: module._orbit_engine_registry_structural_parent_present() !== 0,
        structuralParentHigh: module._orbit_engine_registry_structural_parent_high() >>> 0,
        structuralParentLow: module._orbit_engine_registry_structural_parent_low() >>> 0,
      };
    },
    roundTripFrame: (value: FrameWire) => {
      const args: FrameRoundTripArgs = [
        value.referenceFrameIdHigh,
        value.referenceFrameIdLow,
        value.epochSecondsHigh,
        value.epochSecondsLow,
        value.epochNanoseconds,
        value.translationX,
        value.translationY,
        value.translationZ,
        value.originVelocityX,
        value.originVelocityY,
        value.originVelocityZ,
        value.rotationW,
        value.rotationX,
        value.rotationY,
        value.rotationZ,
        value.angularVelocityX,
        value.angularVelocityY,
        value.angularVelocityZ,
      ];
      return {
        referenceFrameIdHigh: module._orbit_engine_round_trip_frame_reference_frame_id_high(...args) >>> 0,
        referenceFrameIdLow: module._orbit_engine_round_trip_frame_reference_frame_id_low(...args) >>> 0,
        epochSecondsHigh: module._orbit_engine_round_trip_frame_epoch_seconds_high(...args),
        epochSecondsLow: module._orbit_engine_round_trip_frame_epoch_seconds_low(...args) >>> 0,
        epochNanoseconds: module._orbit_engine_round_trip_frame_epoch_nanoseconds(...args) >>> 0,
        translationX: module._orbit_engine_round_trip_frame_translation_x(...args),
        translationY: module._orbit_engine_round_trip_frame_translation_y(...args),
        translationZ: module._orbit_engine_round_trip_frame_translation_z(...args),
        originVelocityX: module._orbit_engine_round_trip_frame_origin_velocity_x(...args),
        originVelocityY: module._orbit_engine_round_trip_frame_origin_velocity_y(...args),
        originVelocityZ: module._orbit_engine_round_trip_frame_origin_velocity_z(...args),
        rotationW: module._orbit_engine_round_trip_frame_rotation_w(...args),
        rotationX: module._orbit_engine_round_trip_frame_rotation_x(...args),
        rotationY: module._orbit_engine_round_trip_frame_rotation_y(...args),
        rotationZ: module._orbit_engine_round_trip_frame_rotation_z(...args),
        angularVelocityX: module._orbit_engine_round_trip_frame_angular_velocity_x(...args),
        angularVelocityY: module._orbit_engine_round_trip_frame_angular_velocity_y(...args),
        angularVelocityZ: module._orbit_engine_round_trip_frame_angular_velocity_z(...args),
      };
    },
    roundTripObject: (value: ObjectWire) => {
      const args: ObjectRoundTripArgs = [
        value.objectIdHigh,
        value.objectIdLow,
        value.objectTypeCode,
        value.massPresent ? 1 : 0,
        value.mass,
        value.muPresent ? 1 : 0,
        value.mu,
        value.physicalRadiusPresent ? 1 : 0,
        value.physicalRadius,
        value.collisionBoundingRadiusPresent ? 1 : 0,
        value.collisionBoundingRadius,
      ];
      return {
        objectIdHigh: module._orbit_engine_round_trip_object_id_high(...args) >>> 0,
        objectIdLow: module._orbit_engine_round_trip_object_id_low(...args) >>> 0,
        objectTypeCode: module._orbit_engine_round_trip_object_type_code(...args) >>> 0,
        massPresent: module._orbit_engine_round_trip_object_mass_present(...args) !== 0,
        mass: module._orbit_engine_round_trip_object_mass(...args),
        muPresent: module._orbit_engine_round_trip_object_mu_present(...args) !== 0,
        mu: module._orbit_engine_round_trip_object_mu(...args),
        physicalRadiusPresent: module._orbit_engine_round_trip_object_physical_radius_present(...args) !== 0,
        physicalRadius: module._orbit_engine_round_trip_object_physical_radius(...args),
        collisionBoundingRadiusPresent: module._orbit_engine_round_trip_object_collision_radius_present(...args) !== 0,
        collisionBoundingRadius: module._orbit_engine_round_trip_object_collision_radius(...args),
      };
    },
    roundTripFrameRegistry: (value: FrameRegistryWire) => {
      const args: FrameRegistryRoundTripArgs = [
        value.operationCode,
        value.resultCode,
        value.frameIdHigh,
        value.frameIdLow,
        value.parentPresent ? 1 : 0,
        value.parentHigh,
        value.parentLow,
        value.providerCode,
        value.dependencyPresent ? 1 : 0,
        value.dependencyHigh,
        value.dependencyLow,
        value.transformReferenceFrameIdHigh,
        value.transformReferenceFrameIdLow,
        value.transformEpochSecondsHigh,
        value.transformEpochSecondsLow,
        value.transformEpochNanoseconds,
        value.transformTranslationX,
        value.transformTranslationY,
        value.transformTranslationZ,
        value.transformOriginVelocityX,
        value.transformOriginVelocityY,
        value.transformOriginVelocityZ,
        value.transformRotationW,
        value.transformRotationX,
        value.transformRotationY,
        value.transformRotationZ,
        value.transformAngularVelocityX,
        value.transformAngularVelocityY,
        value.transformAngularVelocityZ,
      ];
      if (module._orbit_engine_round_trip_frame_registry(...args) === 0) {
        throw new RangeError("WASM frame registry operation was rejected");
      }
      return {
        operationCode: module._orbit_engine_frame_registry_operation_code() >>> 0,
        resultCode: module._orbit_engine_frame_registry_result_code() >>> 0,
        frameIdHigh: module._orbit_engine_frame_registry_frame_id_high() >>> 0,
        frameIdLow: module._orbit_engine_frame_registry_frame_id_low() >>> 0,
        parentPresent: module._orbit_engine_frame_registry_parent_present() !== 0,
        parentHigh: module._orbit_engine_frame_registry_parent_high() >>> 0,
        parentLow: module._orbit_engine_frame_registry_parent_low() >>> 0,
        providerCode: module._orbit_engine_frame_registry_provider_code() >>> 0,
        dependencyPresent: module._orbit_engine_frame_registry_dependency_present() !== 0,
        dependencyHigh: module._orbit_engine_frame_registry_dependency_high() >>> 0,
        dependencyLow: module._orbit_engine_frame_registry_dependency_low() >>> 0,
        transformReferenceFrameIdHigh: module._orbit_engine_frame_registry_transform_reference_frame_id_high() >>> 0,
        transformReferenceFrameIdLow: module._orbit_engine_frame_registry_transform_reference_frame_id_low() >>> 0,
        transformEpochSecondsHigh: module._orbit_engine_frame_registry_transform_epoch_seconds_high(),
        transformEpochSecondsLow: module._orbit_engine_frame_registry_transform_epoch_seconds_low() >>> 0,
        transformEpochNanoseconds: module._orbit_engine_frame_registry_transform_epoch_nanoseconds() >>> 0,
        transformTranslationX: module._orbit_engine_frame_registry_transform_translation_x(),
        transformTranslationY: module._orbit_engine_frame_registry_transform_translation_y(),
        transformTranslationZ: module._orbit_engine_frame_registry_transform_translation_z(),
        transformOriginVelocityX: module._orbit_engine_frame_registry_transform_origin_velocity_x(),
        transformOriginVelocityY: module._orbit_engine_frame_registry_transform_origin_velocity_y(),
        transformOriginVelocityZ: module._orbit_engine_frame_registry_transform_origin_velocity_z(),
        transformRotationW: module._orbit_engine_frame_registry_transform_rotation_w(),
        transformRotationX: module._orbit_engine_frame_registry_transform_rotation_x(),
        transformRotationY: module._orbit_engine_frame_registry_transform_rotation_y(),
        transformRotationZ: module._orbit_engine_frame_registry_transform_rotation_z(),
        transformAngularVelocityX: module._orbit_engine_frame_registry_transform_angular_velocity_x(),
        transformAngularVelocityY: module._orbit_engine_frame_registry_transform_angular_velocity_y(),
        transformAngularVelocityZ: module._orbit_engine_frame_registry_transform_angular_velocity_z(),
      };
    },
    roundTripTwoBody: (value: TwoBodyWire) => {
      const args: TwoBodyRoundTripArgs = [
        value.resultCode,
        value.centralObjectIdHigh,
        value.centralObjectIdLow,
        value.mu,
        value.anchorFrameHigh,
        value.anchorFrameLow,
        value.anchorEpoch.secondsHigh,
        value.anchorEpoch.secondsLow,
        value.anchorEpoch.nanoseconds,
        value.anchorPositionX,
        value.anchorPositionY,
        value.anchorPositionZ,
        value.anchorVelocityX,
        value.anchorVelocityY,
        value.anchorVelocityZ,
        value.targetEpoch.secondsHigh,
        value.targetEpoch.secondsLow,
        value.targetEpoch.nanoseconds,
        value.resultFrameHigh,
        value.resultFrameLow,
        value.resultEpoch.secondsHigh,
        value.resultEpoch.secondsLow,
        value.resultEpoch.nanoseconds,
        value.resultPositionX,
        value.resultPositionY,
        value.resultPositionZ,
        value.resultVelocityX,
        value.resultVelocityY,
        value.resultVelocityZ,
      ];
      if (module._orbit_engine_round_trip_two_body(...args) === 0) {
        throw new RangeError("WASM two-body operation was rejected");
      }
      return {
        resultCode: module._orbit_engine_two_body_result_code() >>> 0,
        centralObjectIdHigh: module._orbit_engine_two_body_central_object_id_high() >>> 0,
        centralObjectIdLow: module._orbit_engine_two_body_central_object_id_low() >>> 0,
        mu: module._orbit_engine_two_body_mu(),
        anchorFrameHigh: module._orbit_engine_two_body_anchor_frame_high() >>> 0,
        anchorFrameLow: module._orbit_engine_two_body_anchor_frame_low() >>> 0,
        anchorEpoch: {
          secondsHigh: module._orbit_engine_two_body_anchor_epoch_seconds_high(),
          secondsLow: module._orbit_engine_two_body_anchor_epoch_seconds_low() >>> 0,
          nanoseconds: module._orbit_engine_two_body_anchor_epoch_nanoseconds() >>> 0,
        },
        anchorPositionX: module._orbit_engine_two_body_anchor_position_x(),
        anchorPositionY: module._orbit_engine_two_body_anchor_position_y(),
        anchorPositionZ: module._orbit_engine_two_body_anchor_position_z(),
        anchorVelocityX: module._orbit_engine_two_body_anchor_velocity_x(),
        anchorVelocityY: module._orbit_engine_two_body_anchor_velocity_y(),
        anchorVelocityZ: module._orbit_engine_two_body_anchor_velocity_z(),
        targetEpoch: {
          secondsHigh: module._orbit_engine_two_body_target_epoch_seconds_high(),
          secondsLow: module._orbit_engine_two_body_target_epoch_seconds_low() >>> 0,
          nanoseconds: module._orbit_engine_two_body_target_epoch_nanoseconds() >>> 0,
        },
        resultFrameHigh: module._orbit_engine_two_body_result_frame_high() >>> 0,
        resultFrameLow: module._orbit_engine_two_body_result_frame_low() >>> 0,
        resultEpoch: {
          secondsHigh: module._orbit_engine_two_body_result_epoch_seconds_high(),
          secondsLow: module._orbit_engine_two_body_result_epoch_seconds_low() >>> 0,
          nanoseconds: module._orbit_engine_two_body_result_epoch_nanoseconds() >>> 0,
        },
        resultPositionX: module._orbit_engine_two_body_result_position_x(),
        resultPositionY: module._orbit_engine_two_body_result_position_y(),
        resultPositionZ: module._orbit_engine_two_body_result_position_z(),
        resultVelocityX: module._orbit_engine_two_body_result_velocity_x(),
        resultVelocityY: module._orbit_engine_two_body_result_velocity_y(),
        resultVelocityZ: module._orbit_engine_two_body_result_velocity_z(),
      };
    },
    roundTripNumerical: (value: NumericalWire) => {
      const args: NumericalRoundTripArgs = [
        value.resultCode,
        value.objectIdHigh,
        value.objectIdLow,
        value.propagationFrameHigh,
        value.propagationFrameLow,
        value.frameRevisionHigh,
        value.frameRevisionLow,
        value.anchorEpoch.secondsHigh,
        value.anchorEpoch.secondsLow,
        value.anchorEpoch.nanoseconds,
        value.targetEpoch.secondsHigh,
        value.targetEpoch.secondsLow,
        value.targetEpoch.nanoseconds,
        value.anchorPositionX,
        value.anchorPositionY,
        value.anchorPositionZ,
        value.anchorVelocityX,
        value.anchorVelocityY,
        value.anchorVelocityZ,
        value.massPresent ? 1 : 0,
        value.mass,
        value.constantAccelerationX,
        value.constantAccelerationY,
        value.constantAccelerationZ,
        value.sourcePresent ? 1 : 0,
        value.sourceIdHigh,
        value.sourceIdLow,
        value.sourceRevisionHigh,
        value.sourceRevisionLow,
        value.sourcePositionX,
        value.sourcePositionY,
        value.sourcePositionZ,
        value.sourceMuPresent ? 1 : 0,
        value.sourceMu,
        value.sourceMassPresent ? 1 : 0,
        value.sourceMass,
        value.relativeTolerance,
        value.positionAbsoluteToleranceMeters,
        value.velocityAbsoluteToleranceMetersPerSecond,
        value.massAbsoluteToleranceKilograms,
        value.checkpointStrideAcceptedSteps,
        value.maxCheckpointCount,
        value.maxDenseStepCount,
        value.maxAcceptedStepsPerExtension,
        value.maxRejectedStepsPerExtension,
        value.minStep.secondsHigh,
        value.minStep.secondsLow,
        value.minStep.nanoseconds,
        value.maxStep.secondsHigh,
        value.maxStep.secondsLow,
        value.maxStep.nanoseconds,
        value.configurationRevisionHigh,
        value.configurationRevisionLow,
        value.motionRevisionHigh,
        value.motionRevisionLow,
      ];
      if (module._orbit_engine_round_trip_numerical(...args) === 0) {
        throw new RangeError("WASM numerical operation was rejected");
      }
      return {
        ...value,
        resultCode: module._orbit_engine_numerical_result_code() >>> 0,
        resultEpoch: {
          secondsHigh: module._orbit_engine_numerical_result_epoch_seconds_high(),
          secondsLow: module._orbit_engine_numerical_result_epoch_seconds_low() >>> 0,
          nanoseconds: module._orbit_engine_numerical_result_epoch_nanoseconds() >>> 0,
        },
        resultPositionX: module._orbit_engine_numerical_result_position_x(),
        resultPositionY: module._orbit_engine_numerical_result_position_y(),
        resultPositionZ: module._orbit_engine_numerical_result_position_z(),
        resultVelocityX: module._orbit_engine_numerical_result_velocity_x(),
        resultVelocityY: module._orbit_engine_numerical_result_velocity_y(),
        resultVelocityZ: module._orbit_engine_numerical_result_velocity_z(),
        resultMassPresent: module._orbit_engine_numerical_result_mass_present() !== 0,
        resultMass: module._orbit_engine_numerical_result_mass(),
      };
    },
    roundTripCoupled: (value: CoupledWire) => {
      const input = encodeCoupledPacket(value);
      const outputLength = 9 + 32 * 23;
      const inputPointer = module._malloc(input.byteLength);
      const outputPointer = module._malloc(outputLength * Float64Array.BYTES_PER_ELEMENT);
      if (inputPointer === 0 || outputPointer === 0) {
        if (inputPointer !== 0) module._free(inputPointer);
        if (outputPointer !== 0) module._free(outputPointer);
        throw new RangeError("WASM coupled operation could not allocate its packet buffers");
      }
      try {
        module.HEAPF64.set(input, inputPointer / Float64Array.BYTES_PER_ELEMENT);
        if (module._orbit_engine_round_trip_coupled(inputPointer, input.length, outputPointer, outputLength) === 0) {
          throw new RangeError("WASM coupled operation was rejected");
        }
        const output = module.HEAPF64.slice(outputPointer / Float64Array.BYTES_PER_ELEMENT, outputPointer / Float64Array.BYTES_PER_ELEMENT + outputLength);
        return decodeCoupledPacket(value, output);
      } finally {
        module._free(inputPointer);
        module._free(outputPointer);
      }
    },
    roundTripScheduler: (value: SchedulerWire) => {
      const input = encodeSchedulerPacket(value);
      const outputLength = SCHEDULER_OUTPUT_WORDS;
      const inputPointer = module._malloc(input.byteLength);
      const outputPointer = module._malloc(outputLength * Float64Array.BYTES_PER_ELEMENT);
      if (inputPointer === 0 || outputPointer === 0) {
        if (inputPointer !== 0) module._free(inputPointer);
        if (outputPointer !== 0) module._free(outputPointer);
        throw new RangeError("WASM scheduler operation could not allocate its packet buffers");
      }
      try {
        module.HEAPF64.set(input, inputPointer / Float64Array.BYTES_PER_ELEMENT);
        if (module._orbit_engine_round_trip_scheduler(inputPointer, input.length, outputPointer, outputLength) === 0) {
          throw new RangeError("WASM scheduler operation was rejected");
        }
        const output = module.HEAPF64.slice(outputPointer / Float64Array.BYTES_PER_ELEMENT, outputPointer / Float64Array.BYTES_PER_ELEMENT + outputLength);
        return decodeSchedulerPacket(value, output);
      } finally {
        module._free(inputPointer);
        module._free(outputPointer);
      }
    },
  };

  return backendFromRawBinding("wasm", raw);
}
