import { objectId, type ObjectId } from "../objects.js";
import { revisionId, type RevisionId } from "../propagation.js";
import { decodeSimulationInstant, encodeSimulationInstant, validateTimeWire, type TimeWire } from "./time-wire.js";
import type { SimulationInstant } from "../time.js";

const TWO_TO_32 = 4_294_967_296;
const UINT32_MAX = 4_294_967_295;

export const SCHEDULER_MAX_DIAGNOSTICS = 64;
export const SCHEDULER_INPUT_WORDS = 41;
export const SCHEDULER_WORK_WORDS = 23;
export const SCHEDULER_OUTPUT_WORDS = 2 + 3 + 2 + 2 + 1 + SCHEDULER_WORK_WORDS + 1 + SCHEDULER_MAX_DIAGNOSTICS * SCHEDULER_WORK_WORDS + 2 + 2 + 1 + 1 + 2 + 2;

export const SchedulerOperationCode = Object.freeze({
  reset: 0,
  snapshot: 1,
  schedule: 2,
  cancel: 3,
  replace: 4,
  list: 5,
  advanceTo: 6,
  advanceBy: 7,
} as const);

export const SchedulerResultCode = Object.freeze({
  success: 0,
  invalidInput: 1,
  pastEvent: 2,
  sameTimeRejected: 3,
  capacityExceeded: 4,
  notFound: 5,
  staleGeneration: 6,
  invalidPhase: 7,
  invalidPayload: 8,
  invalidOperation: 9,
  targetBeforeCurrent: 10,
  advanceBudgetExceeded: 11,
  timestampBudgetExceeded: 12,
  transactionFailed: 13,
  retroactiveEarlierPhase: 14,
  payloadFailed: 15,
  invalidDuration: 16,
} as const);

export interface SchedulerWorkWire {
  readonly idHigh: number;
  readonly idLow: number;
  readonly generationHigh: number;
  readonly generationLow: number;
  readonly instant: TimeWire;
  readonly phase: number;
  readonly sourceKind: number;
  readonly sourceIdHigh: number;
  readonly sourceIdLow: number;
  readonly sourceOrdinalHigh: number;
  readonly sourceOrdinalLow: number;
  readonly dependencyDigestHigh: number;
  readonly dependencyDigestLow: number;
  readonly payloadKind: number;
  readonly payloadObjectIdHigh: number;
  readonly payloadObjectIdLow: number;
  readonly relatedWorkIdHigh: number;
  readonly relatedWorkIdLow: number;
  readonly relatedGenerationHigh: number;
  readonly relatedGenerationLow: number;
  readonly payloadValue: number;
}

export interface SchedulerWire {
  readonly operationCode: number;
  readonly resultCode: number;
  readonly currentTime: TimeWire;
  readonly targetTime: TimeWire;
  readonly expectedIdHigh: number;
  readonly expectedIdLow: number;
  readonly expectedGenerationHigh: number;
  readonly expectedGenerationLow: number;
  readonly listOffset: number;
  readonly listLimit: number;
  readonly allowCurrentTime: boolean;
  readonly maxScheduledWorkItems: number;
  readonly maxWorkItemsPerTimestamp: number;
  readonly maxTimestampTransactionsPerAdvance: number;
  readonly work: SchedulerWorkWire;
  readonly clockRevisionHigh: number;
  readonly clockRevisionLow: number;
  readonly nextWorkIdHigh: number;
  readonly nextWorkIdLow: number;
  readonly resultWorkPresent: boolean;
  readonly resultWork: SchedulerWorkWire;
  readonly resultCount: number;
  readonly results: readonly SchedulerWorkWire[];
  readonly processedTimestampCount: number;
  readonly processedWorkCount: number;
  readonly reachedTarget: boolean;
  readonly failurePresent: boolean;
  readonly failureIdHigh: number;
  readonly failureIdLow: number;
  readonly failureGenerationHigh: number;
  readonly failureGenerationLow: number;
  readonly failurePhase: number;
  readonly failureSourceKind: number;
}

export interface SchedulerWorkValue {
  readonly id: string;
  readonly generation: RevisionId;
  readonly instant: SimulationInstant;
  readonly phase: number;
  readonly sourceKind: number;
  readonly sourceId: ObjectId;
  readonly sourceOrdinal: RevisionId;
  readonly dependencyRevisionDigest: RevisionId;
  readonly payloadKind: number;
  readonly payloadObjectId?: ObjectId;
  readonly relatedWorkId?: string;
  readonly relatedGeneration?: RevisionId;
  readonly payloadValue: number;
}

export function uint64Words(value: string, name: string, allowZero = true): { high: number; low: number } {
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

export function wordsUint64(high: number, low: number, name: string, allowZero = true): string {
  if (!Number.isInteger(high) || high < 0 || high > UINT32_MAX || !Number.isInteger(low) || low < 0 || low > UINT32_MAX) {
    throw new RangeError(`${name} words are outside uint32 range`);
  }
  if (!allowZero && high === 0 && low === 0) throw new RangeError(`${name} must be non-zero`);
  let currentHigh = high;
  let currentLow = low;
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

function work(value: unknown, name: string): SchedulerWorkWire {
  if (typeof value !== "object" || value === null) throw new TypeError(`${name} must be an object`);
  const candidate = value as Record<string, unknown>;
  const instant = validateTimeWire(candidate.instant);
  const result = {
    idHigh: uint32(candidate.idHigh, `${name}.idHigh`), idLow: uint32(candidate.idLow, `${name}.idLow`),
    generationHigh: uint32(candidate.generationHigh, `${name}.generationHigh`), generationLow: uint32(candidate.generationLow, `${name}.generationLow`),
    instant, phase: uint16(candidate.phase, `${name}.phase`), sourceKind: uint16(candidate.sourceKind, `${name}.sourceKind`),
    sourceIdHigh: uint32(candidate.sourceIdHigh, `${name}.sourceIdHigh`), sourceIdLow: uint32(candidate.sourceIdLow, `${name}.sourceIdLow`),
    sourceOrdinalHigh: uint32(candidate.sourceOrdinalHigh, `${name}.sourceOrdinalHigh`), sourceOrdinalLow: uint32(candidate.sourceOrdinalLow, `${name}.sourceOrdinalLow`),
    dependencyDigestHigh: uint32(candidate.dependencyDigestHigh, `${name}.dependencyDigestHigh`), dependencyDigestLow: uint32(candidate.dependencyDigestLow, `${name}.dependencyDigestLow`),
    payloadKind: uint16(candidate.payloadKind, `${name}.payloadKind`),
    payloadObjectIdHigh: uint32(candidate.payloadObjectIdHigh, `${name}.payloadObjectIdHigh`), payloadObjectIdLow: uint32(candidate.payloadObjectIdLow, `${name}.payloadObjectIdLow`),
    relatedWorkIdHigh: uint32(candidate.relatedWorkIdHigh, `${name}.relatedWorkIdHigh`), relatedWorkIdLow: uint32(candidate.relatedWorkIdLow, `${name}.relatedWorkIdLow`),
    relatedGenerationHigh: uint32(candidate.relatedGenerationHigh, `${name}.relatedGenerationHigh`), relatedGenerationLow: uint32(candidate.relatedGenerationLow, `${name}.relatedGenerationLow`),
    payloadValue: finite(candidate.payloadValue, `${name}.payloadValue`),
  } satisfies SchedulerWorkWire;
  if (result.phase < 1 || result.phase > 5) throw new RangeError(`${name}.phase is outside the supported range`);
  if (result.sourceKind === 0 || result.sourceIdHigh === 0 && result.sourceIdLow === 0) throw new RangeError(`${name} source is invalid`);
  if (result.payloadKind === 0) throw new RangeError(`${name}.payloadKind must be non-zero`);
  return Object.freeze(result);
}

export function validateSchedulerWire(value: unknown): SchedulerWire {
  if (typeof value !== "object" || value === null) throw new TypeError("scheduler wire value must be an object");
  const candidate = value as Record<string, unknown>;
  const operationCode = uint16(candidate.operationCode, "operationCode");
  const resultCode = uint16(candidate.resultCode, "resultCode");
  if (operationCode > SchedulerOperationCode.advanceBy) throw new RangeError("Unknown scheduler operation code");
  if (resultCode > SchedulerResultCode.invalidDuration) throw new RangeError("Unknown scheduler result code");
  const resultsValue = candidate.results;
  if (!Array.isArray(resultsValue) || resultsValue.length !== SCHEDULER_MAX_DIAGNOSTICS) throw new RangeError("scheduler results must contain 64 entries");
  const resultCount = uint32(candidate.resultCount, "resultCount");
  if (resultCount > SCHEDULER_MAX_DIAGNOSTICS) throw new RangeError("resultCount exceeds diagnostics capacity");
  return Object.freeze({
    operationCode, resultCode, currentTime: validateTimeWire(candidate.currentTime), targetTime: validateTimeWire(candidate.targetTime),
    expectedIdHigh: uint32(candidate.expectedIdHigh, "expectedIdHigh"), expectedIdLow: uint32(candidate.expectedIdLow, "expectedIdLow"),
    expectedGenerationHigh: uint32(candidate.expectedGenerationHigh, "expectedGenerationHigh"), expectedGenerationLow: uint32(candidate.expectedGenerationLow, "expectedGenerationLow"),
    listOffset: uint32(candidate.listOffset, "listOffset"), listLimit: uint32(candidate.listLimit, "listLimit"),
    allowCurrentTime: boolean(candidate.allowCurrentTime, "allowCurrentTime"),
    maxScheduledWorkItems: uint32(candidate.maxScheduledWorkItems, "maxScheduledWorkItems"),
    maxWorkItemsPerTimestamp: uint32(candidate.maxWorkItemsPerTimestamp, "maxWorkItemsPerTimestamp"),
    maxTimestampTransactionsPerAdvance: uint32(candidate.maxTimestampTransactionsPerAdvance, "maxTimestampTransactionsPerAdvance"),
    work: work(candidate.work, "work"), clockRevisionHigh: uint32(candidate.clockRevisionHigh, "clockRevisionHigh"), clockRevisionLow: uint32(candidate.clockRevisionLow, "clockRevisionLow"),
    nextWorkIdHigh: uint32(candidate.nextWorkIdHigh, "nextWorkIdHigh"), nextWorkIdLow: uint32(candidate.nextWorkIdLow, "nextWorkIdLow"),
    resultWorkPresent: boolean(candidate.resultWorkPresent, "resultWorkPresent"), resultWork: work(candidate.resultWork, "resultWork"),
    resultCount, results: Object.freeze(resultsValue.map((item, index) => work(item, `results[${index}]`))),
    processedTimestampCount: uint32(candidate.processedTimestampCount, "processedTimestampCount"),
    processedWorkCount: uint32(candidate.processedWorkCount, "processedWorkCount"),
    reachedTarget: boolean(candidate.reachedTarget, "reachedTarget"),
    failurePresent: boolean(candidate.failurePresent, "failurePresent"),
    failureIdHigh: uint32(candidate.failureIdHigh, "failureIdHigh"), failureIdLow: uint32(candidate.failureIdLow, "failureIdLow"),
    failureGenerationHigh: uint32(candidate.failureGenerationHigh, "failureGenerationHigh"), failureGenerationLow: uint32(candidate.failureGenerationLow, "failureGenerationLow"),
    failurePhase: uint16(candidate.failurePhase, "failurePhase"), failureSourceKind: uint16(candidate.failureSourceKind, "failureSourceKind"),
  });
}

function emptyWork(): SchedulerWorkWire {
  return Object.freeze({ idHigh: 0, idLow: 0, generationHigh: 0, generationLow: 0, instant: { secondsHigh: 0, secondsLow: 0, nanoseconds: 0 }, phase: 1, sourceKind: 1, sourceIdHigh: 0, sourceIdLow: 1, sourceOrdinalHigh: 0, sourceOrdinalLow: 0, dependencyDigestHigh: 0, dependencyDigestLow: 0, payloadKind: 1, payloadObjectIdHigh: 0, payloadObjectIdLow: 0, relatedWorkIdHigh: 0, relatedWorkIdLow: 0, relatedGenerationHigh: 0, relatedGenerationLow: 0, payloadValue: 0 });
}

export function emptySchedulerWire(operationCode: number): SchedulerWire {
  const empty = emptyWork();
  return validateSchedulerWire({ operationCode, resultCode: 0, currentTime: { secondsHigh: 0, secondsLow: 0, nanoseconds: 0 }, targetTime: { secondsHigh: 0, secondsLow: 0, nanoseconds: 0 }, expectedIdHigh: 0, expectedIdLow: 0, expectedGenerationHigh: 0, expectedGenerationLow: 0, listOffset: 0, listLimit: 0, allowCurrentTime: false, maxScheduledWorkItems: 0, maxWorkItemsPerTimestamp: 0, maxTimestampTransactionsPerAdvance: 0, work: empty, clockRevisionHigh: 0, clockRevisionLow: 0, nextWorkIdHigh: 0, nextWorkIdLow: 0, resultWorkPresent: false, resultWork: empty, resultCount: 0, results: Array.from({ length: SCHEDULER_MAX_DIAGNOSTICS }, () => empty), processedTimestampCount: 0, processedWorkCount: 0, reachedTarget: false, failurePresent: false, failureIdHigh: 0, failureIdLow: 0, failureGenerationHigh: 0, failureGenerationLow: 0, failurePhase: 0, failureSourceKind: 0 });
}

export function encodeWork(value: SchedulerWorkValue, allowZeroId = false): SchedulerWorkWire {
  const id = uint64Words(value.id, "work.id", allowZeroId);
  const generation = uint64Words(value.generation, "work.generation", false);
  const source = uint64Words(value.sourceId, "work.sourceId", false);
  const ordinal = uint64Words(value.sourceOrdinal, "work.sourceOrdinal");
  const digest = uint64Words(value.dependencyRevisionDigest, "work.dependencyRevisionDigest");
  const payloadObjectId = value.payloadObjectId === undefined ? { high: 0, low: 0 } : uint64Words(value.payloadObjectId, "work.payloadObjectId", false);
  const relatedId = value.relatedWorkId === undefined ? { high: 0, low: 0 } : uint64Words(value.relatedWorkId, "work.relatedWorkId", false);
  const relatedGeneration = value.relatedGeneration === undefined ? { high: 0, low: 0 } : uint64Words(value.relatedGeneration, "work.relatedGeneration", false);
  return work({ idHigh: id.high, idLow: id.low, generationHigh: generation.high, generationLow: generation.low, instant: encodeSimulationInstant(value.instant), phase: value.phase, sourceKind: value.sourceKind, sourceIdHigh: source.high, sourceIdLow: source.low, sourceOrdinalHigh: ordinal.high, sourceOrdinalLow: ordinal.low, dependencyDigestHigh: digest.high, dependencyDigestLow: digest.low, payloadKind: value.payloadKind, payloadObjectIdHigh: payloadObjectId.high, payloadObjectIdLow: payloadObjectId.low, relatedWorkIdHigh: relatedId.high, relatedWorkIdLow: relatedId.low, relatedGenerationHigh: relatedGeneration.high, relatedGenerationLow: relatedGeneration.low, payloadValue: value.payloadValue }, "work");
}

export function decodeWork(value: SchedulerWorkWire): SchedulerWorkValue {
  const wire = work(value, "work");
  const payloadObjectId = wordsUint64(wire.payloadObjectIdHigh, wire.payloadObjectIdLow, "payloadObjectId") === "0" ? undefined : objectId(wordsUint64(wire.payloadObjectIdHigh, wire.payloadObjectIdLow, "payloadObjectId", false));
  const relatedWorkId = wordsUint64(wire.relatedWorkIdHigh, wire.relatedWorkIdLow, "relatedWorkId") === "0" ? undefined : wordsUint64(wire.relatedWorkIdHigh, wire.relatedWorkIdLow, "relatedWorkId", false);
  const relatedGeneration = wordsUint64(wire.relatedGenerationHigh, wire.relatedGenerationLow, "relatedGeneration") === "0" ? undefined : revisionId(wordsUint64(wire.relatedGenerationHigh, wire.relatedGenerationLow, "relatedGeneration", false));
  return Object.freeze({ id: wordsUint64(wire.idHigh, wire.idLow, "work.id"), generation: revisionId(wordsUint64(wire.generationHigh, wire.generationLow, "work.generation", false)), instant: decodeSimulationInstant(wire.instant), phase: wire.phase, sourceKind: wire.sourceKind, sourceId: objectId(wordsUint64(wire.sourceIdHigh, wire.sourceIdLow, "work.sourceId", false)), sourceOrdinal: revisionId(wordsUint64(wire.sourceOrdinalHigh, wire.sourceOrdinalLow, "work.sourceOrdinal")), dependencyRevisionDigest: revisionId(wordsUint64(wire.dependencyDigestHigh, wire.dependencyDigestLow, "work.dependencyRevisionDigest")), payloadKind: wire.payloadKind, payloadObjectId, relatedWorkId, relatedGeneration, payloadValue: wire.payloadValue });
}

function writeWord(values: number[], value: number): void { values.push(value); }
function writeWork(values: number[], value: SchedulerWorkWire): void {
  writeWord(values, value.idHigh); writeWord(values, value.idLow); writeWord(values, value.generationHigh); writeWord(values, value.generationLow);
  writeWord(values, value.instant.secondsHigh); writeWord(values, value.instant.secondsLow); writeWord(values, value.instant.nanoseconds); writeWord(values, value.phase); writeWord(values, value.sourceKind);
  writeWord(values, value.sourceIdHigh); writeWord(values, value.sourceIdLow); writeWord(values, value.sourceOrdinalHigh); writeWord(values, value.sourceOrdinalLow); writeWord(values, value.dependencyDigestHigh); writeWord(values, value.dependencyDigestLow); writeWord(values, value.payloadKind); writeWord(values, value.payloadObjectIdHigh); writeWord(values, value.payloadObjectIdLow); writeWord(values, value.relatedWorkIdHigh); writeWord(values, value.relatedWorkIdLow); writeWord(values, value.relatedGenerationHigh); writeWord(values, value.relatedGenerationLow); writeWord(values, value.payloadValue);
}

export function encodeSchedulerPacket(value: SchedulerWire): Float64Array {
  const wire = validateSchedulerWire(value);
  const values: number[] = [wire.operationCode, wire.resultCode, wire.currentTime.secondsHigh, wire.currentTime.secondsLow, wire.currentTime.nanoseconds, wire.targetTime.secondsHigh, wire.targetTime.secondsLow, wire.targetTime.nanoseconds, wire.expectedIdHigh, wire.expectedIdLow, wire.expectedGenerationHigh, wire.expectedGenerationLow, wire.listOffset, wire.listLimit, wire.allowCurrentTime ? 1 : 0, wire.maxScheduledWorkItems, wire.maxWorkItemsPerTimestamp, wire.maxTimestampTransactionsPerAdvance];
  writeWork(values, wire.work);
  return Float64Array.from(values);
}

export function decodeSchedulerPacket(input: SchedulerWire, values: Float64Array): SchedulerWire {
  if (values.length !== SCHEDULER_OUTPUT_WORDS) throw new RangeError("scheduler packet has an invalid output length");
  let offset = 0;
  const next = (): number => {
    const value = values[offset++];
    if (value === undefined) throw new RangeError("scheduler packet ended unexpectedly");
    return value;
  };
  const readWork = (): SchedulerWorkWire => ({ idHigh: next(), idLow: next(), generationHigh: next(), generationLow: next(), instant: { secondsHigh: next(), secondsLow: next(), nanoseconds: next() }, phase: next(), sourceKind: next(), sourceIdHigh: next(), sourceIdLow: next(), sourceOrdinalHigh: next(), sourceOrdinalLow: next(), dependencyDigestHigh: next(), dependencyDigestLow: next(), payloadKind: next(), payloadObjectIdHigh: next(), payloadObjectIdLow: next(), relatedWorkIdHigh: next(), relatedWorkIdLow: next(), relatedGenerationHigh: next(), relatedGenerationLow: next(), payloadValue: next() });
  const resultCode = next(); const operationCode = next(); const currentTime = { secondsHigh: next(), secondsLow: next(), nanoseconds: next() }; const clockRevisionHigh = next(); const clockRevisionLow = next(); const nextWorkIdHigh = next(); const nextWorkIdLow = next(); const resultWorkPresent = next() !== 0; const resultWork = readWork(); const resultCount = next(); const results = Array.from({ length: SCHEDULER_MAX_DIAGNOSTICS }, readWork);
  const processedTimestampCount = next(); const processedWorkCount = next(); const reachedTarget = next() !== 0; const failurePresent = next() !== 0; const failureIdHigh = next(); const failureIdLow = next(); const failureGenerationHigh = next(); const failureGenerationLow = next(); const failurePhase = next(); const failureSourceKind = next();
  return validateSchedulerWire({ ...input, resultCode, operationCode, currentTime, clockRevisionHigh, clockRevisionLow, nextWorkIdHigh, nextWorkIdLow, resultWorkPresent, resultWork, resultCount, results, processedTimestampCount, processedWorkCount, reachedTarget, failurePresent, failureIdHigh, failureIdLow, failureGenerationHigh, failureGenerationLow, failurePhase, failureSourceKind });
}

export function schedulerInstant(value: SchedulerWorkWire): SimulationInstant { return decodeSimulationInstant(value.instant); }
