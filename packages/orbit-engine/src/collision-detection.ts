import type { DependencyRevision } from "./dependency.js";
import {
  buildConservativeSweptBound,
  type EncounterWindow,
  type SweptEncounterBound,
  type SweptEncounterSample,
} from "./broad-phase.js";
import {
  normalizeCollisionProfile,
  requireCollisionSphere,
  type CollisionProfile,
  type CollisionSphere,
} from "./collision.js";
import {
  normalizeRelativeStateSample,
  type RelativeStateSample,
  type RelativeStateSampleNormalized,
} from "./closest-approach.js";
import type { Vec3 } from "./frames.js";
import {
  compareDurations,
  compareSimulationInstants,
  duration,
  durationToSeconds,
  simulationInstant,
  subtractSimulationInstants,
  type Duration,
  type SimulationInstant,
} from "./time.js";

const NANOS_PER_SECOND = 1_000_000_000n;

export const CollisionContactPredictionStatus = Object.freeze({
  contact: "contact",
  noContact: "noContact",
  incomplete: "incomplete",
  failed: "failed",
} as const);

export type CollisionContactPredictionStatus =
  (typeof CollisionContactPredictionStatus)[keyof typeof CollisionContactPredictionStatus];

export const CollisionContactPredictionFailureReason = Object.freeze({
  budgetExceeded: "budgetExceeded",
  nonConvergent: "nonConvergent",
  invalidSource: "invalidSource",
} as const);

export type CollisionContactPredictionFailureReason =
  (typeof CollisionContactPredictionFailureReason)[keyof typeof CollisionContactPredictionFailureReason];

export interface CollisionRelativeStateSource {
  readonly sampleAt: (instant: SimulationInstant) => RelativeStateSample;
  readonly evaluateAtSeconds?: (secondsFromIntervalStart: number, intervalStart: SimulationInstant) => RelativeStateSample;
}

export interface CollisionDetectionInterval {
  readonly start: SimulationInstant;
  readonly end: SimulationInstant;
}

export interface CollisionSweptBoundBuildInput {
  readonly sphere: CollisionSphere;
  readonly profile: CollisionProfile;
  readonly interval: EncounterWindow | CollisionDetectionInterval;
  readonly domainId: string;
  readonly samples?: readonly SweptEncounterSample[];
  readonly sampleAt?: (instant: SimulationInstant) => SweptEncounterSample;
  readonly maxSamples: number;
  readonly minimumWindowSpan: Duration;
  readonly maxErrorMeters?: number;
  readonly dependencyRevisions?: readonly DependencyRevision[];
  readonly dependencyRevisionDigest?: string;
}

export interface CollisionContactBracket {
  readonly start: SimulationInstant;
  readonly end: SimulationInstant;
}

export interface CollisionContactPrediction {
  readonly exactContactInstant: SimulationInstant;
  readonly contactSample: RelativeStateSampleNormalized;
  readonly continuousBracket: CollisionContactBracket;
  readonly timeUncertainty: Duration;
  readonly separationUncertaintyMeters: number;
  readonly iterations: number;
  readonly quality: "refined";
}

export interface CollisionContactPredictionInput {
  readonly interval: CollisionDetectionInterval;
  readonly sphereA: CollisionSphere;
  readonly sphereB: CollisionSphere;
  readonly source: CollisionRelativeStateSource;
  readonly profile: CollisionProfile;
  readonly boundaries?: readonly SimulationInstant[];
  readonly modelErrorMeters?: number;
}

export interface CollisionContactPredictionResult {
  readonly status: CollisionContactPredictionStatus;
  readonly interval: CollisionDetectionInterval;
  readonly prediction?: CollisionContactPrediction;
  readonly evaluatedSamples: number;
  readonly subdivisions: number;
  readonly iterations: number;
  readonly failureReason?: CollisionContactPredictionFailureReason;
}

interface SearchState {
  readonly source: CollisionRelativeStateSource;
  readonly interval: CollisionDetectionInterval;
  readonly radiusSum: number;
  readonly distanceTolerance: number;
  readonly modelErrorMeters: number;
  readonly maxSubdivisions: number;
  readonly maxRootIterations: number;
  readonly timeTolerance: Duration;
  readonly samples: Map<string, RelativeStateSampleNormalized>;
  evaluations: number;
  subdivisions: number;
}

interface SearchNoContact {
  readonly kind: "noContact";
}

interface SearchIncomplete {
  readonly kind: "incomplete";
}

interface SearchBracket {
  readonly kind: "bracket";
  readonly left: RelativeStateSampleNormalized;
  readonly right: RelativeStateSampleNormalized;
}

type SearchResult = SearchNoContact | SearchIncomplete | SearchBracket;

interface RefinedRoot {
  readonly status: "converged" | "failed";
  readonly left: RelativeStateSampleNormalized;
  readonly right: RelativeStateSampleNormalized;
  readonly iterations: number;
}

function finite(value: number, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  return value;
}

function nonNegative(value: number, name: string): number {
  const result = finite(value, name);
  if (result < 0) throw new RangeError(`${name} must be non-negative`);
  return result === 0 ? 0 : result;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive safe integer`);
  return value;
}

function normalizedInterval(value: CollisionDetectionInterval): CollisionDetectionInterval {
  if (typeof value !== "object" || value === null) throw new TypeError("Collision detection interval must be an object");
  const start = simulationInstant(value.start.seconds, value.start.nanoseconds);
  const end = simulationInstant(value.end.seconds, value.end.nanoseconds);
  if (compareSimulationInstants(start, end) >= 0) throw new RangeError("Collision detection interval end must be after start");
  return Object.freeze({ start, end });
}

function instantNanoseconds(value: SimulationInstant): bigint {
  return BigInt(value.seconds) * NANOS_PER_SECOND + BigInt(value.nanoseconds);
}

function instantFromNanoseconds(value: bigint): SimulationInstant {
  return simulationInstant(Number(value / NANOS_PER_SECOND), Number(value % NANOS_PER_SECOND));
}

function midpoint(left: SimulationInstant, right: SimulationInstant): SimulationInstant {
  return instantFromNanoseconds((instantNanoseconds(left) + instantNanoseconds(right)) / 2n);
}

function secondsFrom(start: SimulationInstant, instant: SimulationInstant): number {
  return durationToSeconds(subtractSimulationInstants(instant, start));
}

function intervalDuration(interval: CollisionDetectionInterval): Duration {
  return subtractSimulationInstants(interval.end, interval.start);
}

function compareSampleInstant(sample: RelativeStateSampleNormalized, instant: SimulationInstant): void {
  if (compareSimulationInstants(sample.instant, instant) !== 0) {
    throw new RangeError("Collision relative-state source must return the requested exact instant");
  }
}

function normalizeBoundaries(interval: CollisionDetectionInterval, values: readonly SimulationInstant[] | undefined): readonly SimulationInstant[] {
  const boundaries = (values ?? []).map((value) => simulationInstant(value.seconds, value.nanoseconds));
  boundaries.sort(compareSimulationInstants);
  for (let index = 1; index < boundaries.length; index += 1) {
    if (compareSimulationInstants(boundaries[index - 1]!, boundaries[index]!) === 0) {
      throw new RangeError("Collision detection boundaries must be unique");
    }
  }
  return Object.freeze(boundaries.filter((value) => compareSimulationInstants(value, interval.start) > 0
    && compareSimulationInstants(value, interval.end) < 0));
}

function splitInterval(interval: CollisionDetectionInterval, boundaries: readonly SimulationInstant[] | undefined): readonly CollisionDetectionInterval[] {
  const cuts = [interval.start, ...normalizeBoundaries(interval, boundaries), interval.end];
  const result: CollisionDetectionInterval[] = [];
  for (let index = 0; index + 1 < cuts.length; index += 1) {
    result.push(Object.freeze({ start: cuts[index]!, end: cuts[index + 1]! }));
  }
  return Object.freeze(result);
}

function sampleAt(state: SearchState, instant: SimulationInstant): RelativeStateSampleNormalized {
  const key = `${instant.seconds}:${instant.nanoseconds}`;
  const existing = state.samples.get(key);
  if (existing !== undefined) return existing;
  const raw = state.source.evaluateAtSeconds === undefined
    ? state.source.sampleAt(instant)
    : state.source.evaluateAtSeconds(secondsFrom(state.interval.start, instant), state.interval.start);
  const normalized = normalizeRelativeStateSample(raw);
  compareSampleInstant(normalized, instant);
  state.samples.set(key, normalized);
  state.evaluations += 1;
  return normalized;
}

function positionNorm(value: Vec3<number>): number {
  return Math.hypot(value.x, value.y, value.z);
}

export function collisionSignedSphereSeparation(
  relativePosition: Vec3<number>,
  radiusA: number,
  radiusB: number,
): number {
  return positionNorm(relativePosition) - (nonNegative(radiusA, "radiusA") + nonNegative(radiusB, "radiusB"));
}

export function collisionSphereContactFunction(
  relativePosition: Vec3<number>,
  radiusA: number,
  radiusB: number,
): number {
  const radiusSum = nonNegative(radiusA, "radiusA") + nonNegative(radiusB, "radiusB");
  const distanceSquared = relativePosition.x ** 2 + relativePosition.y ** 2 + relativePosition.z ** 2;
  return distanceSquared - radiusSum ** 2;
}

function signedSeparation(sample: RelativeStateSampleNormalized, radiusSum: number): number {
  return collisionSignedSphereSeparation(sample.position, radiusSum, 0);
}

function contactWithinTolerance(sample: RelativeStateSampleNormalized, state: SearchState): boolean {
  return signedSeparation(sample, state.radiusSum) <= state.distanceTolerance;
}

function contactFunction(sample: RelativeStateSampleNormalized, radiusSum: number, distanceTolerance: number): number {
  return collisionSphereContactFunction(sample.position, radiusSum + distanceTolerance, 0);
}

function lowerSeparationBound(
  sample: RelativeStateSampleNormalized,
  interval: CollisionDetectionInterval,
  modelErrorMeters: number,
): number {
  const maxSeconds = Math.max(
    Math.abs(durationToSeconds(subtractSimulationInstants(sample.instant, interval.start))),
    Math.abs(durationToSeconds(subtractSimulationInstants(interval.end, sample.instant))),
  );
  const speed = positionNorm(sample.velocity) + sample.velocityUncertaintyMetersPerSecond;
  const acceleration = sample.accelerationBoundMetersPerSecondSquared;
  const reachable = speed * maxSeconds + 0.5 * acceleration * maxSeconds * maxSeconds;
  return Math.max(0, positionNorm(sample.position) - reachable - sample.positionUncertaintyMeters - modelErrorMeters);
}

function intervalHasCertifiedClearance(
  left: RelativeStateSampleNormalized,
  right: RelativeStateSampleNormalized,
  interval: CollisionDetectionInterval,
  state: SearchState,
): boolean {
  const middle = sampleAt(state, midpoint(interval.start, interval.end));
  const lower = Math.min(
    lowerSeparationBound(left, interval, state.modelErrorMeters),
    lowerSeparationBound(middle, interval, state.modelErrorMeters),
    lowerSeparationBound(right, interval, state.modelErrorMeters),
  );
  return lower > state.radiusSum + state.distanceTolerance;
}

function searchInterval(
  interval: CollisionDetectionInterval,
  left: RelativeStateSampleNormalized,
  right: RelativeStateSampleNormalized,
  state: SearchState,
): SearchResult {
  if (contactWithinTolerance(left, state)) return Object.freeze({ kind: "bracket", left, right: left });
  if (contactWithinTolerance(right, state)) return Object.freeze({ kind: "bracket", left, right });

  const middleInstant = midpoint(interval.start, interval.end);
  if (compareSimulationInstants(middleInstant, interval.start) === 0
    || compareSimulationInstants(middleInstant, interval.end) === 0) {
    return Object.freeze({ kind: "incomplete" });
  }
  const middle = sampleAt(state, middleInstant);
  const leftInterval = Object.freeze({ start: interval.start, end: middleInstant });
  const rightInterval = Object.freeze({ start: middleInstant, end: interval.end });
  const leftClear = intervalHasCertifiedClearance(left, middle, leftInterval, state);
  const rightClear = intervalHasCertifiedClearance(middle, right, rightInterval, state);

  if (!leftClear) {
    if (state.subdivisions >= state.maxSubdivisions
      || compareDurations(intervalDuration(leftInterval), state.timeTolerance) <= 0) {
      return Object.freeze({ kind: "incomplete" });
    }
    state.subdivisions += 1;
    const result = searchInterval(leftInterval, left, middle, state);
    if (result.kind !== "noContact") return result;
  }
  if (contactWithinTolerance(middle, state)) return Object.freeze({ kind: "bracket", left, right: middle });
  if (!rightClear) {
    if (state.subdivisions >= state.maxSubdivisions
      || compareDurations(intervalDuration(rightInterval), state.timeTolerance) <= 0) {
      return Object.freeze({ kind: "incomplete" });
    }
    state.subdivisions += 1;
    const result = searchInterval(rightInterval, middle, right, state);
    if (result.kind !== "noContact") return result;
  }
  return Object.freeze({ kind: "noContact" });
}

function exactInstantAtFraction(start: SimulationInstant, end: SimulationInstant, fraction: number): SimulationInstant {
  const startNanos = instantNanoseconds(start);
  const span = instantNanoseconds(end) - startNanos;
  return instantFromNanoseconds(startNanos + BigInt(Math.round(Number(span) * fraction)));
}

function refineBracket(
  bracket: SearchBracket,
  state: SearchState,
): RefinedRoot {
  let left = bracket.left;
  let right = bracket.right;
  let leftValue = contactFunction(left, state.radiusSum, state.distanceTolerance);
  let rightValue = contactFunction(right, state.radiusSum, state.distanceTolerance);
  if (leftValue <= 0) return Object.freeze({ status: "converged", left, right: left, iterations: 0 });
  if (rightValue > 0) return Object.freeze({ status: "failed", left, right, iterations: 0 });
  let iterations = 0;
  for (; iterations < state.maxRootIterations; iterations += 1) {
    const spanSeconds = durationToSeconds(subtractSimulationInstants(right.instant, left.instant));
    if (spanSeconds <= durationToSeconds(state.timeTolerance)) {
      return Object.freeze({ status: "converged", left, right, iterations });
    }
    const secantFraction = rightValue === leftValue ? 0.5 : -leftValue / (rightValue - leftValue);
    const fraction = Number.isFinite(secantFraction) && secantFraction > 0.1 && secantFraction < 0.9
      ? secantFraction
      : 0.5;
    const candidateInstant = exactInstantAtFraction(left.instant, right.instant, fraction);
    if (compareSimulationInstants(candidateInstant, left.instant) === 0
      || compareSimulationInstants(candidateInstant, right.instant) === 0) {
      return Object.freeze({ status: "converged", left, right, iterations });
    }
    const candidate = sampleAt(state, candidateInstant);
    const candidateValue = contactFunction(candidate, state.radiusSum, state.distanceTolerance);
    if (candidateValue <= 0) {
      right = candidate;
      rightValue = candidateValue;
    } else {
      left = candidate;
      leftValue = candidateValue;
    }
  }
  return Object.freeze({ status: "failed", left, right, iterations });
}

function earliestExactContact(
  root: RefinedRoot,
  state: SearchState,
): { readonly instant: SimulationInstant; readonly sample: RelativeStateSampleNormalized } | undefined {
  if (root.status !== "converged") return undefined;
  let leftNanos = instantNanoseconds(root.left.instant);
  let rightNanos = instantNanoseconds(root.right.instant);
  if (leftNanos === rightNanos) return Object.freeze({ instant: root.left.instant, sample: root.left });
  const rightSample = sampleAt(state, root.right.instant);
  if (!contactWithinTolerance(rightSample, state)) return undefined;
  let iterations = 0;
  while (rightNanos - leftNanos > 1n && iterations < state.maxRootIterations) {
    const middleNanos = (leftNanos + rightNanos) / 2n;
    const middleInstant = instantFromNanoseconds(middleNanos);
    const middleSample = sampleAt(state, middleInstant);
    if (contactWithinTolerance(middleSample, state)) rightNanos = middleNanos;
    else leftNanos = middleNanos;
    iterations += 1;
  }
  const instant = instantFromNanoseconds(rightNanos);
  const sample = sampleAt(state, instant);
  return contactWithinTolerance(sample, state) ? Object.freeze({ instant, sample }) : undefined;
}

function uncertaintyAt(
  sample: RelativeStateSampleNormalized,
  bracket: CollisionContactBracket,
  state: SearchState,
): number {
  const spanSeconds = durationToSeconds(subtractSimulationInstants(bracket.end, bracket.start));
  return sample.positionUncertaintyMeters
    + state.modelErrorMeters
    + (positionNorm(sample.velocity) + sample.velocityUncertaintyMetersPerSecond) * spanSeconds;
}

function makeState(profile: CollisionProfile, input: CollisionContactPredictionInput, sphereA: CollisionSphere, sphereB: CollisionSphere): SearchState {
  return {
    source: input.source,
    interval: input.interval,
    radiusSum: sphereA.collisionBoundingRadiusMeters! + sphereB.collisionBoundingRadiusMeters!,
    distanceTolerance: profile.contactDistanceToleranceMeters,
    modelErrorMeters: input.modelErrorMeters === undefined ? 0 : nonNegative(input.modelErrorMeters, "modelErrorMeters"),
    maxSubdivisions: profile.maxCandidateSubdivisions,
    maxRootIterations: profile.maxRootIterations,
    timeTolerance: profile.contactTimeTolerance,
    samples: new Map(),
    evaluations: 0,
    subdivisions: 0,
  };
}

export function buildCollisionSweptBound(value: CollisionSweptBoundBuildInput): SweptEncounterBound {
  if (typeof value !== "object" || value === null) throw new TypeError("Collision swept-bound input must be an object");
  const sphere = requireCollisionSphere(value.sphere);
  const profile = normalizeCollisionProfile(value.profile);
  const interval = normalizedInterval(value.interval);
  const broadPhaseMarginMeters = nonNegative(profile.broadPhaseMarginMeters, "broadPhaseMarginMeters");
  return buildConservativeSweptBound({
    objectId: sphere.objectId,
    interval,
    domainId: value.domainId,
    samples: value.samples,
    sampleAt: value.sampleAt,
    maxSamples: value.maxSamples,
    minimumWindowSpan: value.minimumWindowSpan,
    maxErrorMeters: value.maxErrorMeters,
    broadPhaseDistanceMeters: sphere.collisionBoundingRadiusMeters + broadPhaseMarginMeters,
    dependencyRevisions: value.dependencyRevisions,
    dependencyRevisionDigest: value.dependencyRevisionDigest,
  });
}

export function predictCollisionContact(value: CollisionContactPredictionInput): CollisionContactPredictionResult {
  if (typeof value !== "object" || value === null) throw new TypeError("Collision contact prediction input must be an object");
  const interval = normalizedInterval(value.interval);
  const profile = normalizeCollisionProfile(value.profile);
  const sphereA = requireCollisionSphere(value.sphereA);
  const sphereB = requireCollisionSphere(value.sphereB);
  if (sphereA.objectId === sphereB.objectId) throw new RangeError("Collision prediction requires two distinct ObjectIds");
  if (typeof value.source?.sampleAt !== "function") throw new TypeError("Collision source.sampleAt must be a function");
  if (value.source.evaluateAtSeconds !== undefined && typeof value.source.evaluateAtSeconds !== "function") {
    throw new TypeError("Collision source.evaluateAtSeconds must be a function when supplied");
  }
  const state = makeState(profile, { ...value, interval }, sphereA, sphereB);
  let iterations = 0;
  for (const segment of splitInterval(interval, value.boundaries)) {
    const left = sampleAt(state, segment.start);
    const right = sampleAt(state, segment.end);
    const result = searchInterval(segment, left, right, state);
    if (result.kind === "incomplete") {
      return Object.freeze({
        status: CollisionContactPredictionStatus.incomplete,
        interval,
        evaluatedSamples: state.evaluations,
        subdivisions: state.subdivisions,
        iterations,
        failureReason: CollisionContactPredictionFailureReason.budgetExceeded,
      });
    }
    if (result.kind === "bracket") {
      const root = refineBracket(result, state);
      iterations += root.iterations;
      if (root.status === "failed") {
        return Object.freeze({
          status: CollisionContactPredictionStatus.failed,
          interval,
          evaluatedSamples: state.evaluations,
          subdivisions: state.subdivisions,
          iterations,
          failureReason: CollisionContactPredictionFailureReason.nonConvergent,
        });
      }
      const exact = earliestExactContact(root, state);
      if (exact === undefined) {
        return Object.freeze({
          status: CollisionContactPredictionStatus.incomplete,
          interval,
          evaluatedSamples: state.evaluations,
          subdivisions: state.subdivisions,
          iterations,
          failureReason: CollisionContactPredictionFailureReason.budgetExceeded,
        });
      }
      const bracket = Object.freeze({ start: root.left.instant, end: root.right.instant });
      const prediction: CollisionContactPrediction = Object.freeze({
        exactContactInstant: exact.instant,
        contactSample: exact.sample,
        continuousBracket: bracket,
        timeUncertainty: subtractSimulationInstants(bracket.end, bracket.start),
        separationUncertaintyMeters: uncertaintyAt(exact.sample, bracket, state),
        iterations,
        quality: "refined",
      });
      return Object.freeze({
        status: CollisionContactPredictionStatus.contact,
        interval,
        prediction,
        evaluatedSamples: state.evaluations,
        subdivisions: state.subdivisions,
        iterations,
      });
    }
  }
  return Object.freeze({
    status: CollisionContactPredictionStatus.noContact,
    interval,
    evaluatedSamples: state.evaluations,
    subdivisions: state.subdivisions,
    iterations,
  });
}
