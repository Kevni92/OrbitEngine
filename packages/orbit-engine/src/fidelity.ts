import { objectId, type ObjectId } from "./objects.js";
import type { ManeuverForceConfiguration } from "./maneuver.js";
import {
  evaluatePropagationModel,
  MotionAuthority,
  propagationEvaluationContext,
  revisionId,
  stateWithinSwitchTolerance,
  switchTolerance,
  type PropagationFrameResolver,
  type PropagationModel,
  type PropagationModelKind,
  type ReadOnlyPropagationEvaluationContext,
  type RevisionId,
  type SwitchTolerance,
  type AuthoritySnapshot,
  type AuthorityTransitionDraft,
} from "./propagation.js";
import {
  addDurationToInstant,
  compareSimulationInstants,
  duration,
  simulationInstant,
  type Duration,
  type SimulationInstant,
} from "./time.js";

export interface FidelityRequirementInput {
  readonly maxPositionErrorMeters?: number;
  readonly maxVelocityErrorMetersPerSecond?: number;
  readonly requiresPerturbations?: boolean;
  readonly requiresNumericalIntegration?: boolean;
  readonly requiresMutualCoupling?: boolean;
  readonly requiresContinuousThrust?: boolean;
  readonly requiresEncounterRefinement?: boolean;
  readonly requiresCollisionPrecision?: boolean;
  readonly requiredGravitySources?: readonly ObjectId[];
  readonly sourcePolicyRevision?: RevisionId;
  /** Alias accepted at the input boundary for callers using the document wording. */
  readonly gravitySourcePolicyRevision?: RevisionId;
  readonly validFrom?: SimulationInstant;
  readonly reevaluateBy?: SimulationInstant;
  readonly reasons?: readonly string[];
}

export interface FidelityRequirement {
  readonly maxPositionErrorMeters?: number;
  readonly maxVelocityErrorMetersPerSecond?: number;
  readonly requiresPerturbations: boolean;
  readonly requiresNumericalIntegration: boolean;
  readonly requiresMutualCoupling: boolean;
  readonly requiresContinuousThrust: boolean;
  readonly requiresEncounterRefinement: boolean;
  readonly requiresCollisionPrecision: boolean;
  readonly requiredGravitySources: readonly ObjectId[];
  readonly sourcePolicyRevision?: RevisionId;
  readonly validFrom?: SimulationInstant;
  readonly reevaluateBy?: SimulationInstant;
  readonly reasons: readonly string[];
}

export interface FidelityCapabilitiesInput {
  readonly maxPositionErrorMeters?: number;
  readonly maxVelocityErrorMetersPerSecond?: number;
  readonly supportsPerturbations?: boolean;
  readonly supportsNumericalIntegration?: boolean;
  readonly supportsMutualCoupling?: boolean;
  readonly supportsContinuousThrust?: boolean;
  readonly supportsEncounterRefinement?: boolean;
  readonly supportsCollisionPrecision?: boolean;
  readonly gravitySources?: readonly ObjectId[];
  readonly sourcePolicyRevision?: RevisionId;
}

export interface FidelityCapabilities {
  readonly maxPositionErrorMeters?: number;
  readonly maxVelocityErrorMetersPerSecond?: number;
  readonly supportsPerturbations: boolean;
  readonly supportsNumericalIntegration: boolean;
  readonly supportsMutualCoupling: boolean;
  readonly supportsContinuousThrust: boolean;
  readonly supportsEncounterRefinement: boolean;
  readonly supportsCollisionPrecision: boolean;
  readonly gravitySources: readonly ObjectId[];
  readonly sourcePolicyRevision?: RevisionId;
}

export interface FidelityCandidateInput {
  readonly id: string;
  /** A configured authority label; it is deliberately not part of the requirement profile. */
  readonly authorityKind: PropagationModelKind | string;
  readonly configurationRevision: RevisionId;
  readonly cost: number;
  readonly capabilities: FidelityCapabilitiesInput;
  readonly model?: PropagationModel;
  readonly switchTolerance?: SwitchTolerance;
  readonly candidateFactory?: FidelityAuthorityCandidateFactory;
}

export interface FidelityCandidate {
  readonly id: string;
  readonly authorityKind: string;
  readonly configurationRevision: RevisionId;
  readonly cost: number;
  readonly capabilities: FidelityCapabilities;
  readonly model?: PropagationModel;
  readonly switchTolerance?: SwitchTolerance;
  readonly candidateFactory?: FidelityAuthorityCandidateFactory;
}

export type FidelityAuthorityCandidateInput = FidelityCandidateInput;

export interface FidelityAuthorityTransitionPolicy {
  readonly minimumDwell?: Duration;
  readonly quietWindow?: Duration;
  readonly demotionAcceptanceHorizon?: readonly SimulationInstant[];
  readonly retryBackoff?: Duration;
  readonly maximumRetryBackoff?: Duration;
  readonly frameResolver?: PropagationFrameResolver;
  readonly context?: ReadOnlyPropagationEvaluationContext;
}

export interface AuthorityTransitionRequest {
  readonly objectId: ObjectId;
  readonly instant: SimulationInstant;
  readonly handoff: import("./propagation.js").PropagationState;
  readonly authoritativeMass?: number;
  readonly requirement: FidelityRequirement;
  readonly currentAuthority: AuthoritySnapshot;
  readonly forceConfiguration?: ManeuverForceConfiguration;
  readonly dependencies: readonly { readonly kind: string; readonly id: string; readonly revision: RevisionId }[];
}

export type FidelityAuthorityCandidateFactory = (
  request: AuthorityTransitionRequest,
  candidate: FidelityCandidate,
) => PropagationModel;

export interface FidelityAuthorityRef {
  readonly candidateId?: string;
  readonly authorityKind: string;
  readonly configurationRevision: RevisionId;
}

export const FidelityTransitionCode = Object.freeze({
  unchanged: "unchanged",
  selected: "selected",
  noCandidate: "noCandidate",
  switchFailed: "switchFailed",
  dwellBlocked: "dwellBlocked",
  quietWindowBlocked: "quietWindowBlocked",
  demotionRejected: "demotionRejected",
} as const);

export type FidelityTransitionCode = (typeof FidelityTransitionCode)[keyof typeof FidelityTransitionCode];

export interface FidelityTransitionResult {
  readonly code: FidelityTransitionCode;
  readonly candidateId?: string;
  readonly message: string;
}

export interface FidelityStatus {
  readonly effectiveRequirement: FidelityRequirement;
  readonly currentAuthorityKind?: string;
  readonly currentConfigurationRevision?: RevisionId;
  readonly currentCandidateId?: string;
  readonly since: SimulationInstant;
  readonly reasons: readonly string[];
  readonly nextReevaluation?: SimulationInstant;
  readonly futureRequirements: readonly { readonly signalId: string; readonly requirement: FidelityRequirement }[];
  readonly lastTransitionResult?: FidelityTransitionResult;
}

export interface FidelitySelection {
  readonly candidate: FidelityCandidate;
  readonly preservedCurrentAuthority: boolean;
}

export interface PreparedAuthorityTransition {
  readonly candidate: FidelityCandidate;
  readonly model: PropagationModel;
  readonly authorityDraft: AuthorityTransitionDraft;
  readonly beforeStatus: FidelityStatus;
  commit(reevaluate?: boolean): FidelityStatus;
  rollback(): void;
}

export const FidelityErrorCode = Object.freeze({
  noCandidate: "noCandidate",
} as const);

export type FidelityErrorCode = (typeof FidelityErrorCode)[keyof typeof FidelityErrorCode];

export class FidelitySelectionError extends Error {
  readonly code: FidelityErrorCode;
  readonly requirement: FidelityRequirement;

  constructor(requirement: FidelityRequirement) {
    super("No configured fidelity candidate satisfies the effective physical requirement");
    this.name = "FidelitySelectionError";
    this.code = FidelityErrorCode.noCandidate;
    this.requirement = requirement;
  }
}

function finiteNonNegative(value: number | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a finite non-negative number`);
  }
  return value;
}

function normalizeInstant(value: SimulationInstant | undefined, name: string): SimulationInstant | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null) throw new TypeError(`${name} must be a SimulationInstant`);
  return simulationInstant(value.seconds, value.nanoseconds);
}

function compareDecimal(left: string, right: string): number {
  if (left.length !== right.length) return left.length < right.length ? -1 : 1;
  return left === right ? 0 : left < right ? -1 : 1;
}

function compareText(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function normalizeObjectIds(values: readonly ObjectId[] | undefined, name: string): readonly ObjectId[] {
  if (values === undefined) return Object.freeze([]);
  const result = [...values].map((value) => objectId(value));
  result.sort(compareDecimal);
  for (let index = 1; index < result.length; index += 1) {
    if (result[index] === result[index - 1]) throw new RangeError(`${name} must not contain duplicate IDs`);
  }
  return Object.freeze(result);
}

function normalizeReasons(values: readonly string[] | undefined): readonly string[] {
  if (values === undefined) return Object.freeze([]);
  const result = [...values].map((value) => {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new TypeError("Fidelity reasons must be non-empty strings");
    }
    return value;
  });
  result.sort(compareText);
  for (let index = result.length - 1; index > 0; index -= 1) {
    if (result[index] === result[index - 1]) result.splice(index, 1);
  }
  return Object.freeze(result);
}

function normalizeRevision(value: RevisionId | undefined, name: string): RevisionId | undefined {
  return value === undefined ? undefined : revisionId(value);
}

function positiveDuration(value: Duration | undefined, fallback: Duration, name: string): Duration {
  const candidate = value === undefined ? fallback : duration(value.seconds, value.nanoseconds);
  if (candidate.seconds < 0 || (candidate.seconds === 0 && candidate.nanoseconds === 0)) {
    throw new RangeError(`${name} must be positive`);
  }
  return candidate;
}

function nonNegativeDuration(value: Duration | undefined, fallback: Duration, name: string): Duration {
  const candidate = value === undefined ? fallback : duration(value.seconds, value.nanoseconds);
  if (candidate.seconds < 0) throw new RangeError(`${name} must be non-negative`);
  return candidate;
}

function normalizeAuthorityPolicy(value: FidelityAuthorityTransitionPolicy | undefined): NormalizedAuthorityPolicy {
  const horizon = value?.demotionAcceptanceHorizon === undefined
    ? undefined
    : Object.freeze(value.demotionAcceptanceHorizon.map((item) => simulationInstant(item.seconds, item.nanoseconds)));
  return Object.freeze({
    minimumDwell: nonNegativeDuration(value?.minimumDwell, duration(60), "minimumDwell"),
    quietWindow: nonNegativeDuration(value?.quietWindow, duration(0), "quietWindow"),
    demotionAcceptanceHorizon: horizon,
    retryBackoff: positiveDuration(value?.retryBackoff, duration(1), "retryBackoff"),
    maximumRetryBackoff: positiveDuration(value?.maximumRetryBackoff, duration(60), "maximumRetryBackoff"),
    frameResolver: value?.frameResolver,
    context: value?.context,
  });
}

interface NormalizedAuthorityPolicy {
  readonly minimumDwell: Duration;
  readonly quietWindow: Duration;
  readonly demotionAcceptanceHorizon?: readonly SimulationInstant[];
  readonly retryBackoff: Duration;
  readonly maximumRetryBackoff: Duration;
  readonly frameResolver?: PropagationFrameResolver;
  readonly context?: ReadOnlyPropagationEvaluationContext;
}

function booleanValue(value: boolean | undefined, name: string): boolean {
  if (value === undefined) return false;
  if (typeof value !== "boolean") throw new TypeError(`${name} must be a boolean`);
  return value;
}

export function fidelityRequirement(value: FidelityRequirementInput = {}): FidelityRequirement {
  if (typeof value !== "object" || value === null) throw new TypeError("Fidelity requirement must be an object");
  const validFrom = normalizeInstant(value.validFrom, "Fidelity validFrom");
  const reevaluateBy = normalizeInstant(value.reevaluateBy, "Fidelity reevaluateBy");
  if (validFrom !== undefined && reevaluateBy !== undefined && compareSimulationInstants(reevaluateBy, validFrom) < 0) {
    throw new RangeError("Fidelity reevaluateBy must not precede validFrom");
  }
  const sourcePolicyRevision = normalizeRevision(
    value.sourcePolicyRevision ?? value.gravitySourcePolicyRevision,
    "Fidelity sourcePolicyRevision",
  );
  return Object.freeze({
    maxPositionErrorMeters: finiteNonNegative(value.maxPositionErrorMeters, "maxPositionErrorMeters"),
    maxVelocityErrorMetersPerSecond: finiteNonNegative(value.maxVelocityErrorMetersPerSecond, "maxVelocityErrorMetersPerSecond"),
    requiresPerturbations: booleanValue(value.requiresPerturbations, "requiresPerturbations"),
    requiresNumericalIntegration: booleanValue(value.requiresNumericalIntegration, "requiresNumericalIntegration"),
    requiresMutualCoupling: booleanValue(value.requiresMutualCoupling, "requiresMutualCoupling"),
    requiresContinuousThrust: booleanValue(value.requiresContinuousThrust, "requiresContinuousThrust"),
    requiresEncounterRefinement: booleanValue(value.requiresEncounterRefinement, "requiresEncounterRefinement"),
    requiresCollisionPrecision: booleanValue(value.requiresCollisionPrecision, "requiresCollisionPrecision"),
    requiredGravitySources: normalizeObjectIds(value.requiredGravitySources, "requiredGravitySources"),
    sourcePolicyRevision,
    validFrom,
    reevaluateBy,
    reasons: normalizeReasons(value.reasons),
  });
}

function minimumOptional(left: number | undefined, right: number | undefined): number | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  return Math.min(left, right);
}

function earliestOptional(left: SimulationInstant | undefined, right: SimulationInstant | undefined): SimulationInstant | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  return compareSimulationInstants(left, right) <= 0 ? left : right;
}

function greatestRevision(left: RevisionId | undefined, right: RevisionId | undefined): RevisionId | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  return compareDecimal(left, right) >= 0 ? left : right;
}

export function combineFidelityRequirements(
  values: readonly FidelityRequirementInput[],
): FidelityRequirement {
  let result = fidelityRequirement();
  for (const value of values) {
    const next = fidelityRequirement(value);
    result = fidelityRequirement({
      maxPositionErrorMeters: minimumOptional(result.maxPositionErrorMeters, next.maxPositionErrorMeters),
      maxVelocityErrorMetersPerSecond: minimumOptional(result.maxVelocityErrorMetersPerSecond, next.maxVelocityErrorMetersPerSecond),
      requiresPerturbations: result.requiresPerturbations || next.requiresPerturbations,
      requiresNumericalIntegration: result.requiresNumericalIntegration || next.requiresNumericalIntegration,
      requiresMutualCoupling: result.requiresMutualCoupling || next.requiresMutualCoupling,
      requiresContinuousThrust: result.requiresContinuousThrust || next.requiresContinuousThrust,
      requiresEncounterRefinement: result.requiresEncounterRefinement || next.requiresEncounterRefinement,
      requiresCollisionPrecision: result.requiresCollisionPrecision || next.requiresCollisionPrecision,
      requiredGravitySources: [...result.requiredGravitySources, ...next.requiredGravitySources],
      sourcePolicyRevision: greatestRevision(result.sourcePolicyRevision, next.sourcePolicyRevision),
      validFrom: earliestOptional(result.validFrom, next.validFrom),
      reevaluateBy: earliestOptional(result.reevaluateBy, next.reevaluateBy),
      reasons: [...result.reasons, ...next.reasons],
    });
  }
  return result;
}

function hasPhysicalRequirement(value: FidelityRequirement): boolean {
  return value.maxPositionErrorMeters !== undefined
    || value.maxVelocityErrorMetersPerSecond !== undefined
    || value.requiresPerturbations
    || value.requiresNumericalIntegration
    || value.requiresMutualCoupling
    || value.requiresContinuousThrust
    || value.requiresEncounterRefinement
    || value.requiresCollisionPrecision
    || value.requiredGravitySources.length > 0;
}

function normalizeCapabilities(value: FidelityCapabilitiesInput): FidelityCapabilities {
  if (typeof value !== "object" || value === null) throw new TypeError("Fidelity capabilities must be an object");
  return Object.freeze({
    maxPositionErrorMeters: finiteNonNegative(value.maxPositionErrorMeters, "candidate maxPositionErrorMeters"),
    maxVelocityErrorMetersPerSecond: finiteNonNegative(value.maxVelocityErrorMetersPerSecond, "candidate maxVelocityErrorMetersPerSecond"),
    supportsPerturbations: booleanValue(value.supportsPerturbations, "supportsPerturbations"),
    supportsNumericalIntegration: booleanValue(value.supportsNumericalIntegration, "supportsNumericalIntegration"),
    supportsMutualCoupling: booleanValue(value.supportsMutualCoupling, "supportsMutualCoupling"),
    supportsContinuousThrust: booleanValue(value.supportsContinuousThrust, "supportsContinuousThrust"),
    supportsEncounterRefinement: booleanValue(value.supportsEncounterRefinement, "supportsEncounterRefinement"),
    supportsCollisionPrecision: booleanValue(value.supportsCollisionPrecision, "supportsCollisionPrecision"),
    gravitySources: normalizeObjectIds(value.gravitySources, "candidate gravitySources"),
    sourcePolicyRevision: normalizeRevision(value.sourcePolicyRevision, "candidate sourcePolicyRevision"),
  });
}

export function fidelityCandidate(value: FidelityCandidateInput): FidelityCandidate {
  if (typeof value !== "object" || value === null) throw new TypeError("Fidelity candidate must be an object");
  if (typeof value.id !== "string" || value.id.trim().length === 0) throw new TypeError("Fidelity candidate id must be non-empty");
  if (typeof value.authorityKind !== "string" || value.authorityKind.trim().length === 0) throw new TypeError("Fidelity authorityKind must be non-empty");
  if (typeof value.cost !== "number" || !Number.isFinite(value.cost) || value.cost < 0) throw new RangeError("Fidelity candidate cost must be finite and non-negative");
  if (value.model !== undefined && (typeof value.model !== "object" || value.model === null || typeof value.model.evaluate !== "function")) {
    throw new TypeError("Fidelity candidate model must be a PropagationModel");
  }
  if (value.candidateFactory !== undefined && typeof value.candidateFactory !== "function") {
    throw new TypeError("Fidelity candidateFactory must be a function");
  }
  if (value.model !== undefined && value.switchTolerance === undefined) {
    throw new TypeError("A fidelity candidate model requires switchTolerance and vice versa");
  }
  if (value.model === undefined && value.switchTolerance !== undefined && value.candidateFactory === undefined) {
    throw new TypeError("A static fidelity candidate without a model cannot declare switchTolerance");
  }
  return Object.freeze({
    id: value.id,
    authorityKind: value.authorityKind,
    configurationRevision: revisionId(value.configurationRevision),
    cost: value.cost,
    capabilities: normalizeCapabilities(value.capabilities),
    ...(value.model === undefined ? {} : { model: value.model }),
    ...(value.switchTolerance === undefined ? {} : { switchTolerance: switchTolerance(value.switchTolerance) }),
    ...(value.candidateFactory === undefined ? {} : { candidateFactory: value.candidateFactory }),
  });
}

function candidateSatisfies(candidate: FidelityCandidate, requirement: FidelityRequirement): boolean {
  const capabilities = candidate.capabilities;
  return (requirement.maxPositionErrorMeters === undefined
    || (capabilities.maxPositionErrorMeters !== undefined && capabilities.maxPositionErrorMeters <= requirement.maxPositionErrorMeters))
    && (requirement.maxVelocityErrorMetersPerSecond === undefined
      || (capabilities.maxVelocityErrorMetersPerSecond !== undefined && capabilities.maxVelocityErrorMetersPerSecond <= requirement.maxVelocityErrorMetersPerSecond))
    && (!requirement.requiresPerturbations || capabilities.supportsPerturbations)
    && (!requirement.requiresNumericalIntegration || capabilities.supportsNumericalIntegration)
    && (!requirement.requiresMutualCoupling || capabilities.supportsMutualCoupling)
    && (!requirement.requiresContinuousThrust || capabilities.supportsContinuousThrust)
    && (!requirement.requiresEncounterRefinement || capabilities.supportsEncounterRefinement)
    && (!requirement.requiresCollisionPrecision || capabilities.supportsCollisionPrecision)
    && (requirement.sourcePolicyRevision === undefined
      || capabilities.sourcePolicyRevision === requirement.sourcePolicyRevision)
    && requirement.requiredGravitySources.every((source) => capabilities.gravitySources.includes(source));
}

function matchesAuthority(candidate: FidelityCandidate, authority: FidelityAuthorityRef | FidelityCandidate): boolean {
  if ("capabilities" in authority) return candidate.id === authority.id;
  if ("candidateId" in authority && authority.candidateId !== undefined && candidate.id === authority.candidateId) return true;
  return candidate.authorityKind === authority.authorityKind
    && candidate.configurationRevision === authority.configurationRevision;
}

function compareCandidates(left: FidelityCandidate, right: FidelityCandidate): number {
  if (left.cost !== right.cost) return left.cost < right.cost ? -1 : 1;
  const authority = compareText(left.authorityKind, right.authorityKind);
  if (authority !== 0) return authority;
  const revision = compareDecimal(left.configurationRevision, right.configurationRevision);
  return revision !== 0 ? revision : compareText(left.id, right.id);
}

export function selectFidelityCandidate(
  requirement: FidelityRequirementInput,
  candidates: readonly FidelityCandidateInput[],
  currentAuthority?: FidelityAuthorityRef | FidelityCandidate,
): FidelitySelection {
  const normalizedRequirement = fidelityRequirement(requirement);
  const normalizedCandidates = candidates.map(fidelityCandidate);
  const ids = new Set<string>();
  for (const candidate of normalizedCandidates) {
    if (ids.has(candidate.id)) throw new RangeError(`Duplicate fidelity candidate id: ${candidate.id}`);
    ids.add(candidate.id);
  }
  if (currentAuthority !== undefined) {
    const current = normalizedCandidates.find((candidate) => matchesAuthority(candidate, currentAuthority));
    if (current !== undefined && candidateSatisfies(current, normalizedRequirement)) {
      return Object.freeze({ candidate: current, preservedCurrentAuthority: true });
    }
  }
  const eligible = normalizedCandidates.filter((candidate) => candidateSatisfies(candidate, normalizedRequirement));
  eligible.sort(compareCandidates);
  const candidate = eligible[0];
  if (candidate === undefined) throw new FidelitySelectionError(normalizedRequirement);
  return Object.freeze({ candidate, preservedCurrentAuthority: false });
}

function sameCandidate(left: FidelityCandidate | undefined, right: FidelityCandidate | undefined): boolean {
  return left?.id === right?.id
    && left?.authorityKind === right?.authorityKind
    && left?.configurationRevision === right?.configurationRevision;
}

function earlierInstant(left: SimulationInstant | undefined, right: SimulationInstant | undefined): SimulationInstant | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  return compareSimulationInstants(left, right) <= 0 ? left : right;
}

function scaleDuration(value: Duration, factor: number, maximum: Duration): Duration {
  const seconds = Math.min(maximum.seconds, value.seconds * factor);
  if (seconds < maximum.seconds) return duration(seconds, value.nanoseconds);
  if (seconds === maximum.seconds && value.nanoseconds <= maximum.nanoseconds) return duration(seconds, value.nanoseconds);
  return maximum;
}

function freezeStatus(value: FidelityStatus): FidelityStatus {
  return Object.freeze({
    ...value,
    effectiveRequirement: value.effectiveRequirement,
    since: simulationInstant(value.since.seconds, value.since.nanoseconds),
    reasons: Object.freeze([...value.reasons]),
    futureRequirements: Object.freeze(value.futureRequirements.map((item) => Object.freeze({
      signalId: item.signalId,
      requirement: fidelityRequirement(item.requirement),
    }))),
    ...(value.nextReevaluation === undefined ? {} : {
      nextReevaluation: simulationInstant(value.nextReevaluation.seconds, value.nextReevaluation.nanoseconds),
    }),
    ...(value.lastTransitionResult === undefined ? {} : {
      lastTransitionResult: Object.freeze({ ...value.lastTransitionResult }),
    }),
  });
}

interface FidelityState {
  minimumRequirement?: FidelityRequirement;
  readonly signals: Map<string, FidelityRequirement>;
  candidates: readonly FidelityCandidate[];
  current?: FidelityCandidate;
  authority?: MotionAuthority;
  transitionPolicy: NormalizedAuthorityPolicy;
  since: SimulationInstant;
  quietUntil?: SimulationInstant;
  retryAt?: SimulationInstant;
  demotionFailures: number;
  status: FidelityStatus;
}

function defaultStatus(): FidelityStatus {
  const requirement = fidelityRequirement();
  return freezeStatus({
    effectiveRequirement: requirement,
    since: simulationInstant(0),
    reasons: requirement.reasons,
    futureRequirements: [],
  });
}

function candidatesForAuthority(
  state: FidelityState,
): readonly FidelityCandidate[] {
  if (state.authority?.referenceStatus() !== "diverged") return state.candidates;
  return state.candidates.filter((candidate) => candidate.authorityKind !== "referenceEphemeris"
    && candidate.model?.declaration.kind !== "referenceEphemeris");
}

function futureRequirements(
  signals: ReadonlyMap<string, FidelityRequirement>,
  now: SimulationInstant,
): readonly { readonly signalId: string; readonly requirement: FidelityRequirement }[] {
  return [...signals.entries()]
    .filter(([, requirement]) => requirement.validFrom !== undefined
      && compareSimulationInstants(requirement.validFrom, now) > 0)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([signalId, requirement]) => ({ signalId, requirement }));
}

function earliestFutureActivation(
  values: readonly { readonly requirement: FidelityRequirement }[],
): SimulationInstant | undefined {
  return values.reduce<SimulationInstant | undefined>((earliest, item) => {
    const validFrom = item.requirement.validFrom;
    if (validFrom === undefined) return earliest;
    return earliest === undefined || compareSimulationInstants(validFrom, earliest) < 0 ? validFrom : earliest;
  }, undefined);
}

export class FidelityManager {
  readonly #states = new Map<ObjectId, FidelityState>();

  #state(id: ObjectId): FidelityState {
    const normalizedId = objectId(id);
    const existing = this.#states.get(normalizedId);
    if (existing !== undefined) return existing;
    const status = defaultStatus();
    const created: FidelityState = {
    signals: new Map(),
    candidates: Object.freeze([]),
    transitionPolicy: normalizeAuthorityPolicy(undefined),
    demotionFailures: 0,
    since: status.since,
      status,
    };
    this.#states.set(normalizedId, created);
    return created;
  }

  #deferDemotion(
    state: FidelityState,
    now: SimulationInstant,
    code: FidelityTransitionCode,
    message: string,
    retryAt?: SimulationInstant,
  ): FidelityTransitionResult {
    if (retryAt !== undefined) {
      state.retryAt = retryAt;
    } else {
      state.demotionFailures += 1;
      state.retryAt = addDurationToInstant(
        now,
        scaleDuration(
          state.transitionPolicy.retryBackoff,
          2 ** Math.min(state.demotionFailures - 1, 30),
          state.transitionPolicy.maximumRetryBackoff,
        ),
      );
    }
    return { code, message };
  }

  #validateDemotion(
    id: ObjectId,
    state: FidelityState,
    candidate: FidelityCandidate,
    now: SimulationInstant,
  ): FidelityTransitionResult | undefined {
    const horizon = state.transitionPolicy.demotionAcceptanceHorizon;
    if (horizon === undefined || horizon.length === 0) {
      return this.#deferDemotion(state, now, FidelityTransitionCode.demotionRejected, "Demotion requires a non-empty declared future acceptance horizon");
    }
    if (candidate.model === undefined || candidate.switchTolerance === undefined || state.authority === undefined) {
      return this.#deferDemotion(state, now, FidelityTransitionCode.switchFailed, "Demotion candidate is missing an executable authority configuration");
    }
    const context = state.transitionPolicy.context ?? propagationEvaluationContext({ objectId: id, currentTime: now });
    try {
      for (const sample of horizon) {
        const exactSample = simulationInstant(sample.seconds, sample.nanoseconds);
        if (compareSimulationInstants(exactSample, now) < 0) {
          return this.#deferDemotion(state, now, FidelityTransitionCode.demotionRejected, "Demotion horizon contains a past instant");
        }
        const rawCurrent = state.authority.evaluate(exactSample, context);
        const current = rawCurrent.referenceFrame === candidate.model.declaration.propagationFrame
          ? rawCurrent
          : state.authority.evaluate(
            exactSample,
            context,
            candidate.model.declaration.propagationFrame,
            state.transitionPolicy.frameResolver,
          );
        const next = evaluatePropagationModel(candidate.model, exactSample, context);
        if (!stateWithinSwitchTolerance(current, next, candidate.switchTolerance)) {
          return this.#deferDemotion(state, now, FidelityTransitionCode.demotionRejected, "Candidate failed future representability/error-budget validation");
        }
      }
    } catch (error) {
      return this.#deferDemotion(
        state,
        now,
        FidelityTransitionCode.demotionRejected,
        `Candidate failed future representability/error-budget validation: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return undefined;
  }

  #transition(id: ObjectId, state: FidelityState, candidate: FidelityCandidate, now: SimulationInstant): FidelityTransitionResult {
    const current = state.current;
    const authority = state.authority;
    if (authority === undefined) {
      state.since = now;
      state.demotionFailures = 0;
      state.retryAt = undefined;
      return { code: FidelityTransitionCode.selected, candidateId: candidate.id, message: "A configured fidelity authority was selected" };
    }
    let executableCandidate = candidate;
    if (executableCandidate.model === undefined && executableCandidate.candidateFactory !== undefined) {
      const context = state.transitionPolicy.context ?? propagationEvaluationContext({ objectId: id, currentTime: now });
      const handoff = authority.evaluate(now, context);
      const built = executableCandidate.candidateFactory({
        objectId: id,
        instant: now,
        handoff,
        requirement: state.status.effectiveRequirement,
        currentAuthority: authority.snapshot(),
        dependencies: [],
      }, executableCandidate);
      executableCandidate = Object.freeze({
        ...executableCandidate,
        model: built,
        configurationRevision: built.declaration.configurationRevision,
      });
    }
    if (executableCandidate.model === undefined || executableCandidate.switchTolerance === undefined) {
      return { code: FidelityTransitionCode.switchFailed, message: "Selected fidelity candidate has no executable propagation authority" };
    }
    if (authority.referenceStatus() === "diverged"
        && executableCandidate.model.declaration.kind === "referenceEphemeris") {
      return { code: FidelityTransitionCode.switchFailed, message: "A diverged authority cannot resume its reference ephemeris future" };
    }
    const isDemotion = current !== undefined && executableCandidate.cost < current.cost;
    if (isDemotion) {
      if (state.retryAt !== undefined && compareSimulationInstants(now, state.retryAt) < 0) {
        return { code: FidelityTransitionCode.quietWindowBlocked, message: "Demotion is waiting for its bounded retry/backoff instant" };
      }
      const dwellUntil = addDurationToInstant(state.since, state.transitionPolicy.minimumDwell);
      if (compareSimulationInstants(now, dwellUntil) < 0) {
        return this.#deferDemotion(state, now, FidelityTransitionCode.dwellBlocked, "Minimum high-fidelity dwell time has not elapsed", dwellUntil);
      }
      if (state.quietUntil !== undefined && compareSimulationInstants(now, state.quietUntil) < 0) {
        return this.#deferDemotion(state, now, FidelityTransitionCode.quietWindowBlocked, "Configured quiet-window hysteresis has not elapsed", state.quietUntil);
      }
      const validation = this.#validateDemotion(id, state, executableCandidate, now);
      if (validation !== undefined) return validation;
    }
    const context = state.transitionPolicy.context ?? propagationEvaluationContext({ objectId: id, currentTime: now });
    const result = authority.switchModel(executableCandidate.model, now, {
      tolerance: executableCandidate.switchTolerance!,
      frameResolver: state.transitionPolicy.frameResolver,
      context,
    });
    if (!result.ok) return { code: FidelityTransitionCode.switchFailed, message: result.error.message };
    state.since = now;
    state.demotionFailures = 0;
    state.retryAt = undefined;
    state.quietUntil = undefined;
    return {
      code: FidelityTransitionCode.selected,
      candidateId: executableCandidate.id,
      message: isDemotion ? "A validated cheaper fidelity authority was committed" : "A satisfying fidelity authority was committed at the exact transition instant",
    };
  }

  #recompute(id: ObjectId, now: SimulationInstant): FidelityStatus {
    const state = this.#state(id);
    const normalizedNow = simulationInstant(now.seconds, now.nanoseconds);
    const requirements: FidelityRequirement[] = [...state.signals.values()]
      .filter((requirement) => requirement.validFrom === undefined
        || compareSimulationInstants(requirement.validFrom, normalizedNow) <= 0);
    if (state.minimumRequirement !== undefined) requirements.push(state.minimumRequirement);
    const effectiveRequirement = combineFidelityRequirements(requirements);
    const future = futureRequirements(state.signals, normalizedNow);
    let result: FidelityTransitionResult = {
      code: FidelityTransitionCode.unchanged,
      message: "Current fidelity authority remains valid",
    };

    if ((hasPhysicalRequirement(effectiveRequirement) || state.authority !== undefined)
        && !(future.length > 0 && !hasPhysicalRequirement(effectiveRequirement))) {
      try {
        const selection = selectFidelityCandidate(
          effectiveRequirement,
          candidatesForAuthority(state),
          hasPhysicalRequirement(effectiveRequirement) ? state.current : undefined,
        );
        if (!sameCandidate(state.current, selection.candidate)) {
          result = this.#transition(id, state, selection.candidate, normalizedNow);
          if (result.code === FidelityTransitionCode.selected) state.current = selection.candidate;
        }
      } catch (error) {
        if (!(error instanceof FidelitySelectionError)) throw error;
        result = { code: FidelityTransitionCode.noCandidate, message: error.message };
        state.status = freezeStatus({
          effectiveRequirement,
          currentAuthorityKind: state.current?.authorityKind,
          currentConfigurationRevision: state.current?.configurationRevision,
          currentCandidateId: state.current?.id,
          since: state.since,
          reasons: effectiveRequirement.reasons,
          nextReevaluation: earlierInstant(earliestFutureActivation(future), earlierInstant(effectiveRequirement.reevaluateBy, state.retryAt)),
          futureRequirements: future,
          lastTransitionResult: result,
        });
        throw error;
      }
    }

    state.status = freezeStatus({
      effectiveRequirement,
      currentAuthorityKind: state.current?.authorityKind,
      currentConfigurationRevision: state.current?.configurationRevision,
      currentCandidateId: state.current?.id,
      since: state.since,
      reasons: effectiveRequirement.reasons,
      nextReevaluation: earlierInstant(earliestFutureActivation(future), earlierInstant(effectiveRequirement.reevaluateBy, state.retryAt)),
      futureRequirements: future,
      lastTransitionResult: result,
    });
    return state.status;
  }

  getStatus(id: ObjectId): FidelityStatus {
    return this.#state(id).status;
  }

  configureCandidates(id: ObjectId, candidates: readonly FidelityCandidateInput[]): FidelityStatus {
    const state = this.#state(id);
    const normalized = candidates.map(fidelityCandidate);
    const ids = new Set<string>();
    for (const candidate of normalized) {
      if (ids.has(candidate.id)) throw new RangeError(`Duplicate fidelity candidate id: ${candidate.id}`);
      ids.add(candidate.id);
    }
    state.candidates = Object.freeze(normalized);
    return this.#recompute(id, state.since);
  }

  configureAuthorityCandidates(
    id: ObjectId,
    candidates: readonly FidelityAuthorityCandidateInput[],
    policy?: FidelityAuthorityTransitionPolicy,
  ): FidelityStatus {
    const state = this.#state(id);
    const normalized = candidates.map(fidelityCandidate);
    const ids = new Set<string>();
    for (const candidate of normalized) {
      if (ids.has(candidate.id)) throw new RangeError(`Duplicate fidelity candidate id: ${candidate.id}`);
      ids.add(candidate.id);
    }
    state.candidates = Object.freeze(normalized);
    state.transitionPolicy = normalizeAuthorityPolicy(policy);
    return this.#recompute(id, state.since);
  }

  bindAuthority(
    id: ObjectId,
    authority: MotionAuthority,
    currentCandidateId: string,
    now: SimulationInstant = simulationInstant(0),
    policy?: FidelityAuthorityTransitionPolicy,
  ): FidelityStatus {
    const state = this.#state(id);
    const candidate = state.candidates.find((item) => item.id === currentCandidateId);
    if (candidate === undefined) throw new RangeError(`Unknown fidelity authority candidate: ${currentCandidateId}`);
    if (candidate.model === undefined || candidate.switchTolerance === undefined) {
      throw new TypeError("The bound current fidelity candidate must contain an executable authority configuration");
    }
    state.authority = authority;
    state.transitionPolicy = normalizeAuthorityPolicy(policy);
    state.current = candidate;
    state.since = simulationInstant(now.seconds, now.nanoseconds);
    state.retryAt = undefined;
    state.demotionFailures = 0;
    return this.#recompute(id, state.since);
  }

  transitionAuthority(id: ObjectId, now: SimulationInstant = simulationInstant(0)): FidelityStatus {
    const state = this.#state(id);
    if (state.authority === undefined) throw new TypeError("No MotionAuthority is bound for this fidelity object");
    return this.#recompute(id, now);
  }

  /**
   * Prepare a maneuver authority transition from the caller's canonical
   * physical handoff.  Candidate factories are intentionally invoked here,
   * after Fidelity selection, so maneuver callers never construct a model
   * outside the normal Fidelity/model-switch boundary.
   */
  prepareAuthorityTransition(
    id: ObjectId,
    request: AuthorityTransitionRequest,
  ): PreparedAuthorityTransition {
    const normalizedId = objectId(id);
    const state = this.#state(normalizedId);
    if (state.authority === undefined) throw new TypeError("No MotionAuthority is bound for this fidelity object");
    const requirement = fidelityRequirement(request.requirement);
    const selection = selectFidelityCandidate(requirement, candidatesForAuthority(state), state.current);
    const candidate = selection.candidate;
    const model = candidate.candidateFactory === undefined
      ? candidate.model
      : candidate.candidateFactory({ ...request, objectId: normalizedId, requirement }, candidate);
    if (model === undefined || candidate.switchTolerance === undefined) {
      throw new TypeError("Selected maneuver authority candidate cannot build an executable successor");
    }
    if (state.authority.referenceStatus() === "diverged"
        && model.declaration.kind === "referenceEphemeris") {
      throw new TypeError("A diverged authority cannot resume its reference ephemeris future");
    }
    const executableCandidate = Object.freeze({
      ...candidate,
      model,
      configurationRevision: model.declaration.configurationRevision,
    });
    const beforeCurrent = state.current;
    const beforeSince = state.since;
    const beforeRetryAt = state.retryAt;
    const beforeQuietUntil = state.quietUntil;
    const beforeDemotionFailures = state.demotionFailures;
    const context = state.transitionPolicy.context ?? propagationEvaluationContext({
      objectId: normalizedId,
      currentTime: request.instant,
    });
    const authorityDraft = state.authority.prepareFromHandoff(model, request.instant, request.handoff, {
      tolerance: executableCandidate.switchTolerance!,
      frameResolver: state.transitionPolicy.frameResolver,
      context,
    }, request.currentAuthority);
    const beforeStatus = state.status;
    return Object.freeze({
      candidate: executableCandidate,
      model,
      authorityDraft,
      beforeStatus,
      commit: (reevaluate = true) => {
        state.authority!.commitTransition(authorityDraft);
        state.current = executableCandidate;
        state.since = simulationInstant(request.instant.seconds, request.instant.nanoseconds);
        state.retryAt = undefined;
        state.quietUntil = undefined;
        state.demotionFailures = 0;
        if (reevaluate) return this.#recompute(normalizedId, request.instant);
        const activeRequirements = [...state.signals.values()]
          .filter((item) => item.validFrom === undefined
            || compareSimulationInstants(item.validFrom, request.instant) <= 0);
        const effectiveRequirement = combineFidelityRequirements(activeRequirements);
        state.status = freezeStatus({
          effectiveRequirement,
          currentAuthorityKind: state.current?.authorityKind,
          currentConfigurationRevision: state.current?.configurationRevision,
          currentCandidateId: state.current?.id,
          since: state.since,
          reasons: effectiveRequirement.reasons,
          futureRequirements: futureRequirements(state.signals, request.instant),
          lastTransitionResult: {
            code: FidelityTransitionCode.selected,
            candidateId: executableCandidate.id,
            message: "A maneuver authority was committed at the exact physical handoff",
          },
        });
        return state.status;
      },
      rollback: () => {
        state.authority!.restore(authorityDraft.before);
        state.current = beforeCurrent;
        state.since = beforeSince;
        state.retryAt = beforeRetryAt;
        state.quietUntil = beforeQuietUntil;
        state.demotionFailures = beforeDemotionFailures;
        state.status = beforeStatus;
      },
    });
  }

  /** Remove a maneuver-owned requirement without triggering a demotion. */
  retireSignal(
    id: ObjectId,
    signalId: string,
    now: SimulationInstant = simulationInstant(0),
    reevaluate = true,
  ): FidelityStatus {
    const state = this.#state(id);
    state.signals.delete(signalId);
    if (reevaluate) return this.#recompute(id, now);
    const normalizedNow = simulationInstant(now.seconds, now.nanoseconds);
    const requirements = [...state.signals.values()]
      .filter((requirement) => requirement.validFrom === undefined
        || compareSimulationInstants(requirement.validFrom, normalizedNow) <= 0);
    const effectiveRequirement = combineFidelityRequirements(requirements);
    state.status = freezeStatus({
      effectiveRequirement,
      currentAuthorityKind: state.current?.authorityKind,
      currentConfigurationRevision: state.current?.configurationRevision,
      currentCandidateId: state.current?.id,
      since: state.since,
      reasons: effectiveRequirement.reasons,
      futureRequirements: futureRequirements(state.signals, normalizedNow),
      lastTransitionResult: state.status.lastTransitionResult,
    });
    return state.status;
  }

  setMinimumRequirement(
    id: ObjectId,
    requirement: FidelityRequirementInput | null,
    now: SimulationInstant = simulationInstant(0),
  ): FidelityStatus {
    const state = this.#state(id);
    const normalizedNow = simulationInstant(now.seconds, now.nanoseconds);
    if (requirement === null && state.authority !== undefined) {
      state.quietUntil = addDurationToInstant(normalizedNow, state.transitionPolicy.quietWindow);
    } else if (requirement !== null) {
      state.quietUntil = undefined;
      state.retryAt = undefined;
    }
    state.minimumRequirement = requirement === null ? undefined : fidelityRequirement(requirement);
    return this.#recompute(id, normalizedNow);
  }

  setSignal(
    id: ObjectId,
    signalId: string,
    requirement: FidelityRequirementInput | null,
    now: SimulationInstant = simulationInstant(0),
  ): FidelityStatus {
    if (typeof signalId !== "string" || signalId.trim().length === 0) throw new TypeError("Fidelity signalId must be non-empty");
    const state = this.#state(id);
    const normalizedNow = simulationInstant(now.seconds, now.nanoseconds);
    if (requirement === null) {
      if (state.authority !== undefined) state.quietUntil = addDurationToInstant(normalizedNow, state.transitionPolicy.quietWindow);
      state.signals.delete(signalId);
    } else {
      state.quietUntil = undefined;
      state.retryAt = undefined;
      state.signals.set(signalId, fidelityRequirement(requirement));
    }
    return this.#recompute(id, normalizedNow);
  }

  evaluate(id: ObjectId, now: SimulationInstant = simulationInstant(0)): FidelityStatus {
    return this.#recompute(id, now);
  }
}
