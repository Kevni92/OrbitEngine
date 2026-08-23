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
import { meters, metersPerSecond, type Meters, type MetersPerSecond } from "./units.js";
import { vec3, type Vec3 } from "./frames.js";

const NANOS_PER_SECOND = 1_000_000_000n;

export const ClosestApproachSolveStatus = Object.freeze({
  converged: "converged",
  failed: "failed",
  incomplete: "incomplete",
} as const);

export type ClosestApproachSolveStatus = (typeof ClosestApproachSolveStatus)[keyof typeof ClosestApproachSolveStatus];

export const CoarseEncounterDecision = Object.freeze({
  reject: "reject",
  refine: "refine",
} as const);

export type CoarseEncounterDecision = (typeof CoarseEncounterDecision)[keyof typeof CoarseEncounterDecision];

export interface RelativeStateSample {
  readonly instant: SimulationInstant;
  readonly position: Vec3<number>;
  readonly velocity: Vec3<number>;
  readonly positionUncertaintyMeters?: number;
  readonly velocityUncertaintyMetersPerSecond?: number;
  readonly accelerationBoundMetersPerSecondSquared?: number;
}

export interface RelativeStateSampleNormalized {
  readonly instant: SimulationInstant;
  readonly position: Vec3<Meters>;
  readonly velocity: Vec3<MetersPerSecond>;
  readonly positionUncertaintyMeters: Meters;
  readonly velocityUncertaintyMetersPerSecond: MetersPerSecond;
  readonly accelerationBoundMetersPerSecondSquared: number;
}

export interface RelativeStateSource {
  readonly sampleAt: (instant: SimulationInstant) => RelativeStateSample;
  readonly evaluateAtSeconds?: (secondsFromIntervalStart: number, intervalStart: SimulationInstant) => RelativeStateSample;
}

export interface ClosestApproachInterval {
  readonly start: SimulationInstant;
  readonly end: SimulationInstant;
}

export interface CoarseClosestApproachInput {
  readonly interval: ClosestApproachInterval;
  readonly source: RelativeStateSource;
  readonly refineDistanceMeters: number;
  readonly distanceToleranceMeters: number;
  readonly maxSamples: number;
  readonly modelErrorMeters?: number;
}

export interface CoarseClosestApproachResult {
  readonly decision: CoarseEncounterDecision;
  readonly interval: ClosestApproachInterval;
  readonly sampledMinimumDistanceMeters: Meters;
  readonly lowerDistanceBoundMeters: Meters;
  readonly upperDistanceBoundMeters: Meters;
  readonly uncertaintyMeters: Meters;
  readonly sampledMinimumInstant: SimulationInstant;
  readonly samples: readonly RelativeStateSampleNormalized[];
  readonly reason: "minimumPossibleDistanceExceedsRefineThreshold" | "uncertaintyRequiresRefinement" | "coarseBudgetExceeded";
}

export interface ClosestApproachMinimum {
  readonly instant: SimulationInstant;
  readonly distanceMeters: Meters;
  readonly continuousTimeSecondsFromIntervalStart: number;
  readonly bracket: ClosestApproachInterval;
  readonly timeUncertainty: Duration;
  readonly distanceUncertaintyMeters: Meters;
  readonly iterations: number;
}

export interface RefinedClosestApproachInput {
  readonly interval: ClosestApproachInterval;
  readonly source: RelativeStateSource;
  readonly closestApproachTimeTolerance: Duration;
  readonly closestApproachDistanceToleranceMeters: number;
  readonly maxRefinementIntervals: number;
  readonly maxSolverIterations: number;
  readonly maxPublishedMinima: number;
  readonly boundaries?: readonly SimulationInstant[];
  readonly gZeroTolerance?: number;
  readonly modelErrorMeters?: number;
}

export interface RefinedClosestApproachResult {
  readonly status: ClosestApproachSolveStatus;
  readonly minima: readonly ClosestApproachMinimum[];
  readonly interval: ClosestApproachInterval;
  readonly evaluatedIntervals: number;
  readonly iterations: number;
  readonly failureReason?: "budgetExceeded" | "nonConvergent" | "invalidSource" | "multipleMinimaOverflow";
}

function finite(value: number, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  return value;
}

function nonNegative(value: number, name: string): number {
  const result = finite(value, name);
  if (result < 0) throw new RangeError(`${name} must be non-negative`);
  return result;
}

function positive(value: number, name: string): number {
  const result = finite(value, name);
  if (result <= 0) throw new RangeError(`${name} must be positive`);
  return result;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive safe integer`);
  return value;
}

function normalizedInterval(value: ClosestApproachInterval): ClosestApproachInterval {
  if (typeof value !== "object" || value === null) throw new TypeError("Closest-approach interval must be an object");
  const start = simulationInstant(value.start.seconds, value.start.nanoseconds);
  const end = simulationInstant(value.end.seconds, value.end.nanoseconds);
  if (compareSimulationInstants(start, end) >= 0) throw new RangeError("Closest-approach interval end must be after start");
  return Object.freeze({ start, end });
}

function normalizedDuration(value: Duration, name: string): Duration {
  if (typeof value !== "object" || value === null) throw new TypeError(`${name} must be a Duration`);
  return duration(value.seconds, value.nanoseconds);
}

function normalizedPositiveDuration(value: Duration, name: string): Duration {
  const result = normalizedDuration(value, name);
  if (compareDurations(result, duration(0)) <= 0) throw new RangeError(`${name} must be positive`);
  return result;
}

function normalizedVector(value: Vec3<number>, name: string): Vec3<number> {
  if (typeof value !== "object" || value === null) throw new TypeError(`${name} must be a vector`);
  return vec3(finite(value.x, `${name}.x`), finite(value.y, `${name}.y`), finite(value.z, `${name}.z`));
}

export function normalizeRelativeStateSample(value: RelativeStateSample): RelativeStateSampleNormalized {
  if (typeof value !== "object" || value === null) throw new TypeError("Relative state sample must be an object");
  return Object.freeze({
    instant: simulationInstant(value.instant.seconds, value.instant.nanoseconds),
    position: (() => { const v = normalizedVector(value.position, "position"); return vec3(meters(v.x), meters(v.y), meters(v.z)); })(),
    velocity: (() => { const v = normalizedVector(value.velocity, "velocity"); return vec3(metersPerSecond(v.x), metersPerSecond(v.y), metersPerSecond(v.z)); })(),
    positionUncertaintyMeters: meters(nonNegative(value.positionUncertaintyMeters ?? 0, "positionUncertaintyMeters")),
    velocityUncertaintyMetersPerSecond: metersPerSecond(nonNegative(value.velocityUncertaintyMetersPerSecond ?? 0, "velocityUncertaintyMetersPerSecond")),
    accelerationBoundMetersPerSecondSquared: nonNegative(value.accelerationBoundMetersPerSecondSquared ?? 0, "accelerationBoundMetersPerSecondSquared"),
  });
}

function nanos(value: SimulationInstant): bigint {
  return BigInt(value.seconds) * NANOS_PER_SECOND + BigInt(value.nanoseconds);
}

function instantFromNanos(value: bigint): SimulationInstant {
  return simulationInstant(Number(value / NANOS_PER_SECOND), Number(value % NANOS_PER_SECOND));
}

function instantAtFraction(start: SimulationInstant, end: SimulationInstant, fraction: number): SimulationInstant {
  const startNanos = nanos(start);
  const span = nanos(end) - startNanos;
  const offset = BigInt(Math.round(Number(span) * fraction));
  return instantFromNanos(startNanos + offset);
}

function secondsFrom(start: SimulationInstant, instant: SimulationInstant): number {
  return durationToSeconds(subtractSimulationInstants(instant, start));
}

function evaluate(source: RelativeStateSource, interval: ClosestApproachInterval, seconds: number, exactInstant?: SimulationInstant): RelativeStateSampleNormalized {
  const result = source.evaluateAtSeconds === undefined
    ? source.sampleAt(exactInstant ?? addDurationToInstant(interval.start, duration(seconds)))
    : source.evaluateAtSeconds(seconds, interval.start);
  const normalized = normalizeRelativeStateSample(result);
  return normalized;
}

function distanceSquared(value: RelativeStateSampleNormalized): number {
  return value.position.x ** 2 + value.position.y ** 2 + value.position.z ** 2;
}

function distance(value: RelativeStateSampleNormalized): number {
  return Math.sqrt(distanceSquared(value));
}

function g(value: RelativeStateSampleNormalized): number {
  return value.position.x * value.velocity.x + value.position.y * value.velocity.y + value.position.z * value.velocity.z;
}

function hermitePosition(left: RelativeStateSampleNormalized, right: RelativeStateSampleNormalized, t: number, spanSeconds: number): Vec3<number> {
  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  return vec3(
    h00 * left.position.x + h10 * spanSeconds * left.velocity.x + h01 * right.position.x + h11 * spanSeconds * right.velocity.x,
    h00 * left.position.y + h10 * spanSeconds * left.velocity.y + h01 * right.position.y + h11 * spanSeconds * right.velocity.y,
    h00 * left.position.z + h10 * spanSeconds * left.velocity.z + h01 * right.position.z + h11 * spanSeconds * right.velocity.z,
  );
}

export function solveCoarseClosestApproach(value: CoarseClosestApproachInput): CoarseClosestApproachResult {
  const interval = normalizedInterval(value.interval);
  const refineDistanceMeters = positive(value.refineDistanceMeters, "refineDistanceMeters");
  const distanceToleranceMeters = positive(value.distanceToleranceMeters, "distanceToleranceMeters");
  const maxSamples = positiveInteger(value.maxSamples, "maxSamples");
  if (maxSamples < 3) throw new RangeError("coarse maxSamples must include endpoint and midpoint samples");
  if (typeof value.source?.sampleAt !== "function") throw new TypeError("coarse source.sampleAt must be a function");
  const spanSeconds = secondsFrom(interval.start, interval.end);
  const samples: RelativeStateSampleNormalized[] = [];
  const sampleCount = Math.min(maxSamples, Math.max(3, maxSamples));
  for (let index = 0; index < sampleCount; index += 1) {
    const fraction = sampleCount === 1 ? 0 : index / (sampleCount - 1);
    const instant = instantAtFraction(interval.start, interval.end, fraction);
    const sample = evaluate(value.source, interval, spanSeconds * fraction, instant);
    if (compareSimulationInstants(sample.instant, instant) !== 0) throw new RangeError("coarse source returned the wrong exact instant");
    samples.push(sample);
  }
  let sampledIndex = 0;
  let sampledMinimumSquared = Number.POSITIVE_INFINITY;
  for (let index = 0; index < samples.length; index += 1) {
    const valueSquared = distanceSquared(samples[index]!);
    if (valueSquared < sampledMinimumSquared) {
      sampledMinimumSquared = valueSquared;
      sampledIndex = index;
    }
  }
  const left = samples[0]!;
  const right = samples[samples.length - 1]!;
  let modelMinimumSquared = sampledMinimumSquared;
  let modelMinimumFraction = sampledIndex / Math.max(1, samples.length - 1);
  const modelSamples = Math.max(64, samples.length * 8);
  for (let index = 0; index <= modelSamples; index += 1) {
    const fraction = index / modelSamples;
    const position = hermitePosition(left, right, fraction, spanSeconds);
    const valueSquared = position.x ** 2 + position.y ** 2 + position.z ** 2;
    if (valueSquared < modelMinimumSquared) {
      modelMinimumSquared = valueSquared;
      modelMinimumFraction = fraction;
    }
  }
  let residual = 0;
  for (let index = 1; index + 1 < samples.length; index += 1) {
    const fraction = index / (samples.length - 1);
    const approximation = hermitePosition(left, right, fraction, spanSeconds);
    const actual = samples[index]!.position;
    residual = Math.max(residual, Math.hypot(actual.x - approximation.x, actual.y - approximation.y, actual.z - approximation.z));
  }
  const modelErrorMeters = value.modelErrorMeters === undefined ? 0 : nonNegative(value.modelErrorMeters, "modelErrorMeters");
  const sourceError = Math.max(...samples.map((sample) => sample.positionUncertaintyMeters));
  const accelerationBound = Math.max(...samples.map((sample) => sample.accelerationBoundMetersPerSecondSquared));
  const curvatureError = 0.5 * accelerationBound * spanSeconds * spanSeconds;
  const uncertaintyMeters = modelErrorMeters + sourceError + residual + curvatureError + distanceToleranceMeters;
  const sampledMinimumDistanceMeters = Math.sqrt(modelMinimumSquared);
  const lowerDistanceBoundMeters = meters(Math.max(0, sampledMinimumDistanceMeters - uncertaintyMeters));
  const upperDistanceBoundMeters = meters(sampledMinimumDistanceMeters + uncertaintyMeters);
  const decision = lowerDistanceBoundMeters > refineDistanceMeters
    ? CoarseEncounterDecision.reject
    : CoarseEncounterDecision.refine;
  return Object.freeze({
    decision,
    interval,
    sampledMinimumDistanceMeters: meters(sampledMinimumDistanceMeters),
    lowerDistanceBoundMeters,
    upperDistanceBoundMeters,
    uncertaintyMeters: meters(uncertaintyMeters),
    sampledMinimumInstant: instantAtFraction(interval.start, interval.end, modelMinimumFraction),
    samples: Object.freeze(samples),
    reason: decision === CoarseEncounterDecision.reject
      ? "minimumPossibleDistanceExceedsRefineThreshold"
      : uncertaintyMeters > distanceToleranceMeters
        ? "uncertaintyRequiresRefinement"
        : "coarseBudgetExceeded",
  });
}

function splitAtBoundaries(interval: ClosestApproachInterval, boundaries: readonly SimulationInstant[] | undefined): readonly ClosestApproachInterval[] {
  const normalized = (boundaries ?? []).map((value) => simulationInstant(value.seconds, value.nanoseconds));
  normalized.sort(compareSimulationInstants);
  const cuts = [interval.start, ...normalized.filter((value) => compareSimulationInstants(value, interval.start) > 0 && compareSimulationInstants(value, interval.end) < 0), interval.end];
  const result: ClosestApproachInterval[] = [];
  for (let index = 0; index + 1 < cuts.length; index += 1) result.push(Object.freeze({ start: cuts[index]!, end: cuts[index + 1]! }));
  return Object.freeze(result);
}

interface RootBracket {
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly startValue: number;
  readonly endValue: number;
}

function signChange(left: number, right: number): boolean {
  return (left < 0 && right > 0) || (left > 0 && right < 0);
}

function rootInBracket(
  source: RelativeStateSource,
  interval: ClosestApproachInterval,
  bracket: RootBracket,
  timeToleranceSeconds: number,
  distanceToleranceMeters: number,
  maxIterations: number,
): { readonly seconds: number; readonly bracket: RootBracket; readonly iterations: number; readonly converged: boolean } {
  let a = bracket.startSeconds;
  let b = bracket.endSeconds;
  let fa = bracket.startValue;
  let fb = bracket.endValue;
  let best = Math.abs(fa) <= Math.abs(fb) ? a : b;
  let bestValue = Math.min(Math.abs(fa), Math.abs(fb));
  let previousDistance = Number.POSITIVE_INFINITY;
  let iterations = 0;
  for (; iterations < maxIterations; iterations += 1) {
    const midpointSeconds = (a + b) / 2;
    const secant = fb === fa ? midpointSeconds : b - fb * (b - a) / (fb - fa);
    const candidate = Number.isFinite(secant) && secant > Math.min(a, b) && secant < Math.max(a, b)
      && Math.abs(secant - b) < Math.abs(b - a) * 0.75 ? secant : midpointSeconds;
    const value = evaluate(source, interval, candidate);
    const fc = g(value);
    const candidateDistance = distance(value);
    if (Math.abs(fc) < bestValue || (Math.abs(fc) === bestValue && candidate < best)) {
      best = candidate;
      bestValue = Math.abs(fc);
    }
    if (Math.abs(b - a) <= timeToleranceSeconds && Math.abs(candidateDistance - previousDistance) <= distanceToleranceMeters) {
      return Object.freeze({ seconds: best, bracket: Object.freeze({ startSeconds: Math.min(a, b), endSeconds: Math.max(a, b), startValue: fa, endValue: fb }), iterations: iterations + 1, converged: true });
    }
    previousDistance = candidateDistance;
    if (signChange(fa, fc) || fc === 0) {
      b = candidate;
      fb = fc;
    } else {
      a = candidate;
      fa = fc;
    }
  }
  return Object.freeze({ seconds: best, bracket: Object.freeze({ startSeconds: Math.min(a, b), endSeconds: Math.max(a, b), startValue: fa, endValue: fb }), iterations, converged: false });
}

function exactCandidates(interval: ClosestApproachInterval, rootSeconds: number, bracket: RootBracket): readonly SimulationInstant[] {
  const startNanos = nanos(interval.start);
  const rootNanos = startNanos + BigInt(Math.round(rootSeconds * 1_000_000_000));
  const bracketStart = startNanos + BigInt(Math.ceil(bracket.startSeconds * 1_000_000_000));
  const bracketEnd = startNanos + BigInt(Math.floor(bracket.endSeconds * 1_000_000_000));
  const candidates = new Set<string>();
  const add = (value: bigint) => {
    if (value < bracketStart || value > bracketEnd) return;
    const instant = instantFromNanos(value);
    candidates.add(`${instant.seconds}:${instant.nanoseconds}`);
  };
  add(rootNanos - 1n);
  add(rootNanos);
  add(rootNanos + 1n);
  add(bracketStart);
  add(bracketEnd);
  if (candidates.size === 0) {
    const clamped = rootNanos < startNanos ? startNanos : rootNanos > nanos(interval.end) ? nanos(interval.end) : rootNanos;
    const instant = instantFromNanos(clamped);
    candidates.add(`${instant.seconds}:${instant.nanoseconds}`);
  }
  return Object.freeze([...candidates].map((value) => {
    const [seconds, nanoseconds] = value.split(":").map(Number);
    return simulationInstant(seconds!, nanoseconds!);
  }).sort(compareSimulationInstants));
}

function minimumForBracket(
  source: RelativeStateSource,
  interval: ClosestApproachInterval,
  seconds: number,
  bracket: RootBracket,
  iterations: number,
  modelErrorMeters: number,
): ClosestApproachMinimum {
  const candidates = exactCandidates(interval, seconds, bracket);
  let selected = candidates[0];
  let selectedDistance = Number.POSITIVE_INFINITY;
  for (const instant of candidates) {
    const sample = normalizeRelativeStateSample(source.sampleAt(instant));
    const value = distance(sample);
    if (value < selectedDistance || (value === selectedDistance && (selected === undefined || compareSimulationInstants(instant, selected) < 0))) {
      selected = instant;
      selectedDistance = value;
    }
  }
  if (selected === undefined) throw new RangeError("No exact candidate instant lies inside the final bracket");
  return Object.freeze({
    instant: selected,
    distanceMeters: meters(selectedDistance),
    continuousTimeSecondsFromIntervalStart: seconds,
    bracket: Object.freeze({
      start: addDurationToInstant(interval.start, duration(bracket.startSeconds)),
      end: addDurationToInstant(interval.start, duration(bracket.endSeconds)),
    }),
    timeUncertainty: duration(Math.max(0, bracket.endSeconds - bracket.startSeconds)),
    distanceUncertaintyMeters: meters(modelErrorMeters),
    iterations,
  });
}

export function refineClosestApproach(value: RefinedClosestApproachInput): RefinedClosestApproachResult {
  const interval = normalizedInterval(value.interval);
  const timeTolerance = normalizedPositiveDuration(value.closestApproachTimeTolerance, "closestApproachTimeTolerance");
  const timeToleranceSeconds = durationToSeconds(timeTolerance);
  const distanceToleranceMeters = positive(value.closestApproachDistanceToleranceMeters, "closestApproachDistanceToleranceMeters");
  const maxRefinementIntervals = positiveInteger(value.maxRefinementIntervals, "maxRefinementIntervals");
  const maxSolverIterations = positiveInteger(value.maxSolverIterations, "maxSolverIterations");
  const maxPublishedMinima = positiveInteger(value.maxPublishedMinima, "maxPublishedMinima");
  const gZeroTolerance = value.gZeroTolerance === undefined ? distanceToleranceMeters : positive(value.gZeroTolerance, "gZeroTolerance");
  const modelErrorMeters = value.modelErrorMeters === undefined ? 0 : nonNegative(value.modelErrorMeters, "modelErrorMeters");
  if (typeof value.source?.sampleAt !== "function") throw new TypeError("refined source.sampleAt must be a function");
  const segments = splitAtBoundaries(interval, value.boundaries);
  const brackets: Array<{ interval: ClosestApproachInterval; bracket: RootBracket }> = [];
  let evaluatedIntervals = 0;
  let budgetExceeded = false;
  for (const segment of segments) {
    const segmentSeconds = secondsFrom(segment.start, segment.end);
    const count = Math.max(2, Math.floor(maxRefinementIntervals / segments.length));
    for (let index = 0; index < count; index += 1) {
      if (evaluatedIntervals >= maxRefinementIntervals) { budgetExceeded = true; break; }
      const startFraction = index / count;
      const endFraction = (index + 1) / count;
      const startSeconds = segmentSeconds * startFraction;
      const endSeconds = segmentSeconds * endFraction;
      const left = evaluate(value.source, segment, startSeconds, instantAtFraction(segment.start, segment.end, startFraction));
      const right = evaluate(value.source, segment, endSeconds, instantAtFraction(segment.start, segment.end, endFraction));
      evaluatedIntervals += 1;
      const leftG = g(left);
      const rightG = g(right);
      const localInterval = Object.freeze({ startSeconds, endSeconds, startValue: leftG, endValue: rightG });
      if (signChange(leftG, rightG) || Math.abs(leftG) <= gZeroTolerance || Math.abs(rightG) <= gZeroTolerance) {
        brackets.push({ interval: segment, bracket: localInterval });
      } else {
        const middleSeconds = (startSeconds + endSeconds) / 2;
        const middle = evaluate(value.source, segment, middleSeconds, instantAtFraction(segment.start, segment.end, (startFraction + endFraction) / 2));
        const middleG = g(middle);
        if (Math.abs(middleG) <= gZeroTolerance
          && distance(middle) <= Math.min(distance(left), distance(right))) {
          brackets.push({ interval: segment, bracket: Object.freeze({ startSeconds, endSeconds, startValue: leftG, endValue: rightG }) });
        }
      }
    }
    if (budgetExceeded) break;
  }

  const minima: ClosestApproachMinimum[] = [];
  let iterations = 0;
  let failed = false;
  for (const entry of brackets) {
    const root = rootInBracket(value.source, entry.interval, entry.bracket, timeToleranceSeconds, distanceToleranceMeters, maxSolverIterations);
    iterations += root.iterations;
    if (!root.converged) failed = true;
    minima.push(minimumForBracket(value.source, entry.interval, root.seconds, root.bracket, root.iterations, modelErrorMeters));
  }
  for (const segment of segments) {
    const startSample = normalizeRelativeStateSample(value.source.sampleAt(segment.start));
    const endSample = normalizeRelativeStateSample(value.source.sampleAt(segment.end));
    const endpoints = [
      Object.freeze({ instant: segment.start, distanceMeters: meters(distance(startSample)), continuousTimeSecondsFromIntervalStart: secondsFrom(interval.start, segment.start), bracket: segment, timeUncertainty: duration(0), distanceUncertaintyMeters: meters(modelErrorMeters), iterations: 0 }),
      Object.freeze({ instant: segment.end, distanceMeters: meters(distance(endSample)), continuousTimeSecondsFromIntervalStart: secondsFrom(interval.start, segment.end), bracket: segment, timeUncertainty: duration(0), distanceUncertaintyMeters: meters(modelErrorMeters), iterations: 0 }),
    ];
    minima.push(...endpoints);
  }
  minima.sort((left, right) => compareSimulationInstants(left.instant, right.instant) || left.distanceMeters - right.distanceMeters);
  const unique: ClosestApproachMinimum[] = [];
  for (const minimum of minima) {
    if (!unique.some((existing) => compareSimulationInstants(existing.instant, minimum.instant) === 0)) unique.push(minimum);
  }
  const overflow = unique.length > maxPublishedMinima;
  const selected = unique.slice(0, maxPublishedMinima);
  const status = overflow || budgetExceeded
    ? ClosestApproachSolveStatus.incomplete
    : failed
      ? ClosestApproachSolveStatus.failed
      : ClosestApproachSolveStatus.converged;
  return Object.freeze({
    status,
    minima: Object.freeze(selected),
    interval,
    evaluatedIntervals,
    iterations,
    ...(overflow ? { failureReason: "multipleMinimaOverflow" as const } : budgetExceeded ? { failureReason: "budgetExceeded" as const } : failed ? { failureReason: "nonConvergent" as const } : {}),
  });
}

export const coarseClosestApproach = solveCoarseClosestApproach;
export const solveRefinedClosestApproach = refineClosestApproach;
