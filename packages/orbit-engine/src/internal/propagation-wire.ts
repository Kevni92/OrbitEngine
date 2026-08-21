import {
  propagationDirectionCode,
  propagationDirectionFromCode,
  propagationModelKindCode,
  propagationModelKindFromCode,
  type PropagationDirection,
  type PropagationModelKind,
} from "../propagation.js";
import { decodeSimulationInstant, validateTimeWire } from "./time-wire.js";
import { objectId, type ObjectId } from "../objects.js";
import { referenceFrameId, type ReferenceFrameId } from "../frames.js";
import { revisionId, type RevisionId } from "../propagation.js";
import { compareSimulationInstants } from "../time.js";

const TWO_TO_32 = 4_294_967_296;
const UINT32_MAX = 4_294_967_295;

export interface PropagationWire {
  readonly objectIdHigh: number;
  readonly objectIdLow: number;
  readonly modelKindCode: number;
  readonly directionCode: number;
  readonly boundedDirectionCode: number;
  readonly propagationFrameHigh: number;
  readonly propagationFrameLow: number;
  readonly configurationRevisionHigh: number;
  readonly configurationRevisionLow: number;
  readonly motionRevisionHigh: number;
  readonly motionRevisionLow: number;
  readonly segmentStartSecondsHigh: number;
  readonly segmentStartSecondsLow: number;
  readonly segmentStartNanoseconds: number;
  readonly segmentEndPresent: boolean;
  readonly segmentEndSecondsHigh: number;
  readonly segmentEndSecondsLow: number;
  readonly segmentEndNanoseconds: number;
  readonly targetSecondsHigh: number;
  readonly targetSecondsLow: number;
  readonly targetNanoseconds: number;
  readonly outcomeCode: number;
  readonly resultFrameHigh: number;
  readonly resultFrameLow: number;
  readonly positionX: number;
  readonly positionY: number;
  readonly positionZ: number;
  readonly velocityX: number;
  readonly velocityY: number;
  readonly velocityZ: number;
  readonly positionAbsoluteMeters: number;
  readonly positionRelative: number;
  readonly velocityAbsoluteMetersPerSecond: number;
  readonly velocityRelative: number;
}

export interface PropagationWireIdentity {
  readonly objectId: ObjectId;
  readonly propagationFrame: ReferenceFrameId;
  readonly configurationRevision: RevisionId;
  readonly motionRevision: RevisionId;
  readonly modelKind: PropagationModelKind;
  readonly direction: PropagationDirection;
}

function integer(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new TypeError(`${name} must be an integer`);
  }
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

function idToWords(value: string, name: string, allowZero: boolean): { high: number; low: number } {
  if (!/^(0|[1-9][0-9]*)$/.test(value) || value.length > 20 || (!allowZero && value === "0")
      || (value.length === 20 && value > "18446744073709551615")) {
    throw new RangeError(`${name} is not canonical uint64 decimal text`);
  }
  let high = 0;
  let low = 0;
  for (const character of value) {
    const digit = character.charCodeAt(0) - 48;
    const product = low * 10 + digit;
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
    const highRemainder = currentHigh % 10;
    currentHigh = Math.floor(currentHigh / 10);
    const combined = highRemainder * TWO_TO_32 + currentLow;
    currentLow = Math.floor(combined / 10);
    value = String(combined % 10) + value;
  }
  return value || "0";
}

function validateTimestamp(high: unknown, low: unknown, nanoseconds: unknown, name: string): void {
  validateTimeWire({ secondsHigh: integer(high, `${name}SecondsHigh`), secondsLow: uint32(low, `${name}SecondsLow`), nanoseconds: integer(nanoseconds, `${name}Nanoseconds`) });
}

export function validatePropagationWire(value: unknown): PropagationWire {
  if (typeof value !== "object" || value === null) throw new TypeError("Propagation wire value must be an object");
  const candidate = value as Record<string, unknown>;
  const objectIdHigh = uint32(candidate.objectIdHigh, "objectIdHigh");
  const objectIdLow = uint32(candidate.objectIdLow, "objectIdLow");
  const frameHigh = uint32(candidate.propagationFrameHigh, "propagationFrameHigh");
  const frameLow = uint32(candidate.propagationFrameLow, "propagationFrameLow");
  const resultFrameHigh = uint32(candidate.resultFrameHigh, "resultFrameHigh");
  const resultFrameLow = uint32(candidate.resultFrameLow, "resultFrameLow");
  if (objectIdHigh === 0 && objectIdLow === 0) throw new RangeError("Propagation wire object ID must be non-zero");
  if (frameHigh === 0 && frameLow === 0) throw new RangeError("Propagation wire propagation frame must be non-zero");
  if (resultFrameHigh === 0 && resultFrameLow === 0) throw new RangeError("Propagation wire result frame must be non-zero");
  const modelKindCode = integer(candidate.modelKindCode, "modelKindCode");
  const directionCode = integer(candidate.directionCode, "directionCode");
  propagationModelKindFromCode(modelKindCode);
  propagationDirectionFromCode(directionCode);
  const boundedDirectionCode = integer(candidate.boundedDirectionCode, "boundedDirectionCode");
  if (boundedDirectionCode < 0 || boundedDirectionCode > 2) throw new RangeError("Invalid bounded direction code");
  const configurationRevisionHigh = uint32(candidate.configurationRevisionHigh, "configurationRevisionHigh");
  const configurationRevisionLow = uint32(candidate.configurationRevisionLow, "configurationRevisionLow");
  const motionRevisionHigh = uint32(candidate.motionRevisionHigh, "motionRevisionHigh");
  const motionRevisionLow = uint32(candidate.motionRevisionLow, "motionRevisionLow");
  validateTimestamp(candidate.segmentStartSecondsHigh, candidate.segmentStartSecondsLow, candidate.segmentStartNanoseconds, "segmentStart");
  validateTimestamp(candidate.segmentEndSecondsHigh, candidate.segmentEndSecondsLow, candidate.segmentEndNanoseconds, "segmentEnd");
  validateTimestamp(candidate.targetSecondsHigh, candidate.targetSecondsLow, candidate.targetNanoseconds, "target");
  if (typeof candidate.segmentEndPresent !== "boolean") throw new TypeError("segmentEndPresent must be boolean");
  const start = decodeSimulationInstant({ secondsHigh: integer(candidate.segmentStartSecondsHigh, "segmentStartSecondsHigh"), secondsLow: uint32(candidate.segmentStartSecondsLow, "segmentStartSecondsLow"), nanoseconds: integer(candidate.segmentStartNanoseconds, "segmentStartNanoseconds") });
  const end = decodeSimulationInstant({ secondsHigh: integer(candidate.segmentEndSecondsHigh, "segmentEndSecondsHigh"), secondsLow: uint32(candidate.segmentEndSecondsLow, "segmentEndSecondsLow"), nanoseconds: integer(candidate.segmentEndNanoseconds, "segmentEndNanoseconds") });
  if (candidate.segmentEndPresent && compareSimulationInstants(start, end) >= 0) throw new RangeError("Propagation wire segment end must be after start");
  if (candidate.outcomeCode !== 0 && candidate.outcomeCode !== 1 && candidate.outcomeCode !== 2) throw new RangeError("Unknown propagation outcome code");
  const continuousNames = ["positionX", "positionY", "positionZ", "velocityX", "velocityY", "velocityZ", "positionAbsoluteMeters", "positionRelative", "velocityAbsoluteMetersPerSecond", "velocityRelative"] as const;
  const continuous = Object.fromEntries(continuousNames.map((name) => [name, finite(candidate[name], name)])) as Pick<PropagationWire, (typeof continuousNames)[number]>;
  for (const name of ["positionAbsoluteMeters", "positionRelative", "velocityAbsoluteMetersPerSecond", "velocityRelative"] as const) {
    if (continuous[name] < 0) throw new RangeError(`${name} must be non-negative`);
  }
  return Object.freeze({
    objectIdHigh, objectIdLow, modelKindCode, directionCode, boundedDirectionCode,
    propagationFrameHigh: frameHigh, propagationFrameLow: frameLow,
    configurationRevisionHigh, configurationRevisionLow, motionRevisionHigh, motionRevisionLow,
    segmentStartSecondsHigh: integer(candidate.segmentStartSecondsHigh, "segmentStartSecondsHigh"),
    segmentStartSecondsLow: uint32(candidate.segmentStartSecondsLow, "segmentStartSecondsLow"),
    segmentStartNanoseconds: integer(candidate.segmentStartNanoseconds, "segmentStartNanoseconds"),
    segmentEndPresent: candidate.segmentEndPresent,
    segmentEndSecondsHigh: integer(candidate.segmentEndSecondsHigh, "segmentEndSecondsHigh"),
    segmentEndSecondsLow: uint32(candidate.segmentEndSecondsLow, "segmentEndSecondsLow"),
    segmentEndNanoseconds: integer(candidate.segmentEndNanoseconds, "segmentEndNanoseconds"),
    targetSecondsHigh: integer(candidate.targetSecondsHigh, "targetSecondsHigh"),
    targetSecondsLow: uint32(candidate.targetSecondsLow, "targetSecondsLow"),
    targetNanoseconds: integer(candidate.targetNanoseconds, "targetNanoseconds"),
    outcomeCode: candidate.outcomeCode,
    resultFrameHigh, resultFrameLow,
    ...continuous,
  });
}

export function propagationWireIdentity(value: PropagationWire): PropagationWireIdentity {
  const wire = validatePropagationWire(value);
  return Object.freeze({
    objectId: objectId(wordsToId(wire.objectIdHigh, wire.objectIdLow, "objectId", false)),
    propagationFrame: referenceFrameId(wordsToId(wire.propagationFrameHigh, wire.propagationFrameLow, "propagationFrame", false)),
    configurationRevision: revisionId(wordsToId(wire.configurationRevisionHigh, wire.configurationRevisionLow, "configurationRevision", true)),
    motionRevision: revisionId(wordsToId(wire.motionRevisionHigh, wire.motionRevisionLow, "motionRevision", true)),
    modelKind: propagationModelKindFromCode(wire.modelKindCode),
    direction: propagationDirectionFromCode(wire.directionCode),
  });
}

export function encodePropagationWire(value: PropagationWire): PropagationWire {
  return validatePropagationWire(value);
}

export function decodePropagationWire(value: unknown): PropagationWire {
  return validatePropagationWire(value);
}
