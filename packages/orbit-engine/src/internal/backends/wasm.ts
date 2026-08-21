import type { Backend } from "./contract.js";
import { backendFromRawBinding } from "./binding.js";
import { BackendInitializationError } from "./errors.js";
import type { TimeWire } from "../time-wire.js";
import type { ObjectWire } from "../object-wire.js";

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

interface WasmModule {
  readonly _orbit_engine_binding_protocol_version: () => number;
  readonly _orbit_engine_core_version: () => number;
  readonly _orbit_engine_health: () => number;
  readonly _orbit_engine_round_trip_time_seconds_high: (secondsHigh: number, secondsLow: number, nanoseconds: number) => number;
  readonly _orbit_engine_round_trip_time_seconds_low: (secondsHigh: number, secondsLow: number, nanoseconds: number) => number;
  readonly _orbit_engine_round_trip_time_nanoseconds: (secondsHigh: number, secondsLow: number, nanoseconds: number) => number;
  readonly _orbit_engine_round_trip_double: (value: number) => number;
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
