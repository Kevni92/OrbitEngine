import type { Backend } from "./internal/backends/contract.js";
import {
  decodeRegistryRecord,
  encodeRegistryWire,
  RegistryOperationCode,
  RegistryResultCode,
  type RegistryWire,
} from "./internal/registry-wire.js";
import { objectId, objectType, type ObjectId, type ObjectType } from "./objects.js";
import { physicalProperties, type PhysicalProperties, type PhysicalPropertiesInput } from "./properties.js";
import {
  propagationDirectionCode,
  propagationModelKindCode,
  propagationState,
  revisionId,
  type CanonicalCartesianState,
  type PropagationDirection,
  type PropagationModelKind,
  type RevisionId,
} from "./propagation.js";
import { compareSimulationInstants, simulationInstant, type SimulationInstant } from "./time.js";
import { referenceFrameId, type ReferenceFrameId } from "./frames.js";

export const ReferenceStatus = Object.freeze({
  none: "none",
  followingReference: "followingReference",
  diverged: "diverged",
} as const);

export type ReferenceStatus = (typeof ReferenceStatus)[keyof typeof ReferenceStatus];

export interface MotionMetadata {
  readonly modelKind: PropagationModelKind;
  readonly direction: PropagationDirection;
  readonly propagationFrame: ReferenceFrameId;
  readonly segmentStart: SimulationInstant;
  readonly segmentEnd?: SimulationInstant;
  readonly configurationRevision: RevisionId;
  readonly motionRevision: RevisionId;
}

export interface ObjectRecord {
  readonly id: ObjectId;
  readonly type: ObjectType;
  readonly properties: PhysicalProperties;
  readonly state: CanonicalCartesianState;
  readonly motion: MotionMetadata;
  readonly referenceStatus: ReferenceStatus;
  readonly propertyRevision: RevisionId;
  readonly structuralParent?: ObjectId;
}

export interface RegisterObjectInput {
  readonly id: ObjectId;
  readonly type: ObjectType;
  readonly properties?: PhysicalPropertiesInput | PhysicalProperties;
  readonly state: CanonicalCartesianState;
  readonly motion: MotionMetadata;
  readonly referenceStatus?: ReferenceStatus;
  readonly structuralParent?: ObjectId;
}

export interface DivergenceInput {
  readonly state: CanonicalCartesianState;
  readonly motion: MotionMetadata;
}

export const RegistryErrorCode = Object.freeze({
  invalidInput: "invalidInput",
  duplicateLiveId: "duplicateLiveId",
  retiredId: "retiredId",
  notLive: "notLive",
  blockedRemoval: "blockedRemoval",
  retroactiveChange: "retroactiveChange",
  invalidTransition: "invalidTransition",
} as const);

export type RegistryErrorCode = (typeof RegistryErrorCode)[keyof typeof RegistryErrorCode];

const RESULT_TO_ERROR: Readonly<Record<number, RegistryErrorCode>> = Object.freeze({
  [RegistryResultCode.invalidInput]: RegistryErrorCode.invalidInput,
  [RegistryResultCode.duplicateLiveId]: RegistryErrorCode.duplicateLiveId,
  [RegistryResultCode.retiredId]: RegistryErrorCode.retiredId,
  [RegistryResultCode.notLive]: RegistryErrorCode.notLive,
  [RegistryResultCode.blockedRemoval]: RegistryErrorCode.blockedRemoval,
  [RegistryResultCode.retroactiveChange]: RegistryErrorCode.retroactiveChange,
  [RegistryResultCode.invalidTransition]: RegistryErrorCode.invalidTransition,
});

export class RegistryError extends Error {
  readonly code: RegistryErrorCode;
  readonly resultCode: number;

  constructor(code: RegistryErrorCode, message: string, resultCode: number) {
    super(message);
    this.name = "RegistryError";
    this.code = code;
    this.resultCode = resultCode;
  }
}

function failForResult(wire: RegistryWire, operation: string): never {
  const code = RESULT_TO_ERROR[wire.resultCode] ?? RegistryErrorCode.invalidInput;
  throw new RegistryError(code, `Registry ${operation} failed: ${code}`, wire.resultCode);
}

function normalizedState(value: CanonicalCartesianState): CanonicalCartesianState {
  return propagationState(value);
}

function normalizedMotion(value: MotionMetadata): MotionMetadata {
  if (typeof value !== "object" || value === null) throw new TypeError("Motion metadata must be an object");
  const normalizedStart = simulationInstant(value.segmentStart.seconds, value.segmentStart.nanoseconds);
  const normalizedEnd = value.segmentEnd === undefined ? undefined : simulationInstant(value.segmentEnd.seconds, value.segmentEnd.nanoseconds);
  if (normalizedEnd !== undefined && compareSimulationInstants(normalizedStart, normalizedEnd) >= 0) {
    throw new RangeError("Motion segment end must be after start");
  }
  propagationModelKindCode(value.modelKind);
  propagationDirectionCode(value.direction);
  return Object.freeze({
    modelKind: value.modelKind,
    direction: value.direction,
    propagationFrame: referenceFrameId(value.propagationFrame),
    segmentStart: normalizedStart,
    segmentEnd: normalizedEnd,
    configurationRevision: revisionId(value.configurationRevision),
    motionRevision: revisionId(value.motionRevision),
  });
}

function normalizedReferenceStatus(value: ReferenceStatus | undefined): ReferenceStatus {
  const result = value ?? ReferenceStatus.none;
  if (result !== ReferenceStatus.none && result !== ReferenceStatus.followingReference && result !== ReferenceStatus.diverged) {
    throw new RangeError(`Unknown reference status: ${String(result)}`);
  }
  return result;
}

function assertStateWithinMotion(state: CanonicalCartesianState, motion: MotionMetadata): void {
  if (compareSimulationInstants(state.epoch, motion.segmentStart) < 0
      || (motion.segmentEnd !== undefined && compareSimulationInstants(state.epoch, motion.segmentEnd) >= 0)) {
    throw new RangeError("Canonical state epoch must lie within the half-open motion segment");
  }
}

function command(value: {
  readonly operationCode: number;
  readonly id: ObjectId;
  readonly type: ObjectType;
  readonly properties?: PhysicalProperties | PhysicalPropertiesInput;
  readonly state?: CanonicalCartesianState;
  readonly motion?: MotionMetadata;
  readonly referenceStatus?: ReferenceStatus;
  readonly propertyRevision?: RevisionId;
  readonly effectiveEpoch?: SimulationInstant;
  readonly structuralParent?: ObjectId;
}): RegistryWire {
  const id = objectId(value.id);
  const type = objectType(value.type);
  const state = value.state === undefined ? undefined : normalizedState(value.state);
  const motion = value.motion === undefined ? undefined : normalizedMotion(value.motion);
  if (state !== undefined && motion !== undefined && state.referenceFrame !== motion.propagationFrame) {
    throw new RangeError("Canonical state frame must equal the authoritative propagation frame");
  }
  return encodeRegistryWire({
    operationCode: value.operationCode,
    id,
    type,
    properties: value.properties === undefined ? undefined : physicalProperties(value.properties),
    state,
    motion,
    referenceStatus: normalizedReferenceStatus(value.referenceStatus),
    propertyRevision: value.propertyRevision === undefined ? undefined : revisionId(value.propertyRevision),
    effectiveEpoch: value.effectiveEpoch === undefined ? undefined : simulationInstant(value.effectiveEpoch.seconds, value.effectiveEpoch.nanoseconds),
    structuralParent: value.structuralParent === undefined ? undefined : objectId(value.structuralParent),
  });
}

function successful(wire: RegistryWire, operation: string): RegistryWire {
  if (wire.resultCode !== RegistryResultCode.success) failForResult(wire, operation);
  return wire;
}

export class ObjectRegistry {
  readonly #backend: Backend;
  #currentTime = simulationInstant(0);

  constructor(backend: Backend) {
    this.#backend = backend;
    const reset = command({
      operationCode: RegistryOperationCode.reset,
      id: objectId("1"),
      type: "planet",
    });
    successful(this.#backend.roundTripRegistry(reset), "reset");
  }

  currentTime(): SimulationInstant {
    return this.#currentTime;
  }

  setCurrentTime(target: SimulationInstant): void {
    const normalized = simulationInstant(target.seconds, target.nanoseconds);
    const wire = command({
      operationCode: RegistryOperationCode.advanceClock,
      id: objectId("1"),
      type: "planet",
      effectiveEpoch: normalized,
    });
    successful(this.#backend.roundTripRegistry(wire), "advance clock");
    this.#currentTime = normalized;
  }

  register(input: RegisterObjectInput): ObjectRecord {
    if (typeof input !== "object" || input === null) throw new TypeError("Registration input must be an object");
    const state = normalizedState(input.state);
    const motion = normalizedMotion(input.motion);
    assertStateWithinMotion(state, motion);
    const wire = command({
      operationCode: RegistryOperationCode.register,
      id: input.id,
      type: input.type,
      properties: input.properties,
      state,
      motion,
      referenceStatus: input.referenceStatus ?? (motion.modelKind === "referenceEphemeris" ? ReferenceStatus.followingReference : ReferenceStatus.none),
      effectiveEpoch: this.#currentTime,
      structuralParent: input.structuralParent,
    });
    return decodeRegistryRecord(successful(this.#backend.roundTripRegistry(wire), "register"));
  }

  get(id: ObjectId): ObjectRecord {
    const wire = command({
      operationCode: RegistryOperationCode.lookup,
      id,
      type: "planet",
      effectiveEpoch: this.#currentTime,
    });
    return decodeRegistryRecord(successful(this.#backend.roundTripRegistry(wire), "lookup"));
  }

  lookup(id: ObjectId): ObjectRecord {
    return this.get(id);
  }

  updateProperties(id: ObjectId, effectiveEpoch: SimulationInstant, properties: PhysicalPropertiesInput | PhysicalProperties): ObjectRecord {
    const normalizedEpoch = simulationInstant(effectiveEpoch.seconds, effectiveEpoch.nanoseconds);
    const wire = command({
      operationCode: RegistryOperationCode.updateProperties,
      id,
      type: "planet",
      properties,
      effectiveEpoch: normalizedEpoch,
    });
    const result = decodeRegistryRecord(successful(this.#backend.roundTripRegistry(wire), "property update"));
    return result;
  }

  diverge(id: ObjectId, effectiveEpoch: SimulationInstant, input: DivergenceInput): ObjectRecord {
    const normalizedEpoch = simulationInstant(effectiveEpoch.seconds, effectiveEpoch.nanoseconds);
    const state = normalizedState(input.state);
    const motion = normalizedMotion(input.motion);
    if (compareSimulationInstants(state.epoch, normalizedEpoch) !== 0) {
      throw new RangeError("Divergence state epoch must equal the effective epoch");
    }
    if (compareSimulationInstants(motion.segmentStart, normalizedEpoch) !== 0) {
      throw new RangeError("Divergence motion segment must begin at the effective epoch");
    }
    const wire = command({
      operationCode: RegistryOperationCode.diverge,
      id,
      type: "planet",
      state,
      motion,
      effectiveEpoch: normalizedEpoch,
    });
    return decodeRegistryRecord(successful(this.#backend.roundTripRegistry(wire), "divergence"));
  }

  remove(id: ObjectId): void {
    const wire = command({
      operationCode: RegistryOperationCode.remove,
      id,
      type: "planet",
      effectiveEpoch: this.#currentTime,
    });
    successful(this.#backend.roundTripRegistry(wire), "remove");
  }
}
