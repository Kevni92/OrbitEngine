import {
  BINDING_PROTOCOL_VERSION,
  type Backend,
  type BackendHealth,
  type BackendKind,
  type RawBackendBinding,
  type RawInitializationResult,
} from "./contract.js";
import { BackendInitializationError } from "./errors.js";
import { validateTimeWire, type TimeWire } from "../time-wire.js";
import { validateObjectWire, type ObjectWire } from "../object-wire.js";
import { validateFrameWire, type FrameWire } from "../frame-wire.js";
import { validatePropagationWire, type PropagationWire } from "../propagation-wire.js";
import { validateRegistryWire, type RegistryWire } from "../registry-wire.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asInteger(value: unknown, field: string, backend: BackendKind): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new BackendInitializationError(backend, `${backend} binding returned an invalid ${field}`);
  }

  return value;
}

export async function backendFromRawBinding(
  kind: BackendKind,
  raw: unknown,
): Promise<Backend> {
  if (!isRecord(raw)
    || typeof raw.initialize !== "function"
    || typeof raw.roundTripTime !== "function"
    || typeof raw.roundTripDouble !== "function"
    || typeof raw.roundTripObject !== "function"
    || typeof raw.roundTripFrame !== "function"
    || typeof raw.roundTripPropagation !== "function") {
    throw new BackendInitializationError(kind, `${kind} binding is missing its initialization surface`);
  }
  if (typeof raw.roundTripRegistry !== "function") {
    throw new BackendInitializationError(kind, `${kind} binding is missing its initialization surface`);
  }

  const protocolVersion = asInteger(raw.protocolVersion, "protocol version", kind);
  if (protocolVersion !== BINDING_PROTOCOL_VERSION) {
    throw new BackendInitializationError(
      kind,
      `${kind} binding protocol mismatch: expected ${BINDING_PROTOCOL_VERSION}, received ${protocolVersion}`,
    );
  }

  let initialized: unknown;
  try {
    initialized = await raw.initialize();
  } catch (cause) {
    throw new BackendInitializationError(kind, `${kind} backend initialization failed`, cause);
  }

  if (!isRecord(initialized)) {
    throw new BackendInitializationError(kind, `${kind} binding returned an invalid initialization result`);
  }

  const result = initialized as unknown as RawInitializationResult;
  const health: BackendHealth = {
    protocolVersion,
    coreVersion: asInteger(result.coreVersion, "core version", kind),
    healthCode: asInteger(result.healthCode, "health code", kind),
  };

  const binding = raw as unknown as RawBackendBinding;
  return {
    kind,
    health: () => health,
    roundTripTime: (value: TimeWire): TimeWire => {
      let result: unknown;
      try {
        result = binding.roundTripTime(value);
      } catch (cause) {
        throw new BackendInitializationError(kind, `${kind} time round-trip failed`, cause);
      }
      return validateTimeWire(result);
    },
    roundTripDouble: (value: number): number => {
      if (!Number.isFinite(value)) {
        throw new TypeError("round-trip value must be finite");
      }
      let result: unknown;
      try {
        result = binding.roundTripDouble(value);
      } catch (cause) {
        throw new BackendInitializationError(kind, `${kind} binary64 round-trip failed`, cause);
      }
      if (typeof result !== "number" || !Number.isFinite(result)) {
        throw new BackendInitializationError(kind, `${kind} binding returned an invalid binary64 value`);
      }
      return result;
    },
    roundTripObject: (value: ObjectWire): ObjectWire => {
      const input = validateObjectWire(value);
      let result: unknown;
      try {
        result = binding.roundTripObject(input);
      } catch (cause) {
        throw new BackendInitializationError(kind, `${kind} object round-trip failed`, cause);
      }
      return validateObjectWire(result);
    },
    roundTripFrame: (value: FrameWire): FrameWire => {
      const input = validateFrameWire(value);
      let result: unknown;
      try {
        result = binding.roundTripFrame(input);
      } catch (cause) {
        throw new BackendInitializationError(kind, `${kind} frame round-trip failed`, cause);
      }
      return validateFrameWire(result);
    },
    roundTripPropagation: (value: PropagationWire): PropagationWire => {
      const input = validatePropagationWire(value);
      let result: unknown;
      try {
        result = binding.roundTripPropagation(input);
      } catch (cause) {
        throw new BackendInitializationError(kind, `${kind} propagation round-trip failed`, cause);
      }
      return validatePropagationWire(result);
    },
    roundTripRegistry: (value: RegistryWire): RegistryWire => {
      const input = validateRegistryWire(value);
      let result: unknown;
      try {
        result = binding.roundTripRegistry(input);
      } catch (cause) {
        throw new BackendInitializationError(kind, `${kind} registry operation failed`, cause);
      }
      return validateRegistryWire(result);
    },
  };
}
