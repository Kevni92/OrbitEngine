import { objectId, type ObjectId } from "./objects.js";
import {
  revisionId,
  type PropagationModelKind,
  type RevisionId,
} from "./propagation.js";
import {
  compareSimulationInstants,
  simulationInstant,
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
}

export interface FidelityCandidate {
  readonly id: string;
  readonly authorityKind: string;
  readonly configurationRevision: RevisionId;
  readonly cost: number;
  readonly capabilities: FidelityCapabilities;
}

export interface FidelityAuthorityRef {
  readonly candidateId?: string;
  readonly authorityKind: string;
  readonly configurationRevision: RevisionId;
}

export const FidelityTransitionCode = Object.freeze({
  unchanged: "unchanged",
  selected: "selected",
  noCandidate: "noCandidate",
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
  readonly lastTransitionResult?: FidelityTransitionResult;
}

export interface FidelitySelection {
  readonly candidate: FidelityCandidate;
  readonly preservedCurrentAuthority: boolean;
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
  return Object.freeze({
    id: value.id,
    authorityKind: value.authorityKind,
    configurationRevision: revisionId(value.configurationRevision),
    cost: value.cost,
    capabilities: normalizeCapabilities(value.capabilities),
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

function freezeStatus(value: FidelityStatus): FidelityStatus {
  return Object.freeze({
    ...value,
    effectiveRequirement: value.effectiveRequirement,
    since: simulationInstant(value.since.seconds, value.since.nanoseconds),
    reasons: Object.freeze([...value.reasons]),
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
  since: SimulationInstant;
  status: FidelityStatus;
}

function defaultStatus(): FidelityStatus {
  const requirement = fidelityRequirement();
  return freezeStatus({
    effectiveRequirement: requirement,
    since: simulationInstant(0),
    reasons: requirement.reasons,
  });
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
      since: status.since,
      status,
    };
    this.#states.set(normalizedId, created);
    return created;
  }

  #recompute(id: ObjectId, now: SimulationInstant): FidelityStatus {
    const state = this.#state(id);
    const normalizedNow = simulationInstant(now.seconds, now.nanoseconds);
    const requirements: FidelityRequirement[] = [...state.signals.values()];
    if (state.minimumRequirement !== undefined) requirements.push(state.minimumRequirement);
    const effectiveRequirement = combineFidelityRequirements(requirements);
    let result: FidelityTransitionResult = {
      code: FidelityTransitionCode.unchanged,
      message: "Current fidelity authority remains valid",
    };

    if (hasPhysicalRequirement(effectiveRequirement)) {
      try {
        const selection = selectFidelityCandidate(effectiveRequirement, state.candidates, state.current);
        if (!sameCandidate(state.current, selection.candidate)) {
          state.since = normalizedNow;
          result = {
            code: FidelityTransitionCode.selected,
            candidateId: selection.candidate.id,
            message: "A configured authority was selected for the effective physical requirement",
          };
        }
        state.current = selection.candidate;
      } catch (error) {
        if (!(error instanceof FidelitySelectionError)) throw error;
        result = {
          code: FidelityTransitionCode.noCandidate,
          message: error.message,
        };
        state.status = freezeStatus({
          effectiveRequirement,
          currentAuthorityKind: state.current?.authorityKind,
          currentConfigurationRevision: state.current?.configurationRevision,
          currentCandidateId: state.current?.id,
          since: state.since,
          reasons: effectiveRequirement.reasons,
          nextReevaluation: effectiveRequirement.reevaluateBy,
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
      nextReevaluation: effectiveRequirement.reevaluateBy,
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

  setMinimumRequirement(
    id: ObjectId,
    requirement: FidelityRequirementInput | null,
    now: SimulationInstant = simulationInstant(0),
  ): FidelityStatus {
    const state = this.#state(id);
    state.minimumRequirement = requirement === null ? undefined : fidelityRequirement(requirement);
    return this.#recompute(id, now);
  }

  setSignal(
    id: ObjectId,
    signalId: string,
    requirement: FidelityRequirementInput | null,
    now: SimulationInstant = simulationInstant(0),
  ): FidelityStatus {
    if (typeof signalId !== "string" || signalId.trim().length === 0) throw new TypeError("Fidelity signalId must be non-empty");
    const state = this.#state(id);
    if (requirement === null) state.signals.delete(signalId);
    else state.signals.set(signalId, fidelityRequirement(requirement));
    return this.#recompute(id, now);
  }

  evaluate(id: ObjectId, now: SimulationInstant = simulationInstant(0)): FidelityStatus {
    return this.#recompute(id, now);
  }
}
