import type { Backend } from "./internal/backends/contract.js";
import { objectId, type ObjectId } from "./objects.js";
import { revisionId, type RevisionId } from "./propagation.js";
import { simulationInstant, type SimulationInstant } from "./time.js";
import {
  emptySchedulerWire,
  encodeWork,
  decodeWork,
  SchedulerOperationCode,
  SchedulerResultCode,
  uint64Words,
  wordsUint64,
  type SchedulerWire,
  type SchedulerWorkValue,
} from "./internal/scheduler-wire.js";

export const ScheduledWorkPhase = Object.freeze({
  boundary: "boundary",
  physicalChange: "physicalChange",
  authorityTransition: "authorityTransition",
  predictionMaintenance: "predictionMaintenance",
  observation: "observation",
} as const);
export type ScheduledWorkPhase = (typeof ScheduledWorkPhase)[keyof typeof ScheduledWorkPhase];

const phaseCode: Record<ScheduledWorkPhase, number> = {
  boundary: 1,
  physicalChange: 2,
  authorityTransition: 3,
  predictionMaintenance: 4,
  observation: 5,
};

export const ScheduledWorkSourceKind = Object.freeze({
  engine: 1,
  user: 2,
  motion: 3,
  fidelity: 4,
  reference: 5,
  frame: 6,
  maneuver: 7,
  interaction: 8,
  diagnostic: 9,
  test: 10,
} as const);

export const ScheduledWorkPayloadKind = Object.freeze({
  marker: 1,
  fail: 2,
  scheduleSameTime: 3,
  cancel: 4,
  replace: 5,
  registryUpdate: 6,
  motionTransition: 7,
} as const);

export type ScheduledWorkId = string & { readonly __orbitEngineScheduledWorkId: never };

export interface ScheduledWorkPayload {
  readonly kind: number;
  readonly objectId?: ObjectId;
  readonly relatedWorkId?: ScheduledWorkId;
  readonly relatedGeneration?: RevisionId;
  readonly value?: number;
}
export interface ScheduledWorkInput {
  readonly instant: SimulationInstant;
  readonly phase: ScheduledWorkPhase | number;
  readonly sourceKind: number;
  readonly sourceId: ObjectId;
  readonly sourceOrdinal?: RevisionId;
  readonly dependencyRevisionDigest?: RevisionId;
  readonly payload: ScheduledWorkPayload;
}

export interface ScheduledWorkRecord {
  readonly id: ScheduledWorkId;
  readonly generation: RevisionId;
  readonly instant: SimulationInstant;
  readonly phase: ScheduledWorkPhase;
  readonly sourceKind: number;
  readonly sourceId: ObjectId;
  readonly sourceOrdinal: RevisionId;
  readonly dependencyRevisionDigest: RevisionId;
  readonly payload: ScheduledWorkPayload;
}

export interface ScheduledWorkQueueConfiguration {
  readonly maxScheduledWorkItems?: number;
  readonly maxWorkItemsPerTimestamp?: number;
  readonly maxTimestampTransactionsPerAdvance?: number;
}

export interface SimulationClockStatus {
  readonly currentTime: SimulationInstant;
  readonly revision: RevisionId;
  readonly nextWorkId: ScheduledWorkId;
}

export const SchedulerErrorCode = Object.freeze({
  invalidInput: "invalidInput",
  pastEvent: "pastEvent",
  sameTimeRejected: "sameTimeRejected",
  capacityExceeded: "capacityExceeded",
  notFound: "notFound",
  staleGeneration: "staleGeneration",
  invalidPhase: "invalidPhase",
  invalidPayload: "invalidPayload",
  invalidOperation: "invalidOperation",
} as const);
export type SchedulerErrorCode = (typeof SchedulerErrorCode)[keyof typeof SchedulerErrorCode];

export class SchedulerError extends RangeError {
  readonly code: SchedulerErrorCode;

  constructor(code: SchedulerErrorCode, message: string) {
    super(message);
    this.name = "SchedulerError";
    this.code = code;
  }
}

function asWorkId(value: string): ScheduledWorkId {
  uint64Words(value, "scheduled work ID", false);
  return value as ScheduledWorkId;
}

function phase(value: ScheduledWorkPhase | number): number {
  const result = typeof value === "number" ? value : phaseCode[value];
  if (!Number.isInteger(result) || result < 1 || result > 5) throw new SchedulerError(SchedulerErrorCode.invalidPhase, "Scheduled work phase must be one of the five ordered phases");
  return result;
}

function payload(value: ScheduledWorkPayload): { kind: number; objectId?: ObjectId; relatedWorkId?: ScheduledWorkId; relatedGeneration?: RevisionId; value: number } {
  if (typeof value !== "object" || value === null || !Number.isInteger(value.kind) || value.kind <= 0 || value.kind > 65_535) throw new SchedulerError(SchedulerErrorCode.invalidPayload, "Scheduled work payload kind must be a positive uint16");
  if (value.value !== undefined && !Number.isFinite(value.value)) throw new SchedulerError(SchedulerErrorCode.invalidPayload, "Scheduled work payload value must be finite");
  return { kind: value.kind, objectId: value.objectId === undefined ? undefined : objectId(value.objectId), relatedWorkId: value.relatedWorkId === undefined ? undefined : asWorkId(value.relatedWorkId), relatedGeneration: value.relatedGeneration === undefined ? undefined : revisionId(value.relatedGeneration), value: value.value ?? 0 };
}

function record(value: SchedulerWorkValue): ScheduledWorkRecord {
  const phaseName = (Object.keys(phaseCode) as ScheduledWorkPhase[]).find((name) => phaseCode[name] === value.phase);
  if (phaseName === undefined) throw new SchedulerError(SchedulerErrorCode.invalidPhase, "Backend returned an unknown scheduled work phase");
  return Object.freeze({ id: asWorkId(value.id), generation: value.generation, instant: simulationInstant(value.instant.seconds, value.instant.nanoseconds), phase: phaseName, sourceKind: value.sourceKind, sourceId: objectId(value.sourceId), sourceOrdinal: value.sourceOrdinal, dependencyRevisionDigest: value.dependencyRevisionDigest, payload: Object.freeze({ kind: value.payloadKind, objectId: value.payloadObjectId, relatedWorkId: value.relatedWorkId as ScheduledWorkId | undefined, relatedGeneration: value.relatedGeneration, value: value.payloadValue }) });
}

function errorCode(value: number): SchedulerErrorCode {
  switch (value) {
    case SchedulerResultCode.invalidInput: return SchedulerErrorCode.invalidInput;
    case SchedulerResultCode.pastEvent: return SchedulerErrorCode.pastEvent;
    case SchedulerResultCode.sameTimeRejected: return SchedulerErrorCode.sameTimeRejected;
    case SchedulerResultCode.capacityExceeded: return SchedulerErrorCode.capacityExceeded;
    case SchedulerResultCode.notFound: return SchedulerErrorCode.notFound;
    case SchedulerResultCode.staleGeneration: return SchedulerErrorCode.staleGeneration;
    case SchedulerResultCode.invalidPhase: return SchedulerErrorCode.invalidPhase;
    case SchedulerResultCode.invalidPayload: return SchedulerErrorCode.invalidPayload;
    default: return SchedulerErrorCode.invalidOperation;
  }
}

export class ScheduledWorkQueue {
  readonly #backend: Backend;
  readonly #configuration: Required<ScheduledWorkQueueConfiguration>;

  constructor(backend: Backend, configuration: ScheduledWorkQueueConfiguration = {}) {
    this.#backend = backend;
    this.#configuration = Object.freeze({
      maxScheduledWorkItems: configuration.maxScheduledWorkItems ?? 1_000_000,
      maxWorkItemsPerTimestamp: configuration.maxWorkItemsPerTimestamp ?? 4_096,
      maxTimestampTransactionsPerAdvance: configuration.maxTimestampTransactionsPerAdvance ?? 1_000_000,
    });
    for (const [name, value] of Object.entries(this.#configuration)) if (!Number.isInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive integer`);
    const reset = emptySchedulerWire(SchedulerOperationCode.reset);
    this.#backend.roundTripScheduler({ ...reset, maxScheduledWorkItems: this.#configuration.maxScheduledWorkItems, maxWorkItemsPerTimestamp: this.#configuration.maxWorkItemsPerTimestamp, maxTimestampTransactionsPerAdvance: this.#configuration.maxTimestampTransactionsPerAdvance });
  }

  status(): SimulationClockStatus {
    const result = this.#call(emptySchedulerWire(SchedulerOperationCode.snapshot));
    return Object.freeze({ currentTime: simulationInstant(result.currentTime.secondsHigh * 4_294_967_296 + result.currentTime.secondsLow, result.currentTime.nanoseconds), revision: revisionId(wordsUint64(result.clockRevisionHigh, result.clockRevisionLow, "clock revision")), nextWorkId: asWorkId(wordsUint64(result.nextWorkIdHigh, result.nextWorkIdLow, "next work ID", false)) });
  }

  schedule(input: ScheduledWorkInput, options: { readonly allowCurrentTime?: boolean } = {}): ScheduledWorkRecord {
    const result = this.#call(this.#inputWire(SchedulerOperationCode.schedule, input, options.allowCurrentTime ?? false));
    if (!result.resultWorkPresent) throw new SchedulerError(SchedulerErrorCode.invalidOperation, "Scheduler did not return the scheduled work record");
    return record(decodeWork(result.resultWork));
  }

  cancel(id: ScheduledWorkId, generation: RevisionId): ScheduledWorkRecord {
    const words = uint64Words(asWorkId(id), "scheduled work ID", false);
    const generationWords = uint64Words(revisionId(generation), "scheduled work generation", false);
    const result = this.#call({ ...emptySchedulerWire(SchedulerOperationCode.cancel), expectedIdHigh: words.high, expectedIdLow: words.low, expectedGenerationHigh: generationWords.high, expectedGenerationLow: generationWords.low });
    if (!result.resultWorkPresent) throw new SchedulerError(SchedulerErrorCode.invalidOperation, "Scheduler did not return the cancelled work record");
    return record(decodeWork(result.resultWork));
  }

  replace(id: ScheduledWorkId, generation: RevisionId, input: ScheduledWorkInput, options: { readonly allowCurrentTime?: boolean } = {}): ScheduledWorkRecord {
    const words = uint64Words(asWorkId(id), "scheduled work ID", false);
    const generationWords = uint64Words(revisionId(generation), "scheduled work generation", false);
    const result = this.#call({ ...this.#inputWire(SchedulerOperationCode.replace, input, options.allowCurrentTime ?? false), expectedIdHigh: words.high, expectedIdLow: words.low, expectedGenerationHigh: generationWords.high, expectedGenerationLow: generationWords.low });
    if (!result.resultWorkPresent) throw new SchedulerError(SchedulerErrorCode.invalidOperation, "Scheduler did not return the replaced work record");
    return record(decodeWork(result.resultWork));
  }

  list(limit = 64, offset = 0): readonly ScheduledWorkRecord[] {
    if (!Number.isInteger(limit) || limit < 0 || limit > 64 || !Number.isInteger(offset) || offset < 0) throw new RangeError("Scheduled work diagnostics pagination is invalid");
    const result = this.#call({ ...emptySchedulerWire(SchedulerOperationCode.list), listLimit: limit, listOffset: offset });
    return Object.freeze(result.results.slice(0, result.resultCount).map((item) => record(decodeWork(item))));
  }

  #inputWire(operationCode: number, input: ScheduledWorkInput, allowCurrentTime: boolean): SchedulerWire {
    const normalizedPayload = payload(input.payload);
    const work: SchedulerWorkValue = { id: "0", generation: revisionId("1"), instant: simulationInstant(input.instant.seconds, input.instant.nanoseconds), phase: phase(input.phase), sourceKind: input.sourceKind, sourceId: objectId(input.sourceId), sourceOrdinal: revisionId(input.sourceOrdinal ?? "0"), dependencyRevisionDigest: revisionId(input.dependencyRevisionDigest ?? "0"), payloadKind: normalizedPayload.kind, payloadObjectId: normalizedPayload.objectId, relatedWorkId: normalizedPayload.relatedWorkId, relatedGeneration: normalizedPayload.relatedGeneration, payloadValue: normalizedPayload.value };
    return { ...emptySchedulerWire(operationCode), allowCurrentTime, work: encodeWork(work, true) };
  }

  #call(input: SchedulerWire): SchedulerWire {
    const result = this.#backend.roundTripScheduler(input);
    if (result.resultCode !== SchedulerResultCode.success) throw new SchedulerError(errorCode(result.resultCode), `Scheduled work operation failed: ${errorCode(result.resultCode)}`);
    return result;
  }
}
