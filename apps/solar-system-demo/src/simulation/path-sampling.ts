import {
  compareSimulationInstants,
  simulationInstant,
  type ObjectId,
  type PropagationState,
  type PropagationTimeInterval,
  type ReferenceFrameId,
  type RevisionId,
  type SimulationInstant,
} from "orbit-engine";

export const MAX_PATH_SAMPLES = 256;

export interface PathSample {
  readonly instant: SimulationInstant;
  readonly state: PropagationState;
}

export interface OrbitPath {
  readonly objectId: ObjectId;
  readonly focusId: ObjectId;
  readonly outputFrame: ReferenceFrameId;
  readonly interval: PropagationTimeInterval & { readonly end: SimulationInstant };
  readonly sampleCount: number;
  readonly motionRevision: RevisionId;
  readonly configurationRevision: RevisionId;
  readonly closedReferenceOrbit?: boolean;
  readonly samples: readonly PathSample[];
}

export interface PathSamplingRequest {
  readonly objectId: ObjectId;
  readonly focusId: ObjectId;
  readonly outputFrame: ReferenceFrameId;
  readonly interval: PropagationTimeInterval & { readonly end: SimulationInstant };
  readonly sampleCount: number;
  readonly motionRevision: RevisionId;
  readonly configurationRevision: RevisionId;
  readonly closedReferenceOrbit?: boolean;
  readonly stateAt: (objectId: ObjectId, target: SimulationInstant, outputFrame: ReferenceFrameId) => PropagationState;
}

function assertSampleCount(value: number): void {
  if (!Number.isSafeInteger(value) || value < 2 || value > MAX_PATH_SAMPLES) {
    throw new RangeError(`Path sample count must be an integer in [2, ${MAX_PATH_SAMPLES}]`);
  }
}

function exactSampleInstant(
  start: SimulationInstant,
  end: SimulationInstant,
  index: number,
  sampleCount: number,
): SimulationInstant {
  const nanosecondsPerSecond = 1_000_000_000n;
  const startNanoseconds = BigInt(start.seconds) * nanosecondsPerSecond + BigInt(start.nanoseconds);
  const endNanoseconds = BigInt(end.seconds) * nanosecondsPerSecond + BigInt(end.nanoseconds);
  const offset = ((endNanoseconds - startNanoseconds) * BigInt(index)) / BigInt(sampleCount);
  const total = startNanoseconds + offset;
  let seconds = total / nanosecondsPerSecond;
  let nanoseconds = total % nanosecondsPerSecond;
  if (nanoseconds < 0) {
    seconds -= 1n;
    nanoseconds += nanosecondsPerSecond;
  }
  return simulationInstant(Number(seconds), Number(nanoseconds));
}

function cacheKey(request: PathSamplingRequest): string {
  const { interval } = request;
  return [
    request.objectId,
    request.focusId,
    request.outputFrame,
    interval.start.seconds,
    interval.start.nanoseconds,
    interval.end.seconds,
    interval.end.nanoseconds,
    request.sampleCount,
    request.motionRevision,
    request.configurationRevision,
    request.closedReferenceOrbit ?? true,
  ].join("|");
}

export function sampleOrbitPath(request: PathSamplingRequest): OrbitPath {
  assertSampleCount(request.sampleCount);
  if (request.interval.end === undefined
      || compareSimulationInstants(request.interval.start, request.interval.end) >= 0) {
    throw new RangeError("Orbit path interval must have an end after its start");
  }

  const samples = Object.freeze(Array.from({ length: request.sampleCount }, (_, index) => {
    const instant = exactSampleInstant(request.interval.start, request.interval.end, index, request.sampleCount);
    const state = request.stateAt(request.objectId, instant, request.outputFrame);
    if (compareSimulationInstants(state.epoch, instant) !== 0) {
      throw new RangeError("Path state source returned a state at a different epoch");
    }
    return Object.freeze({ instant, state });
  }));

  return Object.freeze({
    objectId: request.objectId,
    focusId: request.focusId,
    outputFrame: request.outputFrame,
    interval: request.interval,
    sampleCount: request.sampleCount,
    motionRevision: request.motionRevision,
    configurationRevision: request.configurationRevision,
    closedReferenceOrbit: request.closedReferenceOrbit ?? true,
    samples,
  });
}

export class PathCache {
  readonly #maxEntries: number;
  readonly #entries = new Map<string, OrbitPath>();

  constructor(maxEntries = 4) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries <= 0) throw new RangeError("Path cache capacity must be positive");
    this.#maxEntries = maxEntries;
  }

  getOrCreate(request: PathSamplingRequest): OrbitPath {
    const key = cacheKey(request);
    const cached = this.#entries.get(key);
    if (cached !== undefined) return cached;
    const path = sampleOrbitPath(request);
    this.#entries.set(key, path);
    while (this.#entries.size > this.#maxEntries) this.#entries.delete(this.#entries.keys().next().value!);
    return path;
  }

  invalidateObject(objectId: ObjectId): void {
    for (const [key, path] of this.#entries) {
      if (path.objectId === objectId || path.focusId === objectId) this.#entries.delete(key);
    }
  }

  clear(): void {
    this.#entries.clear();
  }

  size(): number {
    return this.#entries.size;
  }
}
