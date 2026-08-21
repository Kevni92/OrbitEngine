import { objectId, type ObjectId } from "../objects.js";
import { referenceFrameId, type ReferenceFrameId } from "../frames.js";
import { propagationState, type PropagationState } from "../propagation.js";
import { simulationInstant } from "../time.js";
import { meters, metersPerSecond } from "../units.js";
import { decodeSimulationInstant, encodeSimulationInstant, validateTimeWire, type TimeWire } from "./time-wire.js";

const UINT32_MAX = 4_294_967_295;
const TWO_TO_32 = 4_294_967_296;

export const TwoBodyResultCode = Object.freeze({
  success: 0,
  invalidInput: 1,
  invalidMu: 2,
  numericalFailure: 3,
} as const);

export interface TwoBodyWire {
  readonly resultCode: number;
  readonly centralObjectIdHigh: number;
  readonly centralObjectIdLow: number;
  readonly mu: number;
  readonly anchorFrameHigh: number;
  readonly anchorFrameLow: number;
  readonly anchorEpoch: TimeWire;
  readonly anchorPositionX: number;
  readonly anchorPositionY: number;
  readonly anchorPositionZ: number;
  readonly anchorVelocityX: number;
  readonly anchorVelocityY: number;
  readonly anchorVelocityZ: number;
  readonly targetEpoch: TimeWire;
  readonly resultFrameHigh: number;
  readonly resultFrameLow: number;
  readonly resultEpoch: TimeWire;
  readonly resultPositionX: number;
  readonly resultPositionY: number;
  readonly resultPositionZ: number;
  readonly resultVelocityX: number;
  readonly resultVelocityY: number;
  readonly resultVelocityZ: number;
}

export interface TwoBodyWireValue {
  readonly resultCode?: number;
  readonly centralObject: ObjectId;
  readonly mu: number;
  readonly anchor: PropagationState;
  readonly target: { readonly seconds: number; readonly nanoseconds: number };
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

function finite(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  return value;
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

function validateStateFields(value: Record<string, unknown>, prefix: string): void {
  for (const name of ["PositionX", "PositionY", "PositionZ", "VelocityX", "VelocityY", "VelocityZ"]) {
    finite(value[`${prefix}${name}`], `${prefix}${name}`);
  }
}

export function validateTwoBodyWire(value: unknown): TwoBodyWire {
  if (typeof value !== "object" || value === null) throw new TypeError("two-body wire value must be an object");
  const candidate = value as Record<string, unknown>;
  const resultCode = integer(candidate.resultCode, "resultCode");
  if (resultCode < 0 || resultCode > TwoBodyResultCode.numericalFailure) throw new RangeError("Unknown two-body result code");
  const centralObjectIdHigh = uint32(candidate.centralObjectIdHigh, "centralObjectIdHigh");
  const centralObjectIdLow = uint32(candidate.centralObjectIdLow, "centralObjectIdLow");
  if (centralObjectIdHigh === 0 && centralObjectIdLow === 0) throw new RangeError("Central object ID must be non-zero");
  const muValue = finite(candidate.mu, "mu");
  if (muValue < 0) throw new RangeError("mu must be non-negative");
  const anchorFrameHigh = uint32(candidate.anchorFrameHigh, "anchorFrameHigh");
  const anchorFrameLow = uint32(candidate.anchorFrameLow, "anchorFrameLow");
  const resultFrameHigh = uint32(candidate.resultFrameHigh, "resultFrameHigh");
  const resultFrameLow = uint32(candidate.resultFrameLow, "resultFrameLow");
  if ((anchorFrameHigh === 0 && anchorFrameLow === 0) || (resultFrameHigh === 0 && resultFrameLow === 0)) {
    throw new RangeError("Two-body frame IDs must be non-zero");
  }
  if (anchorFrameHigh !== resultFrameHigh || anchorFrameLow !== resultFrameLow) {
    throw new RangeError("Two-body anchor and result frames must match");
  }
  const anchorEpoch = validateTimeWire(candidate.anchorEpoch);
  const targetEpoch = validateTimeWire(candidate.targetEpoch);
  const resultEpoch = validateTimeWire(candidate.resultEpoch);
  validateStateFields(candidate, "anchor");
  validateStateFields(candidate, "result");
  const anchorPositionMagnitude = Math.hypot(
    candidate.anchorPositionX as number,
    candidate.anchorPositionY as number,
    candidate.anchorPositionZ as number,
  );
  if (anchorPositionMagnitude <= 0) throw new RangeError("Two-body anchor position must be non-zero");
  return Object.freeze({
    resultCode,
    centralObjectIdHigh,
    centralObjectIdLow,
    mu: muValue,
    anchorFrameHigh,
    anchorFrameLow,
    anchorEpoch,
    anchorPositionX: candidate.anchorPositionX as number,
    anchorPositionY: candidate.anchorPositionY as number,
    anchorPositionZ: candidate.anchorPositionZ as number,
    anchorVelocityX: candidate.anchorVelocityX as number,
    anchorVelocityY: candidate.anchorVelocityY as number,
    anchorVelocityZ: candidate.anchorVelocityZ as number,
    targetEpoch,
    resultFrameHigh,
    resultFrameLow,
    resultEpoch,
    resultPositionX: candidate.resultPositionX as number,
    resultPositionY: candidate.resultPositionY as number,
    resultPositionZ: candidate.resultPositionZ as number,
    resultVelocityX: candidate.resultVelocityX as number,
    resultVelocityY: candidate.resultVelocityY as number,
    resultVelocityZ: candidate.resultVelocityZ as number,
  });
}

export function encodeTwoBodyWire(value: TwoBodyWireValue): TwoBodyWire {
  const centralObject = idToWords(objectId(value.centralObject), "centralObject");
  const frame = idToWords(referenceFrameId(value.anchor.referenceFrame), "anchorFrame");
  const target = { seconds: value.target.seconds, nanoseconds: value.target.nanoseconds };
  const anchorEpoch = encodeSimulationInstant(value.anchor.epoch);
  const targetEpoch = encodeSimulationInstant(simulationInstant(target.seconds, target.nanoseconds));
  return validateTwoBodyWire({
    resultCode: value.resultCode ?? TwoBodyResultCode.success,
    centralObjectIdHigh: centralObject.high,
    centralObjectIdLow: centralObject.low,
    mu: finite(value.mu, "mu"),
    anchorFrameHigh: frame.high,
    anchorFrameLow: frame.low,
    anchorEpoch,
    anchorPositionX: value.anchor.position.x,
    anchorPositionY: value.anchor.position.y,
    anchorPositionZ: value.anchor.position.z,
    anchorVelocityX: value.anchor.velocity.x,
    anchorVelocityY: value.anchor.velocity.y,
    anchorVelocityZ: value.anchor.velocity.z,
    targetEpoch,
    resultFrameHigh: frame.high,
    resultFrameLow: frame.low,
    resultEpoch: targetEpoch,
    resultPositionX: value.anchor.position.x,
    resultPositionY: value.anchor.position.y,
    resultPositionZ: value.anchor.position.z,
    resultVelocityX: value.anchor.velocity.x,
    resultVelocityY: value.anchor.velocity.y,
    resultVelocityZ: value.anchor.velocity.z,
  });
}

export function decodeTwoBodyState(value: TwoBodyWire): PropagationState {
  const wire = validateTwoBodyWire(value);
  const frame = referenceFrameId(wordsToId(wire.resultFrameHigh, wire.resultFrameLow, "resultFrame"));
  const epoch = decodeSimulationInstant(wire.resultEpoch);
  return propagationState({
    position: { x: meters(wire.resultPositionX), y: meters(wire.resultPositionY), z: meters(wire.resultPositionZ) },
    velocity: { x: metersPerSecond(wire.resultVelocityX), y: metersPerSecond(wire.resultVelocityY), z: metersPerSecond(wire.resultVelocityZ) },
    epoch,
    referenceFrame: frame,
  });
}

export function twoBodyCentralObjectFromWire(value: TwoBodyWire): ObjectId {
  return objectId(wordsToId(value.centralObjectIdHigh, value.centralObjectIdLow, "centralObject"));
}

export function twoBodyFrameFromWire(value: TwoBodyWire): ReferenceFrameId {
  return referenceFrameId(wordsToId(value.resultFrameHigh, value.resultFrameLow, "resultFrame"));
}
