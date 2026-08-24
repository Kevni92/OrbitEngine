import { objectId, type ObjectId } from "./objects.js";
import type { FrameNode } from "./frame-registry.js";
import { referenceFrameId, type ReferenceFrameId, type Vec3 } from "./frames.js";
import type { Maneuver } from "./maneuver.js";
import { revisionId, type RevisionId } from "./propagation.js";
import type { ObjectRecord } from "./registry.js";
import {
  addDurationToInstant,
  compareDurations,
  compareSimulationInstants,
  duration,
  simulationInstant,
  subtractSimulationInstants,
  type Duration,
  type SimulationInstant,
} from "./time.js";
import type { PropagationState } from "./propagation.js";
import { encodeLambertGeometryWire } from "./internal/planner-wire.js";

export interface PlannerGeometryWire {
  readonly version: number;
  readonly words: readonly number[];
  readonly resultWords?: readonly number[];
}

export const TrajectoryPurpose = Object.freeze({
  intercept: "intercept",
  rendezvous: "rendezvous",
  flyby: "flyby",
} as const);
export type TrajectoryPurpose = (typeof TrajectoryPurpose)[keyof typeof TrajectoryPurpose];

export const TrajectoryMotionSense = Object.freeze({ prograde: "prograde", retrograde: "retrograde" } as const);
export type TrajectoryMotionSense = (typeof TrajectoryMotionSense)[keyof typeof TrajectoryMotionSense];

export const TrajectoryPath = Object.freeze({ shortWay: "shortWay", longWay: "longWay" } as const);
export type TrajectoryPath = (typeof TrajectoryPath)[keyof typeof TrajectoryPath];

export const TrajectoryRankingMetric = Object.freeze({
  minimumTotalDeltaV: "minimumTotalDeltaV",
  minimumDepartureDeltaV: "minimumDepartureDeltaV",
  minimumArrivalDeltaV: "minimumArrivalDeltaV",
  minimumTimeOfFlight: "minimumTimeOfFlight",
} as const);
export type TrajectoryRankingMetric = (typeof TrajectoryRankingMetric)[keyof typeof TrajectoryRankingMetric];

export const PlannerDependencyKind = Object.freeze({
  motion: "motion",
  property: "property",
  source: "source",
  ephemeris: "ephemeris",
  frame: "frame",
  provider: "provider",
  maneuver: "maneuver",
  solver: "solver",
} as const);
export type PlannerDependencyKind = (typeof PlannerDependencyKind)[keyof typeof PlannerDependencyKind];

export type PlannerVector = Vec3<number>;

export interface LambertBranch {
  readonly motionSense: TrajectoryMotionSense;
  readonly path: TrajectoryPath;
  readonly revolutions: number;
  readonly referenceNormal: PlannerVector;
}

export interface LambertSolverConfiguration {
  readonly relativeTimeOfFlightTolerance: number;
  readonly velocityToleranceMetersPerSecond: number;
  readonly maxIterations: number;
  readonly minimumGeometryScaleMeters: number;
}

export const DEFAULT_LAMBERT_SOLVER_CONFIGURATION: LambertSolverConfiguration = Object.freeze({
  relativeTimeOfFlightTolerance: 1e-12,
  velocityToleranceMetersPerSecond: 1e-9,
  maxIterations: 64,
  minimumGeometryScaleMeters: 1,
});

export interface TrajectoryTimeInterval {
  readonly start: SimulationInstant;
  readonly end: SimulationInstant;
}

export interface TrajectoryValidityIntervals {
  readonly source?: TrajectoryTimeInterval;
  readonly target?: TrajectoryTimeInterval;
  readonly centralBody?: TrajectoryTimeInterval;
  readonly planningFrame?: TrajectoryTimeInterval;
}

export interface TrajectoryConstraints {
  readonly minimumTimeOfFlight?: Duration;
  readonly maximumTimeOfFlight?: Duration;
  readonly maximumDepartureDeltaV?: number;
  readonly maximumArrivalDeltaV?: number;
  readonly maximumTotalDeltaV?: number;
  readonly allowedCentralBodyIds?: readonly ObjectId[];
  readonly allowedPlanningFrameIds?: readonly ReferenceFrameId[];
  readonly minimumCentralBodyClearanceMeters?: number;
  readonly validityIntervals?: TrajectoryValidityIntervals;
}

export interface NormalizedTrajectoryConstraints {
  readonly minimumTimeOfFlight?: Duration;
  readonly maximumTimeOfFlight?: Duration;
  readonly maximumDepartureDeltaV?: number;
  readonly maximumArrivalDeltaV?: number;
  readonly maximumTotalDeltaV?: number;
  readonly allowedCentralBodyIds: readonly ObjectId[];
  readonly allowedPlanningFrameIds: readonly ReferenceFrameId[];
  readonly minimumCentralBodyClearanceMeters?: number;
  readonly validityIntervals: TrajectoryValidityIntervals;
}

export interface TrajectoryTransferRequest {
  readonly sourceObjectId: ObjectId;
  readonly targetObjectId: ObjectId;
  readonly centralBodyId: ObjectId;
  readonly planningFrameId: ReferenceFrameId;
  readonly departure: SimulationInstant;
  readonly arrival: SimulationInstant;
  readonly branch: LambertBranch;
  readonly purpose: TrajectoryPurpose;
  readonly constraints?: TrajectoryConstraints;
  readonly solverConfiguration?: Partial<LambertSolverConfiguration>;
}

export interface NormalizedTrajectoryTransferRequest extends Omit<TrajectoryTransferRequest, "constraints" | "solverConfiguration"> {
  readonly timeOfFlight: Duration;
  readonly constraints: NormalizedTrajectoryConstraints;
  readonly solverConfiguration: LambertSolverConfiguration;
}

export interface LambertGeometryRequest {
  readonly centralBodyId: ObjectId;
  readonly planningFrameId: ReferenceFrameId;
  readonly mu: number;
  readonly departurePosition: PlannerVector;
  readonly arrivalPosition: PlannerVector;
  readonly timeOfFlight: Duration;
  readonly branch: LambertBranch;
  readonly solverConfiguration?: Partial<LambertSolverConfiguration>;
  readonly provenanceDigest?: RevisionId;
}

export interface NormalizedLambertGeometryRequest extends Omit<LambertGeometryRequest, "solverConfiguration" | "provenanceDigest"> {
  readonly solverConfiguration: LambertSolverConfiguration;
  readonly provenancePresent: boolean;
  readonly provenanceDigest?: RevisionId;
}

export const LambertGeometryResultStatus = Object.freeze({
  success: "success",
  invalidInput: "invalidInput",
  invalidMu: "invalidMu",
  unsupportedRevolutionCount: "unsupportedRevolutionCount",
  invalidBranch: "invalidBranch",
  degenerateGeometry: "degenerateGeometry",
  nonConvergent: "nonConvergent",
  numericalFailure: "numericalFailure",
} as const);
export type LambertGeometryResultStatus = (typeof LambertGeometryResultStatus)[keyof typeof LambertGeometryResultStatus];

export interface LambertGeometrySolution {
  readonly transferDepartureVelocity: PlannerVector;
  readonly transferArrivalVelocity: PlannerVector;
  readonly residual: number;
  readonly iterations: number;
  readonly periapsisRadiusMeters?: number;
  readonly semiMajorAxisMeters?: number;
  readonly eccentricity?: number;
}

export type LambertGeometryResult =
  | { readonly status: "success"; readonly request: NormalizedLambertGeometryRequest; readonly solution: LambertGeometrySolution }
  | { readonly status: Exclude<LambertGeometryResultStatus, "success">; readonly request: NormalizedLambertGeometryRequest; readonly iterations: number; readonly residual: number };

export interface TrajectorySearchBudget {
  readonly maxLambertSolves?: number;
  readonly maxCoarseCells?: number;
  readonly maxRefinementSeeds?: number;
  readonly maxRefinementIterationsPerSeed?: number;
  readonly maxReturnedCandidates?: number;
}

export interface NormalizedTrajectorySearchBudget {
  readonly maxLambertSolves: number;
  readonly maxCoarseCells: number;
  readonly maxRefinementSeeds: number;
  readonly maxRefinementIterationsPerSeed: number;
  readonly maxReturnedCandidates: number;
}

export interface TrajectorySearchRequest {
  readonly sourceObjectId: ObjectId;
  readonly targetObjectId: ObjectId;
  readonly centralBodyId: ObjectId;
  readonly planningFrameId: ReferenceFrameId;
  readonly departureWindow: TrajectoryTimeInterval;
  readonly arrivalWindow?: TrajectoryTimeInterval;
  readonly timeOfFlightRange?: TrajectoryDurationRange;
  readonly branchSet: readonly LambertBranch[];
  readonly purpose: TrajectoryPurpose;
  readonly constraints?: TrajectoryConstraints;
  readonly solverConfiguration?: Partial<LambertSolverConfiguration>;
  readonly rankingMetric?: TrajectoryRankingMetric;
  readonly searchBudget?: TrajectorySearchBudget;
  readonly sampling?: TrajectorySearchSampling;
}

export interface TrajectorySearchSampling {
  readonly departureSamples?: number;
  readonly arrivalSamples?: number;
  readonly timeOfFlightSamples?: number;
}

export interface NormalizedTrajectorySearchSampling {
  readonly departureSamples: number;
  readonly arrivalSamples: number;
  readonly timeOfFlightSamples: number;
}

export interface TrajectoryDurationRange {
  readonly minimum: Duration;
  readonly maximum: Duration;
}

export interface NormalizedTrajectorySearchRequest extends Omit<TrajectorySearchRequest, "constraints" | "solverConfiguration" | "rankingMetric" | "searchBudget" | "branchSet" | "sampling"> {
  readonly branchSet: readonly LambertBranch[];
  readonly constraints: NormalizedTrajectoryConstraints;
  readonly solverConfiguration: LambertSolverConfiguration;
  readonly rankingMetric: TrajectoryRankingMetric;
  readonly searchBudget: NormalizedTrajectorySearchBudget;
  readonly sampling: NormalizedTrajectorySearchSampling;
}

export interface TrajectorySearchOptions {
  readonly signal?: AbortSignal;
  readonly includeGrid?: boolean;
}

export const TrajectorySearchStatus = Object.freeze({
  completed: "completed",
  budgetExceeded: "budgetExceeded",
  cancelled: "cancelled",
} as const);
export type TrajectorySearchStatus = (typeof TrajectorySearchStatus)[keyof typeof TrajectorySearchStatus];

export const TrajectorySearchCellStatus = Object.freeze({
  feasible: "feasible",
  infeasible: "infeasible",
  unavailable: "unavailable",
  solverFailure: "solverFailure",
} as const);
export type TrajectorySearchCellStatus = (typeof TrajectorySearchCellStatus)[keyof typeof TrajectorySearchCellStatus];

export interface TrajectorySearchGridSample {
  readonly departure: SimulationInstant;
  readonly arrival: SimulationInstant;
  readonly branch: LambertBranch;
  readonly status: TrajectorySearchCellStatus;
  readonly totalDeltaV?: number;
  readonly planDigest?: RevisionId;
}

export interface TrajectorySearchDiagnostics {
  readonly status: TrajectorySearchStatus;
  readonly lambertSolves: number;
  readonly coarseCellsEvaluated: number;
  readonly refinementSeeds: number;
  readonly refinementIterations: number;
  readonly returnedCandidates: number;
  readonly partialCoverage: boolean;
}

export interface TrajectorySearchResult {
  readonly status: TrajectorySearchStatus;
  readonly request: NormalizedTrajectorySearchRequest;
  readonly candidates: readonly TrajectoryPlan[];
  readonly diagnostics: TrajectorySearchDiagnostics;
  readonly grid?: readonly TrajectorySearchGridSample[];
}

export interface PlannerDependencyIdentity {
  readonly kind: PlannerDependencyKind;
  readonly id: string;
  readonly revision: RevisionId;
}

export interface PlannerDependencyChange {
  readonly expected?: PlannerDependencyIdentity;
  readonly actual?: PlannerDependencyIdentity;
}

export interface PlannerStalenessResult {
  readonly status: "current" | "stale";
  readonly dependencyDigest?: RevisionId;
  readonly changedDependencies: readonly PlannerDependencyChange[];
}

export interface TrajectoryEndpointState {
  readonly epoch: SimulationInstant;
  readonly position: PlannerVector;
  readonly velocity: PlannerVector;
}

export interface ImpulsiveLambertLeg {
  readonly kind: "impulsiveLambert";
  readonly departure: SimulationInstant;
  readonly arrival: SimulationInstant;
  readonly centralBodyId: ObjectId;
  readonly planningFrameId: ReferenceFrameId;
  readonly muUsed: number;
  readonly branch: LambertBranch;
  readonly revolutions: 0;
  readonly transferDepartureVelocity: PlannerVector;
  readonly transferArrivalVelocity: PlannerVector;
  readonly departureDeltaVelocity: PlannerVector;
  readonly arrivalRelativeVelocity: PlannerVector;
  readonly arrivalDeltaVelocity?: PlannerVector;
  readonly totalDeltaV: number;
  readonly periapsisRadiusMeters?: number;
  readonly solverResidual: number;
  readonly solverIterations: number;
}

export type TrajectoryLeg = ImpulsiveLambertLeg;

export interface TrajectoryConstraintEvaluation {
  readonly feasible: boolean;
  readonly rejectedBy?: readonly string[];
}

export interface TrajectoryPlanQuality {
  readonly rankingMetric?: TrajectoryRankingMetric;
  readonly primaryScore?: number;
}

export interface TrajectoryPlanInput {
  readonly request: TrajectoryTransferRequest;
  readonly legs: readonly TrajectoryLeg[];
  readonly dependencies?: readonly PlannerDependencyIdentity[];
  readonly departureStateUsed?: TrajectoryEndpointState;
  readonly targetArrivalStateUsed?: TrajectoryEndpointState;
  readonly assumptions?: readonly string[];
  readonly constraintsEvaluation?: TrajectoryConstraintEvaluation;
  readonly quality?: TrajectoryPlanQuality;
}

export interface TrajectoryPlan {
  readonly digest: RevisionId;
  readonly purpose: TrajectoryPurpose;
  readonly sourceObjectId: ObjectId;
  readonly targetObjectId: ObjectId;
  readonly departure: SimulationInstant;
  readonly arrival: SimulationInstant;
  readonly request: NormalizedTrajectoryTransferRequest;
  readonly legs: readonly TrajectoryLeg[];
  readonly departureStateUsed?: TrajectoryEndpointState;
  readonly targetArrivalStateUsed?: TrajectoryEndpointState;
  readonly dependencies: readonly PlannerDependencyIdentity[];
  readonly dependencyDigest?: RevisionId;
  readonly assumptions: readonly string[];
  readonly constraintsEvaluation: TrajectoryConstraintEvaluation;
  readonly quality: TrajectoryPlanQuality;
}

/** Read-only authoritative inputs used by engine-bound transfer planning. */
export interface TrajectoryPlannerContext {
  readonly objectAt: (id: ObjectId) => ObjectRecord;
  readonly stateAt: (id: ObjectId, target: SimulationInstant, outputFrame: ReferenceFrameId) => PropagationState;
  readonly frameAt: (id: ReferenceFrameId) => FrameNode;
  readonly rootFrameId?: () => ReferenceFrameId;
  readonly maneuversForObject?: (id: ObjectId) => readonly Maneuver[];
}

export const TrajectoryPlanningResultStatus = Object.freeze({
  success: "success",
  stateUnavailable: "stateUnavailable",
  invalidPlanningFrame: "invalidPlanningFrame",
  missingMu: "missingMu",
  solverFailure: "solverFailure",
  constraintRejected: "constraintRejected",
} as const);
export type TrajectoryPlanningResultStatus = (typeof TrajectoryPlanningResultStatus)[keyof typeof TrajectoryPlanningResultStatus];

export interface TrajectoryPlanningSuccess {
  readonly status: "success";
  readonly plan: TrajectoryPlan;
}

export interface TrajectoryPlanningStateUnavailable {
  readonly status: "stateUnavailable";
  readonly request: NormalizedTrajectoryTransferRequest;
  readonly reason: string;
  readonly objectId?: ObjectId;
}

export interface TrajectoryPlanningInvalidFrame {
  readonly status: "invalidPlanningFrame";
  readonly request: NormalizedTrajectoryTransferRequest;
  readonly reason: string;
  readonly frameId: ReferenceFrameId;
}

export interface TrajectoryPlanningMissingMu {
  readonly status: "missingMu";
  readonly request: NormalizedTrajectoryTransferRequest;
  readonly reason: string;
  readonly centralBodyId: ObjectId;
}

export interface TrajectoryPlanningSolverFailure {
  readonly status: "solverFailure";
  readonly request: NormalizedTrajectoryTransferRequest;
  readonly solver: LambertGeometryResult | PlannerUnsupportedResult<NormalizedLambertGeometryRequest>;
}

export interface TrajectoryPlanningConstraintRejected {
  readonly status: "constraintRejected";
  readonly request: NormalizedTrajectoryTransferRequest;
  readonly plan: TrajectoryPlan;
  readonly rejectedBy: readonly string[];
}

export type TrajectoryPlanningResult =
  | TrajectoryPlanningSuccess
  | TrajectoryPlanningStateUnavailable
  | TrajectoryPlanningInvalidFrame
  | TrajectoryPlanningMissingMu
  | TrajectoryPlanningSolverFailure
  | TrajectoryPlanningConstraintRejected;

export interface PlannerUnsupportedResult<TRequest> {
  readonly status: "unsupported";
  readonly reason: "lambertSolverNotImplemented" | "plannerStateAccessUnavailable";
  readonly request: TRequest;
}

export interface PlannerBackendCodec {
  roundTripPlanner(value: PlannerGeometryWire): PlannerGeometryWire;
  readonly roundTripPlannerBatch?: (values: readonly PlannerGeometryWire[]) => readonly PlannerGeometryWire[];
}

export interface PlannerValidationConfig {
  readonly maxPositionErrorMeters?: number;
  readonly maxVelocityErrorMetersPerSecond?: number;
}

export interface ImpulsivePlanApplyOptions {
  readonly allowStale?: false;
}

function finite(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  return value;
}

function nonNegative(value: unknown, name: string): number {
  const result = finite(value, name);
  if (result < 0) throw new RangeError(`${name} must be non-negative`);
  return result;
}

function positive(value: unknown, name: string): number {
  const result = finite(value, name);
  if (result <= 0) throw new RangeError(`${name} must be positive`);
  return result;
}

function integer(value: unknown, name: string, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be an integer in [${minimum}, ${maximum}]`);
  }
  return value;
}

function vector(value: unknown, name: string): PlannerVector {
  if (typeof value !== "object" || value === null) throw new TypeError(`${name} must be a vector`);
  const candidate = value as Record<string, unknown>;
  const result = { x: finite(candidate.x, `${name}.x`), y: finite(candidate.y, `${name}.y`), z: finite(candidate.z, `${name}.z`) };
  return Object.freeze(result);
}

function unitVector(value: unknown, name: string): PlannerVector {
  const result = vector(value, name);
  const norm = Math.hypot(result.x, result.y, result.z);
  if (!(norm > 0) || !Number.isFinite(norm)) throw new RangeError(`${name} must be non-zero`);
  return Object.freeze({ x: result.x / norm, y: result.y / norm, z: result.z / norm });
}

function instant(value: unknown, name: string): SimulationInstant {
  if (typeof value !== "object" || value === null) throw new TypeError(`${name} must be a SimulationInstant`);
  const candidate = value as SimulationInstant;
  return Object.freeze({ seconds: integer(candidate.seconds, `${name}.seconds`, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER), nanoseconds: integer(candidate.nanoseconds, `${name}.nanoseconds`, 0, 999_999_999) }) as SimulationInstant;
}

function positiveDuration(value: unknown, name: string): Duration {
  const result = duration((value as Duration).seconds, (value as Duration).nanoseconds);
  if (compareDurations(result, duration(0)) <= 0) throw new RangeError(`${name} must be positive`);
  return result;
}

function interval(value: unknown, name: string): TrajectoryTimeInterval {
  if (typeof value !== "object" || value === null) throw new TypeError(`${name} must be an interval`);
  const candidate = value as Record<string, unknown>;
  const start = instant(candidate.start, `${name}.start`);
  const end = instant(candidate.end, `${name}.end`);
  if (compareSimulationInstants(start, end) >= 0) throw new RangeError(`${name}.end must be later than start`);
  return Object.freeze({ start, end });
}

function contains(intervalValue: TrajectoryTimeInterval, value: SimulationInstant): boolean {
  return compareSimulationInstants(intervalValue.start, value) <= 0 && compareSimulationInstants(value, intervalValue.end) <= 0;
}

function durationRange(value: unknown, name: string): TrajectoryDurationRange {
  if (typeof value !== "object" || value === null) throw new TypeError(`${name} must be a duration range`);
  const candidate = value as Record<string, unknown>;
  const minimum = positiveDuration(candidate.minimum, `${name}.minimum`);
  const maximum = positiveDuration(candidate.maximum, `${name}.maximum`);
  if (compareDurations(minimum, maximum) > 0) throw new RangeError(`${name}.minimum must not exceed maximum`);
  return Object.freeze({ minimum, maximum });
}

function branch(value: unknown, name = "branch"): LambertBranch {
  if (typeof value !== "object" || value === null) throw new TypeError(`${name} must be an object`);
  const candidate = value as Record<string, unknown>;
  if (candidate.motionSense !== "prograde" && candidate.motionSense !== "retrograde") throw new RangeError(`${name}.motionSense is invalid`);
  if (candidate.path !== "shortWay" && candidate.path !== "longWay") throw new RangeError(`${name}.path is invalid`);
  const revolutions = integer(candidate.revolutions, `${name}.revolutions`, 0, 65_535);
  return Object.freeze({ motionSense: candidate.motionSense, path: candidate.path, revolutions, referenceNormal: unitVector(candidate.referenceNormal, `${name}.referenceNormal`) });
}

function solverConfiguration(value: Partial<LambertSolverConfiguration> | undefined): LambertSolverConfiguration {
  const candidate = value ?? {};
  return Object.freeze({
    relativeTimeOfFlightTolerance: positive(candidate.relativeTimeOfFlightTolerance ?? DEFAULT_LAMBERT_SOLVER_CONFIGURATION.relativeTimeOfFlightTolerance, "relativeTimeOfFlightTolerance"),
    velocityToleranceMetersPerSecond: positive(candidate.velocityToleranceMetersPerSecond ?? DEFAULT_LAMBERT_SOLVER_CONFIGURATION.velocityToleranceMetersPerSecond, "velocityToleranceMetersPerSecond"),
    maxIterations: integer(candidate.maxIterations ?? DEFAULT_LAMBERT_SOLVER_CONFIGURATION.maxIterations, "maxIterations", 1, 4096),
    minimumGeometryScaleMeters: positive(candidate.minimumGeometryScaleMeters ?? DEFAULT_LAMBERT_SOLVER_CONFIGURATION.minimumGeometryScaleMeters, "minimumGeometryScaleMeters"),
  });
}

function idList<T extends string>(values: readonly string[] | undefined, name: string, normalize: (value: string) => T): readonly T[] {
  const result = [...(values ?? [])].map((value) => normalize(value)).sort();
  for (let index = 1; index < result.length; index += 1) if (result[index] === result[index - 1]) throw new RangeError(`${name} contains duplicate IDs`);
  return Object.freeze(result);
}

function compareText(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function normalizeConstraints(value: TrajectoryConstraints | undefined): NormalizedTrajectoryConstraints {
  const candidate = value ?? {};
  const minimumTimeOfFlight = candidate.minimumTimeOfFlight === undefined ? undefined : positiveDuration(candidate.minimumTimeOfFlight, "minimumTimeOfFlight");
  const maximumTimeOfFlight = candidate.maximumTimeOfFlight === undefined ? undefined : positiveDuration(candidate.maximumTimeOfFlight, "maximumTimeOfFlight");
  if (minimumTimeOfFlight && maximumTimeOfFlight && compareDurations(minimumTimeOfFlight, maximumTimeOfFlight) > 0) throw new RangeError("minimumTimeOfFlight must not exceed maximumTimeOfFlight");
  const validityCandidate = candidate.validityIntervals ?? {};
  const validityIntervals = Object.freeze({
    ...(validityCandidate.source === undefined ? {} : { source: interval(validityCandidate.source, "validityIntervals.source") }),
    ...(validityCandidate.target === undefined ? {} : { target: interval(validityCandidate.target, "validityIntervals.target") }),
    ...(validityCandidate.centralBody === undefined ? {} : { centralBody: interval(validityCandidate.centralBody, "validityIntervals.centralBody") }),
    ...(validityCandidate.planningFrame === undefined ? {} : { planningFrame: interval(validityCandidate.planningFrame, "validityIntervals.planningFrame") }),
  });
  return Object.freeze({
    ...(minimumTimeOfFlight === undefined ? {} : { minimumTimeOfFlight }),
    ...(maximumTimeOfFlight === undefined ? {} : { maximumTimeOfFlight }),
    ...(candidate.maximumDepartureDeltaV === undefined ? {} : { maximumDepartureDeltaV: nonNegative(candidate.maximumDepartureDeltaV, "maximumDepartureDeltaV") }),
    ...(candidate.maximumArrivalDeltaV === undefined ? {} : { maximumArrivalDeltaV: nonNegative(candidate.maximumArrivalDeltaV, "maximumArrivalDeltaV") }),
    ...(candidate.maximumTotalDeltaV === undefined ? {} : { maximumTotalDeltaV: nonNegative(candidate.maximumTotalDeltaV, "maximumTotalDeltaV") }),
    allowedCentralBodyIds: idList(candidate.allowedCentralBodyIds, "allowedCentralBodyIds", (value) => objectId(value)),
    allowedPlanningFrameIds: idList(candidate.allowedPlanningFrameIds, "allowedPlanningFrameIds", (value) => referenceFrameId(value)),
    ...(candidate.minimumCentralBodyClearanceMeters === undefined ? {} : { minimumCentralBodyClearanceMeters: positive(candidate.minimumCentralBodyClearanceMeters, "minimumCentralBodyClearanceMeters") }),
    validityIntervals,
  });
}

export function normalizeLambertBranch(value: LambertBranch): LambertBranch { return branch(value); }

export function normalizeLambertSolverConfiguration(value?: Partial<LambertSolverConfiguration>): LambertSolverConfiguration { return solverConfiguration(value); }

export function normalizeTrajectoryConstraints(value?: TrajectoryConstraints): NormalizedTrajectoryConstraints { return normalizeConstraints(value); }

export function normalizeLambertGeometryRequest(value: LambertGeometryRequest): NormalizedLambertGeometryRequest {
  if (typeof value !== "object" || value === null) throw new TypeError("LambertGeometryRequest must be an object");
  const candidate = value as LambertGeometryRequest;
  const centralBodyId = objectId(candidate.centralBodyId);
  const planningFrameId = referenceFrameId(candidate.planningFrameId);
  const mu = positive(candidate.mu, "mu");
  const timeOfFlight = positiveDuration(candidate.timeOfFlight, "timeOfFlight");
  const normalizedProvenance = candidate.provenanceDigest === undefined ? undefined : revisionId(candidate.provenanceDigest);
  return Object.freeze({
    centralBodyId,
    planningFrameId,
    mu,
    departurePosition: vector(candidate.departurePosition, "departurePosition"),
    arrivalPosition: vector(candidate.arrivalPosition, "arrivalPosition"),
    timeOfFlight,
    branch: branch(candidate.branch),
    solverConfiguration: solverConfiguration(candidate.solverConfiguration),
    provenancePresent: normalizedProvenance !== undefined,
    ...(normalizedProvenance === undefined ? {} : { provenanceDigest: normalizedProvenance }),
  });
}

function decodeLambertGeometryResult(request: NormalizedLambertGeometryRequest, value: PlannerGeometryWire): LambertGeometryResult {
  const result = value.resultWords;
  if (result === undefined || result.length === 0) throw new RangeError("planner backend did not return a Lambert result packet");
  const code = result[0] ?? -1;
  const statusByCode: readonly LambertGeometryResultStatus[] = ["success", "invalidInput", "invalidMu", "unsupportedRevolutionCount", "invalidBranch", "degenerateGeometry", "nonConvergent", "numericalFailure"];
  const status = Number.isInteger(code) && code >= 0 && code < statusByCode.length ? statusByCode[code]! : "numericalFailure";
  const iterations = integer(result[1], "Lambert result iterations", 0, 4096);
  const residual = nonNegative(result[2], "Lambert result residual");
  if (status !== "success") return Object.freeze({ status, request, iterations, residual });
  const departureVelocity = vector({ x: result[3], y: result[4], z: result[5] }, "Lambert result departure velocity");
  const arrivalVelocity = vector({ x: result[6], y: result[7], z: result[8] }, "Lambert result arrival velocity");
  const periapsis = result[9] !== 0 ? positive(result[10], "Lambert result periapsis radius") : undefined;
  const semiMajorAxis = result[11] === 0 ? undefined : finite(result[11], "Lambert result semi-major axis");
  const eccentricity = result[12] === 0 ? undefined : nonNegative(result[12], "Lambert result eccentricity");
  return Object.freeze({ status: "success", request, solution: Object.freeze({ transferDepartureVelocity: departureVelocity, transferArrivalVelocity: arrivalVelocity, residual, iterations, ...(periapsis === undefined ? {} : { periapsisRadiusMeters: periapsis }), ...(semiMajorAxis === undefined ? {} : { semiMajorAxisMeters: semiMajorAxis }), ...(eccentricity === undefined ? {} : { eccentricity }) }) });
}

export function normalizeTrajectoryTransferRequest(value: TrajectoryTransferRequest): NormalizedTrajectoryTransferRequest {
  if (typeof value !== "object" || value === null) throw new TypeError("TrajectoryTransferRequest must be an object");
  const candidate = value as TrajectoryTransferRequest;
  const sourceObjectId = objectId(candidate.sourceObjectId);
  const targetObjectId = objectId(candidate.targetObjectId);
  if (sourceObjectId === targetObjectId) throw new RangeError("sourceObjectId and targetObjectId must differ");
  const centralBodyId = objectId(candidate.centralBodyId);
  const planningFrameId = referenceFrameId(candidate.planningFrameId);
  const departure = instant(candidate.departure, "departure");
  const arrival = instant(candidate.arrival, "arrival");
  if (compareSimulationInstants(arrival, departure) <= 0) throw new RangeError("arrival must be strictly later than departure");
  if (candidate.purpose !== "intercept" && candidate.purpose !== "rendezvous" && candidate.purpose !== "flyby") throw new RangeError("purpose is invalid");
  const timeOfFlight = subtractSimulationInstants(arrival, departure);
  const constraints = normalizeConstraints(candidate.constraints);
  if (constraints.minimumTimeOfFlight && compareDurations(timeOfFlight, constraints.minimumTimeOfFlight) < 0) throw new RangeError("request timeOfFlight is below minimumTimeOfFlight");
  if (constraints.maximumTimeOfFlight && compareDurations(timeOfFlight, constraints.maximumTimeOfFlight) > 0) throw new RangeError("request timeOfFlight exceeds maximumTimeOfFlight");
  if (constraints.allowedCentralBodyIds.length > 0 && !constraints.allowedCentralBodyIds.includes(centralBodyId)) throw new RangeError("centralBodyId is not allowed by constraints");
  if (constraints.allowedPlanningFrameIds.length > 0 && !constraints.allowedPlanningFrameIds.includes(planningFrameId)) throw new RangeError("planningFrameId is not allowed by constraints");
  const validity = constraints.validityIntervals;
  if (validity.source && !contains(validity.source, departure)) throw new RangeError("departure is outside validityIntervals.source");
  if (validity.target && !contains(validity.target, arrival)) throw new RangeError("arrival is outside validityIntervals.target");
  if (validity.centralBody && (!contains(validity.centralBody, departure) || !contains(validity.centralBody, arrival))) throw new RangeError("request is outside validityIntervals.centralBody");
  if (validity.planningFrame && (!contains(validity.planningFrame, departure) || !contains(validity.planningFrame, arrival))) throw new RangeError("request is outside validityIntervals.planningFrame");
  return Object.freeze({ sourceObjectId, targetObjectId, centralBodyId, planningFrameId, departure, arrival, timeOfFlight, branch: branch(candidate.branch), purpose: candidate.purpose, constraints, solverConfiguration: solverConfiguration(candidate.solverConfiguration) });
}

const DEFAULT_SEARCH_BUDGET: NormalizedTrajectorySearchBudget = Object.freeze({ maxLambertSolves: 100_000, maxCoarseCells: 100_000, maxRefinementSeeds: 1024, maxRefinementIterationsPerSeed: 128, maxReturnedCandidates: 256 });
const DEFAULT_SEARCH_SAMPLING: NormalizedTrajectorySearchSampling = Object.freeze({ departureSamples: 8, arrivalSamples: 8, timeOfFlightSamples: 8 });

function searchBudget(value: TrajectorySearchBudget | undefined): NormalizedTrajectorySearchBudget {
  const candidate = value ?? {};
  return Object.freeze({
    maxLambertSolves: integer(candidate.maxLambertSolves ?? DEFAULT_SEARCH_BUDGET.maxLambertSolves, "maxLambertSolves", 1, 100_000),
    maxCoarseCells: integer(candidate.maxCoarseCells ?? DEFAULT_SEARCH_BUDGET.maxCoarseCells, "maxCoarseCells", 1, 100_000),
    maxRefinementSeeds: integer(candidate.maxRefinementSeeds ?? DEFAULT_SEARCH_BUDGET.maxRefinementSeeds, "maxRefinementSeeds", 1, 100_000),
    maxRefinementIterationsPerSeed: integer(candidate.maxRefinementIterationsPerSeed ?? DEFAULT_SEARCH_BUDGET.maxRefinementIterationsPerSeed, "maxRefinementIterationsPerSeed", 1, 4096),
    maxReturnedCandidates: integer(candidate.maxReturnedCandidates ?? DEFAULT_SEARCH_BUDGET.maxReturnedCandidates, "maxReturnedCandidates", 1, 256),
  });
}

function searchSampling(value: TrajectorySearchSampling | undefined): NormalizedTrajectorySearchSampling {
  const candidate = value ?? {};
  return Object.freeze({
    departureSamples: integer(candidate.departureSamples ?? DEFAULT_SEARCH_SAMPLING.departureSamples, "departureSamples", 1, 100_000),
    arrivalSamples: integer(candidate.arrivalSamples ?? DEFAULT_SEARCH_SAMPLING.arrivalSamples, "arrivalSamples", 1, 100_000),
    timeOfFlightSamples: integer(candidate.timeOfFlightSamples ?? DEFAULT_SEARCH_SAMPLING.timeOfFlightSamples, "timeOfFlightSamples", 1, 100_000),
  });
}

export function normalizeTrajectorySearchRequest(value: TrajectorySearchRequest): NormalizedTrajectorySearchRequest {
  if (typeof value !== "object" || value === null) throw new TypeError("TrajectorySearchRequest must be an object");
  const candidate = value as TrajectorySearchRequest;
  const sourceObjectId = objectId(candidate.sourceObjectId);
  const targetObjectId = objectId(candidate.targetObjectId);
  if (sourceObjectId === targetObjectId) throw new RangeError("sourceObjectId and targetObjectId must differ");
  const centralBodyId = objectId(candidate.centralBodyId);
  const planningFrameId = referenceFrameId(candidate.planningFrameId);
  const departureWindow = interval(candidate.departureWindow, "departureWindow");
  const arrivalWindow = candidate.arrivalWindow === undefined ? undefined : interval(candidate.arrivalWindow, "arrivalWindow");
  const timeOfFlightRange = candidate.timeOfFlightRange === undefined ? undefined : durationRange(candidate.timeOfFlightRange, "timeOfFlightRange");
  if (arrivalWindow === undefined && timeOfFlightRange === undefined) throw new RangeError("search requires arrivalWindow or timeOfFlightRange");
  if (candidate.purpose !== "intercept" && candidate.purpose !== "rendezvous" && candidate.purpose !== "flyby") throw new RangeError("purpose is invalid");
  if (!Array.isArray(candidate.branchSet) || candidate.branchSet.length === 0) throw new RangeError("branchSet must not be empty");
  const branches = candidate.branchSet.map((value, index) => branch(value, `branchSet[${index}]`));
  branches.sort((left, right) => compareText(canonical(left), canonical(right)));
  for (let index = 1; index < branches.length; index += 1) if (canonical(branches[index]) === canonical(branches[index - 1])) throw new RangeError("branchSet contains duplicates");
  const constraints = normalizeConstraints(candidate.constraints);
  if (constraints.allowedCentralBodyIds.length > 0 && !constraints.allowedCentralBodyIds.includes(centralBodyId)) throw new RangeError("centralBodyId is not allowed by constraints");
  if (constraints.allowedPlanningFrameIds.length > 0 && !constraints.allowedPlanningFrameIds.includes(planningFrameId)) throw new RangeError("planningFrameId is not allowed by constraints");
  const rankingMetric = candidate.rankingMetric ?? TrajectoryRankingMetric.minimumTotalDeltaV;
  if (!Object.values(TrajectoryRankingMetric).includes(rankingMetric)) throw new RangeError("rankingMetric is invalid");
  return Object.freeze({ sourceObjectId, targetObjectId, centralBodyId, planningFrameId, departureWindow, ...(arrivalWindow === undefined ? {} : { arrivalWindow }), ...(timeOfFlightRange === undefined ? {} : { timeOfFlightRange }), branchSet: Object.freeze(branches), purpose: candidate.purpose, constraints, solverConfiguration: solverConfiguration(candidate.solverConfiguration), rankingMetric, searchBudget: searchBudget(candidate.searchBudget), sampling: searchSampling(candidate.sampling) });
}

function normalizeDependency(value: PlannerDependencyIdentity): PlannerDependencyIdentity {
  if (typeof value !== "object" || value === null) throw new TypeError("Planner dependency must be an object");
  if (!Object.prototype.hasOwnProperty.call(PlannerDependencyKind, value.kind)) throw new RangeError(`Unknown planner dependency kind: ${String(value.kind)}`);
  if (typeof value.id !== "string" || value.id.trim().length === 0) throw new TypeError("Planner dependency id must be non-empty");
  return Object.freeze({ kind: value.kind, id: value.id, revision: revisionId(value.revision) });
}

function normalizeDependencies(values: readonly PlannerDependencyIdentity[] | undefined): readonly PlannerDependencyIdentity[] {
  const result = [...(values ?? [])].map(normalizeDependency).sort((left, right) => compareText(`${left.kind}:${left.id}`, `${right.kind}:${right.id}`));
  for (let index = 1; index < result.length; index += 1) if (`${result[index - 1]!.kind}:${result[index - 1]!.id}` === `${result[index]!.kind}:${result[index]!.id}`) throw new RangeError("Duplicate planner dependency identity");
  return Object.freeze(result);
}

function canonical(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") return Number.isFinite(value) ? JSON.stringify(value) : "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object") return `{${Object.keys(value as object).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(String(value));
}

function contentDigest(value: unknown): RevisionId {
  let hash = 14_695_981_039_346_656_037n;
  const text = canonical(value);
  for (const character of text) {
    hash ^= BigInt(character.codePointAt(0)!);
    hash = (hash * 1_099_511_628_211n) % 18_446_744_073_709_551_616n;
  }
  return revisionId(hash.toString());
}

const NEWTONIAN_GRAVITATIONAL_CONSTANT = 6.67430e-11;

function vectorDifference(left: PlannerVector, right: PlannerVector): PlannerVector {
  return Object.freeze({ x: left.x - right.x, y: left.y - right.y, z: left.z - right.z });
}

function vectorNegate(value: PlannerVector): PlannerVector {
  return Object.freeze({ x: -value.x, y: -value.y, z: -value.z });
}

function vectorMagnitude(value: PlannerVector): number {
  return Math.hypot(value.x, value.y, value.z);
}

function endpointFromState(value: PropagationState, expectedEpoch: SimulationInstant, expectedFrame: ReferenceFrameId, name: string): TrajectoryEndpointState {
  if (compareSimulationInstants(value.epoch, expectedEpoch) !== 0) throw new RangeError(`${name} returned a different exact epoch`);
  if (value.referenceFrame !== expectedFrame) throw new RangeError(`${name} returned a different reference frame`);
  return Object.freeze({ epoch: value.epoch, position: Object.freeze({ ...value.position }), velocity: Object.freeze({ ...value.velocity }) });
}

function dependencyRevision(value: string | undefined): RevisionId {
  return revisionId(value ?? "0");
}

function addDependency(
  result: PlannerDependencyIdentity[],
  keys: Set<string>,
  value: PlannerDependencyIdentity,
): void {
  const key = `${value.kind}:${value.id}`;
  if (keys.has(key)) return;
  keys.add(key);
  result.push(value);
}

function collectFrameDependencies(
  context: TrajectoryPlannerContext,
  frameId: ReferenceFrameId,
): { readonly dependencies: readonly PlannerDependencyIdentity[]; readonly invalidReason?: string } {
  const dependencies: PlannerDependencyIdentity[] = [];
  const keys = new Set<string>();
  const visited = new Set<ReferenceFrameId>();
  let current = frameId;
  while (true) {
    if (visited.has(current)) return Object.freeze({ dependencies, invalidReason: "planning frame parent cycle" });
    visited.add(current);
    const node = context.frameAt(current);
    if (node.provider.kind !== "staticRigid" && node.provider.kind !== "staticLocal") {
      return Object.freeze({ dependencies, invalidReason: `planning frame provider ${node.provider.kind} is not inertial` });
    }
    const providerRevision = dependencyRevision(node.provider.revision);
    addDependency(dependencies, keys, { kind: "frame", id: node.id, revision: providerRevision });
    addDependency(dependencies, keys, { kind: "provider", id: `${node.id}:provider`, revision: providerRevision });
    if (node.id === node.parent) break;
    current = node.parent;
  }
  return Object.freeze({ dependencies: Object.freeze(dependencies) });
}

function collectObjectDependencies(
  context: TrajectoryPlannerContext,
  records: readonly ObjectRecord[],
  sourceObjectId: ObjectId,
): readonly PlannerDependencyIdentity[] {
  const dependencies: PlannerDependencyIdentity[] = [];
  const keys = new Set<string>();
  for (const record of records) {
    addDependency(dependencies, keys, { kind: "motion", id: record.id, revision: record.motion.motionRevision });
    addDependency(dependencies, keys, { kind: "source", id: `${record.id}:state-source`, revision: record.motion.configurationRevision });
    addDependency(dependencies, keys, { kind: "property", id: `${record.id}:properties`, revision: record.propertyRevision });
    if (record.motion.modelKind === "referenceEphemeris") {
      addDependency(dependencies, keys, { kind: "ephemeris", id: `${record.id}:ephemeris`, revision: record.motion.configurationRevision });
    }
  }
  if (context.maneuversForObject !== undefined) {
    for (const maneuver of context.maneuversForObject(sourceObjectId)) {
      addDependency(dependencies, keys, { kind: "maneuver", id: maneuver.id, revision: maneuver.revision });
    }
  }
  return Object.freeze(dependencies);
}

function resolveMu(record: ObjectRecord): { readonly value?: number; readonly source: "property" | "mass" | "missing" | "invalid" } {
  if (record.properties.mu !== undefined) {
    return record.properties.mu > 0 && Number.isFinite(record.properties.mu)
      ? { value: record.properties.mu, source: "property" }
      : { source: "invalid" };
  }
  if (record.properties.mass !== undefined && record.properties.mass > 0 && Number.isFinite(record.properties.mass)) {
    const derived = record.properties.mass * NEWTONIAN_GRAVITATIONAL_CONSTANT;
    return Number.isFinite(derived) && derived > 0 ? { value: derived, source: "mass" } : { source: "invalid" };
  }
  return { source: "missing" };
}

export function plannerContentDigest(value: unknown): RevisionId {
  return contentDigest(value);
}

export function plannerDependencyDigest(values: readonly PlannerDependencyIdentity[] | undefined): RevisionId | undefined {
  const normalized = normalizeDependencies(values);
  return normalized.length === 0 ? undefined : contentDigest(normalized);
}

function endpointState(value: TrajectoryEndpointState | undefined, name: string): TrajectoryEndpointState | undefined {
  if (value === undefined) return undefined;
  return Object.freeze({ epoch: instant(value.epoch, `${name}.epoch`), position: vector(value.position, `${name}.position`), velocity: vector(value.velocity, `${name}.velocity`) });
}

function normalizeLeg(value: ImpulsiveLambertLeg): ImpulsiveLambertLeg {
  if (value.kind !== "impulsiveLambert") throw new RangeError("Unsupported trajectory leg kind");
  const departure = instant(value.departure, "leg.departure");
  const arrival = instant(value.arrival, "leg.arrival");
  if (compareSimulationInstants(arrival, departure) <= 0) throw new RangeError("leg.arrival must be later than leg.departure");
  const leg = {
    kind: value.kind, departure, arrival, centralBodyId: objectId(value.centralBodyId), planningFrameId: referenceFrameId(value.planningFrameId), muUsed: positive(value.muUsed, "leg.muUsed"), branch: branch(value.branch, "leg.branch"), revolutions: integer(value.revolutions, "leg.revolutions", 0, 0) as 0,
    transferDepartureVelocity: vector(value.transferDepartureVelocity, "leg.transferDepartureVelocity"), transferArrivalVelocity: vector(value.transferArrivalVelocity, "leg.transferArrivalVelocity"), departureDeltaVelocity: vector(value.departureDeltaVelocity, "leg.departureDeltaVelocity"), arrivalRelativeVelocity: vector(value.arrivalRelativeVelocity, "leg.arrivalRelativeVelocity"), ...(value.arrivalDeltaVelocity === undefined ? {} : { arrivalDeltaVelocity: vector(value.arrivalDeltaVelocity, "leg.arrivalDeltaVelocity") }), totalDeltaV: nonNegative(value.totalDeltaV, "leg.totalDeltaV"), ...(value.periapsisRadiusMeters === undefined ? {} : { periapsisRadiusMeters: positive(value.periapsisRadiusMeters, "leg.periapsisRadiusMeters") }), solverResidual: nonNegative(value.solverResidual, "leg.solverResidual"), solverIterations: integer(value.solverIterations, "leg.solverIterations", 1, 4096),
  } satisfies ImpulsiveLambertLeg;
  return Object.freeze(leg);
}

export function createTrajectoryPlan(value: TrajectoryPlanInput): TrajectoryPlan {
  const request = normalizeTrajectoryTransferRequest(value.request);
  if (value.legs.length === 0) throw new RangeError("TrajectoryPlan must contain at least one leg");
  const legs = Object.freeze(value.legs.map(normalizeLeg));
  if (compareSimulationInstants(legs[0]!.departure, request.departure) !== 0 || compareSimulationInstants(legs[legs.length - 1]!.arrival, request.arrival) !== 0) throw new RangeError("plan leg endpoints must match request endpoints");
  const dependencies = normalizeDependencies(value.dependencies);
  const dependencyDigest = plannerDependencyDigest(dependencies);
  const assumptions = Object.freeze([...(value.assumptions ?? [])].map((item) => { if (typeof item !== "string") throw new TypeError("plan assumptions must be strings"); return item; }));
  if (value.constraintsEvaluation?.feasible !== undefined && typeof value.constraintsEvaluation.feasible !== "boolean") throw new TypeError("constraintsEvaluation.feasible must be boolean");
  const rejectedBy = value.constraintsEvaluation?.rejectedBy;
  if (rejectedBy !== undefined && (!Array.isArray(rejectedBy) || rejectedBy.some((item) => typeof item !== "string"))) throw new TypeError("constraintsEvaluation.rejectedBy must contain strings");
  const constraintsEvaluation = Object.freeze({ feasible: value.constraintsEvaluation?.feasible ?? true, ...(rejectedBy === undefined ? {} : { rejectedBy: Object.freeze([...rejectedBy]) }) });
  if (value.quality?.rankingMetric !== undefined && !Object.values(TrajectoryRankingMetric).includes(value.quality.rankingMetric)) throw new RangeError("quality.rankingMetric is invalid");
  const quality = Object.freeze({ ...(value.quality?.rankingMetric === undefined ? {} : { rankingMetric: value.quality.rankingMetric }), ...(value.quality?.primaryScore === undefined ? {} : { primaryScore: finite(value.quality.primaryScore, "quality.primaryScore") }) });
  const planBase = { purpose: request.purpose, sourceObjectId: request.sourceObjectId, targetObjectId: request.targetObjectId, departure: request.departure, arrival: request.arrival, request, legs, ...(value.departureStateUsed === undefined ? {} : { departureStateUsed: endpointState(value.departureStateUsed, "departureStateUsed") }), ...(value.targetArrivalStateUsed === undefined ? {} : { targetArrivalStateUsed: endpointState(value.targetArrivalStateUsed, "targetArrivalStateUsed") }), dependencies, ...(dependencyDigest === undefined ? {} : { dependencyDigest }), assumptions, constraintsEvaluation, quality };
  return Object.freeze({ ...planBase, digest: contentDigest(planBase) });
}

export function checkTrajectoryPlanStaleness(plan: TrajectoryPlan, currentDependencies?: readonly PlannerDependencyIdentity[]): PlannerStalenessResult {
  const expected = normalizeDependencies(plan.dependencies);
  const actual = normalizeDependencies(currentDependencies ?? plan.dependencies);
  const expectedByKey = new Map(expected.map((value) => [`${value.kind}:${value.id}`, value]));
  const actualByKey = new Map(actual.map((value) => [`${value.kind}:${value.id}`, value]));
  const keys = [...new Set([...expectedByKey.keys(), ...actualByKey.keys()])].sort();
  const changedDependencies: PlannerDependencyChange[] = [];
  for (const key of keys) {
    const left = expectedByKey.get(key); const right = actualByKey.get(key);
    if (left?.revision !== right?.revision) changedDependencies.push(Object.freeze({ ...(left === undefined ? {} : { expected: left }), ...(right === undefined ? {} : { actual: right }) }));
  }
  return Object.freeze({ status: changedDependencies.length === 0 ? "current" : "stale", ...(actual.length === 0 ? {} : { dependencyDigest: plannerDependencyDigest(actual) }), changedDependencies: Object.freeze(changedDependencies) });
}

type SearchSecondCoordinate = SimulationInstant | Duration;

interface SearchPoint {
  readonly departure: SimulationInstant;
  readonly arrival: SimulationInstant;
}

const NANOSECONDS_PER_SECOND = 1_000_000_000n;

function timeValueNanoseconds(value: SimulationInstant | Duration): bigint {
  return BigInt(value.seconds) * NANOSECONDS_PER_SECOND + BigInt(value.nanoseconds);
}

function timeValueFromNanoseconds(value: bigint, kind: "instant" | "duration"): SimulationInstant | Duration {
  let seconds = value / NANOSECONDS_PER_SECOND;
  let nanoseconds = value % NANOSECONDS_PER_SECOND;
  if (nanoseconds < 0) {
    seconds -= 1n;
    nanoseconds += NANOSECONDS_PER_SECOND;
  }
  return kind === "instant"
    ? simulationInstant(Number(seconds), Number(nanoseconds))
    : duration(Number(seconds), Number(nanoseconds));
}

function interpolateTime<T extends "instant" | "duration">(
  start: T extends "instant" ? SimulationInstant : Duration,
  end: T extends "instant" ? SimulationInstant : Duration,
  index: number,
  count: number,
  kind: T,
): T extends "instant" ? SimulationInstant : Duration {
  if (count <= 1 || index <= 0) return start as T extends "instant" ? SimulationInstant : Duration;
  if (index >= count - 1) return end as T extends "instant" ? SimulationInstant : Duration;
  const startNanoseconds = timeValueNanoseconds(start);
  const span = timeValueNanoseconds(end) - startNanoseconds;
  const value = startNanoseconds + (span * BigInt(index)) / BigInt(count - 1);
  return timeValueFromNanoseconds(value, kind) as T extends "instant" ? SimulationInstant : Duration;
}

function shiftTime<T extends "instant" | "duration">(
  value: T extends "instant" ? SimulationInstant : Duration,
  deltaNanoseconds: bigint,
  kind: T,
): T extends "instant" ? SimulationInstant : Duration {
  return timeValueFromNanoseconds(timeValueNanoseconds(value) + deltaNanoseconds, kind) as T extends "instant" ? SimulationInstant : Duration;
}

function searchPoint(request: NormalizedTrajectorySearchRequest, departure: SimulationInstant, second: SearchSecondCoordinate): SearchPoint {
  return {
    departure,
    arrival: request.arrivalWindow === undefined
      ? addDurationToInstant(departure, second as Duration)
      : second as SimulationInstant,
  };
}

function searchPointWithinDomain(request: NormalizedTrajectorySearchRequest, point: SearchPoint): boolean {
  if (compareSimulationInstants(point.arrival, point.departure) <= 0) return false;
  if (!contains(request.departureWindow, point.departure)) return false;
  if (request.arrivalWindow !== undefined) return contains(request.arrivalWindow, point.arrival);
  const timeOfFlight = subtractSimulationInstants(point.arrival, point.departure);
  return request.timeOfFlightRange !== undefined
    && compareDurations(timeOfFlight, request.timeOfFlightRange.minimum) >= 0
    && compareDurations(timeOfFlight, request.timeOfFlightRange.maximum) <= 0;
}

function searchCandidateKey(branchValue: LambertBranch, point: SearchPoint): string {
  return `${canonical(branchValue)}|${point.departure.seconds}:${point.departure.nanoseconds}|${point.arrival.seconds}:${point.arrival.nanoseconds}`;
}

function searchPlanMetric(plan: TrajectoryPlan, metric: TrajectoryRankingMetric): number {
  const leg = plan.legs[0]!;
  switch (metric) {
    case TrajectoryRankingMetric.minimumDepartureDeltaV:
      return vectorMagnitude(leg.departureDeltaVelocity);
    case TrajectoryRankingMetric.minimumArrivalDeltaV:
      return vectorMagnitude(leg.arrivalDeltaVelocity ?? leg.arrivalRelativeVelocity);
    case TrajectoryRankingMetric.minimumTimeOfFlight:
      return Number(timeValueNanoseconds(subtractSimulationInstants(plan.arrival, plan.departure)));
    case TrajectoryRankingMetric.minimumTotalDeltaV:
      return leg.totalDeltaV;
  }
}

function compareSearchPlans(left: TrajectoryPlan, right: TrajectoryPlan, metric: TrajectoryRankingMetric): number {
  const leftMetric = searchPlanMetric(left, metric);
  const rightMetric = searchPlanMetric(right, metric);
  if (leftMetric !== rightMetric) return leftMetric < rightMetric ? -1 : 1;
  const departure = compareSimulationInstants(left.departure, right.departure);
  if (departure !== 0) return departure;
  const arrival = compareSimulationInstants(left.arrival, right.arrival);
  if (arrival !== 0) return arrival;
  const leftBranch = left.request.branch;
  const rightBranch = right.request.branch;
  const motionSense = compareText(leftBranch.motionSense, rightBranch.motionSense);
  if (motionSense !== 0) return motionSense;
  const path = compareText(leftBranch.path, rightBranch.path);
  if (path !== 0) return path;
  return compareText(left.digest, right.digest);
}

function rankedSearchPlan(plan: TrajectoryPlan, metric: TrajectoryRankingMetric): TrajectoryPlan {
  return createTrajectoryPlan({
    request: plan.request,
    legs: plan.legs,
    dependencies: plan.dependencies,
    ...(plan.departureStateUsed === undefined ? {} : { departureStateUsed: plan.departureStateUsed }),
    ...(plan.targetArrivalStateUsed === undefined ? {} : { targetArrivalStateUsed: plan.targetArrivalStateUsed }),
    assumptions: plan.assumptions,
    constraintsEvaluation: plan.constraintsEvaluation,
    quality: { rankingMetric: metric, primaryScore: searchPlanMetric(plan, metric) },
  });
}

function normalizedSearchResult(
  request: NormalizedTrajectorySearchRequest,
  status: TrajectorySearchStatus,
  candidates: readonly TrajectoryPlan[],
  diagnostics: Omit<TrajectorySearchDiagnostics, "status" | "returnedCandidates" | "partialCoverage">,
  grid: readonly TrajectorySearchGridSample[],
  includeGrid: boolean,
): TrajectorySearchResult {
  const limitedCandidates = Object.freeze([...candidates].slice(0, request.searchBudget.maxReturnedCandidates));
  const normalizedDiagnostics = Object.freeze({
    ...diagnostics,
    status,
    returnedCandidates: limitedCandidates.length,
    partialCoverage: status !== TrajectorySearchStatus.completed,
  });
  return Object.freeze({
    status,
    request,
    candidates: limitedCandidates,
    diagnostics: normalizedDiagnostics,
    ...(includeGrid ? { grid: Object.freeze([...grid]) } : {}),
  });
}

interface PreparedTransfer {
  readonly request: NormalizedTrajectoryTransferRequest;
  readonly sourceDeparture: TrajectoryEndpointState;
  readonly targetArrival: TrajectoryEndpointState;
  readonly departurePosition: PlannerVector;
  readonly departureVelocity: PlannerVector;
  readonly arrivalPosition: PlannerVector;
  readonly arrivalVelocity: PlannerVector;
  readonly mu: number;
  readonly muSource: "property" | "mass";
  readonly dependencies: readonly PlannerDependencyIdentity[];
  readonly dependencyDigest?: RevisionId;
}

type TransferPreparationResult = PreparedTransfer
  | PlannerUnsupportedResult<NormalizedTrajectoryTransferRequest>
  | TrajectoryPlanningStateUnavailable
  | TrajectoryPlanningInvalidFrame
  | TrajectoryPlanningMissingMu;

function isPreparedTransfer(value: TransferPreparationResult): value is PreparedTransfer {
  return !Object.prototype.hasOwnProperty.call(value, "status");
}

export class TrajectoryPlanner {
  readonly #backend: PlannerBackendCodec;
  readonly #context?: TrajectoryPlannerContext;

  constructor(backend: PlannerBackendCodec, context?: TrajectoryPlannerContext) {
    this.#backend = backend;
    this.#context = context;
    Object.freeze(this);
  }

  #prepareTransfer(input: TrajectoryTransferRequest): TransferPreparationResult {
    const request = normalizeTrajectoryTransferRequest(input);
    const context = this.#context;
    if (context === undefined) return Object.freeze({ status: "unsupported", reason: "plannerStateAccessUnavailable", request });

    let sourceRecord: ObjectRecord;
    let targetRecord: ObjectRecord;
    let centralRecord: ObjectRecord;
    let frameDependencies: ReturnType<typeof collectFrameDependencies>;
    try {
      sourceRecord = context.objectAt(request.sourceObjectId);
      targetRecord = context.objectAt(request.targetObjectId);
      centralRecord = context.objectAt(request.centralBodyId);
      frameDependencies = collectFrameDependencies(context, request.planningFrameId);
    } catch (error) {
      return Object.freeze({ status: "stateUnavailable", request, reason: error instanceof Error ? error.message : "authoritative planning source is unavailable" });
    }
    if (frameDependencies.invalidReason !== undefined) {
      return Object.freeze({ status: "invalidPlanningFrame", request, frameId: request.planningFrameId, reason: frameDependencies.invalidReason });
    }
    const resolvedMu = resolveMu(centralRecord);
    if (resolvedMu.value === undefined) {
      return Object.freeze({
        status: "missingMu",
        request,
        centralBodyId: request.centralBodyId,
        reason: resolvedMu.source === "invalid"
          ? "central body has no positive gravitational parameter"
          : "central body has neither a positive gravitational parameter nor a positive mass",
      });
    }

    let sourceDeparture: TrajectoryEndpointState;
    let targetArrival: TrajectoryEndpointState;
    let centralDeparture: TrajectoryEndpointState;
    let centralArrival: TrajectoryEndpointState;
    try {
      sourceDeparture = endpointFromState(context.stateAt(request.sourceObjectId, request.departure, request.planningFrameId), request.departure, request.planningFrameId, "source state");
      centralDeparture = endpointFromState(context.stateAt(request.centralBodyId, request.departure, request.planningFrameId), request.departure, request.planningFrameId, "central-body departure state");
      targetArrival = endpointFromState(context.stateAt(request.targetObjectId, request.arrival, request.planningFrameId), request.arrival, request.planningFrameId, "target state");
      centralArrival = endpointFromState(context.stateAt(request.centralBodyId, request.arrival, request.planningFrameId), request.arrival, request.planningFrameId, "central-body arrival state");
    } catch (error) {
      return Object.freeze({ status: "stateUnavailable", request, reason: error instanceof Error ? error.message : "authoritative state query failed" });
    }

    const dependencies = [
      ...collectObjectDependencies(context, [sourceRecord, targetRecord, centralRecord], request.sourceObjectId),
      ...frameDependencies.dependencies,
      { kind: "property" as const, id: `${request.centralBodyId}:mu`, revision: centralRecord.propertyRevision },
      { kind: "solver" as const, id: "lambert-zero-revolution-v1", revision: contentDigest({ algorithm: "lambert-zero-revolution-v1", solverConfiguration: request.solverConfiguration }) },
    ];
    const dependencyKeys = new Set<string>();
    const uniqueDependencies: PlannerDependencyIdentity[] = [];
    for (const dependency of dependencies) addDependency(uniqueDependencies, dependencyKeys, dependency);
    const departurePosition = vectorDifference(sourceDeparture.position, centralDeparture.position);
    const departureVelocity = vectorDifference(sourceDeparture.velocity, centralDeparture.velocity);
    const arrivalPosition = vectorDifference(targetArrival.position, centralArrival.position);
    const arrivalVelocity = vectorDifference(targetArrival.velocity, centralArrival.velocity);
    return Object.freeze({
      request,
      sourceDeparture,
      targetArrival,
      departurePosition,
      departureVelocity,
      arrivalPosition,
      arrivalVelocity,
      mu: resolvedMu.value,
      muSource: resolvedMu.source === "mass" ? "mass" : "property",
      dependencies: Object.freeze(uniqueDependencies),
      ...(plannerDependencyDigest(uniqueDependencies) === undefined ? {} : { dependencyDigest: plannerDependencyDigest(uniqueDependencies) }),
    });
  }

  #geometryRequest(prepared: PreparedTransfer): NormalizedLambertGeometryRequest {
    return normalizeLambertGeometryRequest({
      centralBodyId: prepared.request.centralBodyId,
      planningFrameId: prepared.request.planningFrameId,
      mu: prepared.mu,
      departurePosition: prepared.departurePosition,
      arrivalPosition: prepared.arrivalPosition,
      timeOfFlight: prepared.request.timeOfFlight,
      branch: prepared.request.branch,
      solverConfiguration: prepared.request.solverConfiguration,
      ...(prepared.dependencyDigest === undefined ? {} : { provenanceDigest: prepared.dependencyDigest }),
    });
  }

  #solvePrepared(prepared: PreparedTransfer): LambertGeometryResult | PlannerUnsupportedResult<NormalizedLambertGeometryRequest> {
    const request = this.#geometryRequest(prepared);
    const crossed = this.#backend.roundTripPlanner(encodeLambertGeometryWire(request));
    if (crossed.resultWords === undefined) return Object.freeze({ status: "unsupported", reason: "lambertSolverNotImplemented", request });
    return decodeLambertGeometryResult(request, crossed);
  }

  #solvePreparedBatch(prepared: readonly PreparedTransfer[]): readonly (LambertGeometryResult | PlannerUnsupportedResult<NormalizedLambertGeometryRequest>)[] {
    if (prepared.length === 0) return Object.freeze([]);
    const requests = prepared.map((value) => this.#geometryRequest(value));
    const wires = requests.map((value) => encodeLambertGeometryWire(value));
    const crossed = this.#backend.roundTripPlannerBatch === undefined
      ? wires.map((value) => this.#backend.roundTripPlanner(value))
      : this.#backend.roundTripPlannerBatch(wires);
    if (crossed.length !== requests.length) throw new RangeError("planner batch codec returned the wrong number of packets");
    return Object.freeze(crossed.map((value, index) => {
      const request = requests[index]!;
      if (value.resultWords === undefined) return Object.freeze({ status: "unsupported", reason: "lambertSolverNotImplemented", request });
      return decodeLambertGeometryResult(request, value);
    }));
  }

  #completeTransfer(prepared: PreparedTransfer, geometry: LambertGeometryResult | PlannerUnsupportedResult<NormalizedLambertGeometryRequest>): TrajectoryPlanningResult | PlannerUnsupportedResult<NormalizedTrajectoryTransferRequest> {
    if (geometry.status !== "success") return Object.freeze({ status: "solverFailure", request: prepared.request, solver: geometry });
    const departureDeltaVelocity = vectorDifference(geometry.solution.transferDepartureVelocity, prepared.departureVelocity);
    const arrivalRelativeVelocity = vectorDifference(geometry.solution.transferArrivalVelocity, prepared.arrivalVelocity);
    const arrivalDeltaVelocity = prepared.request.purpose === "rendezvous" ? vectorNegate(arrivalRelativeVelocity) : undefined;
    const departureDeltaV = vectorMagnitude(departureDeltaVelocity);
    const arrivalDeltaV = arrivalDeltaVelocity === undefined ? 0 : vectorMagnitude(arrivalDeltaVelocity);
    const totalDeltaV = departureDeltaV + arrivalDeltaV;
    const rejectedBy: string[] = [];
    const constraints = prepared.request.constraints;
    if (constraints.maximumDepartureDeltaV !== undefined && departureDeltaV > constraints.maximumDepartureDeltaV) rejectedBy.push("maximumDepartureDeltaV");
    if (prepared.request.purpose === "rendezvous" && constraints.maximumArrivalDeltaV !== undefined && arrivalDeltaV > constraints.maximumArrivalDeltaV) rejectedBy.push("maximumArrivalDeltaV");
    if (constraints.maximumTotalDeltaV !== undefined && totalDeltaV > constraints.maximumTotalDeltaV) rejectedBy.push("maximumTotalDeltaV");
    if (constraints.minimumCentralBodyClearanceMeters !== undefined
        && (geometry.solution.periapsisRadiusMeters === undefined || geometry.solution.periapsisRadiusMeters < constraints.minimumCentralBodyClearanceMeters)) rejectedBy.push("minimumCentralBodyClearanceMeters");
    const plan = createTrajectoryPlan({
      request: prepared.request,
      legs: [{
        kind: "impulsiveLambert",
        departure: prepared.request.departure,
        arrival: prepared.request.arrival,
        centralBodyId: prepared.request.centralBodyId,
        planningFrameId: prepared.request.planningFrameId,
        muUsed: prepared.mu,
        branch: prepared.request.branch,
        revolutions: 0,
        transferDepartureVelocity: geometry.solution.transferDepartureVelocity,
        transferArrivalVelocity: geometry.solution.transferArrivalVelocity,
        departureDeltaVelocity,
        arrivalRelativeVelocity,
        ...(arrivalDeltaVelocity === undefined ? {} : { arrivalDeltaVelocity }),
        totalDeltaV,
        ...(geometry.solution.periapsisRadiusMeters === undefined ? {} : { periapsisRadiusMeters: geometry.solution.periapsisRadiusMeters }),
        solverResidual: geometry.solution.residual,
        solverIterations: geometry.solution.iterations,
      }],
      dependencies: prepared.dependencies,
      departureStateUsed: { epoch: prepared.sourceDeparture.epoch, position: prepared.departurePosition, velocity: prepared.departureVelocity },
      targetArrivalStateUsed: { epoch: prepared.targetArrival.epoch, position: prepared.arrivalPosition, velocity: prepared.arrivalVelocity },
      assumptions: [
        "twoBodyCentralBody",
        `centralBody:${prepared.request.centralBodyId}`,
        `planningFrame:${prepared.request.planningFrameId}`,
        "centralBodyRelativeEndpointStates",
        `muSource:${prepared.muSource}`,
        `mu:${prepared.mu}`,
        `purpose:${prepared.request.purpose}`,
      ],
      constraintsEvaluation: { feasible: rejectedBy.length === 0, ...(rejectedBy.length === 0 ? {} : { rejectedBy }) },
      quality: { rankingMetric: TrajectoryRankingMetric.minimumTotalDeltaV, primaryScore: totalDeltaV },
    });
    return rejectedBy.length > 0
      ? Object.freeze({ status: "constraintRejected", request: prepared.request, plan, rejectedBy: Object.freeze(rejectedBy) })
      : Object.freeze({ status: "success", plan });
  }

  #planTransferBatch(inputs: readonly TrajectoryTransferRequest[]): readonly (TrajectoryPlanningResult | PlannerUnsupportedResult<NormalizedTrajectoryTransferRequest>)[] {
    const preparedResults = inputs.map((input) => this.#prepareTransfer(input));
    const prepared = preparedResults.filter(isPreparedTransfer);
    const geometries = this.#solvePreparedBatch(prepared);
    let geometryIndex = 0;
    return Object.freeze(preparedResults.map((result) => {
      if (!isPreparedTransfer(result)) return result;
      const geometry = geometries[geometryIndex++];
      if (geometry === undefined) throw new RangeError("planner batch preparation and result counts differ");
      return this.#completeTransfer(result, geometry);
    }));
  }

  solveLambertGeometry(input: LambertGeometryRequest): LambertGeometryResult | PlannerUnsupportedResult<NormalizedLambertGeometryRequest> {
    const request = normalizeLambertGeometryRequest(input);
    const wire = encodeLambertGeometryWire(request);
    const crossed = this.#backend.roundTripPlanner(wire);
    if (crossed.resultWords === undefined) return Object.freeze({ status: "unsupported", reason: "lambertSolverNotImplemented", request });
    return decodeLambertGeometryResult(request, crossed);
  }

  planTransfer(input: TrajectoryTransferRequest): PlannerUnsupportedResult<NormalizedTrajectoryTransferRequest> | TrajectoryPlanningResult {
    const request = normalizeTrajectoryTransferRequest(input);
    const context = this.#context;
    if (context === undefined) return Object.freeze({ status: "unsupported", reason: "plannerStateAccessUnavailable", request });

    let sourceRecord: ObjectRecord;
    let targetRecord: ObjectRecord;
    let centralRecord: ObjectRecord;
    let frameDependencies: ReturnType<typeof collectFrameDependencies>;
    try {
      sourceRecord = context.objectAt(request.sourceObjectId);
      targetRecord = context.objectAt(request.targetObjectId);
      centralRecord = context.objectAt(request.centralBodyId);
      frameDependencies = collectFrameDependencies(context, request.planningFrameId);
    } catch (error) {
      return Object.freeze({
        status: "stateUnavailable",
        request,
        reason: error instanceof Error ? error.message : "authoritative planning source is unavailable",
      });
    }
    if (frameDependencies.invalidReason !== undefined) {
      return Object.freeze({ status: "invalidPlanningFrame", request, frameId: request.planningFrameId, reason: frameDependencies.invalidReason });
    }

    const resolvedMu = resolveMu(centralRecord);
    if (resolvedMu.value === undefined) {
      return Object.freeze({
        status: "missingMu",
        request,
        centralBodyId: request.centralBodyId,
        reason: resolvedMu.source === "invalid"
          ? "central body has no positive gravitational parameter"
          : "central body has neither a positive gravitational parameter nor a positive mass",
      });
    }

    let sourceDeparture: TrajectoryEndpointState;
    let targetArrival: TrajectoryEndpointState;
    let centralDeparture: TrajectoryEndpointState;
    let centralArrival: TrajectoryEndpointState;
    try {
      sourceDeparture = endpointFromState(
        context.stateAt(request.sourceObjectId, request.departure, request.planningFrameId),
        request.departure,
        request.planningFrameId,
        "source state",
      );
      centralDeparture = endpointFromState(
        context.stateAt(request.centralBodyId, request.departure, request.planningFrameId),
        request.departure,
        request.planningFrameId,
        "central-body departure state",
      );
      targetArrival = endpointFromState(
        context.stateAt(request.targetObjectId, request.arrival, request.planningFrameId),
        request.arrival,
        request.planningFrameId,
        "target state",
      );
      centralArrival = endpointFromState(
        context.stateAt(request.centralBodyId, request.arrival, request.planningFrameId),
        request.arrival,
        request.planningFrameId,
        "central-body arrival state",
      );
    } catch (error) {
      const objectIdValue = error instanceof Object && "objectId" in error
        ? (error as { readonly objectId?: ObjectId }).objectId
        : undefined;
      return Object.freeze({
        status: "stateUnavailable",
        request,
        ...(objectIdValue === undefined ? {} : { objectId: objectIdValue }),
        reason: error instanceof Error ? error.message : "authoritative state query failed",
      });
    }

    const dependencies = [
      ...collectObjectDependencies(context, [sourceRecord, targetRecord, centralRecord], request.sourceObjectId),
      ...frameDependencies.dependencies,
      {
        kind: "property" as const,
        id: `${request.centralBodyId}:mu`,
        revision: centralRecord.propertyRevision,
      },
      {
        kind: "solver" as const,
        id: "lambert-zero-revolution-v1",
        revision: contentDigest({ algorithm: "lambert-zero-revolution-v1", solverConfiguration: request.solverConfiguration }),
      },
    ];
    const dependencyKeys = new Set<string>();
    const uniqueDependencies: PlannerDependencyIdentity[] = [];
    for (const dependency of dependencies) addDependency(uniqueDependencies, dependencyKeys, dependency);
    const dependencyDigest = plannerDependencyDigest(uniqueDependencies);

    const departurePosition = vectorDifference(sourceDeparture.position, centralDeparture.position);
    const departureVelocity = vectorDifference(sourceDeparture.velocity, centralDeparture.velocity);
    const arrivalPosition = vectorDifference(targetArrival.position, centralArrival.position);
    const arrivalVelocity = vectorDifference(targetArrival.velocity, centralArrival.velocity);
    const geometry = this.solveLambertGeometry({
      centralBodyId: request.centralBodyId,
      planningFrameId: request.planningFrameId,
      mu: resolvedMu.value,
      departurePosition,
      arrivalPosition,
      timeOfFlight: request.timeOfFlight,
      branch: request.branch,
      solverConfiguration: request.solverConfiguration,
      ...(dependencyDigest === undefined ? {} : { provenanceDigest: dependencyDigest }),
    });
    if (geometry.status !== "success") {
      return Object.freeze({ status: "solverFailure", request, solver: geometry });
    }

    const departureDeltaVelocity = vectorDifference(geometry.solution.transferDepartureVelocity, departureVelocity);
    const arrivalRelativeVelocity = vectorDifference(geometry.solution.transferArrivalVelocity, arrivalVelocity);
    const arrivalDeltaVelocity = request.purpose === "rendezvous" ? vectorNegate(arrivalRelativeVelocity) : undefined;
    const departureDeltaV = vectorMagnitude(departureDeltaVelocity);
    const arrivalDeltaV = arrivalDeltaVelocity === undefined ? 0 : vectorMagnitude(arrivalDeltaVelocity);
    const totalDeltaV = departureDeltaV + arrivalDeltaV;
    const rejectedBy: string[] = [];
    const constraints = request.constraints;
    if (constraints.maximumDepartureDeltaV !== undefined && departureDeltaV > constraints.maximumDepartureDeltaV) {
      rejectedBy.push("maximumDepartureDeltaV");
    }
    if (request.purpose === "rendezvous" && constraints.maximumArrivalDeltaV !== undefined && arrivalDeltaV > constraints.maximumArrivalDeltaV) {
      rejectedBy.push("maximumArrivalDeltaV");
    }
    if (constraints.maximumTotalDeltaV !== undefined && totalDeltaV > constraints.maximumTotalDeltaV) {
      rejectedBy.push("maximumTotalDeltaV");
    }
    if (constraints.minimumCentralBodyClearanceMeters !== undefined
        && (geometry.solution.periapsisRadiusMeters === undefined
          || geometry.solution.periapsisRadiusMeters < constraints.minimumCentralBodyClearanceMeters)) {
      rejectedBy.push("minimumCentralBodyClearanceMeters");
    }

    const leg: ImpulsiveLambertLeg = {
      kind: "impulsiveLambert",
      departure: request.departure,
      arrival: request.arrival,
      centralBodyId: request.centralBodyId,
      planningFrameId: request.planningFrameId,
      muUsed: resolvedMu.value,
      branch: request.branch,
      revolutions: 0,
      transferDepartureVelocity: geometry.solution.transferDepartureVelocity,
      transferArrivalVelocity: geometry.solution.transferArrivalVelocity,
      departureDeltaVelocity,
      arrivalRelativeVelocity,
      ...(arrivalDeltaVelocity === undefined ? {} : { arrivalDeltaVelocity }),
      totalDeltaV,
      ...(geometry.solution.periapsisRadiusMeters === undefined ? {} : { periapsisRadiusMeters: geometry.solution.periapsisRadiusMeters }),
      solverResidual: geometry.solution.residual,
      solverIterations: geometry.solution.iterations,
    };
    const plan = createTrajectoryPlan({
      request,
      legs: [leg],
      dependencies: uniqueDependencies,
      departureStateUsed: {
        epoch: sourceDeparture.epoch,
        position: departurePosition,
        velocity: departureVelocity,
      },
      targetArrivalStateUsed: {
        epoch: targetArrival.epoch,
        position: arrivalPosition,
        velocity: arrivalVelocity,
      },
      assumptions: [
        "twoBodyCentralBody",
        `centralBody:${request.centralBodyId}`,
        `planningFrame:${request.planningFrameId}`,
        "centralBodyRelativeEndpointStates",
        `muSource:${resolvedMu.source}`,
        `mu:${resolvedMu.value}`,
        `purpose:${request.purpose}`,
      ],
      constraintsEvaluation: { feasible: rejectedBy.length === 0, ...(rejectedBy.length === 0 ? {} : { rejectedBy }) },
      quality: { rankingMetric: TrajectoryRankingMetric.minimumTotalDeltaV, primaryScore: totalDeltaV },
    });
    if (rejectedBy.length > 0) {
      return Object.freeze({ status: "constraintRejected", request, plan, rejectedBy: Object.freeze(rejectedBy) });
    }
    return Object.freeze({ status: "success", plan });
  }

  async searchTransfers(input: TrajectorySearchRequest, options: TrajectorySearchOptions = {}): Promise<PlannerUnsupportedResult<NormalizedTrajectorySearchRequest> | TrajectorySearchResult> {
    const request = normalizeTrajectorySearchRequest(input);
    if (this.#context === undefined) return Object.freeze({ status: "unsupported", reason: "plannerStateAccessUnavailable", request });

    const includeGrid = options.includeGrid === true;
    const emptyDiagnostics = {
      lambertSolves: 0,
      coarseCellsEvaluated: 0,
      refinementSeeds: 0,
      refinementIterations: 0,
    } as const;
    if (options.signal?.aborted) {
      return normalizedSearchResult(request, TrajectorySearchStatus.cancelled, [], emptyDiagnostics, [], includeGrid);
    }

    const candidates = new Map<string, TrajectoryPlan>();
    const visited = new Set<string>();
    const grid: TrajectorySearchGridSample[] = [];
    let lambertSolves = 0;
    let coarseCellsEvaluated = 0;
    let refinementSeeds = 0;
    let refinementIterations = 0;
    let budgetExceeded = false;
    let cancelled = false;
    let evaluationsSinceYield = 0;

    const yieldAtBatchBoundary = async (): Promise<void> => {
      evaluationsSinceYield += 1;
      if (evaluationsSinceYield % 32 === 0) await Promise.resolve();
    };

    const recordCell = (point: SearchPoint, branchValue: LambertBranch, result: TrajectoryPlanningResult | PlannerUnsupportedResult<NormalizedTrajectoryTransferRequest>): void => {
      if (!includeGrid) return;
      if (result.status === "success") {
        grid.push(Object.freeze({ departure: point.departure, arrival: point.arrival, branch: branchValue, status: TrajectorySearchCellStatus.feasible, totalDeltaV: result.plan.legs[0]!.totalDeltaV, planDigest: result.plan.digest }));
      } else if (result.status === "constraintRejected") {
        grid.push(Object.freeze({ departure: point.departure, arrival: point.arrival, branch: branchValue, status: TrajectorySearchCellStatus.infeasible, totalDeltaV: result.plan.legs[0]!.totalDeltaV, planDigest: result.plan.digest }));
      } else if (result.status === "solverFailure") {
        grid.push(Object.freeze({ departure: point.departure, arrival: point.arrival, branch: branchValue, status: TrajectorySearchCellStatus.solverFailure }));
      } else {
        grid.push(Object.freeze({ departure: point.departure, arrival: point.arrival, branch: branchValue, status: TrajectorySearchCellStatus.unavailable }));
      }
    };

    const evaluateBatch = async (entries: readonly { readonly point: SearchPoint; readonly coarse: boolean }[], branchValue: LambertBranch): Promise<boolean> => {
      if (cancelled || budgetExceeded) return false;
      if (options.signal?.aborted) {
        cancelled = true;
        return false;
      }
      const accepted: { readonly point: SearchPoint; readonly key: string; readonly coarse: boolean }[] = [];
      for (const entry of entries) {
        if (!searchPointWithinDomain(request, entry.point)) continue;
        const key = searchCandidateKey(branchValue, entry.point);
        if (visited.has(key)) continue;
        if ((entry.coarse && coarseCellsEvaluated >= request.searchBudget.maxCoarseCells) || lambertSolves + accepted.length >= request.searchBudget.maxLambertSolves) {
          budgetExceeded = true;
          break;
        }
        visited.add(key);
        accepted.push({ ...entry, key });
        if (entry.coarse) coarseCellsEvaluated += 1;
      }
      if (accepted.length === 0) return false;
      lambertSolves += accepted.length;
      const results = this.#planTransferBatch(accepted.map(({ point }) => ({
        sourceObjectId: request.sourceObjectId,
        targetObjectId: request.targetObjectId,
        centralBodyId: request.centralBodyId,
        planningFrameId: request.planningFrameId,
        departure: point.departure,
        arrival: point.arrival,
        branch: branchValue,
        purpose: request.purpose,
        constraints: request.constraints,
        solverConfiguration: request.solverConfiguration,
      })));
      results.forEach((result, index) => {
        const entry = accepted[index]!;
        recordCell(entry.point, branchValue, result);
        if (result.status === "success") candidates.set(entry.key, rankedSearchPlan(result.plan, request.rankingMetric));
        else if (result.status === "constraintRejected") candidates.delete(entry.key);
      });
      await yieldAtBatchBoundary();
      return true;
    };

    let departureSamples = request.sampling.departureSamples;
    let secondSamples = request.arrivalWindow === undefined
      ? request.sampling.timeOfFlightSamples
      : request.sampling.arrivalSamples;
    const branchCount = request.branchSet.length;
    while (departureSamples * secondSamples * branchCount > request.searchBudget.maxCoarseCells
      && (departureSamples > 1 || secondSamples > 1)) {
      if (secondSamples >= departureSamples && secondSamples > 1) secondSamples -= 1;
      else if (departureSamples > 1) departureSamples -= 1;
      else secondSamples -= 1;
    }

    for (const branchValue of request.branchSet) {
      for (let departureIndex = 0; departureIndex < departureSamples; departureIndex += 1) {
        const departure = interpolateTime(request.departureWindow.start, request.departureWindow.end, departureIndex, departureSamples, "instant");
        const entries = Array.from({ length: secondSamples }, (_, secondIndex) => {
          const second = request.arrivalWindow === undefined
            ? interpolateTime(request.timeOfFlightRange!.minimum, request.timeOfFlightRange!.maximum, secondIndex, secondSamples, "duration")
            : interpolateTime(request.arrivalWindow.start, request.arrivalWindow.end, secondIndex, secondSamples, "instant");
          return { point: searchPoint(request, departure, second), coarse: true };
        });
        await evaluateBatch(entries, branchValue);
        if (cancelled || budgetExceeded) break;
      }
      if (cancelled || budgetExceeded) break;
    }

    const seedPlans = [...candidates.values()]
      .sort((left, right) => compareSearchPlans(left, right, request.rankingMetric))
      .slice(0, request.searchBudget.maxRefinementSeeds);
    refinementSeeds = seedPlans.length;
    const departureSpan = timeValueNanoseconds(subtractSimulationInstants(request.departureWindow.end, request.departureWindow.start));
    const secondSpan = request.arrivalWindow === undefined
      ? timeValueNanoseconds(request.timeOfFlightRange!.maximum) - timeValueNanoseconds(request.timeOfFlightRange!.minimum)
      : timeValueNanoseconds(subtractSimulationInstants(request.arrivalWindow.end, request.arrivalWindow.start));

    for (const seed of seedPlans) {
      let current = seed;
      for (let iteration = 0; iteration < request.searchBudget.maxRefinementIterationsPerSeed; iteration += 1) {
        if (cancelled || budgetExceeded) break;
        if (options.signal?.aborted) {
          cancelled = true;
          break;
        }
        const departureStep = departureSpan / (2n ** BigInt(iteration + 1));
        const secondStep = secondSpan / (2n ** BigInt(iteration + 1));
        if (departureStep === 0n && secondStep === 0n) break;
        refinementIterations += 1;
        let best = current;
        const currentTimeOfFlight = subtractSimulationInstants(current.arrival, current.departure);
        const neighbors: readonly SearchPoint[] = [
          { departure: shiftTime(current.departure, -departureStep, "instant"), arrival: current.arrival },
          { departure: shiftTime(current.departure, departureStep, "instant"), arrival: current.arrival },
          request.arrivalWindow === undefined
            ? searchPoint(request, current.departure, shiftTime(currentTimeOfFlight, -secondStep, "duration"))
            : { departure: current.departure, arrival: shiftTime(current.arrival, -secondStep, "instant") },
          request.arrivalWindow === undefined
            ? searchPoint(request, current.departure, shiftTime(currentTimeOfFlight, secondStep, "duration"))
            : { departure: current.departure, arrival: shiftTime(current.arrival, secondStep, "instant") },
        ];
        await evaluateBatch(neighbors.map((point) => ({ point, coarse: false })), current.request.branch);
        for (const neighbor of neighbors) {
          const neighborPlan = candidates.get(searchCandidateKey(current.request.branch, neighbor));
          if (neighborPlan !== undefined && compareSearchPlans(neighborPlan, best, request.rankingMetric) < 0) best = neighborPlan;
        }
        current = best;
      }
      if (cancelled || budgetExceeded) break;
    }

    const status = cancelled
      ? TrajectorySearchStatus.cancelled
      : budgetExceeded
        ? TrajectorySearchStatus.budgetExceeded
        : TrajectorySearchStatus.completed;
    const sortedCandidates = [...candidates.values()].sort((left, right) => compareSearchPlans(left, right, request.rankingMetric));
    return normalizedSearchResult(request, status, sortedCandidates, {
      lambertSolves,
      coarseCellsEvaluated,
      refinementSeeds,
      refinementIterations,
    }, grid, includeGrid);
  }

  checkPlanStaleness(plan: TrajectoryPlan, currentDependencies?: readonly PlannerDependencyIdentity[]): PlannerStalenessResult {
    return checkTrajectoryPlanStaleness(plan, currentDependencies);
  }

  validateTrajectoryPlan(plan: TrajectoryPlan, _configuration: PlannerValidationConfig = {}): PlannerUnsupportedResult<TrajectoryPlan> {
    return Object.freeze({ status: "unsupported", reason: "lambertSolverNotImplemented", request: plan });
  }

  applyImpulsivePlan(plan: TrajectoryPlan, _options: ImpulsivePlanApplyOptions = {}): PlannerUnsupportedResult<TrajectoryPlan> {
    return Object.freeze({ status: "unsupported", reason: "lambertSolverNotImplemented", request: plan });
  }
}
