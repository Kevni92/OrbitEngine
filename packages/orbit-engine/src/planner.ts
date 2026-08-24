import { objectId, type ObjectId } from "./objects.js";
import { referenceFrameId, type ReferenceFrameId, type Vec3 } from "./frames.js";
import { revisionId, type RevisionId } from "./propagation.js";
import {
  compareDurations,
  compareSimulationInstants,
  duration,
  subtractSimulationInstants,
  type Duration,
  type SimulationInstant,
} from "./time.js";
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
  readonly rankingMetric?: TrajectoryRankingMetric;
  readonly searchBudget?: TrajectorySearchBudget;
}

export interface TrajectoryDurationRange {
  readonly minimum: Duration;
  readonly maximum: Duration;
}

export interface NormalizedTrajectorySearchRequest extends Omit<TrajectorySearchRequest, "constraints" | "rankingMetric" | "searchBudget" | "branchSet"> {
  readonly branchSet: readonly LambertBranch[];
  readonly constraints: NormalizedTrajectoryConstraints;
  readonly rankingMetric: TrajectoryRankingMetric;
  readonly searchBudget: NormalizedTrajectorySearchBudget;
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

export interface PlannerUnsupportedResult<TRequest> {
  readonly status: "unsupported";
  readonly reason: "lambertSolverNotImplemented";
  readonly request: TRequest;
}

export interface PlannerBackendCodec {
  roundTripPlanner(value: PlannerGeometryWire): PlannerGeometryWire;
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
  return Object.freeze({ sourceObjectId, targetObjectId, centralBodyId, planningFrameId, departureWindow, ...(arrivalWindow === undefined ? {} : { arrivalWindow }), ...(timeOfFlightRange === undefined ? {} : { timeOfFlightRange }), branchSet: Object.freeze(branches), purpose: candidate.purpose, constraints, rankingMetric, searchBudget: searchBudget(candidate.searchBudget) });
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

export class TrajectoryPlanner {
  readonly #backend: PlannerBackendCodec;

  constructor(backend: PlannerBackendCodec) {
    this.#backend = backend;
    Object.freeze(this);
  }

  solveLambertGeometry(input: LambertGeometryRequest): LambertGeometryResult | PlannerUnsupportedResult<NormalizedLambertGeometryRequest> {
    const request = normalizeLambertGeometryRequest(input);
    const wire = encodeLambertGeometryWire(request);
    const crossed = this.#backend.roundTripPlanner(wire);
    if (crossed.resultWords === undefined) return Object.freeze({ status: "unsupported", reason: "lambertSolverNotImplemented", request });
    return decodeLambertGeometryResult(request, crossed);
  }

  planTransfer(input: TrajectoryTransferRequest): PlannerUnsupportedResult<NormalizedTrajectoryTransferRequest> {
    const request = normalizeTrajectoryTransferRequest(input);
    return Object.freeze({ status: "unsupported", reason: "lambertSolverNotImplemented", request });
  }

  async searchTransfers(input: TrajectorySearchRequest, _options?: { readonly signal?: AbortSignal }): Promise<PlannerUnsupportedResult<NormalizedTrajectorySearchRequest>> {
    const request = normalizeTrajectorySearchRequest(input);
    return Object.freeze({ status: "unsupported", reason: "lambertSolverNotImplemented", request });
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
