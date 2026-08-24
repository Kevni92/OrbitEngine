import type { DependencyRevision } from "./dependency.js";
import { dependencyRevisionDigest, normalizeDependencyRevisions } from "./dependency.js";
import { ReferenceStatus, type ReferenceStatus as ReferenceStatusValue } from "./registry.js";
import { objectId, objectType, ObjectType, type ObjectId, type ObjectType as ObjectTypeValue } from "./objects.js";
import { referenceFrameId, type ReferenceFrameId, vec3, type Vec3 } from "./frames.js";
import { propagationState, revisionId, type PropagationState, type RevisionId } from "./propagation.js";
import { meters, metersPerSecond, type Meters, type MetersPerSecond } from "./units.js";
import {
  compareDurations,
  duration,
  simulationInstant,
  type Duration,
  type SimulationInstant,
} from "./time.js";

const UINT64_MAX = 18_446_744_073_709_551_615n;
const FNV_OFFSET = 14_695_981_039_346_656_037n;
const FNV_PRIME = 1_099_511_628_211n;
const UINT64_MODULUS = UINT64_MAX + 1n;

declare const collisionProfileIdBrand: unique symbol;
declare const collisionContactIdBrand: unique symbol;

export type CollisionProfileId = string & {
  readonly [collisionProfileIdBrand]: "CollisionProfileId";
};

export type CollisionContactId = string & {
  readonly [collisionContactIdBrand]: "CollisionContactId";
};

export type CollisionGeneration = RevisionId;

export const CollisionPolicyMode = Object.freeze({
  disabled: "disabled",
  enabled: "enabled",
} as const);

export type CollisionPolicyMode = (typeof CollisionPolicyMode)[keyof typeof CollisionPolicyMode];

export const CollisionResponseMode = Object.freeze({
  detectOnly: "detectOnly",
  frictionlessImpulse: "frictionlessImpulse",
} as const);

export type CollisionResponseMode = (typeof CollisionResponseMode)[keyof typeof CollisionResponseMode];

export const CollisionContactQuality = Object.freeze({
  coarse: "coarse",
  refined: "refined",
  highFidelityValidated: "highFidelityValidated",
} as const);

export type CollisionContactQuality = (typeof CollisionContactQuality)[keyof typeof CollisionContactQuality];

export const CollisionContactLifecycle = Object.freeze({
  active: "active",
  stale: "stale",
  retired: "retired",
  failed: "failed",
} as const);

export type CollisionContactLifecycle = (typeof CollisionContactLifecycle)[keyof typeof CollisionContactLifecycle];

export const CollisionResponseResult = Object.freeze({
  notApplied: "notApplied",
  applied: "applied",
  notApproaching: "notApproaching",
  unsupported: "unsupported",
  failed: "failed",
} as const);

export type CollisionResponseResult = (typeof CollisionResponseResult)[keyof typeof CollisionResponseResult];

export interface CollisionPair {
  readonly objectA: ObjectId;
  readonly objectB: ObjectId;
}

export interface CollisionPolicyResolutionDisabled {
  readonly mode: "disabled";
}

export interface CollisionPolicyResolutionEnabled {
  readonly mode: "enabled";
  readonly profileId: CollisionProfileId;
}

export type CollisionPolicyResolution =
  | CollisionPolicyResolutionDisabled
  | CollisionPolicyResolutionEnabled;

export type CollisionPolicyResolutionInput =
  | { readonly mode: "disabled" }
  | { readonly mode: "enabled"; readonly profileId: CollisionProfileId | string };

export interface CollisionProfileInput {
  readonly profileId: CollisionProfileId | string;
  readonly responseMode: CollisionResponseMode;
  readonly coefficientOfRestitution: number;
  readonly broadPhaseMarginMeters: number;
  readonly contactDistanceToleranceMeters: number;
  readonly contactTimeTolerance: Duration;
  readonly separationHysteresisMeters: number;
  readonly maxCandidateSubdivisions: number;
  readonly maxRootIterations: number;
  readonly requiredPositionErrorMeters: number;
  readonly requiredVelocityErrorMetersPerSecond: number;
  readonly policyRevision: RevisionId | string;
}

export interface CollisionProfile extends Omit<CollisionProfileInput, "profileId" | "policyRevision"> {
  readonly profileId: CollisionProfileId;
  readonly policyRevision: RevisionId;
}

export interface CollisionObjectFactsInput {
  readonly objectId: ObjectId;
  readonly type: ObjectTypeValue;
  readonly referenceStatus?: ReferenceStatusValue;
}

export interface CollisionObjectFacts {
  readonly objectId: ObjectId;
  readonly type: ObjectTypeValue;
  readonly referenceStatus: ReferenceStatusValue;
}

export interface CollisionPairFactsInput {
  readonly objectA: CollisionObjectFactsInput;
  readonly objectB: CollisionObjectFactsInput;
  readonly interactionTags?: readonly string[];
  readonly hasCollisionGeometry?: boolean;
}

export interface CollisionPairFacts {
  readonly objectA: CollisionObjectFacts;
  readonly objectB: CollisionObjectFacts;
  readonly interactionTags: readonly string[];
  readonly hasCollisionGeometry: boolean;
}

export interface CollisionPolicyRuleInput {
  readonly id: string;
  readonly priority?: number;
  readonly objectTypes?: readonly [ObjectTypeValue, ObjectTypeValue];
  readonly referenceStatuses?: readonly [ReferenceStatusValue, ReferenceStatusValue];
  readonly requiredInteractionTags?: readonly string[];
  readonly requiresCollisionGeometry?: boolean;
  readonly resolution: CollisionPolicyResolutionInput;
}

export interface CollisionPolicyRule extends Omit<CollisionPolicyRuleInput, "objectTypes" | "referenceStatuses" | "requiredInteractionTags" | "resolution"> {
  readonly priority: number;
  readonly objectTypes?: readonly [ObjectTypeValue, ObjectTypeValue];
  readonly referenceStatuses?: readonly [ReferenceStatusValue, ReferenceStatusValue];
  readonly requiredInteractionTags: readonly string[];
  readonly resolution: CollisionPolicyResolution;
}

export interface CollisionPairPolicyOverrideInput {
  readonly objectA: ObjectId;
  readonly objectB: ObjectId;
  readonly resolution: CollisionPolicyResolutionInput;
}

export interface CollisionPairPolicyOverride {
  readonly objectA: ObjectId;
  readonly objectB: ObjectId;
  readonly resolution: CollisionPolicyResolution;
}

export interface CollisionObjectPolicyOverrideInput {
  readonly objectId: ObjectId;
  readonly resolution: CollisionPolicyResolutionInput;
}

export interface CollisionObjectPolicyOverride {
  readonly objectId: ObjectId;
  readonly resolution: CollisionPolicyResolution;
}

export interface CollisionPolicyInput {
  readonly revision: RevisionId | string;
  readonly profiles: readonly CollisionProfileInput[];
  readonly pairOverrides?: readonly CollisionPairPolicyOverrideInput[];
  readonly objectOverrides?: readonly CollisionObjectPolicyOverrideInput[];
  readonly rules?: readonly CollisionPolicyRuleInput[];
  readonly defaultResolution?: CollisionPolicyResolutionInput;
}

export interface CollisionPolicy {
  readonly revision: RevisionId;
  readonly profiles: readonly CollisionProfile[];
  readonly pairOverrides: readonly CollisionPairPolicyOverride[];
  readonly objectOverrides: readonly CollisionObjectPolicyOverride[];
  readonly rules: readonly CollisionPolicyRule[];
  readonly defaultResolution: CollisionPolicyResolution;
}

export interface CollisionSphereInput {
  readonly objectId: ObjectId;
  readonly collisionBoundingRadiusMeters?: number;
  readonly collisionShapeRevision?: RevisionId | string;
}

export interface CollisionSphere {
  readonly objectId: ObjectId;
  readonly collisionBoundingRadiusMeters?: Meters;
  readonly collisionShapeRevision?: RevisionId;
}

export interface CollisionContactRecordInput {
  readonly contactId?: CollisionContactId | string;
  readonly continuityKey?: string;
  readonly generation: CollisionGeneration | string;
  readonly objectA: ObjectId;
  readonly objectB: ObjectId;
  readonly exactContactInstant: SimulationInstant;
  readonly evaluationFrame: ReferenceFrameId;
  readonly stateA: PropagationState;
  readonly stateB: PropagationState;
  readonly collisionBoundingRadiusMetersA: number;
  readonly collisionBoundingRadiusMetersB: number;
  readonly contactPointApproximation?: Vec3<number>;
  readonly contactNormal?: Vec3<number>;
  readonly timeUncertainty: Duration;
  readonly separationUncertaintyMeters: number;
  readonly policyRevision: RevisionId | string;
  readonly profileId: CollisionProfileId | string;
  readonly collisionShapeRevisionA: RevisionId | string;
  readonly collisionShapeRevisionB: RevisionId | string;
  readonly dependencyRevisions?: readonly DependencyRevision[];
  readonly motionDependencyRevisionDigest?: RevisionId | string;
  readonly responseMode: CollisionResponseMode;
  readonly responseResult: CollisionResponseResult;
  readonly quality: CollisionContactQuality;
  readonly lifecycle?: CollisionContactLifecycle;
}

export interface CollisionContactRecord {
  readonly contactId: CollisionContactId;
  readonly generation: CollisionGeneration;
  readonly objectA: ObjectId;
  readonly objectB: ObjectId;
  readonly exactContactInstant: SimulationInstant;
  readonly evaluationFrame: ReferenceFrameId;
  readonly stateA: PropagationState;
  readonly stateB: PropagationState;
  readonly collisionBoundingRadiusMetersA: Meters;
  readonly collisionBoundingRadiusMetersB: Meters;
  readonly contactPointApproximation?: Vec3<Meters>;
  readonly contactNormal?: Vec3<number>;
  readonly relativeVelocity: Vec3<MetersPerSecond>;
  readonly normalRelativeSpeed?: MetersPerSecond;
  readonly timeUncertainty: Duration;
  readonly separationUncertaintyMeters: Meters;
  readonly policyRevision: RevisionId;
  readonly profileId: CollisionProfileId;
  readonly collisionShapeRevisionA: RevisionId;
  readonly collisionShapeRevisionB: RevisionId;
  readonly motionDependencyRevisionDigest?: RevisionId;
  readonly responseMode: CollisionResponseMode;
  readonly responseResult: CollisionResponseResult;
  readonly quality: CollisionContactQuality;
  readonly lifecycle: CollisionContactLifecycle;
}

export interface SerializedCollisionContactRecord {
  readonly contactId: string;
  readonly generation: string;
  readonly objectA: string;
  readonly objectB: string;
  readonly exactContactInstant: { readonly seconds: number; readonly nanoseconds: number };
  readonly evaluationFrame: string;
  readonly stateA: SerializedPropagationState;
  readonly stateB: SerializedPropagationState;
  readonly collisionBoundingRadiusMetersA: number;
  readonly collisionBoundingRadiusMetersB: number;
  readonly contactPointApproximation?: { readonly x: number; readonly y: number; readonly z: number };
  readonly contactNormal?: { readonly x: number; readonly y: number; readonly z: number };
  readonly relativeVelocity: { readonly x: number; readonly y: number; readonly z: number };
  readonly normalRelativeSpeed?: number;
  readonly timeUncertainty: { readonly seconds: number; readonly nanoseconds: number };
  readonly separationUncertaintyMeters: number;
  readonly policyRevision: string;
  readonly profileId: string;
  readonly collisionShapeRevisionA: string;
  readonly collisionShapeRevisionB: string;
  readonly motionDependencyRevisionDigest?: string;
  readonly responseMode: CollisionResponseMode;
  readonly responseResult: CollisionResponseResult;
  readonly quality: CollisionContactQuality;
  readonly lifecycle: CollisionContactLifecycle;
}

export interface SerializedPropagationState {
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  readonly velocity: { readonly x: number; readonly y: number; readonly z: number };
  readonly epoch: { readonly seconds: number; readonly nanoseconds: number };
  readonly referenceFrame: string;
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

function normalizedProfileId(value: CollisionProfileId | string, name = "profileId"): CollisionProfileId {
  assertIdentifier(value, name);
  return value as CollisionProfileId;
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
  return value === 0 ? 0 : value;
}

function restitution(value: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError("coefficientOfRestitution must be a finite number in [0, 1]");
  }
  return value === 0 ? 0 : value;
}

function positiveSafeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive safe integer`);
  return value;
}

function normalizedPair(objectA: ObjectId, objectB: ObjectId, name = "collision pair"): CollisionPair {
  const left = objectId(objectA);
  const right = objectId(objectB);
  if (left === right) throw new RangeError(`${name} requires two distinct ObjectIds`);
  return BigInt(left) < BigInt(right)
    ? Object.freeze({ objectA: left, objectB: right })
    : Object.freeze({ objectA: right, objectB: left });
}

export function canonicalCollisionPair(objectA: ObjectId, objectB: ObjectId): CollisionPair {
  return normalizedPair(objectA, objectB);
}

function normalizedResponseMode(value: CollisionResponseMode): CollisionResponseMode {
  if (value !== CollisionResponseMode.detectOnly && value !== CollisionResponseMode.frictionlessImpulse) {
    throw new RangeError(`Unknown collision response mode: ${String(value)}`);
  }
  return value;
}

function normalizedResponseResult(value: CollisionResponseResult): CollisionResponseResult {
  if (value !== CollisionResponseResult.notApplied
    && value !== CollisionResponseResult.applied
    && value !== CollisionResponseResult.notApproaching
    && value !== CollisionResponseResult.unsupported
    && value !== CollisionResponseResult.failed) {
    throw new RangeError(`Unknown collision response result: ${String(value)}`);
  }
  return value;
}

function normalizedQuality(value: CollisionContactQuality): CollisionContactQuality {
  if (value !== CollisionContactQuality.coarse
    && value !== CollisionContactQuality.refined
    && value !== CollisionContactQuality.highFidelityValidated) {
    throw new RangeError(`Unknown collision contact quality: ${String(value)}`);
  }
  return value;
}

function normalizedLifecycle(value: CollisionContactLifecycle | undefined): CollisionContactLifecycle {
  const lifecycle = value ?? CollisionContactLifecycle.active;
  if (lifecycle !== CollisionContactLifecycle.active
    && lifecycle !== CollisionContactLifecycle.stale
    && lifecycle !== CollisionContactLifecycle.retired
    && lifecycle !== CollisionContactLifecycle.failed) {
    throw new RangeError(`Unknown collision contact lifecycle: ${String(lifecycle)}`);
  }
  return lifecycle;
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

function normalizedObjectTypes(value: readonly [ObjectTypeValue, ObjectTypeValue] | undefined): readonly [ObjectTypeValue, ObjectTypeValue] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length !== 2) throw new TypeError("Collision rule objectTypes must contain exactly two ObjectTypes");
  const result = [objectType(value[0]), objectType(value[1])] as [ObjectTypeValue, ObjectTypeValue];
  result.sort(compareText);
  return Object.freeze(result);
}

function normalizedReferenceStatuses(value: readonly [ReferenceStatusValue, ReferenceStatusValue] | undefined): readonly [ReferenceStatusValue, ReferenceStatusValue] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length !== 2) throw new TypeError("Collision rule referenceStatuses must contain exactly two statuses");
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

export function normalizeCollisionProfile(value: CollisionProfileInput): CollisionProfile {
  if (typeof value !== "object" || value === null) throw new TypeError("Collision profile must be an object");
  const profileId = normalizedProfileId(value.profileId);
  const responseMode = normalizedResponseMode(value.responseMode);
  const coefficientOfRestitution = restitution(value.coefficientOfRestitution);
  const broadPhaseMarginMeters = finiteNonNegative(value.broadPhaseMarginMeters, "broadPhaseMarginMeters");
  const contactDistanceToleranceMeters = finiteNonNegative(value.contactDistanceToleranceMeters, "contactDistanceToleranceMeters");
  const contactTimeTolerance = requirePositiveDuration(value.contactTimeTolerance, "contactTimeTolerance");
  const separationHysteresisMeters = finiteNonNegative(value.separationHysteresisMeters, "separationHysteresisMeters");
  const maxCandidateSubdivisions = positiveSafeInteger(value.maxCandidateSubdivisions, "maxCandidateSubdivisions");
  const maxRootIterations = positiveSafeInteger(value.maxRootIterations, "maxRootIterations");
  const requiredPositionErrorMeters = finiteNonNegative(value.requiredPositionErrorMeters, "requiredPositionErrorMeters");
  const requiredVelocityErrorMetersPerSecond = finiteNonNegative(value.requiredVelocityErrorMetersPerSecond, "requiredVelocityErrorMetersPerSecond");
  const policyRevision = normalizedRevision(value.policyRevision, "policyRevision");
  return Object.freeze({
    profileId,
    responseMode,
    coefficientOfRestitution,
    broadPhaseMarginMeters,
    contactDistanceToleranceMeters,
    contactTimeTolerance,
    separationHysteresisMeters,
    maxCandidateSubdivisions,
    maxRootIterations,
    requiredPositionErrorMeters,
    requiredVelocityErrorMetersPerSecond,
    policyRevision,
  });
}

function normalizedResolution(value: CollisionPolicyResolutionInput, profiles: ReadonlyMap<CollisionProfileId, CollisionProfile>): CollisionPolicyResolution {
  if (typeof value !== "object" || value === null) throw new TypeError("Collision policy resolution must be an object");
  if (value.mode === CollisionPolicyMode.disabled) return Object.freeze({ mode: CollisionPolicyMode.disabled });
  if (value.mode !== CollisionPolicyMode.enabled) throw new RangeError(`Unknown collision policy mode: ${String((value as { readonly mode: unknown }).mode)}`);
  const profileId = normalizedProfileId(value.profileId);
  if (!profiles.has(profileId)) throw new RangeError(`Collision policy references unknown profile: ${profileId}`);
  return Object.freeze({ mode: CollisionPolicyMode.enabled, profileId });
}

function normalizedFacts(pair: CollisionPair, value: CollisionPairFactsInput): CollisionPairFacts {
  if (typeof value !== "object" || value === null) throw new TypeError("Collision pair facts must be an object");
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
    throw new RangeError("Collision pair facts must use the canonical pair ordering");
  }
  const hasCollisionGeometry = value.hasCollisionGeometry ?? false;
  if (typeof hasCollisionGeometry !== "boolean") throw new TypeError("hasCollisionGeometry must be boolean");
  return Object.freeze({ objectA, objectB, interactionTags: normalizedTags(value.interactionTags, "interactionTags"), hasCollisionGeometry });
}

function normalizedRule(value: CollisionPolicyRuleInput, profiles: ReadonlyMap<CollisionProfileId, CollisionProfile>): CollisionPolicyRule {
  if (typeof value !== "object" || value === null) throw new TypeError("Collision policy rule must be an object");
  assertIdentifier(value.id, "Collision policy rule id");
  const priority = value.priority ?? 0;
  if (!Number.isSafeInteger(priority)) throw new RangeError("Collision policy rule priority must be a safe integer");
  if (value.requiresCollisionGeometry !== undefined && typeof value.requiresCollisionGeometry !== "boolean") {
    throw new TypeError("requiresCollisionGeometry must be boolean when supplied");
  }
  return Object.freeze({
    id: value.id,
    priority,
    objectTypes: normalizedObjectTypes(value.objectTypes),
    referenceStatuses: normalizedReferenceStatuses(value.referenceStatuses),
    requiredInteractionTags: normalizedTags(value.requiredInteractionTags, "requiredInteractionTags"),
    ...(value.requiresCollisionGeometry === undefined ? {} : { requiresCollisionGeometry: value.requiresCollisionGeometry }),
    resolution: normalizedResolution(value.resolution, profiles),
  });
}

export function normalizeCollisionPolicy(value: CollisionPolicyInput): CollisionPolicy {
  if (typeof value !== "object" || value === null) throw new TypeError("Collision policy must be an object");
  const revision = normalizedRevision(value.revision, "Collision policy revision");
  if (!Array.isArray(value.profiles)) throw new TypeError("Collision policy profiles must be an array");
  const profiles = value.profiles.map(normalizeCollisionProfile);
  profiles.sort((left, right) => compareText(left.profileId, right.profileId));
  const profileMap = new Map<CollisionProfileId, CollisionProfile>();
  for (const profile of profiles) {
    if (profileMap.has(profile.profileId)) throw new RangeError(`Duplicate collision profile: ${profile.profileId}`);
    if (profile.policyRevision !== revision) throw new RangeError(`Collision profile ${profile.profileId} policyRevision must match policy revision`);
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
      throw new RangeError(`Duplicate collision pair override: ${current.objectA},${current.objectB}`);
    }
  }

  const objectOverrides = (value.objectOverrides ?? []).map((override) => Object.freeze({
    objectId: objectId(override.objectId),
    resolution: normalizedResolution(override.resolution, profileMap),
  }));
  objectOverrides.sort((left, right) => compareObjectId(left.objectId, right.objectId));
  for (let index = 1; index < objectOverrides.length; index += 1) {
    if (objectOverrides[index]!.objectId === objectOverrides[index - 1]!.objectId) {
      throw new RangeError(`Duplicate collision object override: ${objectOverrides[index]!.objectId}`);
    }
  }

  const rules = (value.rules ?? []).map((rule) => normalizedRule(rule, profileMap));
  const ruleIds = new Set<string>();
  for (const rule of rules) {
    if (ruleIds.has(rule.id)) throw new RangeError(`Duplicate collision policy rule: ${rule.id}`);
    ruleIds.add(rule.id);
  }
  rules.sort((left, right) => right.priority - left.priority || compareText(left.id, right.id));

  return Object.freeze({
    revision,
    profiles: Object.freeze(profiles),
    pairOverrides: Object.freeze(pairOverrides),
    objectOverrides: Object.freeze(objectOverrides),
    rules: Object.freeze(rules),
    defaultResolution: normalizedResolution(value.defaultResolution ?? { mode: CollisionPolicyMode.disabled }, profileMap),
  });
}

export function createDisabledCollisionPolicy(revision: RevisionId | string = "0"): CollisionPolicy {
  return normalizeCollisionPolicy({ revision, profiles: [] });
}

function ruleMatches(rule: CollisionPolicyRule, facts: CollisionPairFacts | undefined): boolean {
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

export function resolveCollisionPolicy(
  policy: CollisionPolicy,
  objectA: ObjectId,
  objectB: ObjectId,
  facts?: CollisionPairFactsInput,
): CollisionPolicyResolution {
  const normalizedPolicy = normalizeCollisionPolicy(policy);
  const pair = normalizedPair(objectA, objectB);
  const pairOverride = normalizedPolicy.pairOverrides.find((override) => override.objectA === pair.objectA && override.objectB === pair.objectB);
  if (pairOverride !== undefined) return pairOverride.resolution;
  const objectOverrideA = normalizedPolicy.objectOverrides.find((override) => override.objectId === pair.objectA);
  const objectOverrideB = normalizedPolicy.objectOverrides.find((override) => override.objectId === pair.objectB);
  if (objectOverrideA !== undefined) return objectOverrideA.resolution;
  if (objectOverrideB !== undefined) return objectOverrideB.resolution;
  const normalizedPairFacts = facts === undefined ? undefined : normalizedFacts(pair, facts);
  return normalizedPolicy.rules.find((rule) => ruleMatches(rule, normalizedPairFacts))?.resolution ?? normalizedPolicy.defaultResolution;
}

export type CollisionPolicyRevisionListener = (previous: CollisionPolicy, next: CollisionPolicy) => void;

export class CollisionPolicyManager {
  #policy: CollisionPolicy;
  readonly #onRevisionChange?: CollisionPolicyRevisionListener;

  constructor(initial?: CollisionPolicyInput, onRevisionChange?: CollisionPolicyRevisionListener) {
    this.#policy = initial === undefined ? createDisabledCollisionPolicy() : normalizeCollisionPolicy(initial);
    this.#onRevisionChange = onRevisionChange;
  }

  get policy(): CollisionPolicy {
    return this.#policy;
  }

  getProfile(profileId: CollisionProfileId | string): CollisionProfile | undefined {
    const id = normalizedProfileId(profileId);
    return this.#policy.profiles.find((profile) => profile.profileId === id);
  }

  listProfiles(): readonly CollisionProfile[] {
    return this.#policy.profiles;
  }

  setPolicy(value: CollisionPolicyInput): CollisionPolicy {
    const next = normalizeCollisionPolicy(value);
    if (next.revision === this.#policy.revision) {
      if (JSON.stringify(serializeCollisionPolicy(this.#policy)) !== JSON.stringify(serializeCollisionPolicy(next))) {
        throw new RangeError("Collision policy revision must change when policy contents change");
      }
      return this.#policy;
    }
    const previous = this.#policy;
    this.#policy = next;
    this.#onRevisionChange?.(previous, next);
    return next;
  }

  setProfile(value: CollisionProfileInput): CollisionPolicy {
    const profile = normalizeCollisionProfile(value);
    const profiles = this.#policy.profiles
      .filter((current) => current.profileId !== profile.profileId)
      .map((current) => ({ ...current, policyRevision: profile.policyRevision }));
    profiles.push(profile);
    return this.setPolicy({
      revision: profile.policyRevision,
      profiles,
      pairOverrides: this.#policy.pairOverrides,
      objectOverrides: this.#policy.objectOverrides,
      rules: this.#policy.rules,
      defaultResolution: this.#policy.defaultResolution,
    });
  }

  resolve(objectA: ObjectId, objectB: ObjectId, facts?: CollisionPairFactsInput): CollisionPolicyResolution {
    return resolveCollisionPolicy(this.#policy, objectA, objectB, facts);
  }
}

export function collisionProfileId(value: string): CollisionProfileId {
  return normalizedProfileId(value);
}

export function isCollisionProfileId(value: unknown): value is CollisionProfileId {
  return typeof value === "string" && value.length > 0 && value.trim() === value;
}

export function collisionContactId(value: string): CollisionContactId {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value) || BigInt(value) > UINT64_MAX) {
    throw new RangeError("CollisionContactId must be canonical decimal text in the range 1..uint64_max");
  }
  return value as CollisionContactId;
}

export function isCollisionContactId(value: unknown): value is CollisionContactId {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) return false;
  try {
    return BigInt(value) <= UINT64_MAX;
  } catch {
    return false;
  }
}

export function collisionContactIdForPair(pair: CollisionPair, continuityKey = "0"): CollisionContactId {
  const canonical = normalizedPair(pair.objectA, pair.objectB);
  assertIdentifier(continuityKey, "continuityKey");
  let hash = FNV_OFFSET;
  const input = `${canonical.objectA}\u0000${canonical.objectB}\u0000${continuityKey}`;
  for (const character of input) {
    hash ^= BigInt(character.codePointAt(0)!);
    hash = (hash * FNV_PRIME) % UINT64_MODULUS;
  }
  if (hash === 0n) hash = 1n;
  return collisionContactId(hash.toString());
}

export function nextCollisionGeneration(value: CollisionGeneration | string): CollisionGeneration {
  const current = BigInt(normalizedRevision(value, "generation"));
  if (current >= UINT64_MAX) throw new RangeError("Collision generation overflow");
  return revisionId((current + 1n).toString());
}

export function normalizeCollisionSphere(value: CollisionSphereInput): CollisionSphere {
  if (typeof value !== "object" || value === null) throw new TypeError("Collision sphere must be an object");
  const object = objectId(value.objectId);
  const radius = value.collisionBoundingRadiusMeters === undefined
    ? undefined
    : meters(finiteNonNegative(value.collisionBoundingRadiusMeters, "collisionBoundingRadiusMeters"));
  if (radius === undefined && value.collisionShapeRevision !== undefined) {
    throw new RangeError("collisionShapeRevision requires an explicit collisionBoundingRadiusMeters");
  }
  if (radius !== undefined && value.collisionShapeRevision === undefined) {
    throw new RangeError("collisionShapeRevision is required with an explicit collisionBoundingRadiusMeters");
  }
  const shapeRevision = radius === undefined
    ? undefined
    : normalizedRevision(value.collisionShapeRevision!, "collisionShapeRevision");
  return Object.freeze({
    objectId: object,
    ...(radius === undefined ? {} : { collisionBoundingRadiusMeters: radius }),
    ...(shapeRevision === undefined ? {} : { collisionShapeRevision: shapeRevision }),
  });
}

export function collisionSphereParticipates(value: CollisionSphere): boolean {
  const normalized = normalizeCollisionSphere(value);
  return normalized.collisionBoundingRadiusMeters !== undefined;
}

export function requireCollisionSphere(value: CollisionSphere): Required<CollisionSphere> {
  const normalized = normalizeCollisionSphere(value);
  if (normalized.collisionBoundingRadiusMeters === undefined || normalized.collisionShapeRevision === undefined) {
    throw new RangeError(`Object ${normalized.objectId} has no explicit collision sphere geometry`);
  }
  return normalized as Required<CollisionSphere>;
}

function normalizedVector(value: Vec3<number>, name: string): Vec3<number> {
  return vec3(
    finiteNonNegative(Math.abs(value.x), `${name}.x`) * Math.sign(value.x),
    finiteNonNegative(Math.abs(value.y), `${name}.y`) * Math.sign(value.y),
    finiteNonNegative(Math.abs(value.z), `${name}.z`) * Math.sign(value.z),
  );
}

function vectorDifference(left: Vec3<number>, right: Vec3<number>): Vec3<number> {
  return vec3(left.x - right.x, left.y - right.y, left.z - right.z);
}

function vectorSum(left: Vec3<number>, right: Vec3<number>): Vec3<number> {
  return vec3(left.x + right.x, left.y + right.y, left.z + right.z);
}

function vectorScale(value: Vec3<number>, scale: number): Vec3<number> {
  return vec3(value.x * scale, value.y * scale, value.z * scale);
}

function dot(left: Vec3<number>, right: Vec3<number>): number {
  return left.x * right.x + left.y * right.y + left.z * right.z;
}

function normalizedContactNormal(value: Vec3<number> | undefined, positionA: Vec3<number>, positionB: Vec3<number>): Vec3<number> | undefined {
  const displacement = vectorDifference(positionB, positionA);
  const displacementNorm = Math.hypot(displacement.x, displacement.y, displacement.z);
  const supplied = value === undefined ? undefined : normalizedVector(value, "contactNormal");
  if (displacementNorm === 0) return supplied === undefined ? undefined : unitVector(supplied, "contactNormal");
  const derived = vectorScale(displacement, 1 / displacementNorm);
  if (supplied !== undefined) {
    const suppliedUnit = unitVector(supplied, "contactNormal");
    if (dot(derived, suppliedUnit) < 1 - 1e-12) throw new RangeError("contactNormal must point from objectA to objectB");
    return suppliedUnit;
  }
  return derived;
}

function unitVector(value: Vec3<number>, name: string): Vec3<number> {
  const norm = Math.hypot(value.x, value.y, value.z);
  if (norm === 0) throw new RangeError(`${name} must be non-zero when supplied`);
  return vectorScale(value, 1 / norm);
}

function normalizedStateAt(value: PropagationState, instant: SimulationInstant, frame: ReferenceFrameId, name: string): PropagationState {
  const state = propagationState(value);
  if (state.epoch.seconds !== instant.seconds || state.epoch.nanoseconds !== instant.nanoseconds) {
    throw new RangeError(`${name} epoch must equal exactContactInstant`);
  }
  if (state.referenceFrame !== frame) throw new RangeError(`${name} reference frame must equal evaluationFrame`);
  return state;
}

function normalizedContactId(value: CollisionContactId | string): CollisionContactId {
  return collisionContactId(value);
}

export function createCollisionContactRecord(value: CollisionContactRecordInput): CollisionContactRecord {
  if (typeof value !== "object" || value === null) throw new TypeError("Collision contact record must be an object");
  const left = objectId(value.objectA);
  const right = objectId(value.objectB);
  if (left === right) throw new RangeError("Collision contact requires two distinct ObjectIds");
  const reverse = BigInt(left) > BigInt(right);
  const pair = normalizedPair(left, right, "Collision contact pair");
  const exactContactInstant = simulationInstant(value.exactContactInstant.seconds, value.exactContactInstant.nanoseconds);
  const evaluationFrame = referenceFrameId(value.evaluationFrame);
  const inputStateA = normalizedStateAt(value.stateA, exactContactInstant, evaluationFrame, "stateA");
  const inputStateB = normalizedStateAt(value.stateB, exactContactInstant, evaluationFrame, "stateB");
  const stateA = reverse ? inputStateB : inputStateA;
  const stateB = reverse ? inputStateA : inputStateB;
  const radiusInputA = finiteNonNegative(value.collisionBoundingRadiusMetersA, "collisionBoundingRadiusMetersA");
  const radiusInputB = finiteNonNegative(value.collisionBoundingRadiusMetersB, "collisionBoundingRadiusMetersB");
  const radiusA = meters(reverse ? radiusInputB : radiusInputA);
  const radiusB = meters(reverse ? radiusInputA : radiusInputB);
  const suppliedNormal = value.contactNormal === undefined
    ? undefined
    : reverse
      ? vectorScale(normalizedVector(value.contactNormal, "contactNormal"), -1)
      : normalizedVector(value.contactNormal, "contactNormal");
  const contactNormal = normalizedContactNormal(suppliedNormal, stateA.position, stateB.position);
  const relativeVelocityVector = vectorDifference(stateB.velocity, stateA.velocity);
  const normalizedRelativeVelocity = vec3(
    metersPerSecond(relativeVelocityVector.x),
    metersPerSecond(relativeVelocityVector.y),
    metersPerSecond(relativeVelocityVector.z),
  );
  const normalRelativeSpeed = contactNormal === undefined ? undefined : metersPerSecond(dot(normalizedRelativeVelocity, contactNormal));
  const contactPointInput = value.contactPointApproximation === undefined
    ? undefined
    : normalizedVector(value.contactPointApproximation, "contactPointApproximation");
  const contactPoint = contactPointInput === undefined
    ? contactNormal === undefined ? undefined : vectorSum(stateA.position, vectorScale(contactNormal, radiusA)) as Vec3<Meters>
    : contactPointInput as Vec3<Meters>;
  const timeUncertainty = requireNonNegativeDuration(value.timeUncertainty, "timeUncertainty");
  const separationUncertaintyMeters = meters(finiteNonNegative(value.separationUncertaintyMeters, "separationUncertaintyMeters"));
  const policyRevision = normalizedRevision(value.policyRevision, "policyRevision");
  const profileId = normalizedProfileId(value.profileId);
  const shapeRevisionInputA = normalizedRevision(value.collisionShapeRevisionA, "collisionShapeRevisionA");
  const shapeRevisionInputB = normalizedRevision(value.collisionShapeRevisionB, "collisionShapeRevisionB");
  const collisionShapeRevisionA = reverse ? shapeRevisionInputB : shapeRevisionInputA;
  const collisionShapeRevisionB = reverse ? shapeRevisionInputA : shapeRevisionInputB;
  const dependencies = value.dependencyRevisions === undefined ? undefined : normalizeDependencyRevisions(value.dependencyRevisions);
  const computedDigest = dependencyRevisionDigest(dependencies);
  const suppliedDigest = value.motionDependencyRevisionDigest === undefined
    ? computedDigest
    : normalizedRevision(value.motionDependencyRevisionDigest, "motionDependencyRevisionDigest");
  if (computedDigest !== undefined && suppliedDigest !== computedDigest) {
    throw new RangeError("motionDependencyRevisionDigest does not match dependencyRevisions");
  }
  const responseMode = normalizedResponseMode(value.responseMode);
  const responseResult = normalizedResponseResult(value.responseResult);
  const quality = normalizedQuality(value.quality);
  const lifecycle = normalizedLifecycle(value.lifecycle);
  const contactId = value.contactId === undefined
    ? collisionContactIdForPair(pair, value.continuityKey ?? "0")
    : normalizedContactId(value.contactId);
  return Object.freeze({
    contactId,
    generation: normalizedRevision(value.generation, "generation"),
    objectA: pair.objectA,
    objectB: pair.objectB,
    exactContactInstant,
    evaluationFrame,
    stateA,
    stateB,
    collisionBoundingRadiusMetersA: radiusA,
    collisionBoundingRadiusMetersB: radiusB,
    ...(contactPoint === undefined ? {} : { contactPointApproximation: contactPoint }),
    ...(contactNormal === undefined ? {} : { contactNormal }),
    relativeVelocity: normalizedRelativeVelocity,
    ...(normalRelativeSpeed === undefined ? {} : { normalRelativeSpeed }),
    timeUncertainty,
    separationUncertaintyMeters,
    policyRevision,
    profileId,
    collisionShapeRevisionA,
    collisionShapeRevisionB,
    ...(suppliedDigest === undefined ? {} : { motionDependencyRevisionDigest: suppliedDigest }),
    responseMode,
    responseResult,
    quality,
    lifecycle,
  });
}

export function canTransitionCollisionContactLifecycle(from: CollisionContactLifecycle, to: CollisionContactLifecycle): boolean {
  if (from === to) return true;
  if (from === CollisionContactLifecycle.retired) return false;
  if (from === CollisionContactLifecycle.active) return to === CollisionContactLifecycle.stale
    || to === CollisionContactLifecycle.failed
    || to === CollisionContactLifecycle.retired;
  return to === CollisionContactLifecycle.retired;
}

export function transitionCollisionContactRecordLifecycle(record: CollisionContactRecord, lifecycle: CollisionContactLifecycle): CollisionContactRecord {
  const next = normalizedLifecycle(lifecycle);
  if (!canTransitionCollisionContactLifecycle(record.lifecycle, next)) {
    throw new RangeError(`Invalid collision contact lifecycle transition: ${record.lifecycle} -> ${next}`);
  }
  return createCollisionContactRecord({ ...record, lifecycle: next });
}

const QUALITY_ORDER: Readonly<Record<CollisionContactQuality, number>> = Object.freeze({
  coarse: 0,
  refined: 1,
  highFidelityValidated: 2,
});

export function upgradeCollisionContactRecordQuality(record: CollisionContactRecord, quality: CollisionContactQuality): CollisionContactRecord {
  const nextQuality = normalizedQuality(quality);
  if (QUALITY_ORDER[nextQuality] < QUALITY_ORDER[record.quality]) throw new RangeError("Collision contact quality cannot be downgraded");
  return createCollisionContactRecord({ ...record, quality: nextQuality });
}

function serializeInstant(value: SimulationInstant): { readonly seconds: number; readonly nanoseconds: number } {
  return Object.freeze({ seconds: value.seconds, nanoseconds: value.nanoseconds });
}

function serializeDurationValue(value: Duration): { readonly seconds: number; readonly nanoseconds: number } {
  return Object.freeze({ seconds: value.seconds, nanoseconds: value.nanoseconds });
}

function serializeState(value: PropagationState): SerializedPropagationState {
  return Object.freeze({
    position: Object.freeze({ ...value.position }),
    velocity: Object.freeze({ ...value.velocity }),
    epoch: serializeInstant(value.epoch),
    referenceFrame: value.referenceFrame,
  });
}

function deserializeState(value: SerializedPropagationState): PropagationState {
  return propagationState({
    position: {
      x: meters(value.position.x),
      y: meters(value.position.y),
      z: meters(value.position.z),
    },
    velocity: {
      x: metersPerSecond(value.velocity.x),
      y: metersPerSecond(value.velocity.y),
      z: metersPerSecond(value.velocity.z),
    },
    epoch: simulationInstant(value.epoch.seconds, value.epoch.nanoseconds),
    referenceFrame: referenceFrameId(value.referenceFrame),
  });
}

export function serializeCollisionContactRecord(record: CollisionContactRecord): SerializedCollisionContactRecord {
  const normalized = createCollisionContactRecord(record);
  return Object.freeze({
    contactId: normalized.contactId,
    generation: normalized.generation,
    objectA: normalized.objectA,
    objectB: normalized.objectB,
    exactContactInstant: serializeInstant(normalized.exactContactInstant),
    evaluationFrame: normalized.evaluationFrame,
    stateA: serializeState(normalized.stateA),
    stateB: serializeState(normalized.stateB),
    collisionBoundingRadiusMetersA: normalized.collisionBoundingRadiusMetersA,
    collisionBoundingRadiusMetersB: normalized.collisionBoundingRadiusMetersB,
    ...(normalized.contactPointApproximation === undefined ? {} : { contactPointApproximation: Object.freeze({ ...normalized.contactPointApproximation }) }),
    ...(normalized.contactNormal === undefined ? {} : { contactNormal: Object.freeze({ ...normalized.contactNormal }) }),
    relativeVelocity: Object.freeze({ ...normalized.relativeVelocity }),
    ...(normalized.normalRelativeSpeed === undefined ? {} : { normalRelativeSpeed: normalized.normalRelativeSpeed }),
    timeUncertainty: serializeDurationValue(normalized.timeUncertainty),
    separationUncertaintyMeters: normalized.separationUncertaintyMeters,
    policyRevision: normalized.policyRevision,
    profileId: normalized.profileId,
    collisionShapeRevisionA: normalized.collisionShapeRevisionA,
    collisionShapeRevisionB: normalized.collisionShapeRevisionB,
    ...(normalized.motionDependencyRevisionDigest === undefined ? {} : { motionDependencyRevisionDigest: normalized.motionDependencyRevisionDigest }),
    responseMode: normalized.responseMode,
    responseResult: normalized.responseResult,
    quality: normalized.quality,
    lifecycle: normalized.lifecycle,
  });
}

export function deserializeCollisionContactRecord(value: SerializedCollisionContactRecord): CollisionContactRecord {
  return createCollisionContactRecord({
    contactId: value.contactId,
    generation: value.generation,
    objectA: objectId(value.objectA),
    objectB: objectId(value.objectB),
    exactContactInstant: simulationInstant(value.exactContactInstant.seconds, value.exactContactInstant.nanoseconds),
    evaluationFrame: referenceFrameId(value.evaluationFrame),
    stateA: deserializeState(value.stateA),
    stateB: deserializeState(value.stateB),
    collisionBoundingRadiusMetersA: value.collisionBoundingRadiusMetersA,
    collisionBoundingRadiusMetersB: value.collisionBoundingRadiusMetersB,
    ...(value.contactPointApproximation === undefined ? {} : { contactPointApproximation: value.contactPointApproximation }),
    ...(value.contactNormal === undefined ? {} : { contactNormal: value.contactNormal }),
    timeUncertainty: duration(value.timeUncertainty.seconds, value.timeUncertainty.nanoseconds),
    separationUncertaintyMeters: value.separationUncertaintyMeters,
    policyRevision: value.policyRevision,
    profileId: value.profileId,
    collisionShapeRevisionA: value.collisionShapeRevisionA,
    collisionShapeRevisionB: value.collisionShapeRevisionB,
    motionDependencyRevisionDigest: value.motionDependencyRevisionDigest,
    responseMode: value.responseMode,
    responseResult: value.responseResult,
    quality: value.quality,
    lifecycle: value.lifecycle,
  });
}

export interface SerializedCollisionPolicy {
  readonly revision: string;
  readonly profiles: readonly CollisionProfile[];
  readonly pairOverrides: readonly CollisionPairPolicyOverride[];
  readonly objectOverrides: readonly CollisionObjectPolicyOverride[];
  readonly rules: readonly CollisionPolicyRule[];
  readonly defaultResolution: CollisionPolicyResolution;
}

export function serializeCollisionPolicy(policy: CollisionPolicy): SerializedCollisionPolicy {
  const normalized = normalizeCollisionPolicy(policy);
  return Object.freeze({
    revision: normalized.revision,
    profiles: normalized.profiles,
    pairOverrides: normalized.pairOverrides,
    objectOverrides: normalized.objectOverrides,
    rules: normalized.rules,
    defaultResolution: normalized.defaultResolution,
  });
}
