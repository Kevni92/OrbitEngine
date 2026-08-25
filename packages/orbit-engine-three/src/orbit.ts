import type { ObjectId, SimulationInstant } from "orbit-engine";
import type { RenderSnapshotOrigin } from "./snapshot.js";
import type { RenderVector3 } from "./render-space.js";

export const MAX_ORBIT_PATH_SAMPLES = 256;
export const DEFAULT_ORBIT_PATH_SAMPLES = 128;

export type OrbitPathOrigin = RenderSnapshotOrigin;

export interface OrbitPathInterval {
  readonly start: SimulationInstant;
  readonly end: SimulationInstant;
}

export interface OrbitPathSample {
  readonly instant: SimulationInstant;
  readonly positionRelativeToOriginMeters: RenderVector3;
}

export interface OrbitPathSnapshotInput {
  readonly objectId: ObjectId;
  readonly parentId?: ObjectId;
  readonly origin: OrbitPathOrigin;
  readonly frameId?: string;
  readonly interval: OrbitPathInterval;
  readonly samples: readonly OrbitPathSample[];
  readonly closedReferenceOrbit?: boolean;
  readonly closed?: boolean;
  readonly motionRevision?: string;
  readonly sourceRevision?: string;
  readonly sourceRevisionFingerprint?: string;
}

export interface OrbitPathSnapshot extends OrbitPathSnapshotInput {
  readonly frameId: string;
  readonly sampleInstants: readonly SimulationInstant[];
  readonly samplePositionsRelativeToOriginMeters: readonly RenderVector3[];
  readonly sampleCount: number;
  readonly closedReferenceOrbit: boolean;
  readonly closed: boolean;
  readonly sourceRevisionFingerprint?: string;
  readonly fingerprint: string;
}

const normalizedOrbitPaths = new WeakSet<object>();

export interface OrbitPathSamplingRequest {
  readonly objectId: ObjectId;
  readonly parentId?: ObjectId;
  readonly origin: OrbitPathOrigin;
  readonly frameId?: string;
  readonly interval: OrbitPathInterval;
  readonly sampleCount: number;
  readonly closedReferenceOrbit?: boolean;
  readonly motionRevision?: string;
  readonly sourceRevision?: string;
  readonly sourceRevisionFingerprint?: string;
  readonly positionAt: (instant: SimulationInstant) => RenderVector3;
}

export interface OrbitPathCacheKeyInput {
  readonly objectId: ObjectId;
  readonly parentId?: ObjectId;
  readonly origin: OrbitPathOrigin;
  readonly frameId?: string;
  readonly interval: OrbitPathInterval;
  readonly sampleCount: number;
  readonly closedReferenceOrbit?: boolean;
  readonly motionRevision?: string;
  readonly sourceRevision?: string;
  readonly sourceRevisionFingerprint?: string;
}

function fail(message: string): never {
  throw new RangeError(`Orbit path: ${message}`);
}

function nonEmpty(name: string, value: string): void {
  if (typeof value !== "string" || value.trim().length === 0) fail(`${name} must be a non-empty string`);
}

function finite(name: string, value: number): void {
  if (!Number.isFinite(value)) fail(`${name} must be finite`);
}

function validateInstant(name: string, value: SimulationInstant): void {
  if (typeof value !== "object" || value === null) fail(`${name} must be a time value`);
  finite(`${name}.seconds`, value.seconds);
  finite(`${name}.nanoseconds`, value.nanoseconds);
  if (!Number.isSafeInteger(value.seconds) || !Number.isInteger(value.nanoseconds)
      || value.nanoseconds < 0 || value.nanoseconds >= 1_000_000_000) {
    fail(`${name} must contain normalized integer seconds and nanoseconds`);
  }
}

function compareInstants(left: SimulationInstant, right: SimulationInstant): number {
  if (left.seconds !== right.seconds) return left.seconds < right.seconds ? -1 : 1;
  if (left.nanoseconds !== right.nanoseconds) return left.nanoseconds < right.nanoseconds ? -1 : 1;
  return 0;
}

function validateOrigin(origin: OrbitPathOrigin): void {
  if (typeof origin !== "object" || origin === null) fail("origin must be an object");
  if (origin.kind !== "frame" && origin.kind !== "object" && origin.kind !== "custom") fail(`origin kind ${String(origin.kind)} is unsupported`);
  nonEmpty("origin.frameId", origin.frameId);
  if (origin.kind === "object" && origin.objectId === undefined) fail("object origins require objectId");
  if (origin.label !== undefined) nonEmpty("origin.label", origin.label);
}

function validatePosition(name: string, value: RenderVector3): void {
  if (typeof value !== "object" || value === null) fail(`${name} must be a vector`);
  finite(`${name}.x`, value.x);
  finite(`${name}.y`, value.y);
  finite(`${name}.z`, value.z);
}

function validateRevision(name: string, value: string | undefined): void {
  if (value !== undefined) nonEmpty(name, value);
}

function stableFingerprint(value: unknown): string {
  const serialized = JSON.stringify(value);
  let hash = 2_166_136_261;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `orbit-path-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function instantKey(value: SimulationInstant): string {
  return `${value.seconds}:${value.nanoseconds}`;
}

function originKey(origin: OrbitPathOrigin): string {
  return `${origin.kind}:${origin.frameId}:${origin.objectId ?? ""}:${origin.label ?? ""}`;
}

function normalizedSample(sample: OrbitPathSample, index: number): OrbitPathSample {
  if (typeof sample !== "object" || sample === null) fail(`samples[${index}] must be an object`);
  validateInstant(`samples[${index}].instant`, sample.instant);
  validatePosition(`samples[${index}].positionRelativeToOriginMeters`, sample.positionRelativeToOriginMeters);
  const instant = Object.freeze({ seconds: sample.instant.seconds, nanoseconds: sample.instant.nanoseconds }) as SimulationInstant;
  const position = Object.freeze({
    x: sample.positionRelativeToOriginMeters.x,
    y: sample.positionRelativeToOriginMeters.y,
    z: sample.positionRelativeToOriginMeters.z,
  });
  return Object.freeze({ instant, positionRelativeToOriginMeters: position });
}

export function orbitPathCacheKey(input: OrbitPathCacheKeyInput): string {
  if (!Number.isSafeInteger(input.sampleCount) || input.sampleCount < 2 || input.sampleCount > MAX_ORBIT_PATH_SAMPLES) {
    throw new RangeError(`Orbit path sample count must be an integer in [2, ${MAX_ORBIT_PATH_SAMPLES}]`);
  }
  return [
    input.objectId,
    input.parentId ?? "",
    originKey(input.origin),
    input.frameId ?? input.origin.frameId,
    instantKey(input.interval.start),
    instantKey(input.interval.end),
    input.sampleCount,
    input.closedReferenceOrbit ?? true,
    input.motionRevision ?? "",
    input.sourceRevision ?? "",
    input.sourceRevisionFingerprint ?? "",
  ].join("|");
}

export function createOrbitPathSnapshot(input: OrbitPathSnapshotInput): OrbitPathSnapshot {
  if (typeof input === "object" && input !== null && normalizedOrbitPaths.has(input)) {
    return input as OrbitPathSnapshot;
  }
  if (typeof input.objectId !== "string" || input.objectId.length === 0) fail("objectId must be a non-empty ObjectId");
  validateOrigin(input.origin);
  validateInstant("interval.start", input.interval.start);
  validateInstant("interval.end", input.interval.end);
  if (compareInstants(input.interval.start, input.interval.end) >= 0) fail("interval.end must be after interval.start");
  if (input.frameId !== undefined) nonEmpty("frameId", input.frameId);
  const frameId = input.frameId ?? input.origin.frameId;
  if (frameId !== input.origin.frameId) fail("frameId must match origin.frameId");
  const sampleCount = input.samples.length;
  if (!Number.isSafeInteger(sampleCount) || sampleCount < 2 || sampleCount > MAX_ORBIT_PATH_SAMPLES) {
    throw new RangeError(`Orbit path sample count must be an integer in [2, ${MAX_ORBIT_PATH_SAMPLES}]`);
  }
  const samples = Object.freeze(input.samples.map(normalizedSample));
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index]!;
    if (compareInstants(sample.instant, input.interval.start) < 0 || compareInstants(sample.instant, input.interval.end) >= 0) {
      fail(`samples[${index}].instant must lie in the half-open interval`);
    }
    const previous = samples[index - 1];
    if (previous !== undefined && compareInstants(previous.instant, sample.instant) >= 0) {
      fail("sample instants must be strictly increasing");
    }
  }
  validateRevision("motionRevision", input.motionRevision);
  validateRevision("sourceRevision", input.sourceRevision);
  validateRevision("sourceRevisionFingerprint", input.sourceRevisionFingerprint);
  const interval = Object.freeze({
    start: Object.freeze({ seconds: input.interval.start.seconds, nanoseconds: input.interval.start.nanoseconds }) as SimulationInstant,
    end: Object.freeze({ seconds: input.interval.end.seconds, nanoseconds: input.interval.end.nanoseconds }) as SimulationInstant,
  });
  const origin = Object.freeze({ ...input.origin });
  const sampleInstants = Object.freeze(samples.map((sample) => sample.instant));
  const samplePositions = Object.freeze(samples.map((sample) => sample.positionRelativeToOriginMeters));
  const closedReferenceOrbit = input.closedReferenceOrbit ?? input.closed ?? true;
  const closed = input.closed ?? closedReferenceOrbit;
  const sourceRevisionFingerprint = input.sourceRevisionFingerprint
    ?? (input.sourceRevision === undefined ? undefined : input.sourceRevision);
  const fingerprint = stableFingerprint({
    objectId: input.objectId,
    parentId: input.parentId,
    origin,
    frameId,
    interval,
    samples,
    closedReferenceOrbit,
    closed,
    motionRevision: input.motionRevision,
    sourceRevision: input.sourceRevision,
    sourceRevisionFingerprint,
  });
  const path = Object.freeze({
    objectId: input.objectId,
    ...(input.parentId === undefined ? {} : { parentId: input.parentId }),
    origin,
    frameId,
    interval,
    samples,
    sampleInstants,
    samplePositionsRelativeToOriginMeters: samplePositions,
    sampleCount,
    closedReferenceOrbit,
    closed,
    ...(input.motionRevision === undefined ? {} : { motionRevision: input.motionRevision }),
    ...(input.sourceRevision === undefined ? {} : { sourceRevision: input.sourceRevision }),
    ...(sourceRevisionFingerprint === undefined ? {} : { sourceRevisionFingerprint }),
    fingerprint,
  });
  normalizedOrbitPaths.add(path);
  return path;
}

function exactSampleInstant(start: SimulationInstant, end: SimulationInstant, index: number, sampleCount: number): SimulationInstant {
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
  return Object.freeze({ seconds: Number(seconds), nanoseconds: Number(nanoseconds) }) as SimulationInstant;
}

export function sampleOrbitPath(request: OrbitPathSamplingRequest): OrbitPathSnapshot {
  if (!Number.isSafeInteger(request.sampleCount) || request.sampleCount < 2 || request.sampleCount > MAX_ORBIT_PATH_SAMPLES) {
    throw new RangeError(`Orbit path sample count must be an integer in [2, ${MAX_ORBIT_PATH_SAMPLES}]`);
  }
  if (typeof request.positionAt !== "function") throw new TypeError("Orbit path positionAt must be a function");
  validateInstant("interval.start", request.interval.start);
  validateInstant("interval.end", request.interval.end);
  if (compareInstants(request.interval.start, request.interval.end) >= 0) throw new RangeError("Orbit path interval.end must be after interval.start");
  const samples = Array.from({ length: request.sampleCount }, (_, index) => {
    const instant = exactSampleInstant(request.interval.start, request.interval.end, index, request.sampleCount);
    return { instant, positionRelativeToOriginMeters: request.positionAt(instant) };
  });
  return createOrbitPathSnapshot({ ...request, samples });
}

export class OrbitPathCache {
  readonly #maxEntries: number;
  readonly #entries = new Map<string, OrbitPathSnapshot>();

  constructor(maxEntries = 12) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries <= 0) throw new RangeError("Orbit path cache capacity must be positive");
    this.#maxEntries = maxEntries;
  }

  get(key: string): OrbitPathSnapshot | undefined {
    nonEmpty("cache key", key);
    return this.#entries.get(key);
  }

  getOrCreate(key: string, factory: () => OrbitPathSnapshot): OrbitPathSnapshot {
    const cached = this.get(key);
    if (cached !== undefined) return cached;
    const value = factory();
    if (typeof value?.fingerprint !== "string") throw new TypeError("Orbit path cache factory must return an OrbitPathSnapshot");
    this.#entries.set(key, value);
    while (this.#entries.size > this.#maxEntries) this.#entries.delete(this.#entries.keys().next().value!);
    return value;
  }

  invalidateObject(objectId: ObjectId): void {
    for (const [key, path] of this.#entries) {
      if (path.objectId === objectId || path.parentId === objectId || path.origin.objectId === objectId) this.#entries.delete(key);
    }
  }

  clear(): void {
    this.#entries.clear();
  }

  size(): number {
    return this.#entries.size;
  }
}
