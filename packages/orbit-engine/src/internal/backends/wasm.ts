import type { Backend } from "./contract.js";
import { backendFromRawBinding } from "./binding.js";
import { BackendInitializationError } from "./errors.js";
import type { TimeWire } from "../time-wire.js";
import type { ObjectWire } from "../object-wire.js";
import type { FrameWire } from "../frame-wire.js";
import type { PropagationWire } from "../propagation-wire.js";

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

interface WasmModule {
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
}

interface WasmModuleFactory {
  (options: { locateFile: (fileName: string) => string }): Promise<WasmModule>;
}

export async function loadWasmBackend(): Promise<Backend> {
  const wasmDirectory = new URL("../../../../wasm/", import.meta.url);
  const moduleUrl = new URL("orbit_engine_wasm.js", wasmDirectory);

  let imported: { default?: unknown };
  try {
    imported = (await import(moduleUrl.href)) as { default?: unknown };
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
      locateFile: (fileName) => new URL(fileName, wasmDirectory).href,
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
  };

  return backendFromRawBinding("wasm", raw);
}
