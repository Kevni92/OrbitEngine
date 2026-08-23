import type { DependencyRevision } from "./dependency.js";
import { dependencyRevisionDigest } from "./dependency.js";
import type { EncounterPair } from "./encounter.js";
import { objectId, type ObjectId } from "./objects.js";
import { referenceFrameId, type ReferenceFrameId, vec3, type Vec3 } from "./frames.js";
import { revisionId, type RevisionId } from "./propagation.js";
import { meters, type Meters } from "./units.js";
import {
  addDurationToInstant,
  compareDurations,
  compareSimulationInstants,
  duration,
  durationToSeconds,
  simulationInstant,
  subtractSimulationInstants,
  type Duration,
  type SimulationInstant,
} from "./time.js";
import type { PropagationTimeInterval } from "./propagation.js";

const NANOS_PER_SECOND = 1_000_000_000n;

export const SweptEncounterBoundStatus = Object.freeze({
  bounded: "bounded",
  uncertain: "uncertain",
  unbounded: "unbounded",
} as const);

export type SweptEncounterBoundStatus = (typeof SweptEncounterBoundStatus)[keyof typeof SweptEncounterBoundStatus];

export interface EncounterDomainInput {
  readonly domainId: string;
  readonly frame: ReferenceFrameId;
  readonly revision: RevisionId | string;
  readonly maxWindowSpan: Duration;
}

export interface EncounterDomain {
  readonly domainId: string;
  readonly frame: ReferenceFrameId;
  readonly revision: RevisionId;
  readonly maxWindowSpan: Duration;
}

export interface EncounterDomainMembershipInput {
  readonly domainId: string;
  readonly objectId: ObjectId;
  readonly revision: RevisionId | string;
  readonly validity?: PropagationTimeInterval;
}

export interface EncounterDomainMembership {
  readonly domainId: string;
  readonly objectId: ObjectId;
  readonly revision: RevisionId;
  readonly validity?: PropagationTimeInterval;
}

export interface EncounterWindowSplitInput {
  readonly interval: PropagationTimeInterval;
  readonly maxWindowSpan: Duration;
  readonly boundaries?: readonly SimulationInstant[];
}

export interface EncounterWindow {
  readonly start: SimulationInstant;
  readonly end: SimulationInstant;
}

export interface SweptEncounterBoundInput {
  readonly objectId: ObjectId;
  readonly interval: EncounterWindow | PropagationTimeInterval;
  readonly domainId: string;
  readonly min: Vec3<number>;
  readonly max: Vec3<number>;
  readonly inflationMeters: number;
  readonly status?: SweptEncounterBoundStatus;
  readonly dependencyRevisions?: readonly DependencyRevision[];
  readonly dependencyRevisionDigest?: RevisionId | string;
}

export interface SweptEncounterBound {
  readonly objectId: ObjectId;
  readonly interval: EncounterWindow;
  readonly domainId: string;
  readonly min: Vec3<Meters>;
  readonly max: Vec3<Meters>;
  readonly inflationMeters: Meters;
  readonly status: SweptEncounterBoundStatus;
  readonly dependencyRevisionDigest?: RevisionId;
}

export interface SweptEncounterSample {
  readonly instant: SimulationInstant;
  readonly position: Vec3<number>;
  readonly velocity?: Vec3<number>;
  readonly uncertaintyMeters?: number;
  readonly betweenSampleErrorMeters?: number;
  readonly certified?: boolean;
}

export interface SweptEncounterBoundBuildInput {
  readonly objectId: ObjectId;
  readonly domainId: string;
  readonly interval: EncounterWindow | PropagationTimeInterval;
  readonly broadPhaseDistanceMeters: number;
  readonly samples?: readonly SweptEncounterSample[];
  readonly sampleAt?: (instant: SimulationInstant) => SweptEncounterSample;
  readonly maxSamples: number;
  readonly minimumWindowSpan: Duration;
  readonly maxErrorMeters?: number;
  readonly dependencyRevisions?: readonly DependencyRevision[];
  readonly dependencyRevisionDigest?: RevisionId | string;
}

export interface EncounterBoundShardInput {
  readonly shardId: string;
  readonly domainId: string;
  readonly revision: RevisionId | string;
  readonly bounds: readonly SweptEncounterBound[];
}

export interface EncounterBoundShard {
  readonly shardId: string;
  readonly domainId: string;
  readonly revision: RevisionId;
  readonly bounds: readonly SweptEncounterBound[];
}

export interface EncounterCandidate {
  readonly objectA: ObjectId;
  readonly objectB: ObjectId;
  readonly domainId: string;
  readonly interval: EncounterWindow;
  readonly boundKeys: readonly [string, string];
}

export interface EncounterBroadPhaseDiagnostics {
  readonly indexedBounds: number;
  readonly indexedDomains: number;
  readonly indexedShards: number;
  readonly overlapTests: number;
  readonly queryCount: number;
  readonly candidatePairs: number;
}

function compareText(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function compareObjectId(left: ObjectId, right: ObjectId): number {
  const a = BigInt(left);
  const b = BigInt(right);
  return a === b ? 0 : a < b ? -1 : 1;
}

function assertIdentifier(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    throw new TypeError(`${name} must be a non-empty identifier without surrounding whitespace`);
  }
}

function normalizedRevision(value: RevisionId | string, name: string): RevisionId {
  if (typeof value !== "string") throw new TypeError(`${name} must be a revision`);
  return revisionId(value);
}

function normalizedFinite(value: number, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  return value;
}

function normalizedNonNegative(value: number, name: string): number {
  const result = normalizedFinite(value, name);
  if (result < 0) throw new RangeError(`${name} must be non-negative`);
  return result;
}

function positiveSafeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive safe integer`);
  return value;
}

function normalizedDuration(value: Duration, name: string): Duration {
  if (typeof value !== "object" || value === null) throw new TypeError(`${name} must be a Duration`);
  return duration(value.seconds, value.nanoseconds);
}

function positiveDuration(value: Duration, name: string): Duration {
  const result = normalizedDuration(value, name);
  if (compareDurations(result, duration(0)) <= 0) throw new RangeError(`${name} must be positive`);
  return result;
}

function normalizedInterval(value: EncounterWindow | PropagationTimeInterval): EncounterWindow {
  if (typeof value !== "object" || value === null) throw new TypeError("Encounter interval must be an object");
  const start = simulationInstant(value.start.seconds, value.start.nanoseconds);
  if (value.end === undefined) throw new RangeError("Encounter broad-phase intervals require an exact end");
  const end = simulationInstant(value.end.seconds, value.end.nanoseconds);
  if (compareSimulationInstants(start, end) >= 0) throw new RangeError("Encounter interval end must be after start");
  return Object.freeze({ start, end });
}

function contains(interval: PropagationTimeInterval, instant: SimulationInstant): boolean {
  return compareSimulationInstants(instant, interval.start) >= 0
    && (interval.end === undefined || compareSimulationInstants(instant, interval.end) < 0);
}

function normalizedVec(value: Vec3<number>, name: string): Vec3<number> {
  if (typeof value !== "object" || value === null) throw new TypeError(`${name} must be a vector`);
  return vec3(
    normalizedFinite(value.x, `${name}.x`),
    normalizedFinite(value.y, `${name}.y`),
    normalizedFinite(value.z, `${name}.z`),
  );
}

function normalizedStatus(value: SweptEncounterBoundStatus | undefined): SweptEncounterBoundStatus {
  const status = value ?? SweptEncounterBoundStatus.bounded;
  if (status !== SweptEncounterBoundStatus.bounded
    && status !== SweptEncounterBoundStatus.uncertain
    && status !== SweptEncounterBoundStatus.unbounded) {
    throw new RangeError(`Unknown swept encounter bound status: ${String(status)}`);
  }
  return status;
}

function digestFor(
  revisions: readonly DependencyRevision[] | undefined,
  explicit: RevisionId | string | undefined,
): RevisionId | undefined {
  const computed = dependencyRevisionDigest(revisions);
  if (explicit === undefined) return computed;
  const normalized = normalizedRevision(explicit, "dependencyRevisionDigest");
  if (computed !== undefined && computed !== normalized) throw new RangeError("dependencyRevisionDigest does not match dependencyRevisions");
  return normalized;
}

export function normalizeEncounterDomain(value: EncounterDomainInput): EncounterDomain {
  if (typeof value !== "object" || value === null) throw new TypeError("Encounter domain must be an object");
  assertIdentifier(value.domainId, "domainId");
  return Object.freeze({
    domainId: value.domainId,
    frame: referenceFrameId(value.frame),
    revision: normalizedRevision(value.revision, "domain revision"),
    maxWindowSpan: positiveDuration(value.maxWindowSpan, "maxWindowSpan"),
  });
}

export function normalizeEncounterDomainMembership(value: EncounterDomainMembershipInput): EncounterDomainMembership {
  if (typeof value !== "object" || value === null) throw new TypeError("Encounter domain membership must be an object");
  assertIdentifier(value.domainId, "domainId");
  const validity = value.validity === undefined ? undefined : Object.freeze({
    start: simulationInstant(value.validity.start.seconds, value.validity.start.nanoseconds),
    ...(value.validity.end === undefined ? {} : { end: simulationInstant(value.validity.end.seconds, value.validity.end.nanoseconds) }),
  });
  if (validity?.end !== undefined && compareSimulationInstants(validity.start, validity.end) >= 0) {
    throw new RangeError("Domain membership validity end must be after start");
  }
  return Object.freeze({
    domainId: value.domainId,
    objectId: objectId(value.objectId),
    revision: normalizedRevision(value.revision, "membership revision"),
    ...(validity === undefined ? {} : { validity }),
  });
}

export class EncounterDomainRegistry {
  readonly #domains = new Map<string, EncounterDomain>();
  readonly #memberships = new Map<string, EncounterDomainMembership>();

  register(value: EncounterDomainInput): EncounterDomain {
    const domain = normalizeEncounterDomain(value);
    if (this.#domains.has(domain.domainId)) throw new RangeError(`Encounter domain already exists: ${domain.domainId}`);
    this.#domains.set(domain.domainId, domain);
    return domain;
  }

  get(domainId: string): EncounterDomain {
    assertIdentifier(domainId, "domainId");
    const domain = this.#domains.get(domainId);
    if (domain === undefined) throw new RangeError(`Unknown encounter domain: ${domainId}`);
    return domain;
  }

  list(): readonly EncounterDomain[] {
    return Object.freeze([...this.#domains.values()].sort((left, right) => compareText(left.domainId, right.domainId)));
  }

  setMembership(value: EncounterDomainMembershipInput): EncounterDomainMembership {
    const membership = normalizeEncounterDomainMembership(value);
    this.get(membership.domainId);
    const key = `${membership.domainId}:${membership.objectId}`;
    const previous = this.#memberships.get(key);
    if (previous !== undefined && previous.revision === membership.revision) {
      if (JSON.stringify(previous) !== JSON.stringify(membership)) throw new RangeError("Membership revision must change when membership contents change");
      return previous;
    }
    this.#memberships.set(key, membership);
    return membership;
  }

  membership(domainId: string, objectIdValue: ObjectId): EncounterDomainMembership | undefined {
    this.get(domainId);
    return this.#memberships.get(`${domainId}:${objectId(objectIdValue)}`);
  }

  membersAt(domainId: string, instant?: SimulationInstant): readonly EncounterDomainMembership[] {
    this.get(domainId);
    const result = [...this.#memberships.values()]
      .filter((membership) => membership.domainId === domainId && (instant === undefined || membership.validity === undefined || contains(membership.validity, instant)))
      .sort((left, right) => compareObjectId(left.objectId, right.objectId));
    return Object.freeze(result);
  }
}

function instantNanoseconds(value: SimulationInstant): bigint {
  return BigInt(value.seconds) * NANOS_PER_SECOND + BigInt(value.nanoseconds);
}

function instantFromNanoseconds(value: bigint): SimulationInstant {
  const seconds = value / NANOS_PER_SECOND;
  const nanoseconds = value % NANOS_PER_SECOND;
  return simulationInstant(Number(seconds), Number(nanoseconds));
}

function midpoint(left: SimulationInstant, right: SimulationInstant): SimulationInstant {
  return instantFromNanoseconds((instantNanoseconds(left) + instantNanoseconds(right)) / 2n);
}

export function splitEncounterPredictionWindows(value: EncounterWindowSplitInput): readonly EncounterWindow[] {
  const interval = normalizedInterval(value.interval);
  const maxWindowSpan = positiveDuration(value.maxWindowSpan, "maxWindowSpan");
  const boundaries = (value.boundaries ?? []).map((boundary) => simulationInstant(boundary.seconds, boundary.nanoseconds));
  boundaries.sort(compareSimulationInstants);
  for (let index = 1; index < boundaries.length; index += 1) {
    if (compareSimulationInstants(boundaries[index - 1]!, boundaries[index]!) === 0) throw new RangeError("Encounter window boundaries must be unique");
  }
  const cuts = [interval.start, ...boundaries.filter((boundary) => compareSimulationInstants(boundary, interval.start) > 0 && compareSimulationInstants(boundary, interval.end) < 0), interval.end];
  const windows: EncounterWindow[] = [];
  for (let index = 0; index < cuts.length - 1; index += 1) {
    let start = cuts[index]!;
    const end = cuts[index + 1]!;
    while (compareSimulationInstants(start, end) < 0) {
      const candidateEnd = addDurationToInstant(start, maxWindowSpan);
      const windowEnd = compareSimulationInstants(candidateEnd, end) < 0 ? candidateEnd : end;
      windows.push(Object.freeze({ start, end: windowEnd }));
      start = windowEnd;
    }
  }
  return Object.freeze(windows);
}

export const splitEncounterWindows = splitEncounterPredictionWindows;

export function createSweptEncounterBound(value: SweptEncounterBoundInput): SweptEncounterBound {
  if (typeof value !== "object" || value === null) throw new TypeError("Swept encounter bound must be an object");
  const min = normalizedVec(value.min, "min");
  const max = normalizedVec(value.max, "max");
  if (min.x > max.x || min.y > max.y || min.z > max.z) throw new RangeError("Swept encounter bound min must not exceed max");
  const domainId = value.domainId;
  assertIdentifier(domainId, "domainId");
  const status = normalizedStatus(value.status);
  const inflationMeters = normalizedNonNegative(value.inflationMeters, "inflationMeters");
  return Object.freeze({
    objectId: objectId(value.objectId),
    interval: normalizedInterval(value.interval),
    domainId,
    min: vec3(meters(min.x), meters(min.y), meters(min.z)),
    max: vec3(meters(max.x), meters(max.y), meters(max.z)),
    inflationMeters: meters(inflationMeters),
    status,
    ...(digestFor(value.dependencyRevisions, value.dependencyRevisionDigest) === undefined
      ? {}
      : { dependencyRevisionDigest: digestFor(value.dependencyRevisions, value.dependencyRevisionDigest) }),
  });
}

function normalizedSample(value: SweptEncounterSample): SweptEncounterSample {
  if (typeof value !== "object" || value === null) throw new TypeError("Swept encounter sample must be an object");
  const uncertaintyMeters = value.uncertaintyMeters === undefined ? 0 : normalizedNonNegative(value.uncertaintyMeters, "uncertaintyMeters");
  const betweenSampleErrorMeters = value.betweenSampleErrorMeters === undefined ? 0 : normalizedNonNegative(value.betweenSampleErrorMeters, "betweenSampleErrorMeters");
  if (value.certified !== undefined && typeof value.certified !== "boolean") throw new TypeError("sample certified must be boolean");
  return Object.freeze({
    instant: simulationInstant(value.instant.seconds, value.instant.nanoseconds),
    position: normalizedVec(value.position, "sample.position"),
    ...(value.velocity === undefined ? {} : { velocity: normalizedVec(value.velocity, "sample.velocity") }),
    uncertaintyMeters,
    betweenSampleErrorMeters,
    certified: value.certified ?? true,
  });
}

function boundFromSamples(
  objectIdValue: ObjectId,
  domainId: string,
  interval: EncounterWindow,
  samples: readonly SweptEncounterSample[],
  broadPhaseDistanceMeters: number,
  status: SweptEncounterBoundStatus,
  dependencyRevisions: readonly DependencyRevision[] | undefined,
  dependencyRevisionDigest: RevisionId | string | undefined,
): SweptEncounterBound {
  if (samples.length === 0) throw new RangeError("At least one swept-bound sample is required");
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  let inflation = broadPhaseDistanceMeters;
  const start = interval.start;
  const end = interval.end;
  for (const sample of samples) {
    const uncertainty = sample.uncertaintyMeters ?? 0;
    const error = sample.betweenSampleErrorMeters ?? 0;
    const maxSeconds = Math.max(
      Math.abs(durationToSeconds(subtractSimulationInstants(sample.instant, start))),
      Math.abs(durationToSeconds(subtractSimulationInstants(end, sample.instant))),
    );
    const velocity = sample.velocity;
    const reachX = (velocity === undefined ? 0 : Math.abs(velocity.x) * maxSeconds) + uncertainty + error;
    const reachY = (velocity === undefined ? 0 : Math.abs(velocity.y) * maxSeconds) + uncertainty + error;
    const reachZ = (velocity === undefined ? 0 : Math.abs(velocity.z) * maxSeconds) + uncertainty + error;
    minX = Math.min(minX, sample.position.x - reachX);
    minY = Math.min(minY, sample.position.y - reachY);
    minZ = Math.min(minZ, sample.position.z - reachZ);
    maxX = Math.max(maxX, sample.position.x + reachX);
    maxY = Math.max(maxY, sample.position.y + reachY);
    maxZ = Math.max(maxZ, sample.position.z + reachZ);
    inflation = Math.max(inflation, broadPhaseDistanceMeters + uncertainty + error);
  }
  return createSweptEncounterBound({
    objectId: objectIdValue,
    interval,
    domainId,
    min: { x: minX - broadPhaseDistanceMeters, y: minY - broadPhaseDistanceMeters, z: minZ - broadPhaseDistanceMeters },
    max: { x: maxX + broadPhaseDistanceMeters, y: maxY + broadPhaseDistanceMeters, z: maxZ + broadPhaseDistanceMeters },
    inflationMeters: inflation,
    status,
    dependencyRevisions,
    dependencyRevisionDigest,
  });
}

export function buildConservativeSweptBound(value: SweptEncounterBoundBuildInput): SweptEncounterBound {
  if (typeof value !== "object" || value === null) throw new TypeError("Swept-bound build input must be an object");
  const interval = normalizedInterval(value.interval);
  const objectIdValue = objectId(value.objectId);
  const domainId = value.domainId;
  assertIdentifier(domainId, "domainId");
  const broadPhaseDistanceMeters = normalizedNonNegative(value.broadPhaseDistanceMeters, "broadPhaseDistanceMeters");
  const maxSamples = positiveSafeInteger(value.maxSamples, "maxSamples");
  const minimumWindowSpan = positiveDuration(value.minimumWindowSpan, "minimumWindowSpan");
  const maxErrorMeters = value.maxErrorMeters === undefined ? undefined : normalizedNonNegative(value.maxErrorMeters, "maxErrorMeters");
  let status: SweptEncounterBoundStatus = SweptEncounterBoundStatus.bounded;
  const samples: SweptEncounterSample[] = [];

  if (value.sampleAt !== undefined) {
    if (typeof value.sampleAt !== "function") throw new TypeError("sampleAt must be a function");
    const sampled = new Map<string, SweptEncounterSample>();
    const key = (instant: SimulationInstant) => `${instant.seconds}:${instant.nanoseconds}`;
    const sampleAt = (instant: SimulationInstant): SweptEncounterSample => {
      const sampleKey = key(instant);
      const existing = sampled.get(sampleKey);
      if (existing !== undefined) return existing;
      if (sampled.size >= maxSamples) {
        status = SweptEncounterBoundStatus.unbounded;
        return normalizedSample({ instant, position: { x: 0, y: 0, z: 0 }, certified: false });
      }
      const result = normalizedSample(value.sampleAt!(instant));
      if (compareSimulationInstants(result.instant, instant) !== 0) {
        throw new RangeError("sampleAt must return a sample at the requested exact instant");
      }
      sampled.set(sampleKey, result);
      samples.push(result);
      if (result.certified === false) status = SweptEncounterBoundStatus.unbounded;
      return result;
    };
    const visit = (start: SimulationInstant, end: SimulationInstant): void => {
      const left = sampleAt(start);
      const right = sampleAt(end);
      const middleInstant = midpoint(start, end);
      const middle = sampleAt(middleInstant);
      const maxError = Math.max(left.uncertaintyMeters ?? 0, right.uncertaintyMeters ?? 0, middle.uncertaintyMeters ?? 0);
      const span = subtractSimulationInstants(end, start);
      if (maxErrorMeters !== undefined && maxError > maxErrorMeters) {
        if (compareDurations(span, minimumWindowSpan) > 0 && sampled.size + 2 <= maxSamples) {
          visit(start, middleInstant);
          visit(middleInstant, end);
        } else {
          status = SweptEncounterBoundStatus.unbounded;
        }
      }
    };
    visit(interval.start, interval.end);
  } else {
    if (value.samples === undefined) throw new TypeError("Either samples or sampleAt must be supplied");
    if (value.samples.length > maxSamples) status = SweptEncounterBoundStatus.unbounded;
    for (const sampleValue of value.samples.slice(0, maxSamples)) {
      const sample = normalizedSample(sampleValue);
      samples.push(sample);
      if (sample.certified === false) status = SweptEncounterBoundStatus.unbounded;
      if (maxErrorMeters !== undefined && (sample.uncertaintyMeters ?? 0) > maxErrorMeters) status = SweptEncounterBoundStatus.unbounded;
    }
  }
  if (samples.length === 0) status = SweptEncounterBoundStatus.unbounded;
  return boundFromSamples(
    objectIdValue,
    domainId,
    interval,
    samples,
    broadPhaseDistanceMeters,
    status,
    value.dependencyRevisions,
    value.dependencyRevisionDigest,
  );
}

export function createEncounterBoundShard(value: EncounterBoundShardInput): EncounterBoundShard {
  if (typeof value !== "object" || value === null) throw new TypeError("Encounter bound shard must be an object");
  assertIdentifier(value.shardId, "shardId");
  assertIdentifier(value.domainId, "domainId");
  const bounds = value.bounds.map((bound) => {
    const normalized = createSweptEncounterBound(bound);
    if (normalized.domainId !== value.domainId) throw new RangeError("Shard bound domain does not match shard domain");
    return normalized;
  });
  bounds.sort((left, right) => compareObjectId(left.objectId, right.objectId)
    || compareSimulationInstants(left.interval.start, right.interval.start));
  return Object.freeze({ shardId: value.shardId, domainId: value.domainId, revision: normalizedRevision(value.revision, "shard revision"), bounds: Object.freeze(bounds) });
}

function intervalsOverlap(left: EncounterWindow, right: EncounterWindow): boolean {
  return compareSimulationInstants(left.start, right.end) < 0 && compareSimulationInstants(right.start, left.end) < 0;
}

function boundsOverlap(left: SweptEncounterBound, right: SweptEncounterBound): boolean {
  if (left.domainId !== right.domainId || !intervalsOverlap(left.interval, right.interval)) return false;
  if (left.status !== SweptEncounterBoundStatus.bounded || right.status !== SweptEncounterBoundStatus.bounded) return true;
  return left.min.x <= right.max.x && right.min.x <= left.max.x
    && left.min.y <= right.max.y && right.min.y <= left.max.y
    && left.min.z <= right.max.z && right.min.z <= left.max.z;
}

function intersection(left: EncounterWindow, right: EncounterWindow): EncounterWindow {
  const start = compareSimulationInstants(left.start, right.start) >= 0 ? left.start : right.start;
  const end = compareSimulationInstants(left.end, right.end) <= 0 ? left.end : right.end;
  return Object.freeze({ start, end });
}

interface IndexedBound {
  readonly key: string;
  readonly bound: SweptEncounterBound;
  readonly shardId?: string;
}

function boundKey(bound: SweptEncounterBound, suffix = ""): string {
  return `${bound.domainId}:${bound.objectId}:${bound.interval.start.seconds}:${bound.interval.start.nanoseconds}:${bound.interval.end.seconds}:${bound.interval.end.nanoseconds}:${suffix}`;
}

function candidateComparator(left: EncounterCandidate, right: EncounterCandidate): number {
  return compareObjectId(left.objectA, right.objectA)
    || compareObjectId(left.objectB, right.objectB)
    || compareText(left.domainId, right.domainId)
    || compareSimulationInstants(left.interval.start, right.interval.start)
    || compareSimulationInstants(left.interval.end, right.interval.end);
}

export class EncounterBroadPhaseIndex {
  readonly #bounds = new Map<string, IndexedBound>();
  readonly #shards = new Map<string, readonly string[]>();
  #overlapTests = 0;
  #queryCount = 0;
  #candidatePairs = 0;

  insert(value: SweptEncounterBoundInput | SweptEncounterBound): string {
    const bound = createSweptEncounterBound(value as SweptEncounterBoundInput);
    const key = boundKey(bound);
    this.#bounds.set(key, { key, bound });
    return key;
  }

  remove(key: string): boolean {
    return this.#bounds.delete(key);
  }

  publishShard(value: EncounterBoundShardInput | EncounterBoundShard): EncounterBoundShard {
    const shard = createEncounterBoundShard(value as EncounterBoundShardInput);
    const previous = this.#shards.get(shard.shardId);
    if (previous !== undefined) for (const key of previous) this.#bounds.delete(key);
    const keys = shard.bounds.map((bound) => {
      const key = boundKey(bound, shard.shardId);
      this.#bounds.set(key, { key, bound, shardId: shard.shardId });
      return key;
    });
    this.#shards.set(shard.shardId, Object.freeze(keys));
    return shard;
  }

  removeShard(shardId: string): boolean {
    assertIdentifier(shardId, "shardId");
    const keys = this.#shards.get(shardId);
    if (keys === undefined) return false;
    for (const key of keys) this.#bounds.delete(key);
    this.#shards.delete(shardId);
    return true;
  }

  listBounds(): readonly SweptEncounterBound[] {
    const result = [...this.#bounds.values()].map((entry) => entry.bound);
    result.sort((left, right) => compareText(left.domainId, right.domainId)
      || compareSimulationInstants(left.interval.start, right.interval.start)
      || compareObjectId(left.objectId, right.objectId));
    return Object.freeze(result);
  }

  queryOverlaps(value: SweptEncounterBoundInput | SweptEncounterBound): readonly SweptEncounterBound[] {
    const query = createSweptEncounterBound(value as SweptEncounterBoundInput);
    this.#queryCount += 1;
    const candidates = [...this.#bounds.values()]
      .filter((entry) => entry.bound.domainId === query.domainId
        && (query.status !== SweptEncounterBoundStatus.bounded
          || entry.bound.status !== SweptEncounterBoundStatus.bounded
          || entry.bound.min.x <= query.max.x))
      .sort((left, right) => left.bound.min.x - right.bound.min.x || compareText(left.key, right.key));
    const result: IndexedBound[] = [];
    for (const entry of candidates) {
      this.#overlapTests += 1;
      if (boundsOverlap(entry.bound, query)) result.push(entry);
    }
    result.sort((left, right) => compareObjectId(left.bound.objectId, right.bound.objectId) || compareText(left.key, right.key));
    return Object.freeze(result.map((entry) => entry.bound));
  }

  candidatePairs(options: { readonly pairEnabled?: (pair: EncounterPair) => boolean } = {}): readonly EncounterCandidate[] {
    this.#queryCount += 1;
    const byDomain = new Map<string, IndexedBound[]>();
    for (const entry of this.#bounds.values()) {
      const list = byDomain.get(entry.bound.domainId) ?? [];
      list.push(entry);
      byDomain.set(entry.bound.domainId, list);
    }
    const deduplicated = new Map<string, EncounterCandidate>();
    for (const [domainId, entries] of byDomain) {
      entries.sort((left, right) => left.bound.min.x - right.bound.min.x || compareText(left.key, right.key));
      const nonBoundedSuffix = new Array<boolean>(entries.length).fill(false);
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        nonBoundedSuffix[index] = entries[index]!.bound.status !== SweptEncounterBoundStatus.bounded
          || (index + 1 < entries.length && nonBoundedSuffix[index + 1]!);
      }
      for (let leftIndex = 0; leftIndex < entries.length; leftIndex += 1) {
        const left = entries[leftIndex]!;
        for (let rightIndex = leftIndex + 1; rightIndex < entries.length; rightIndex += 1) {
          const right = entries[rightIndex]!;
          if (right.bound.min.x > left.bound.max.x
            && left.bound.status === SweptEncounterBoundStatus.bounded
            && right.bound.status === SweptEncounterBoundStatus.bounded
            && !nonBoundedSuffix[rightIndex]!
          ) break;
          this.#overlapTests += 1;
          if (left.bound.objectId === right.bound.objectId || !boundsOverlap(left.bound, right.bound)) continue;
          const pair = compareObjectId(left.bound.objectId, right.bound.objectId) < 0
            ? { objectA: left.bound.objectId, objectB: right.bound.objectId }
            : { objectA: right.bound.objectId, objectB: left.bound.objectId };
          if (options.pairEnabled !== undefined && !options.pairEnabled(pair)) continue;
          const interval = intersection(left.bound.interval, right.bound.interval);
          const candidate: EncounterCandidate = Object.freeze({
            ...pair,
            domainId,
            interval,
            boundKeys: (compareText(left.key, right.key) < 0 ? [left.key, right.key] : [right.key, left.key]) as [string, string],
          });
          const pairKey = `${pair.objectA}:${pair.objectB}`;
          const previous = deduplicated.get(pairKey);
          if (previous === undefined || candidateComparator(candidate, previous) < 0) deduplicated.set(pairKey, candidate);
        }
      }
    }
    const result = [...deduplicated.values()].sort(candidateComparator);
    this.#candidatePairs += result.length;
    return Object.freeze(result);
  }

  diagnostics(): EncounterBroadPhaseDiagnostics {
    return Object.freeze({
      indexedBounds: this.#bounds.size,
      indexedDomains: new Set([...this.#bounds.values()].map((entry) => entry.bound.domainId)).size,
      indexedShards: this.#shards.size,
      overlapTests: this.#overlapTests,
      queryCount: this.#queryCount,
      candidatePairs: this.#candidatePairs,
    });
  }

  resetDiagnostics(): void {
    this.#overlapTests = 0;
    this.#queryCount = 0;
    this.#candidatePairs = 0;
  }
}

export const DeterministicEncounterBroadPhase = EncounterBroadPhaseIndex;
export const EncounterBoundIndex = EncounterBroadPhaseIndex;
