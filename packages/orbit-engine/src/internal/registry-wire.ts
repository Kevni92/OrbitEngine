import {
  objectId,
  objectId as normalizeObjectId,
  type ObjectId,
  type ObjectType,
} from "../objects.js";
import { objectTypeFromCode, objectTypeToCode } from "./object-wire.js";
import { physicalProperties, type PhysicalProperties } from "../properties.js";
import {
  propagationDirectionCode,
  propagationDirectionFromCode,
  propagationModelKindCode,
  propagationModelKindFromCode,
  propagationState,
  revisionId,
  type CanonicalCartesianState,
  type PropagationDirection,
  type PropagationModelKind,
  type RevisionId,
} from "../propagation.js";
import { referenceFrameId, type ReferenceFrameId } from "../frames.js";
import { meters, metersPerSecond } from "../units.js";
import {
  compareSimulationInstants,
  simulationInstant,
  type SimulationInstant,
} from "../time.js";
import { decodeSimulationInstant, encodeSimulationInstant, validateTimeWire, type TimeWire } from "./time-wire.js";
import type {
  MotionMetadata,
  ObjectRecord,
  ReferenceStatus,
} from "../registry.js";

const TWO_TO_32 = 4_294_967_296;
const UINT32_MAX = 4_294_967_295;
const INT32_MIN = -2_147_483_648;
const INT32_MAX = 2_147_483_647;

export const RegistryOperationCode = Object.freeze({
  reset: 0,
  register: 1,
  lookup: 2,
  updateProperties: 3,
  remove: 4,
  diverge: 5,
  advanceClock: 6,
} as const);

export const RegistryResultCode = Object.freeze({
  success: 0,
  invalidInput: 1,
  duplicateLiveId: 2,
  retiredId: 3,
  notLive: 4,
  blockedRemoval: 5,
  retroactiveChange: 6,
  invalidTransition: 7,
} as const);

export interface RegistryWire {
  readonly operationCode: number;
  readonly resultCode: number;
  readonly objectIdHigh: number;
  readonly objectIdLow: number;
  readonly objectTypeCode: number;
  readonly massPresent: boolean;
  readonly mass: number;
  readonly muPresent: boolean;
  readonly mu: number;
  readonly physicalRadiusPresent: boolean;
  readonly physicalRadius: number;
  readonly collisionBoundingRadiusPresent: boolean;
  readonly collisionBoundingRadius: number;
  readonly statePresent: boolean;
  readonly stateEpochSecondsHigh: number;
  readonly stateEpochSecondsLow: number;
  readonly stateEpochNanoseconds: number;
  readonly stateFrameHigh: number;
  readonly stateFrameLow: number;
  readonly positionX: number;
  readonly positionY: number;
  readonly positionZ: number;
  readonly velocityX: number;
  readonly velocityY: number;
  readonly velocityZ: number;
  readonly modelKindCode: number;
  readonly directionCode: number;
  readonly segmentStartSecondsHigh: number;
  readonly segmentStartSecondsLow: number;
  readonly segmentStartNanoseconds: number;
  readonly segmentEndPresent: boolean;
  readonly segmentEndSecondsHigh: number;
  readonly segmentEndSecondsLow: number;
  readonly segmentEndNanoseconds: number;
  readonly configurationRevisionHigh: number;
  readonly configurationRevisionLow: number;
  readonly motionRevisionHigh: number;
  readonly motionRevisionLow: number;
  readonly referenceStatusCode: number;
  readonly propertyRevisionHigh: number;
  readonly propertyRevisionLow: number;
  readonly effectiveEpochSecondsHigh: number;
  readonly effectiveEpochSecondsLow: number;
  readonly effectiveEpochNanoseconds: number;
  readonly structuralParentPresent: boolean;
  readonly structuralParentHigh: number;
  readonly structuralParentLow: number;
}

export interface RegistryWireValue {
  readonly operationCode: number;
  readonly id: ObjectId;
  readonly type: ObjectType;
  readonly properties?: PhysicalProperties;
  readonly state?: CanonicalCartesianState;
  readonly motion?: MotionMetadata;
  readonly referenceStatus?: ReferenceStatus;
  readonly propertyRevision?: RevisionId;
  readonly effectiveEpoch?: SimulationInstant;
  readonly structuralParent?: ObjectId;
}

function integer(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) throw new TypeError(`${name} must be an integer`);
  return value;
}

function uint32(value: unknown, name: string): number {
  const result = integer(value, name);
  if (result < 0 || result > UINT32_MAX) throw new RangeError(`${name} is outside uint32 range`);
  return result;
}

function uint16(value: unknown, name: string): number {
  const result = integer(value, name);
  if (result < 0 || result > 65_535) throw new RangeError(`${name} is outside uint16 range`);
  return result;
}

function finite(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  return value;
}

function boolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") throw new TypeError(`${name} must be boolean`);
  return value;
}

function idToWords(value: string, name: string, allowZero: boolean): { high: number; low: number } {
  if (!/^(0|[1-9][0-9]*)$/.test(value) || value.length > 20 || (!allowZero && value === "0")
      || (value.length === 20 && value > "18446744073709551615")) {
    throw new RangeError(`${name} is not canonical uint64 decimal text`);
  }
  let high = 0;
  let low = 0;
  for (const character of value) {
    const product = low * 10 + character.charCodeAt(0) - 48;
    low = product % TWO_TO_32;
    high = high * 10 + Math.floor(product / TWO_TO_32);
  }
  if (high >= TWO_TO_32) throw new RangeError(`${name} exceeds uint64 range`);
  return { high, low };
}

function wordsToId(high: number, low: number, name: string, allowZero: boolean): string {
  let currentHigh = uint32(high, `${name}High`);
  let currentLow = uint32(low, `${name}Low`);
  if (!allowZero && currentHigh === 0 && currentLow === 0) throw new RangeError(`${name} must be non-zero`);
  let value = "";
  while (currentHigh !== 0 || currentLow !== 0) {
    const remainder = currentHigh % 10;
    currentHigh = Math.floor(currentHigh / 10);
    const combined = remainder * TWO_TO_32 + currentLow;
    currentLow = Math.floor(combined / 10);
    value = String(combined % 10) + value;
  }
  return value || "0";
}

function validateTimestamp(high: unknown, low: unknown, nanoseconds: unknown, name: string): SimulationInstant {
  const secondsHigh = integer(high, `${name}SecondsHigh`);
  if (secondsHigh < INT32_MIN || secondsHigh > INT32_MAX) throw new RangeError(`${name} secondsHigh is outside int32 range`);
  const wire = validateTimeWire({ secondsHigh, secondsLow: uint32(low, `${name}SecondsLow`), nanoseconds: integer(nanoseconds, `${name}Nanoseconds`) });
  return decodeSimulationInstant(wire);
}

function optional(value: unknown, present: unknown, name: string): { readonly present: boolean; readonly value: number } {
  const isPresent = boolean(present, `${name}Present`);
  const result = finite(value, name);
  if (result < 0 || (!isPresent && result !== 0)) throw new RangeError(`${name} must be non-negative and zero when absent`);
  return { present: isPresent, value: result === 0 ? 0 : result };
}

function validateCommon(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) throw new TypeError("registry wire value must be an object");
  const candidate = value as Record<string, unknown>;
  const operationCode = uint16(candidate.operationCode, "operationCode");
  const resultCode = uint16(candidate.resultCode, "resultCode");
  if (operationCode > RegistryOperationCode.advanceClock) throw new RangeError("Unknown registry operation code");
  if (resultCode > RegistryResultCode.invalidTransition) throw new RangeError("Unknown registry result code");
  const objectIdHigh = uint32(candidate.objectIdHigh, "objectIdHigh");
  const objectIdLow = uint32(candidate.objectIdLow, "objectIdLow");
  if (objectIdHigh === 0 && objectIdLow === 0) throw new RangeError("Registry wire object ID must be non-zero");
  const objectTypeCode = uint16(candidate.objectTypeCode, "objectTypeCode");
  objectTypeFromCode(objectTypeCode);
  optional(candidate.mass, candidate.massPresent, "mass");
  optional(candidate.mu, candidate.muPresent, "mu");
  optional(candidate.physicalRadius, candidate.physicalRadiusPresent, "physicalRadius");
  optional(candidate.collisionBoundingRadius, candidate.collisionBoundingRadiusPresent, "collisionBoundingRadius");
  const statePresent = boolean(candidate.statePresent, "statePresent");
  validateTimestamp(candidate.stateEpochSecondsHigh, candidate.stateEpochSecondsLow, candidate.stateEpochNanoseconds, "stateEpoch");
  const stateFrameHigh = uint32(candidate.stateFrameHigh, "stateFrameHigh");
  const stateFrameLow = uint32(candidate.stateFrameLow, "stateFrameLow");
  if (statePresent && stateFrameHigh === 0 && stateFrameLow === 0) throw new RangeError("State frame must be non-zero");
  for (const name of ["positionX", "positionY", "positionZ", "velocityX", "velocityY", "velocityZ"]) finite(candidate[name], name);
  const modelKindCode = uint16(candidate.modelKindCode, "modelKindCode");
  propagationModelKindFromCode(modelKindCode);
  const directionCode = uint16(candidate.directionCode, "directionCode");
  propagationDirectionFromCode(directionCode);
  const segmentStart = validateTimestamp(candidate.segmentStartSecondsHigh, candidate.segmentStartSecondsLow, candidate.segmentStartNanoseconds, "segmentStart");
  const segmentEndPresent = boolean(candidate.segmentEndPresent, "segmentEndPresent");
  const segmentEnd = validateTimestamp(candidate.segmentEndSecondsHigh, candidate.segmentEndSecondsLow, candidate.segmentEndNanoseconds, "segmentEnd");
  if (segmentEndPresent && compareSimulationInstants(segmentStart, segmentEnd) >= 0) throw new RangeError("Segment end must be after start");
  const referenceStatusCode = uint16(candidate.referenceStatusCode, "referenceStatusCode");
  if (referenceStatusCode > 2) throw new RangeError("Unknown reference status code");
  validateTimestamp(candidate.effectiveEpochSecondsHigh, candidate.effectiveEpochSecondsLow, candidate.effectiveEpochNanoseconds, "effectiveEpoch");
  const structuralParentPresent = boolean(candidate.structuralParentPresent, "structuralParentPresent");
  const structuralParentHigh = uint32(candidate.structuralParentHigh, "structuralParentHigh");
  const structuralParentLow = uint32(candidate.structuralParentLow, "structuralParentLow");
  if (structuralParentPresent && structuralParentHigh === 0 && structuralParentLow === 0) throw new RangeError("Structural parent must be non-zero");
  if (!structuralParentPresent && (structuralParentHigh !== 0 || structuralParentLow !== 0)) throw new RangeError("Absent structural parent must use zero words");
  uint32(candidate.configurationRevisionHigh, "configurationRevisionHigh");
  uint32(candidate.configurationRevisionLow, "configurationRevisionLow");
  uint32(candidate.motionRevisionHigh, "motionRevisionHigh");
  uint32(candidate.motionRevisionLow, "motionRevisionLow");
  uint32(candidate.propertyRevisionHigh, "propertyRevisionHigh");
  uint32(candidate.propertyRevisionLow, "propertyRevisionLow");
  return {
    ...candidate,
    operationCode,
    resultCode,
    objectIdHigh,
    objectIdLow,
    objectTypeCode,
    statePresent,
    stateFrameHigh,
    stateFrameLow,
    modelKindCode,
    directionCode,
    segmentEndPresent,
    referenceStatusCode,
    structuralParentPresent,
    structuralParentHigh,
    structuralParentLow,
  };
}

export function validateRegistryWire(value: unknown): RegistryWire {
  const candidate = validateCommon(value);
  return Object.freeze({
    ...candidate,
    massPresent: boolean(candidate.massPresent, "massPresent"),
    mass: finite(candidate.mass, "mass"),
    muPresent: boolean(candidate.muPresent, "muPresent"),
    mu: finite(candidate.mu, "mu"),
    physicalRadiusPresent: boolean(candidate.physicalRadiusPresent, "physicalRadiusPresent"),
    physicalRadius: finite(candidate.physicalRadius, "physicalRadius"),
    collisionBoundingRadiusPresent: boolean(candidate.collisionBoundingRadiusPresent, "collisionBoundingRadiusPresent"),
    collisionBoundingRadius: finite(candidate.collisionBoundingRadius, "collisionBoundingRadius"),
    stateEpochSecondsHigh: integer(candidate.stateEpochSecondsHigh, "stateEpochSecondsHigh"),
    stateEpochSecondsLow: uint32(candidate.stateEpochSecondsLow, "stateEpochSecondsLow"),
    stateEpochNanoseconds: integer(candidate.stateEpochNanoseconds, "stateEpochNanoseconds"),
    positionX: finite(candidate.positionX, "positionX"),
    positionY: finite(candidate.positionY, "positionY"),
    positionZ: finite(candidate.positionZ, "positionZ"),
    velocityX: finite(candidate.velocityX, "velocityX"),
    velocityY: finite(candidate.velocityY, "velocityY"),
    velocityZ: finite(candidate.velocityZ, "velocityZ"),
    segmentStartSecondsHigh: integer(candidate.segmentStartSecondsHigh, "segmentStartSecondsHigh"),
    segmentStartSecondsLow: uint32(candidate.segmentStartSecondsLow, "segmentStartSecondsLow"),
    segmentStartNanoseconds: integer(candidate.segmentStartNanoseconds, "segmentStartNanoseconds"),
    segmentEndSecondsHigh: integer(candidate.segmentEndSecondsHigh, "segmentEndSecondsHigh"),
    segmentEndSecondsLow: uint32(candidate.segmentEndSecondsLow, "segmentEndSecondsLow"),
    segmentEndNanoseconds: integer(candidate.segmentEndNanoseconds, "segmentEndNanoseconds"),
    effectiveEpochSecondsHigh: integer(candidate.effectiveEpochSecondsHigh, "effectiveEpochSecondsHigh"),
    effectiveEpochSecondsLow: uint32(candidate.effectiveEpochSecondsLow, "effectiveEpochSecondsLow"),
    effectiveEpochNanoseconds: integer(candidate.effectiveEpochNanoseconds, "effectiveEpochNanoseconds"),
  } as RegistryWire);
}

function zeroTime(): TimeWire {
  return { secondsHigh: 0, secondsLow: 0, nanoseconds: 0 };
}

function defaultState(): CanonicalCartesianState {
  return propagationState({
    position: { x: meters(0), y: meters(0), z: meters(0) },
    velocity: { x: metersPerSecond(0), y: metersPerSecond(0), z: metersPerSecond(0) },
    epoch: simulationInstant(0),
    referenceFrame: referenceFrameId("1"),
  });
}

function defaultMotion(): MotionMetadata {
  return Object.freeze({
    modelKind: "referenceEphemeris",
    direction: "bidirectional",
    propagationFrame: referenceFrameId("1"),
    segmentStart: simulationInstant(0),
    configurationRevision: revisionId("0"),
    motionRevision: revisionId("0"),
  });
}

function words(value: RevisionId | undefined): { high: number; low: number } {
  return idToWords(value ?? revisionId("0"), "revision", true);
}

export function encodeRegistryWire(value: RegistryWireValue): RegistryWire {
  const id = idToWords(normalizeObjectId(value.id), "objectId", false);
  const state = value.state ?? defaultState();
  const motion = value.motion ?? defaultMotion();
  const properties = physicalProperties(value.properties ?? {});
  const epoch = encodeSimulationInstant(state.epoch);
  const segmentStart = encodeSimulationInstant(motion.segmentStart);
  const segmentEnd = motion.segmentEnd === undefined ? zeroTime() : encodeSimulationInstant(motion.segmentEnd);
  const effectiveEpoch = encodeSimulationInstant(value.effectiveEpoch ?? simulationInstant(0));
  const configurationRevision = words(motion.configurationRevision);
  const motionRevision = words(motion.motionRevision);
  const propertyRevision = words(value.propertyRevision);
  const structuralParent = value.structuralParent === undefined
    ? { present: false, high: 0, low: 0 }
    : { present: true, ...idToWords(normalizeObjectId(value.structuralParent), "structuralParent", false) };
  const optionalMass = properties.mass === undefined ? { present: false, value: 0 } : { present: true, value: properties.mass };
  const optionalMu = properties.mu === undefined ? { present: false, value: 0 } : { present: true, value: properties.mu };
  const optionalPhysicalRadius = properties.physicalRadius === undefined ? { present: false, value: 0 } : { present: true, value: properties.physicalRadius };
  const optionalCollisionRadius = properties.collisionBoundingRadius === undefined ? { present: false, value: 0 } : { present: true, value: properties.collisionBoundingRadius };
  return validateRegistryWire({
    operationCode: value.operationCode,
    resultCode: RegistryResultCode.success,
    objectIdHigh: id.high,
    objectIdLow: id.low,
    objectTypeCode: objectTypeToCode(value.type),
    massPresent: optionalMass.present,
    mass: optionalMass.value,
    muPresent: optionalMu.present,
    mu: optionalMu.value,
    physicalRadiusPresent: optionalPhysicalRadius.present,
    physicalRadius: optionalPhysicalRadius.value,
    collisionBoundingRadiusPresent: optionalCollisionRadius.present,
    collisionBoundingRadius: optionalCollisionRadius.value,
    statePresent: value.state !== undefined,
    stateEpochSecondsHigh: epoch.secondsHigh,
    stateEpochSecondsLow: epoch.secondsLow,
    stateEpochNanoseconds: epoch.nanoseconds,
    stateFrameHigh: idToWords(referenceFrameId(state.referenceFrame), "referenceFrame", false).high,
    stateFrameLow: idToWords(referenceFrameId(state.referenceFrame), "referenceFrame", false).low,
    positionX: state.position.x,
    positionY: state.position.y,
    positionZ: state.position.z,
    velocityX: state.velocity.x,
    velocityY: state.velocity.y,
    velocityZ: state.velocity.z,
    modelKindCode: propagationModelKindCode(motion.modelKind),
    directionCode: propagationDirectionCode(motion.direction),
    segmentStartSecondsHigh: segmentStart.secondsHigh,
    segmentStartSecondsLow: segmentStart.secondsLow,
    segmentStartNanoseconds: segmentStart.nanoseconds,
    segmentEndPresent: motion.segmentEnd !== undefined,
    segmentEndSecondsHigh: segmentEnd.secondsHigh,
    segmentEndSecondsLow: segmentEnd.secondsLow,
    segmentEndNanoseconds: segmentEnd.nanoseconds,
    configurationRevisionHigh: configurationRevision.high,
    configurationRevisionLow: configurationRevision.low,
    motionRevisionHigh: motionRevision.high,
    motionRevisionLow: motionRevision.low,
    referenceStatusCode: value.referenceStatus === "followingReference" ? 1 : value.referenceStatus === "diverged" ? 2 : 0,
    propertyRevisionHigh: propertyRevision.high,
    propertyRevisionLow: propertyRevision.low,
    effectiveEpochSecondsHigh: effectiveEpoch.secondsHigh,
    effectiveEpochSecondsLow: effectiveEpoch.secondsLow,
    effectiveEpochNanoseconds: effectiveEpoch.nanoseconds,
    structuralParentPresent: structuralParent.present,
    structuralParentHigh: structuralParent.high,
    structuralParentLow: structuralParent.low,
  });
}

export function decodeRegistryRecord(value: unknown): ObjectRecord {
  const wire = validateRegistryWire(value);
  if (wire.resultCode !== RegistryResultCode.success) throw new RangeError("Registry result is not successful");
  const stateEpoch = decodeSimulationInstant({
    secondsHigh: wire.stateEpochSecondsHigh,
    secondsLow: wire.stateEpochSecondsLow,
    nanoseconds: wire.stateEpochNanoseconds,
  });
  const frame = wordsToId(wire.stateFrameHigh, wire.stateFrameLow, "referenceFrame", false);
  const segmentStart = decodeSimulationInstant({
    secondsHigh: wire.segmentStartSecondsHigh,
    secondsLow: wire.segmentStartSecondsLow,
    nanoseconds: wire.segmentStartNanoseconds,
  });
  const segmentEnd = wire.segmentEndPresent ? decodeSimulationInstant({
    secondsHigh: wire.segmentEndSecondsHigh,
    secondsLow: wire.segmentEndSecondsLow,
    nanoseconds: wire.segmentEndNanoseconds,
  }) : undefined;
  const state = propagationState({
    position: { x: meters(wire.positionX), y: meters(wire.positionY), z: meters(wire.positionZ) },
    velocity: { x: metersPerSecond(wire.velocityX), y: metersPerSecond(wire.velocityY), z: metersPerSecond(wire.velocityZ) },
    epoch: stateEpoch,
    referenceFrame: referenceFrameId(frame),
  });
  const structuralParent = wire.structuralParentPresent
    ? objectId(wordsToId(wire.structuralParentHigh, wire.structuralParentLow, "structuralParent", false))
    : undefined;
  return Object.freeze({
    id: objectId(wordsToId(wire.objectIdHigh, wire.objectIdLow, "objectId", false)),
    type: objectTypeFromCode(wire.objectTypeCode),
    properties: physicalProperties({
      mass: wire.massPresent ? wire.mass : undefined,
      mu: wire.muPresent ? wire.mu : undefined,
      physicalRadius: wire.physicalRadiusPresent ? wire.physicalRadius : undefined,
      collisionBoundingRadius: wire.collisionBoundingRadiusPresent ? wire.collisionBoundingRadius : undefined,
    }),
    state,
    motion: Object.freeze({
      modelKind: propagationModelKindFromCode(wire.modelKindCode),
      direction: propagationDirectionFromCode(wire.directionCode),
      propagationFrame: referenceFrameId(frame),
      segmentStart,
      segmentEnd,
      configurationRevision: revisionId(wordsToId(wire.configurationRevisionHigh, wire.configurationRevisionLow, "configurationRevision", true)),
      motionRevision: revisionId(wordsToId(wire.motionRevisionHigh, wire.motionRevisionLow, "motionRevision", true)),
    }),
    referenceStatus: wire.referenceStatusCode === 1 ? "followingReference" : wire.referenceStatusCode === 2 ? "diverged" : "none",
    propertyRevision: revisionId(wordsToId(wire.propertyRevisionHigh, wire.propertyRevisionLow, "propertyRevision", true)),
    structuralParent,
  });
}

export function registryObjectIdFromWire(value: RegistryWire): ObjectId {
  return objectId(wordsToId(value.objectIdHigh, value.objectIdLow, "objectId", false));
}
