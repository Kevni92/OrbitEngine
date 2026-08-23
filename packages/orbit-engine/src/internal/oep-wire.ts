import { validateTimeWire, type TimeWire } from "./time-wire.js";

const UINT32_MAX = 4_294_967_295;
const TWO_TO_32 = 4_294_967_296;

export const OepResultCode = Object.freeze({
  success: 0,
  invalidInput: 1,
  badMagic: 2,
  unsupportedSchema: 3,
  truncated: 4,
  outOfBounds: 5,
  nonFinite: 6,
  invalidCode: 7,
  duplicateSource: 8,
  missingCenter: 9,
  dependencyCycle: 10,
  missingShard: 11,
  checksumMismatch: 12,
  sourceOutOfRange: 13,
  missingDataset: 14,
  missingSource: 15,
  datasetInUse: 16,
  malformedRecords: 17,
} as const);

export const OepRepresentationCode = Object.freeze({
  positionChebyshev: 1,
  stateChebyshev: 2,
} as const);

export const OepEvaluationModeCode = Object.freeze({
  relativeToCenter: 1,
  rootSsb: 2,
} as const);

export interface OepDatasetInfoWire {
  readonly resultCode: number;
  readonly handleHigh: number;
  readonly handleLow: number;
  readonly datasetRevisionHigh: number;
  readonly datasetRevisionLow: number;
  readonly sourceCount: number;
}

export interface OepSourceInfoWire {
  readonly resultCode: number;
  readonly handleHigh: number;
  readonly handleLow: number;
  readonly sourceNodeId: number;
  readonly centerSourceNodeId: number;
  readonly representationCode: number;
  readonly sourceRevisionHigh: number;
  readonly sourceRevisionLow: number;
  readonly validityStart: TimeWire;
  readonly validityEnd: TimeWire;
  readonly effectiveValidityStart: TimeWire;
  readonly effectiveValidityEnd: TimeWire;
  readonly positionErrorMeters: number;
  readonly velocityErrorMetersPerSecond: number;
}

export interface OepEvaluationWire {
  readonly resultCode: number;
  readonly handleHigh: number;
  readonly handleLow: number;
  readonly sourceNodeId: number;
  readonly evaluationModeCode: number;
  readonly recordIndex: number;
  readonly sourceRevisionHigh: number;
  readonly sourceRevisionLow: number;
  readonly epoch: TimeWire;
  readonly positionX: number;
  readonly positionY: number;
  readonly positionZ: number;
  readonly velocityX: number;
  readonly velocityY: number;
  readonly velocityZ: number;
}

function integer(value: unknown, name: string, minimum = 0, maximum = UINT32_MAX): number {
  if (typeof value !== "number" || !Number.isInteger(value)) throw new TypeError(`${name} must be an integer`);
  if (value < minimum || value > maximum) throw new RangeError(`${name} is outside its wire range`);
  return value;
}

function finite(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  return value;
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null) throw new TypeError(`${name} must be an object`);
  return value as Record<string, unknown>;
}

export function validateOepDatasetInfoWire(value: unknown): OepDatasetInfoWire {
  const candidate = record(value, "OEP dataset result");
  return Object.freeze({
    resultCode: integer(candidate.resultCode, "resultCode", 0, OepResultCode.malformedRecords),
    handleHigh: integer(candidate.handleHigh, "handleHigh"),
    handleLow: integer(candidate.handleLow, "handleLow"),
    datasetRevisionHigh: integer(candidate.datasetRevisionHigh, "datasetRevisionHigh"),
    datasetRevisionLow: integer(candidate.datasetRevisionLow, "datasetRevisionLow"),
    sourceCount: integer(candidate.sourceCount, "sourceCount"),
  });
}

export function validateOepSourceInfoWire(value: unknown): OepSourceInfoWire {
  const candidate = record(value, "OEP source result");
  return Object.freeze({
    resultCode: integer(candidate.resultCode, "resultCode", 0, OepResultCode.malformedRecords),
    handleHigh: integer(candidate.handleHigh, "handleHigh"),
    handleLow: integer(candidate.handleLow, "handleLow"),
    sourceNodeId: integer(candidate.sourceNodeId, "sourceNodeId"),
    centerSourceNodeId: integer(candidate.centerSourceNodeId, "centerSourceNodeId"),
    representationCode: integer(candidate.representationCode, "representationCode", 0, OepRepresentationCode.stateChebyshev),
    sourceRevisionHigh: integer(candidate.sourceRevisionHigh, "sourceRevisionHigh"),
    sourceRevisionLow: integer(candidate.sourceRevisionLow, "sourceRevisionLow"),
    validityStart: validateTimeWire(candidate.validityStart),
    validityEnd: validateTimeWire(candidate.validityEnd),
    effectiveValidityStart: validateTimeWire(candidate.effectiveValidityStart),
    effectiveValidityEnd: validateTimeWire(candidate.effectiveValidityEnd),
    positionErrorMeters: finite(candidate.positionErrorMeters, "positionErrorMeters"),
    velocityErrorMetersPerSecond: finite(candidate.velocityErrorMetersPerSecond, "velocityErrorMetersPerSecond"),
  });
}

export function validateOepEvaluationWire(value: unknown): OepEvaluationWire {
  const candidate = record(value, "OEP evaluation result");
  return Object.freeze({
    resultCode: integer(candidate.resultCode, "resultCode", 0, OepResultCode.malformedRecords),
    handleHigh: integer(candidate.handleHigh, "handleHigh"),
    handleLow: integer(candidate.handleLow, "handleLow"),
    sourceNodeId: integer(candidate.sourceNodeId, "sourceNodeId"),
    evaluationModeCode: integer(candidate.evaluationModeCode, "evaluationModeCode", 0, OepEvaluationModeCode.rootSsb),
    recordIndex: integer(candidate.recordIndex, "recordIndex"),
    sourceRevisionHigh: integer(candidate.sourceRevisionHigh, "sourceRevisionHigh"),
    sourceRevisionLow: integer(candidate.sourceRevisionLow, "sourceRevisionLow"),
    epoch: validateTimeWire(candidate.epoch),
    positionX: finite(candidate.positionX, "positionX"),
    positionY: finite(candidate.positionY, "positionY"),
    positionZ: finite(candidate.positionZ, "positionZ"),
    velocityX: finite(candidate.velocityX, "velocityX"),
    velocityY: finite(candidate.velocityY, "velocityY"),
    velocityZ: finite(candidate.velocityZ, "velocityZ"),
  });
}

export function oepWordsToDecimal(high: number, low: number): string {
  let currentHigh = integer(high, "high");
  let currentLow = integer(low, "low");
  if (currentHigh === 0) return String(currentLow);
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
