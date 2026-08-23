import type { DependencyRevision } from "./dependency.js";
import { dependencyRevisionDigest, normalizeDependencyRevisions } from "./dependency.js";
import {
  ReferenceStatus,
  type ReferenceStatus as ReferenceStatusValue,
} from "./registry.js";
import { objectId, objectType, ObjectType, type ObjectId, type ObjectType as ObjectTypeValue } from "./objects.js";
import { referenceFrameId, type ReferenceFrameId, vec3, type Vec3 } from "./frames.js";
import { revisionId, type RevisionId } from "./propagation.js";
import { meters, metersPerSecond, type Meters, type MetersPerSecond } from "./units.js";
import {
  compareDurations,
  compareSimulationInstants,
  duration,
  simulationInstant,
  type Duration,
  type SimulationInstant,
} from "./time.js";
import type { PropagationTimeInterval } from "./propagation.js";
import type { ScheduledWorkId } from "./scheduler.js";

const UINT64_MAX = 18_446_744_073_709_551_615n;
const FNV_OFFSET = 14_695_981_039_346_656_037n;
const FNV_PRIME = 1_099_511_628_211n;
const UINT64_MODULUS = UINT64_MAX + 1n;

declare const encounterProfileIdBrand: unique symbol;
declare const encounterIdBrand: unique symbol;

export type EncounterProfileId = string & {
  readonly [encounterProfileIdBrand]: "EncounterProfileId";
};

export type EncounterId = string & {
  readonly [encounterIdBrand]: "EncounterId";
};

export type EncounterGeneration = RevisionId;

export const EncounterPolicyMode = Object.freeze({
  disabled: "disabled",
  monitor: "monitor",
} as const);

export type EncounterPolicyMode = (typeof EncounterPolicyMode)[keyof typeof EncounterPolicyMode];

export const EncounterRecordQuality = Object.freeze({
  coarse: "coarse",
  refined: "refined",
  highFidelityValidated: "highFidelityValidated",
} as const);

export type EncounterRecordQuality = (typeof EncounterRecordQuality)[keyof typeof EncounterRecordQuality];

export const EncounterRecordLifecycle = Object.freeze({
  active: "active",
  stale: "stale",
  retired: "retired",
  failed: "failed",
} as const);

export type EncounterRecordLifecycle = (typeof EncounterRecordLifecycle)[keyof typeof EncounterRecordLifecycle];

export interface EncounterPair {
  readonly objectA: ObjectId;
  readonly objectB: ObjectId;
}

export interface EncounterPolicyResolutionDisabled {
  readonly mode: "disabled";
}

export interface EncounterPolicyResolutionMonitor {
  readonly mode: "monitor";
  readonly profileId: EncounterProfileId;
}

export type EncounterPolicyResolution =
  | EncounterPolicyResolutionDisabled
  | EncounterPolicyResolutionMonitor;

export type EncounterPolicyResolutionInput =
  | { readonly mode: "disabled" }
  | { readonly mode: "monitor"; readonly profileId: EncounterProfileId | string };

export interface EncounterPredictionProfileInput {
  readonly profileId: EncounterProfileId | string;
  readonly lookahead: Duration;
  readonly maintenanceLead: Duration;
  readonly broadPhaseDistanceMeters: number;
  readonly refineDistanceMeters: number;
  readonly closestApproachDistanceToleranceMeters: number;
  readonly closestApproachTimeTolerance: Duration;
  readonly maxBroadPhaseWindows: number;
  readonly maxCandidatesPerMaintenance: number;
  readonly maxCoarseSubdivisionsPerCandidate: number;
  readonly maxRefinementIntervalsPerCandidate: number;
  readonly maxSolverIterationsPerMinimum: number;
  readonly maxPublishedEncountersPerPair: number;
  readonly policyRevision: RevisionId | string;
}

export interface EncounterPredictionProfile {
  readonly profileId: EncounterProfileId;
  readonly lookahead: Duration;
  readonly maintenanceLead: Duration;
  readonly broadPhaseDistanceMeters: number;
  readonly refineDistanceMeters: number;
  readonly closestApproachDistanceToleranceMeters: number;
  readonly closestApproachTimeTolerance: Duration;
  readonly maxBroadPhaseWindows: number;
  readonly maxCandidatesPerMaintenance: number;
  readonly maxCoarseSubdivisionsPerCandidate: number;
  readonly maxRefinementIntervalsPerCandidate: number;
  readonly maxSolverIterationsPerMinimum: number;
  readonly maxPublishedEncountersPerPair: number;
  readonly policyRevision: RevisionId;
}

export interface EncounterObjectFactsInput {
  readonly objectId: ObjectId;
  readonly type: ObjectTypeValue;
  readonly referenceStatus?: ReferenceStatusValue;
}

export interface EncounterObjectFacts {
  readonly objectId: ObjectId;
  readonly type: ObjectTypeValue;
  readonly referenceStatus: ReferenceStatusValue;
}

export interface EncounterPairFactsInput {
  readonly objectA: EncounterObjectFactsInput;
  readonly objectB: EncounterObjectFactsInput;
  readonly interactionTags?: readonly string[];
  readonly hasCollisionGeometry?: boolean;
}

export interface EncounterPairFacts {
  readonly objectA: EncounterObjectFacts;
  readonly objectB: EncounterObjectFacts;
  readonly interactionTags: readonly string[];
  readonly hasCollisionGeometry: boolean;
}

export interface EncounterPolicyRuleInput {
  readonly id: string;
  readonly priority?: number;
  readonly objectTypes?: readonly [ObjectTypeValue, ObjectTypeValue];
  readonly referenceStatuses?: readonly [ReferenceStatusValue, ReferenceStatusValue];
  readonly requiredInteractionTags?: readonly string[];
  readonly requiresCollisionGeometry?: boolean;
  readonly resolution: EncounterPolicyResolutionInput;
}

export interface EncounterPolicyRule extends Omit<EncounterPolicyRuleInput, "objectTypes" | "referenceStatuses" | "requiredInteractionTags" | "resolution"> {
  readonly priority: number;
  readonly objectTypes?: readonly [ObjectTypeValue, ObjectTypeValue];
  readonly referenceStatuses?: readonly [ReferenceStatusValue, ReferenceStatusValue];
  readonly requiredInteractionTags: readonly string[];
  readonly resolution: EncounterPolicyResolution;
}

export interface EncounterPairPolicyOverrideInput {
  readonly objectA: ObjectId;
  readonly objectB: ObjectId;
  readonly resolution: EncounterPolicyResolutionInput;
}

export interface EncounterPairPolicyOverride {
  readonly objectA: ObjectId;
  readonly objectB: ObjectId;
  readonly resolution: EncounterPolicyResolution;
}

export interface EncounterObjectPolicyOverrideInput {
  readonly objectId: ObjectId;
  readonly resolution: EncounterPolicyResolutionInput;
}

export interface EncounterObjectPolicyOverride {
  readonly objectId: ObjectId;
  readonly resolution: EncounterPolicyResolution;
}

export interface EncounterPolicyInput {
  readonly revision: RevisionId | string;
  readonly profiles: readonly EncounterPredictionProfileInput[];
  readonly pairOverrides?: readonly EncounterPairPolicyOverrideInput[];
  readonly objectOverrides?: readonly EncounterObjectPolicyOverrideInput[];
  readonly rules?: readonly EncounterPolicyRuleInput[];
  readonly defaultResolution?: EncounterPolicyResolutionInput;
}

export interface EncounterPolicy {
  readonly revision: RevisionId;
  readonly profiles: readonly EncounterPredictionProfile[];
  readonly pairOverrides: readonly EncounterPairPolicyOverride[];
  readonly objectOverrides: readonly EncounterObjectPolicyOverride[];
  readonly rules: readonly EncounterPolicyRule[];
  readonly defaultResolution: EncounterPolicyResolution;
}

export interface EncounterDomainContextInput {
  readonly domainId: string;
  readonly frame: ReferenceFrameId;
}

export interface EncounterDomainContext {
  readonly domainId: string;
  readonly frame: ReferenceFrameId;
}

export interface EncounterRecordInput {
  readonly encounterId?: EncounterId | string;
  readonly continuityKey?: string;
  readonly generation: EncounterGeneration | string;
  readonly objectA: ObjectId;
  readonly objectB: ObjectId;
  readonly predictionInterval: PropagationTimeInterval;
  readonly closestApproachInstant: SimulationInstant;
  readonly closestApproachDistanceMeters: number;
  readonly relativeVelocityAtClosestApproach: Vec3<number>;
  readonly quality: EncounterRecordQuality;
  readonly timeUncertainty: Duration;
  readonly distanceUncertaintyMeters: number;
  readonly domain: EncounterDomainContextInput;
  readonly dependencyRevisions?: readonly DependencyRevision[];
  readonly dependencyRevisionDigest?: RevisionId | string;
  readonly policyRevision: RevisionId | string;
  readonly profileId: EncounterProfileId | string;
  readonly scheduledRefinementWorkId?: ScheduledWorkId;
  readonly scheduledFidelityWorkId?: ScheduledWorkId;
  readonly lifecycle?: EncounterRecordLifecycle;
}

export interface EncounterRecord {
  readonly encounterId: EncounterId;
  readonly generation: EncounterGeneration;
  readonly objectA: ObjectId;
  readonly objectB: ObjectId;
  readonly predictionInterval: PropagationTimeInterval;
  readonly closestApproachInstant: SimulationInstant;
  readonly closestApproachDistanceMeters: Meters;
  readonly relativeVelocityAtClosestApproach: Vec3<MetersPerSecond>;
  readonly quality: EncounterRecordQuality;
  readonly timeUncertainty: Duration;
  readonly distanceUncertaintyMeters: Meters;
  readonly domain: EncounterDomainContext;
  readonly dependencyRevisionDigest?: RevisionId;
  readonly policyRevision: RevisionId;
  readonly profileId: EncounterProfileId;
  readonly scheduledRefinementWorkId?: ScheduledWorkId;
  readonly scheduledFidelityWorkId?: ScheduledWorkId;
  readonly lifecycle: EncounterRecordLifecycle;
}

export interface SerializedEncounterRecord {
  readonly encounterId: string;
  readonly generation: string;
  readonly objectA: string;
  readonly objectB: string;
  readonly predictionInterval: {
    readonly start: { readonly seconds: number; readonly nanoseconds: number };
    readonly end?: { readonly seconds: number; readonly nanoseconds: number };
  };
  readonly closestApproachInstant: { readonly seconds: number; readonly nanoseconds: number };
  readonly closestApproachDistanceMeters: number;
  readonly relativeVelocityAtClosestApproach: { readonly x: number; readonly y: number; readonly z: number };
  readonly quality: EncounterRecordQuality;
  readonly timeUncertainty: { readonly seconds: number; readonly nanoseconds: number };
  readonly distanceUncertaintyMeters: number;
  readonly domain: { readonly domainId: string; readonly frame: string };
  readonly dependencyRevisionDigest?: string;
  readonly policyRevision: string;
  readonly profileId: string;
  readonly scheduledRefinementWorkId?: string;
  readonly scheduledFidelityWorkId?: string;
  readonly lifecycle: EncounterRecordLifecycle;
}

function compareText(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function compareObjectId(left: ObjectId, right: ObjectId): number {
  const leftValue = BigInt(left);
  const rightValue = BigInt(right);
  return leftValue === rightValue ? 0 : leftValue < rightValue ? -1 : 1;
}

function assertIdentifier(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    throw new TypeError(`${name} must be a non-empty identifier without surrounding whitespace`);
  }
}

function normalizedProfileId(value: EncounterProfileId | string, name = "profileId"): EncounterProfileId {
  assertIdentifier(value, name);
  return value as EncounterProfileId;
}

function normalizedDomainId(value: string): string {
  assertIdentifier(value, "domainId");
  return value;
}

function normalizedRevision(value: RevisionId | string, name: string): RevisionId {
  if (typeof value !== "string") throw new TypeError(`${name} must be a revision`);
  try {
    return revisionId(value);
  } catch (error) {
    throw new RangeError(`${name} must be canonical uint64 decimal text: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function normalizedDuration(value: Duration, name: string): Duration {
  if (typeof value !== "object" || value === null) throw new TypeError(`${name} must be a Duration`);
  try {
    return duration(value.seconds, value.nanoseconds);
  } catch (error) {
    throw new RangeError(`${name} is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function requirePositiveDuration(value: Duration, name: string): Duration {
  const normalized = normalizedDuration(value, name);
  if (compareDurations(normalized, duration(0)) <= 0) throw new RangeError(`${name} must be positive`);
  return normalized;
}

function requireNonNegativeDuration(value: Duration, name: string): Duration {
  const normalized = normalizedDuration(value, name);
  if (compareDurations(normalized, duration(0)) < 0) throw new RangeError(`${name} must be non-negative`);
  return normalized;
}

function finiteNonNegative(value: number, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a finite non-negative number`);
  }
  return value;
}

function positiveSafeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive safe integer`);
  return value;
}

function normalizedPair(objectA: ObjectId, objectB: ObjectId): EncounterPair {
  const left = objectId(objectA);
  const right = objectId(objectB);
  if (left === right) throw new RangeError("An encounter pair requires two distinct ObjectIds");
  return BigInt(left) < BigInt(right)
    ? Object.freeze({ objectA: left, objectB: right })
    : Object.freeze({ objectA: right, objectB: left });
}

export function canonicalEncounterPair(objectA: ObjectId, objectB: ObjectId): EncounterPair {
  return normalizedPair(objectA, objectB);
}

function normalizedResolution(value: EncounterPolicyResolutionInput, profiles: ReadonlyMap<EncounterProfileId, EncounterPredictionProfile>): EncounterPolicyResolution {
  if (typeof value !== "object" || value === null) throw new TypeError("Encounter policy resolution must be an object");
  if (value.mode === "disabled") return Object.freeze({ mode: "disabled" });
  if (value.mode !== "monitor") throw new RangeError(`Unknown encounter policy mode: ${String((value as { readonly mode: unknown }).mode)}`);
  const profileId = normalizedProfileId(value.profileId);
  if (!profiles.has(profileId)) throw new RangeError(`Encounter policy references unknown profile: ${profileId}`);
  return Object.freeze({ mode: "monitor", profileId });
}

function normalizedObjectTypes(value: readonly [ObjectTypeValue, ObjectTypeValue] | undefined): readonly [ObjectTypeValue, ObjectTypeValue] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length !== 2) throw new TypeError("Rule objectTypes must contain exactly two ObjectTypes");
  const result = [objectType(value[0]), objectType(value[1])] as [ObjectTypeValue, ObjectTypeValue];
  result.sort(compareText);
  return Object.freeze(result);
}

function normalizedReferenceStatuses(value: readonly [ReferenceStatusValue, ReferenceStatusValue] | undefined): readonly [ReferenceStatusValue, ReferenceStatusValue] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length !== 2) throw new TypeError("Rule referenceStatuses must contain exactly two statuses");
  const result = [value[0], value[1]] as [ReferenceStatusValue, ReferenceStatusValue];
  for (const status of result) {
    if (status !== ReferenceStatus.none && status !== ReferenceStatus.followingReference && status !== ReferenceStatus.diverged) {
      throw new RangeError(`Unknown reference status: ${String(status)}`);
    }
  }
  result.sort(compareText);
  return Object.freeze(result);
}

function normalizedReferenceStatus(value: ReferenceStatusValue | undefined, name: string): ReferenceStatusValue {
  const result = value ?? ReferenceStatus.none;
  if (result !== ReferenceStatus.none && result !== ReferenceStatus.followingReference && result !== ReferenceStatus.diverged) {
    throw new RangeError(`${name} has an unknown reference status: ${String(result)}`);
  }
  return result;
}

function normalizedTags(values: readonly string[] | undefined, name: string): readonly string[] {
  if (values === undefined) return Object.freeze([]);
  const result = values.map((value) => {
    assertIdentifier(value, `${name} entry`);
    return value;
  });
  result.sort(compareText);
  for (let index = 1; index < result.length; index += 1) {
    if (result[index] === result[index - 1]) throw new RangeError(`${name} contains a duplicate tag`);
  }
  return Object.freeze(result);
}

export function normalizeEncounterPredictionProfile(value: EncounterPredictionProfileInput): EncounterPredictionProfile {
  if (typeof value !== "object" || value === null) throw new TypeError("Encounter prediction profile must be an object");
  const profileId = normalizedProfileId(value.profileId);
  const lookahead = requirePositiveDuration(value.lookahead, "lookahead");
  const maintenanceLead = requireNonNegativeDuration(value.maintenanceLead, "maintenanceLead");
  const broadPhaseDistanceMeters = finiteNonNegative(value.broadPhaseDistanceMeters, "broadPhaseDistanceMeters");
  const refineDistanceMeters = finiteNonNegative(value.refineDistanceMeters, "refineDistanceMeters");
  if (refineDistanceMeters > broadPhaseDistanceMeters) throw new RangeError("refineDistanceMeters must not exceed broadPhaseDistanceMeters");
  const closestApproachDistanceToleranceMeters = finiteNonNegative(
    value.closestApproachDistanceToleranceMeters,
    "closestApproachDistanceToleranceMeters",
  );
  const closestApproachTimeTolerance = requirePositiveDuration(value.closestApproachTimeTolerance, "closestApproachTimeTolerance");
  const maxBroadPhaseWindows = positiveSafeInteger(value.maxBroadPhaseWindows, "maxBroadPhaseWindows");
  const maxCandidatesPerMaintenance = positiveSafeInteger(value.maxCandidatesPerMaintenance, "maxCandidatesPerMaintenance");
  const maxCoarseSubdivisionsPerCandidate = positiveSafeInteger(value.maxCoarseSubdivisionsPerCandidate, "maxCoarseSubdivisionsPerCandidate");
  const maxRefinementIntervalsPerCandidate = positiveSafeInteger(value.maxRefinementIntervalsPerCandidate, "maxRefinementIntervalsPerCandidate");
  const maxSolverIterationsPerMinimum = positiveSafeInteger(value.maxSolverIterationsPerMinimum, "maxSolverIterationsPerMinimum");
  const maxPublishedEncountersPerPair = positiveSafeInteger(value.maxPublishedEncountersPerPair, "maxPublishedEncountersPerPair");
  const policyRevision = normalizedRevision(value.policyRevision, "policyRevision");
  return Object.freeze({
    profileId,
    lookahead,
    maintenanceLead,
    broadPhaseDistanceMeters,
    refineDistanceMeters,
    closestApproachDistanceToleranceMeters,
    closestApproachTimeTolerance,
    maxBroadPhaseWindows,
    maxCandidatesPerMaintenance,
    maxCoarseSubdivisionsPerCandidate,
    maxRefinementIntervalsPerCandidate,
    maxSolverIterationsPerMinimum,
    maxPublishedEncountersPerPair,
    policyRevision,
  });
}

function normalizedRule(value: EncounterPolicyRuleInput, profiles: ReadonlyMap<EncounterProfileId, EncounterPredictionProfile>): EncounterPolicyRule {
  if (typeof value !== "object" || value === null) throw new TypeError("Encounter policy rule must be an object");
  assertIdentifier(value.id, "Encounter policy rule id");
  const priority = value.priority ?? 0;
  if (!Number.isSafeInteger(priority)) throw new RangeError("Encounter policy rule priority must be a safe integer");
  const requiresCollisionGeometry = value.requiresCollisionGeometry;
  if (requiresCollisionGeometry !== undefined && typeof requiresCollisionGeometry !== "boolean") {
    throw new TypeError("requiresCollisionGeometry must be boolean when supplied");
  }
  return Object.freeze({
    id: value.id,
    priority,
    objectTypes: normalizedObjectTypes(value.objectTypes),
    referenceStatuses: normalizedReferenceStatuses(value.referenceStatuses),
    requiredInteractionTags: normalizedTags(value.requiredInteractionTags, "requiredInteractionTags"),
    ...(requiresCollisionGeometry === undefined ? {} : { requiresCollisionGeometry }),
    resolution: normalizedResolution(value.resolution, profiles),
  });
}

export function normalizeEncounterPolicy(value: EncounterPolicyInput): EncounterPolicy {
  if (typeof value !== "object" || value === null) throw new TypeError("Encounter policy must be an object");
  const revision = normalizedRevision(value.revision, "Encounter policy revision");
  if (!Array.isArray(value.profiles)) throw new TypeError("Encounter policy profiles must be an array");
  const profiles = value.profiles.map(normalizeEncounterPredictionProfile);
  profiles.sort((left, right) => compareText(left.profileId, right.profileId));
  const profileMap = new Map<EncounterProfileId, EncounterPredictionProfile>();
  for (const profile of profiles) {
    if (profileMap.has(profile.profileId)) throw new RangeError(`Duplicate encounter profile: ${profile.profileId}`);
    if (profile.policyRevision !== revision) {
      throw new RangeError(`Encounter profile ${profile.profileId} policyRevision must match policy revision`);
    }
    profileMap.set(profile.profileId, profile);
  }

  const pairOverrides = (value.pairOverrides ?? []).map((override) => {
    const pair = normalizedPair(override.objectA, override.objectB);
    return Object.freeze({ ...pair, resolution: normalizedResolution(override.resolution, profileMap) });
  });
  pairOverrides.sort((left, right) => compareObjectId(left.objectA, right.objectA) || compareObjectId(left.objectB, right.objectB));
  for (let index = 1; index < pairOverrides.length; index += 1) {
    const previous = pairOverrides[index - 1]!;
    const current = pairOverrides[index]!;
    if (previous.objectA === current.objectA && previous.objectB === current.objectB) {
      throw new RangeError(`Duplicate encounter pair override: ${current.objectA},${current.objectB}`);
    }
  }

  const objectOverrides = (value.objectOverrides ?? []).map((override) => Object.freeze({
    objectId: objectId(override.objectId),
    resolution: normalizedResolution(override.resolution, profileMap),
  }));
  objectOverrides.sort((left, right) => compareText(left.objectId, right.objectId));
  for (let index = 1; index < objectOverrides.length; index += 1) {
    if (objectOverrides[index]!.objectId === objectOverrides[index - 1]!.objectId) {
      throw new RangeError(`Duplicate encounter object override: ${objectOverrides[index]!.objectId}`);
    }
  }

  const rules = (value.rules ?? []).map((rule) => normalizedRule(rule, profileMap));
  const ruleIds = new Set<string>();
  for (const rule of rules) {
    if (ruleIds.has(rule.id)) throw new RangeError(`Duplicate encounter policy rule: ${rule.id}`);
    ruleIds.add(rule.id);
  }
  rules.sort((left, right) => right.priority - left.priority || compareText(left.id, right.id));

  return Object.freeze({
    revision,
    profiles: Object.freeze(profiles),
    pairOverrides: Object.freeze(pairOverrides),
    objectOverrides: Object.freeze(objectOverrides),
    rules: Object.freeze(rules),
    defaultResolution: normalizedResolution(value.defaultResolution ?? { mode: "disabled" }, profileMap),
  });
}

export function createDisabledEncounterPolicy(revision: RevisionId | string = "0"): EncounterPolicy {
  return normalizeEncounterPolicy({ revision, profiles: [] });
}

function normalizedFacts(pair: EncounterPair, value: EncounterPairFactsInput): EncounterPairFacts {
  if (typeof value !== "object" || value === null) throw new TypeError("Encounter pair facts must be an object");
  const objectA = Object.freeze({
    objectId: objectId(value.objectA.objectId),
    type: objectType(value.objectA.type),
    referenceStatus: normalizedReferenceStatus(value.objectA.referenceStatus, "objectA.referenceStatus"),
  });
  const objectB = Object.freeze({
    objectId: objectId(value.objectB.objectId),
    type: objectType(value.objectB.type),
    referenceStatus: normalizedReferenceStatus(value.objectB.referenceStatus, "objectB.referenceStatus"),
  });
  if (objectA.objectId !== pair.objectA || objectB.objectId !== pair.objectB) {
    throw new RangeError("Encounter pair facts must use the canonical pair ordering");
  }
  const interactionTags = normalizedTags(value.interactionTags, "interactionTags");
  const hasCollisionGeometry = value.hasCollisionGeometry ?? false;
  if (typeof hasCollisionGeometry !== "boolean") throw new TypeError("hasCollisionGeometry must be boolean");
  return Object.freeze({ objectA, objectB, interactionTags, hasCollisionGeometry });
}

function ruleMatches(rule: EncounterPolicyRule, facts: EncounterPairFacts | undefined): boolean {
  if (facts === undefined) return rule.objectTypes === undefined
    && rule.referenceStatuses === undefined
    && rule.requiredInteractionTags.length === 0
    && rule.requiresCollisionGeometry === undefined;
  if (rule.objectTypes !== undefined) {
    const actual = [facts.objectA.type, facts.objectB.type].sort(compareText);
    if (actual[0] !== rule.objectTypes[0] || actual[1] !== rule.objectTypes[1]) return false;
  }
  if (rule.referenceStatuses !== undefined) {
    const actual = [facts.objectA.referenceStatus, facts.objectB.referenceStatus].sort(compareText);
    if (actual[0] !== rule.referenceStatuses[0] || actual[1] !== rule.referenceStatuses[1]) return false;
  }
  if (rule.requiredInteractionTags.some((tag) => !facts.interactionTags.includes(tag))) return false;
  return rule.requiresCollisionGeometry === undefined || rule.requiresCollisionGeometry === facts.hasCollisionGeometry;
}

export function resolveEncounterPolicy(
  policy: EncounterPolicy,
  objectA: ObjectId,
  objectB: ObjectId,
  facts?: EncounterPairFactsInput,
): EncounterPolicyResolution {
  const normalizedPolicy = normalizeEncounterPolicy(policy);
  const pair = normalizedPair(objectA, objectB);
  const pairOverride = normalizedPolicy.pairOverrides.find((override) => override.objectA === pair.objectA && override.objectB === pair.objectB);
  if (pairOverride !== undefined) return pairOverride.resolution;

  const objectOverrideA = normalizedPolicy.objectOverrides.find((override) => override.objectId === pair.objectA);
  const objectOverrideB = normalizedPolicy.objectOverrides.find((override) => override.objectId === pair.objectB);
  if (objectOverrideA !== undefined) return objectOverrideA.resolution;
  if (objectOverrideB !== undefined) return objectOverrideB.resolution;

  const normalizedPairFacts = facts === undefined ? undefined : normalizedFacts(pair, facts);
  const rule = normalizedPolicy.rules.find((candidate) => ruleMatches(candidate, normalizedPairFacts));
  return rule?.resolution ?? normalizedPolicy.defaultResolution;
}

export type EncounterPolicyRevisionListener = (previous: EncounterPolicy, next: EncounterPolicy) => void;

export class EncounterPolicyManager {
  #policy: EncounterPolicy;
  readonly #onRevisionChange?: EncounterPolicyRevisionListener;

  constructor(initial?: EncounterPolicyInput, onRevisionChange?: EncounterPolicyRevisionListener) {
    this.#policy = initial === undefined ? createDisabledEncounterPolicy() : normalizeEncounterPolicy(initial);
    this.#onRevisionChange = onRevisionChange;
  }

  get policy(): EncounterPolicy {
    return this.#policy;
  }

  setPolicy(value: EncounterPolicyInput): EncounterPolicy {
    const next = normalizeEncounterPolicy(value);
    if (next.revision === this.#policy.revision) {
      if (JSON.stringify(serializeEncounterPolicy(this.#policy)) !== JSON.stringify(serializeEncounterPolicy(next))) {
        throw new RangeError("Encounter policy revision must change when policy contents change");
      }
      return this.#policy;
    }
    const previous = this.#policy;
    this.#policy = next;
    this.#onRevisionChange?.(previous, next);
    return next;
  }

  resolve(objectA: ObjectId, objectB: ObjectId, facts?: EncounterPairFactsInput): EncounterPolicyResolution {
    return resolveEncounterPolicy(this.#policy, objectA, objectB, facts);
  }
}

export function encounterId(value: string): EncounterId {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value) || BigInt(value) > UINT64_MAX) {
    throw new RangeError("EncounterId must be canonical decimal text in the range 1..uint64_max");
  }
  return value as EncounterId;
}

export function isEncounterId(value: unknown): value is EncounterId {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) return false;
  try {
    return BigInt(value) <= UINT64_MAX;
  } catch {
    return false;
  }
}

export function encounterIdForPair(pair: EncounterPair, continuityKey = "0"): EncounterId {
  const canonical = normalizedPair(pair.objectA, pair.objectB);
  assertIdentifier(continuityKey, "continuityKey");
  let hash = FNV_OFFSET;
  const input = `${canonical.objectA}\u0000${canonical.objectB}\u0000${continuityKey}`;
  for (const character of input) {
    hash ^= BigInt(character.codePointAt(0)!);
    hash = (hash * FNV_PRIME) % UINT64_MODULUS;
  }
  if (hash === 0n) hash = 1n;
  return encounterId(hash.toString());
}

export function nextEncounterGeneration(value: EncounterGeneration | string): EncounterGeneration {
  const current = BigInt(normalizedRevision(value, "generation"));
  if (current >= UINT64_MAX) throw new RangeError("Encounter generation overflow");
  return revisionId((current + 1n).toString());
}

function normalizedInterval(value: PropagationTimeInterval): PropagationTimeInterval {
  if (typeof value !== "object" || value === null) throw new TypeError("predictionInterval must be an interval");
  const start = simulationInstant(value.start.seconds, value.start.nanoseconds);
  const end = value.end === undefined ? undefined : simulationInstant(value.end.seconds, value.end.nanoseconds);
  if (end !== undefined && compareSimulationInstants(start, end) >= 0) throw new RangeError("predictionInterval end must be after start");
  return Object.freeze({ start, ...(end === undefined ? {} : { end }) });
}

function normalizedQuality(value: EncounterRecordQuality): EncounterRecordQuality {
  if (value !== EncounterRecordQuality.coarse && value !== EncounterRecordQuality.refined && value !== EncounterRecordQuality.highFidelityValidated) {
    throw new RangeError(`Unknown encounter quality: ${String(value)}`);
  }
  return value;
}

function normalizedLifecycle(value: EncounterRecordLifecycle | undefined): EncounterRecordLifecycle {
  const lifecycle = value ?? EncounterRecordLifecycle.active;
  if (lifecycle !== EncounterRecordLifecycle.active
    && lifecycle !== EncounterRecordLifecycle.stale
    && lifecycle !== EncounterRecordLifecycle.retired
    && lifecycle !== EncounterRecordLifecycle.failed) {
    throw new RangeError(`Unknown encounter lifecycle: ${String(lifecycle)}`);
  }
  return lifecycle;
}

function normalizedDomain(value: EncounterDomainContextInput): EncounterDomainContext {
  if (typeof value !== "object" || value === null) throw new TypeError("Encounter domain context must be an object");
  return Object.freeze({ domainId: normalizedDomainId(value.domainId), frame: referenceFrameId(value.frame) });
}

function normalizedWorkId(value: ScheduledWorkId | undefined, name: string): ScheduledWorkId | undefined {
  if (value === undefined) return undefined;
  assertIdentifier(value, name);
  return value;
}

export function createEncounterRecord(value: EncounterRecordInput): EncounterRecord {
  if (typeof value !== "object" || value === null) throw new TypeError("Encounter record must be an object");
  const pair = normalizedPair(value.objectA, value.objectB);
  const encounterIdValue = value.encounterId === undefined
    ? encounterIdForPair(pair, value.continuityKey ?? "0")
    : encounterId(value.encounterId);
  const generation = normalizedRevision(value.generation, "generation");
  const predictionInterval = normalizedInterval(value.predictionInterval);
  const closestApproachInstant = simulationInstant(value.closestApproachInstant.seconds, value.closestApproachInstant.nanoseconds);
  if (compareSimulationInstants(closestApproachInstant, predictionInterval.start) < 0
    || (predictionInterval.end !== undefined && compareSimulationInstants(closestApproachInstant, predictionInterval.end) >= 0)) {
    throw new RangeError("closestApproachInstant must lie within predictionInterval");
  }
  const closestApproachDistanceMeters = meters(finiteNonNegative(value.closestApproachDistanceMeters, "closestApproachDistanceMeters"));
  const relativeVelocityAtClosestApproach = vec3(
    metersPerSecond(value.relativeVelocityAtClosestApproach.x),
    metersPerSecond(value.relativeVelocityAtClosestApproach.y),
    metersPerSecond(value.relativeVelocityAtClosestApproach.z),
  );
  const quality = normalizedQuality(value.quality);
  const timeUncertainty = requireNonNegativeDuration(value.timeUncertainty, "timeUncertainty");
  const distanceUncertaintyMeters = meters(finiteNonNegative(value.distanceUncertaintyMeters, "distanceUncertaintyMeters"));
  const domain = normalizedDomain(value.domain);
  const dependencies = value.dependencyRevisions === undefined ? undefined : normalizeDependencyRevisions(value.dependencyRevisions);
  const computedDigest = dependencyRevisionDigest(dependencies);
  const dependencyRevisionDigestValue = value.dependencyRevisionDigest === undefined
    ? computedDigest
    : normalizedRevision(value.dependencyRevisionDigest, "dependencyRevisionDigest");
  if (computedDigest !== undefined && dependencyRevisionDigestValue !== computedDigest) {
    throw new RangeError("dependencyRevisionDigest does not match dependencyRevisions");
  }
  const policyRevision = normalizedRevision(value.policyRevision, "policyRevision");
  const profileId = normalizedProfileId(value.profileId);
  const lifecycle = normalizedLifecycle(value.lifecycle);
  return Object.freeze({
    encounterId: encounterIdValue,
    generation,
    objectA: pair.objectA,
    objectB: pair.objectB,
    predictionInterval,
    closestApproachInstant,
    closestApproachDistanceMeters,
    relativeVelocityAtClosestApproach,
    quality,
    timeUncertainty,
    distanceUncertaintyMeters,
    domain,
    ...(dependencyRevisionDigestValue === undefined ? {} : { dependencyRevisionDigest: dependencyRevisionDigestValue }),
    policyRevision,
    profileId,
    ...(value.scheduledRefinementWorkId === undefined ? {} : { scheduledRefinementWorkId: normalizedWorkId(value.scheduledRefinementWorkId, "scheduledRefinementWorkId") }),
    ...(value.scheduledFidelityWorkId === undefined ? {} : { scheduledFidelityWorkId: normalizedWorkId(value.scheduledFidelityWorkId, "scheduledFidelityWorkId") }),
    lifecycle,
  });
}

const QUALITY_ORDER: Readonly<Record<EncounterRecordQuality, number>> = Object.freeze({
  coarse: 0,
  refined: 1,
  highFidelityValidated: 2,
});

export function upgradeEncounterRecordQuality(record: EncounterRecord, quality: EncounterRecordQuality): EncounterRecord {
  const nextQuality = normalizedQuality(quality);
  if (QUALITY_ORDER[nextQuality] < QUALITY_ORDER[record.quality]) throw new RangeError("Encounter quality cannot be downgraded");
  return createEncounterRecord({ ...record, quality: nextQuality });
}

export function canTransitionEncounterLifecycle(from: EncounterRecordLifecycle, to: EncounterRecordLifecycle): boolean {
  if (from === to) return true;
  if (from === EncounterRecordLifecycle.retired) return false;
  if (from === EncounterRecordLifecycle.active) return to === EncounterRecordLifecycle.stale
    || to === EncounterRecordLifecycle.failed
    || to === EncounterRecordLifecycle.retired;
  return to === EncounterRecordLifecycle.retired;
}

export function transitionEncounterRecordLifecycle(record: EncounterRecord, lifecycle: EncounterRecordLifecycle): EncounterRecord {
  const next = normalizedLifecycle(lifecycle);
  if (!canTransitionEncounterLifecycle(record.lifecycle, next)) {
    throw new RangeError(`Invalid encounter lifecycle transition: ${record.lifecycle} -> ${next}`);
  }
  return createEncounterRecord({ ...record, lifecycle: next });
}

function serializeInstant(value: SimulationInstant): { readonly seconds: number; readonly nanoseconds: number } {
  return Object.freeze({ seconds: value.seconds, nanoseconds: value.nanoseconds });
}

function serializeDurationValue(value: Duration): { readonly seconds: number; readonly nanoseconds: number } {
  return Object.freeze({ seconds: value.seconds, nanoseconds: value.nanoseconds });
}

export function serializeEncounterRecord(record: EncounterRecord): SerializedEncounterRecord {
  const normalized = createEncounterRecord(record);
  return Object.freeze({
    encounterId: normalized.encounterId,
    generation: normalized.generation,
    objectA: normalized.objectA,
    objectB: normalized.objectB,
    predictionInterval: Object.freeze({
      start: serializeInstant(normalized.predictionInterval.start),
      ...(normalized.predictionInterval.end === undefined ? {} : { end: serializeInstant(normalized.predictionInterval.end) }),
    }),
    closestApproachInstant: serializeInstant(normalized.closestApproachInstant),
    closestApproachDistanceMeters: normalized.closestApproachDistanceMeters,
    relativeVelocityAtClosestApproach: Object.freeze({ ...normalized.relativeVelocityAtClosestApproach }),
    quality: normalized.quality,
    timeUncertainty: serializeDurationValue(normalized.timeUncertainty),
    distanceUncertaintyMeters: normalized.distanceUncertaintyMeters,
    domain: Object.freeze({ domainId: normalized.domain.domainId, frame: normalized.domain.frame }),
    ...(normalized.dependencyRevisionDigest === undefined ? {} : { dependencyRevisionDigest: normalized.dependencyRevisionDigest }),
    policyRevision: normalized.policyRevision,
    profileId: normalized.profileId,
    ...(normalized.scheduledRefinementWorkId === undefined ? {} : { scheduledRefinementWorkId: normalized.scheduledRefinementWorkId }),
    ...(normalized.scheduledFidelityWorkId === undefined ? {} : { scheduledFidelityWorkId: normalized.scheduledFidelityWorkId }),
    lifecycle: normalized.lifecycle,
  });
}

export function deserializeEncounterRecord(value: SerializedEncounterRecord): EncounterRecord {
  return createEncounterRecord({
    encounterId: value.encounterId,
    generation: value.generation,
    objectA: objectId(value.objectA),
    objectB: objectId(value.objectB),
    predictionInterval: {
      start: simulationInstant(value.predictionInterval.start.seconds, value.predictionInterval.start.nanoseconds),
      end: value.predictionInterval.end === undefined ? undefined : simulationInstant(value.predictionInterval.end.seconds, value.predictionInterval.end.nanoseconds),
    },
    closestApproachInstant: simulationInstant(value.closestApproachInstant.seconds, value.closestApproachInstant.nanoseconds),
    closestApproachDistanceMeters: value.closestApproachDistanceMeters,
    relativeVelocityAtClosestApproach: value.relativeVelocityAtClosestApproach,
    quality: value.quality,
    timeUncertainty: duration(value.timeUncertainty.seconds, value.timeUncertainty.nanoseconds),
    distanceUncertaintyMeters: value.distanceUncertaintyMeters,
    domain: { domainId: value.domain.domainId, frame: referenceFrameId(value.domain.frame) },
    dependencyRevisionDigest: value.dependencyRevisionDigest,
    policyRevision: value.policyRevision,
    profileId: value.profileId,
    scheduledRefinementWorkId: value.scheduledRefinementWorkId as ScheduledWorkId | undefined,
    scheduledFidelityWorkId: value.scheduledFidelityWorkId as ScheduledWorkId | undefined,
    lifecycle: value.lifecycle,
  });
}

export interface SerializedEncounterPolicy {
  readonly revision: string;
  readonly profiles: readonly EncounterPredictionProfile[];
  readonly pairOverrides: readonly EncounterPairPolicyOverride[];
  readonly objectOverrides: readonly EncounterObjectPolicyOverride[];
  readonly rules: readonly EncounterPolicyRule[];
  readonly defaultResolution: EncounterPolicyResolution;
}

export function serializeEncounterPolicy(policy: EncounterPolicy): SerializedEncounterPolicy {
  const normalized = normalizeEncounterPolicy(policy);
  return Object.freeze({
    revision: normalized.revision,
    profiles: normalized.profiles,
    pairOverrides: normalized.pairOverrides,
    objectOverrides: normalized.objectOverrides,
    rules: normalized.rules,
    defaultResolution: normalized.defaultResolution,
  });
}
