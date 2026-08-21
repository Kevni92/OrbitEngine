import { objectId, type ObjectId } from "../objects.js";
import { referenceFrameId, type ReferenceFrameId } from "../frames.js";
import { rigidStateTransform, type RigidStateTransform } from "../frames.js";
import {
  decodeFrameWire,
  encodeFrameWire,
  validateFrameWire,
  type FrameWire,
} from "./frame-wire.js";

const UINT32_MAX = 4_294_967_295;
const TWO_TO_32 = 4_294_967_296;

export const FrameRegistryOperationCode = Object.freeze({
  reset: 0,
  register: 1,
  lookup: 2,
  remove: 3,
} as const);

export const FrameRegistryProviderCode = Object.freeze({
  root: 0,
  staticRigid: 1,
  objectCentered: 2,
  bodyFixed: 3,
  staticLocal: 4,
  objectAttached: 5,
} as const);

export const FrameRegistryResultCode = Object.freeze({
  success: 0,
  invalidInput: 1,
  duplicateLiveId: 2,
  retiredId: 3,
  notLive: 4,
  blockedRemoval: 5,
  missingParent: 6,
  rootProtected: 7,
} as const);

export interface FrameRegistryWire {
  readonly operationCode: number;
  readonly resultCode: number;
  readonly frameIdHigh: number;
  readonly frameIdLow: number;
  readonly parentPresent: boolean;
  readonly parentHigh: number;
  readonly parentLow: number;
  readonly providerCode: number;
  readonly dependencyPresent: boolean;
  readonly dependencyHigh: number;
  readonly dependencyLow: number;
  readonly transformReferenceFrameIdHigh: number;
  readonly transformReferenceFrameIdLow: number;
  readonly transformEpochSecondsHigh: number;
  readonly transformEpochSecondsLow: number;
  readonly transformEpochNanoseconds: number;
  readonly transformTranslationX: number;
  readonly transformTranslationY: number;
  readonly transformTranslationZ: number;
  readonly transformOriginVelocityX: number;
  readonly transformOriginVelocityY: number;
  readonly transformOriginVelocityZ: number;
  readonly transformRotationW: number;
  readonly transformRotationX: number;
  readonly transformRotationY: number;
  readonly transformRotationZ: number;
  readonly transformAngularVelocityX: number;
  readonly transformAngularVelocityY: number;
  readonly transformAngularVelocityZ: number;
}

export interface FrameRegistryWireValue {
  readonly operationCode: number;
  readonly frameId: ReferenceFrameId;
  readonly parent?: ReferenceFrameId;
  readonly providerCode: number;
  readonly dependency?: ObjectId;
  readonly transform: RigidStateTransform;
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

function idToWords(value: string, name: string): { high: number; low: number } {
  if (!/^[1-9][0-9]*$/.test(value) || value.length > 20
      || (value.length === 20 && value > "18446744073709551615")) {
    throw new RangeError(`${name} must be canonical non-zero uint64 decimal text`);
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

function wordsToId(high: number, low: number, name: string): string {
  let currentHigh = uint32(high, `${name}High`);
  let currentLow = uint32(low, `${name}Low`);
  if (currentHigh === 0 && currentLow === 0) throw new RangeError(`${name} must be non-zero`);
  let value = "";
  while (currentHigh !== 0 || currentLow !== 0) {
    const remainder = currentHigh % 10;
    currentHigh = Math.floor(currentHigh / 10);
    const combined = remainder * TWO_TO_32 + currentLow;
    currentLow = Math.floor(combined / 10);
    value = String(combined % 10) + value;
  }
  return value;
}

function frameWireFromRegistry(value: FrameRegistryWire): FrameWire {
  return validateFrameWire({
    referenceFrameIdHigh: value.transformReferenceFrameIdHigh,
    referenceFrameIdLow: value.transformReferenceFrameIdLow,
    epochSecondsHigh: value.transformEpochSecondsHigh,
    epochSecondsLow: value.transformEpochSecondsLow,
    epochNanoseconds: value.transformEpochNanoseconds,
    translationX: value.transformTranslationX,
    translationY: value.transformTranslationY,
    translationZ: value.transformTranslationZ,
    originVelocityX: value.transformOriginVelocityX,
    originVelocityY: value.transformOriginVelocityY,
    originVelocityZ: value.transformOriginVelocityZ,
    rotationW: value.transformRotationW,
    rotationX: value.transformRotationX,
    rotationY: value.transformRotationY,
    rotationZ: value.transformRotationZ,
    angularVelocityX: value.transformAngularVelocityX,
    angularVelocityY: value.transformAngularVelocityY,
    angularVelocityZ: value.transformAngularVelocityZ,
  });
}

export function validateFrameRegistryWire(value: unknown): FrameRegistryWire {
  if (typeof value !== "object" || value === null) throw new TypeError("frame registry wire value must be an object");
  const candidate = value as Record<string, unknown>;
  const operationCode = integer(candidate.operationCode, "operationCode");
  const resultCode = integer(candidate.resultCode, "resultCode");
  if (operationCode < 0 || operationCode > FrameRegistryOperationCode.remove) throw new RangeError("Unknown frame registry operation code");
  if (resultCode < 0 || resultCode > FrameRegistryResultCode.rootProtected) throw new RangeError("Unknown frame registry result code");
  const frameIdHigh = uint32(candidate.frameIdHigh, "frameIdHigh");
  const frameIdLow = uint32(candidate.frameIdLow, "frameIdLow");
  if (frameIdHigh === 0 && frameIdLow === 0) throw new RangeError("Frame registry ID must be non-zero");
  const parentPresent = candidate.parentPresent;
  if (typeof parentPresent !== "boolean") throw new TypeError("parentPresent must be boolean");
  const parentHigh = uint32(candidate.parentHigh, "parentHigh");
  const parentLow = uint32(candidate.parentLow, "parentLow");
  if (parentPresent && parentHigh === 0 && parentLow === 0) throw new RangeError("Parent frame must be non-zero");
  if (!parentPresent && (parentHigh !== 0 || parentLow !== 0)) throw new RangeError("Absent parent must use zero words");
  const providerCode = integer(candidate.providerCode, "providerCode");
  if (providerCode < 0 || providerCode > FrameRegistryProviderCode.objectAttached) throw new RangeError("Unknown frame provider code");
  const dependencyPresent = candidate.dependencyPresent;
  if (typeof dependencyPresent !== "boolean") throw new TypeError("dependencyPresent must be boolean");
  const dependencyHigh = uint32(candidate.dependencyHigh, "dependencyHigh");
  const dependencyLow = uint32(candidate.dependencyLow, "dependencyLow");
  if (dependencyPresent && dependencyHigh === 0 && dependencyLow === 0) throw new RangeError("Provider dependency must be non-zero");
  if (!dependencyPresent && (dependencyHigh !== 0 || dependencyLow !== 0)) throw new RangeError("Absent provider dependency must use zero words");
  const transform = frameWireFromRegistry(value as FrameRegistryWire);
  if (transform.referenceFrameIdHigh !== frameIdHigh || transform.referenceFrameIdLow !== frameIdLow) {
    throw new RangeError("Frame registry transform ID must equal the registered frame ID");
  }
  return Object.freeze({
    ...value,
    operationCode,
    resultCode,
    frameIdHigh,
    frameIdLow,
    parentPresent,
    parentHigh,
    parentLow,
    providerCode,
    dependencyPresent,
    dependencyHigh,
    dependencyLow,
    transformReferenceFrameIdHigh: transform.referenceFrameIdHigh,
    transformReferenceFrameIdLow: transform.referenceFrameIdLow,
    transformEpochSecondsHigh: transform.epochSecondsHigh,
    transformEpochSecondsLow: transform.epochSecondsLow,
    transformEpochNanoseconds: transform.epochNanoseconds,
    transformTranslationX: transform.translationX,
    transformTranslationY: transform.translationY,
    transformTranslationZ: transform.translationZ,
    transformOriginVelocityX: transform.originVelocityX,
    transformOriginVelocityY: transform.originVelocityY,
    transformOriginVelocityZ: transform.originVelocityZ,
    transformRotationW: transform.rotationW,
    transformRotationX: transform.rotationX,
    transformRotationY: transform.rotationY,
    transformRotationZ: transform.rotationZ,
    transformAngularVelocityX: transform.angularVelocityX,
    transformAngularVelocityY: transform.angularVelocityY,
    transformAngularVelocityZ: transform.angularVelocityZ,
  });
}

export function encodeFrameRegistryWire(value: FrameRegistryWireValue): FrameRegistryWire {
  const frameId = idToWords(referenceFrameId(value.frameId), "frameId");
  const parent = value.parent === undefined ? { present: false, high: 0, low: 0 } : {
    present: true,
    ...idToWords(referenceFrameId(value.parent), "parent"),
  };
  const dependency = value.dependency === undefined ? { present: false, high: 0, low: 0 } : {
    present: true,
    ...idToWords(objectId(value.dependency), "dependency"),
  };
  const transform = encodeFrameWire({
    referenceFrameId: referenceFrameId(value.frameId),
    transform: rigidStateTransform(value.transform),
  });
  return validateFrameRegistryWire({
    operationCode: value.operationCode,
    resultCode: FrameRegistryResultCode.success,
    frameIdHigh: frameId.high,
    frameIdLow: frameId.low,
    parentPresent: parent.present,
    parentHigh: parent.high,
    parentLow: parent.low,
    providerCode: value.providerCode,
    dependencyPresent: dependency.present,
    dependencyHigh: dependency.high,
    dependencyLow: dependency.low,
    transformReferenceFrameIdHigh: transform.referenceFrameIdHigh,
    transformReferenceFrameIdLow: transform.referenceFrameIdLow,
    transformEpochSecondsHigh: transform.epochSecondsHigh,
    transformEpochSecondsLow: transform.epochSecondsLow,
    transformEpochNanoseconds: transform.epochNanoseconds,
    transformTranslationX: transform.translationX,
    transformTranslationY: transform.translationY,
    transformTranslationZ: transform.translationZ,
    transformOriginVelocityX: transform.originVelocityX,
    transformOriginVelocityY: transform.originVelocityY,
    transformOriginVelocityZ: transform.originVelocityZ,
    transformRotationW: transform.rotationW,
    transformRotationX: transform.rotationX,
    transformRotationY: transform.rotationY,
    transformRotationZ: transform.rotationZ,
    transformAngularVelocityX: transform.angularVelocityX,
    transformAngularVelocityY: transform.angularVelocityY,
    transformAngularVelocityZ: transform.angularVelocityZ,
  });
}

export function decodeFrameRegistryTransform(value: FrameRegistryWire): RigidStateTransform {
  const wire = frameWireFromRegistry(validateFrameRegistryWire(value));
  return decodeFrameWire(wire).transform;
}

export function frameRegistryFrameIdFromWire(value: FrameRegistryWire): ReferenceFrameId {
  return referenceFrameId(wordsToId(value.frameIdHigh, value.frameIdLow, "frameId"));
}

export function frameRegistryParentFromWire(value: FrameRegistryWire): ReferenceFrameId | undefined {
  return value.parentPresent ? referenceFrameId(wordsToId(value.parentHigh, value.parentLow, "parent")) : undefined;
}

export function frameRegistryDependencyFromWire(value: FrameRegistryWire): ObjectId | undefined {
  return value.dependencyPresent ? objectId(wordsToId(value.dependencyHigh, value.dependencyLow, "dependency")) : undefined;
}
