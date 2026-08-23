import {
  createCollisionContactRecord,
  type CollisionContactRecord,
  type CollisionResponseMode,
  type CollisionResponseResult,
  normalizeCollisionProfile,
  type CollisionProfile,
} from "./collision.js";
import { ReferenceStatus, type ReferenceStatus as ReferenceStatusValue } from "./registry.js";
import { propagationState, type PropagationState } from "./propagation.js";
import { metersPerSecond, type MetersPerSecond } from "./units.js";
import { vec3, type Vec3 } from "./frames.js";
import type { ObjectId } from "./objects.js";

export const CollisionResponseErrorCode = Object.freeze({
  missingMass: "missingMass",
  invalidMass: "invalidMass",
  missingContactNormal: "missingContactNormal",
  invalidProfile: "invalidProfile",
  invalidReferenceStatus: "invalidReferenceStatus",
  successorValidationFailed: "successorValidationFailed",
} as const);

export type CollisionResponseErrorCode = (typeof CollisionResponseErrorCode)[keyof typeof CollisionResponseErrorCode];

export const CollisionAtomicHandoffStatus = Object.freeze({
  committed: "committed",
  rolledBack: "rolledBack",
} as const);

export type CollisionAtomicHandoffStatus = (typeof CollisionAtomicHandoffStatus)[keyof typeof CollisionAtomicHandoffStatus];

export interface CollisionVelocityResponseInput {
  readonly contact: CollisionContactRecord;
  readonly profile: CollisionProfile;
  readonly massA?: number;
  readonly massB?: number;
}

export interface CollisionVelocityResponseOutcome {
  readonly responseMode: CollisionResponseMode;
  readonly responseResult: CollisionResponseResult;
  readonly preStateA: PropagationState;
  readonly preStateB: PropagationState;
  readonly postStateA: PropagationState;
  readonly postStateB: PropagationState;
  readonly normalRelativeSpeed?: MetersPerSecond;
  readonly impulseMagnitude?: number;
  readonly deltaVelocityA?: Vec3<MetersPerSecond>;
  readonly deltaVelocityB?: Vec3<MetersPerSecond>;
  readonly errorCode?: CollisionResponseErrorCode;
}

export interface CollisionAtomicHandoffInput extends CollisionVelocityResponseInput {
  readonly referenceStatusA?: ReferenceStatusValue;
  readonly referenceStatusB?: ReferenceStatusValue;
  readonly successorValidation?: {
    readonly objectA: boolean;
    readonly objectB: boolean;
  };
}

export interface CollisionAtomicHandoffResult {
  readonly status: CollisionAtomicHandoffStatus;
  readonly objectA: ObjectId;
  readonly objectB: ObjectId;
  readonly exactContactInstant: CollisionContactRecord["exactContactInstant"];
  readonly response: CollisionVelocityResponseOutcome;
  readonly stateA: PropagationState;
  readonly stateB: PropagationState;
  readonly referenceStatusA: ReferenceStatusValue;
  readonly referenceStatusB: ReferenceStatusValue;
  readonly errorCode?: CollisionResponseErrorCode;
}

interface SuppressionEntry {
  readonly contactId: string;
  readonly objectA: ObjectId;
  readonly objectB: ObjectId;
  readonly releaseSeparationMeters: number;
  readonly dependencyDigest?: string;
}

export interface CollisionSuppressionState {
  readonly contactId: string;
  readonly objectA: ObjectId;
  readonly objectB: ObjectId;
  readonly releaseSeparationMeters: number;
  readonly dependencyDigest?: string;
}

function finite(value: number, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  return value;
}

function positiveMass(value: number | undefined, name: string): number {
  if (value === undefined) throw new RangeError(`${name} is required for frictionlessImpulse`);
  const result = finite(value, name);
  if (result <= 0) throw new RangeError(`${name} must be positive for frictionlessImpulse`);
  return result;
}

function normalizedReferenceStatus(value: ReferenceStatusValue | undefined, name: string): ReferenceStatusValue {
  const result = value ?? ReferenceStatus.none;
  if (result !== ReferenceStatus.none && result !== ReferenceStatus.followingReference && result !== ReferenceStatus.diverged) {
    throw new RangeError(`${name} has an unknown reference status: ${String(result)}`);
  }
  return result;
}

function dot(left: Vec3<number>, right: Vec3<number>): number {
  return left.x * right.x + left.y * right.y + left.z * right.z;
}

function addVelocity(state: PropagationState, delta: Vec3<number>): PropagationState {
  return propagationState({
    position: state.position,
    velocity: {
      x: metersPerSecond(state.velocity.x + delta.x),
      y: metersPerSecond(state.velocity.y + delta.y),
      z: metersPerSecond(state.velocity.z + delta.z),
    },
    epoch: state.epoch,
    referenceFrame: state.referenceFrame,
  });
}

function unchangedOutcome(
  contact: CollisionContactRecord,
  responseResult: CollisionResponseResult,
  errorCode?: CollisionResponseErrorCode,
): CollisionVelocityResponseOutcome {
  return Object.freeze({
    responseMode: contact.responseMode,
    responseResult,
    preStateA: contact.stateA,
    preStateB: contact.stateB,
    postStateA: contact.stateA,
    postStateB: contact.stateB,
    ...(errorCode === undefined ? {} : { errorCode }),
  });
}

export function resolveCollisionVelocityResponse(value: CollisionVelocityResponseInput): CollisionVelocityResponseOutcome {
  if (typeof value !== "object" || value === null) throw new TypeError("Collision velocity response input must be an object");
  const contact = createCollisionContactRecord(value.contact);
  let profile: CollisionProfile;
  try {
    profile = normalizeCollisionProfile(value.profile);
  } catch {
    return unchangedOutcome(contact, "failed", CollisionResponseErrorCode.invalidProfile);
  }
  if (contact.profileId !== profile.profileId || contact.policyRevision !== profile.policyRevision || contact.responseMode !== profile.responseMode) {
    return unchangedOutcome(contact, "failed", CollisionResponseErrorCode.invalidProfile);
  }
  if (contact.responseMode === "detectOnly") return unchangedOutcome(contact, "notApplied");

  const normal = contact.contactNormal;
  if (normal === undefined) return unchangedOutcome(contact, "unsupported", CollisionResponseErrorCode.missingContactNormal);

  let massA: number;
  let massB: number;
  try {
    massA = positiveMass(value.massA, "massA");
    massB = positiveMass(value.massB, "massB");
  } catch (error) {
    const errorCode = value.massA === undefined || value.massB === undefined
      ? CollisionResponseErrorCode.missingMass
      : CollisionResponseErrorCode.invalidMass;
    return unchangedOutcome(contact, "failed", errorCode);
  }

  const relativeVelocity = vec3(
    contact.stateB.velocity.x - contact.stateA.velocity.x,
    contact.stateB.velocity.y - contact.stateA.velocity.y,
    contact.stateB.velocity.z - contact.stateA.velocity.z,
  );
  const normalRelativeSpeed = dot(relativeVelocity, normal);
  const normalRelativeSpeedValue = metersPerSecond(normalRelativeSpeed);
  if (normalRelativeSpeed >= -profile.requiredVelocityErrorMetersPerSecond) {
    return Object.freeze({
      ...unchangedOutcome(contact, "notApproaching"),
      normalRelativeSpeed: normalRelativeSpeedValue,
    });
  }

  const inverseMassSum = 1 / massA + 1 / massB;
  const impulseMagnitude = -(1 + profile.coefficientOfRestitution) * normalRelativeSpeed / inverseMassSum;
  const deltaVelocityA = vec3(
    metersPerSecond(-(impulseMagnitude / massA) * normal.x),
    metersPerSecond(-(impulseMagnitude / massA) * normal.y),
    metersPerSecond(-(impulseMagnitude / massA) * normal.z),
  );
  const deltaVelocityB = vec3(
    metersPerSecond((impulseMagnitude / massB) * normal.x),
    metersPerSecond((impulseMagnitude / massB) * normal.y),
    metersPerSecond((impulseMagnitude / massB) * normal.z),
  );
  return Object.freeze({
    responseMode: contact.responseMode,
    responseResult: "applied",
    preStateA: contact.stateA,
    preStateB: contact.stateB,
    postStateA: addVelocity(contact.stateA, deltaVelocityA),
    postStateB: addVelocity(contact.stateB, deltaVelocityB),
    normalRelativeSpeed: normalRelativeSpeedValue,
    impulseMagnitude,
    deltaVelocityA,
    deltaVelocityB,
  });
}

export function applyCollisionResponseAtomically(value: CollisionAtomicHandoffInput): CollisionAtomicHandoffResult {
  if (typeof value !== "object" || value === null) throw new TypeError("Collision atomic handoff input must be an object");
  const contact = createCollisionContactRecord(value.contact);
  const response = resolveCollisionVelocityResponse({ contact, profile: value.profile, massA: value.massA, massB: value.massB });
  const referenceStatusA = normalizedReferenceStatus(value.referenceStatusA, "referenceStatusA");
  const referenceStatusB = normalizedReferenceStatus(value.referenceStatusB, "referenceStatusB");
  const successorValidation = value.successorValidation ?? { objectA: true, objectB: true };
  if (typeof successorValidation.objectA !== "boolean" || typeof successorValidation.objectB !== "boolean") {
    throw new TypeError("successorValidation flags must be boolean");
  }
  const failedResponse = response.responseResult === "failed" || response.responseResult === "unsupported";
  const failedSuccessor = !successorValidation.objectA || !successorValidation.objectB;
  if (failedResponse || failedSuccessor) {
    return Object.freeze({
      status: CollisionAtomicHandoffStatus.rolledBack,
      objectA: contact.objectA,
      objectB: contact.objectB,
      exactContactInstant: contact.exactContactInstant,
      response: failedSuccessor
        ? Object.freeze({ ...response, responseResult: "failed", errorCode: CollisionResponseErrorCode.successorValidationFailed })
        : response,
      stateA: contact.stateA,
      stateB: contact.stateB,
      referenceStatusA,
      referenceStatusB,
      errorCode: failedSuccessor ? CollisionResponseErrorCode.successorValidationFailed : response.errorCode,
    });
  }
  return Object.freeze({
    status: CollisionAtomicHandoffStatus.committed,
    objectA: contact.objectA,
    objectB: contact.objectB,
    exactContactInstant: contact.exactContactInstant,
    response,
    stateA: response.postStateA,
    stateB: response.postStateB,
    referenceStatusA: response.responseResult === "applied" && referenceStatusA === ReferenceStatus.followingReference
      ? ReferenceStatus.diverged : referenceStatusA,
    referenceStatusB: response.responseResult === "applied" && referenceStatusB === ReferenceStatus.followingReference
      ? ReferenceStatus.diverged : referenceStatusB,
  });
}

export function recordCollisionResponseResult(
  contact: CollisionContactRecord,
  responseResult: CollisionResponseResult,
  lifecycle = contact.lifecycle,
): CollisionContactRecord {
  return createCollisionContactRecord({ ...contact, responseResult, lifecycle });
}

export class CollisionContactSuppressionManager {
  readonly #entries = new Map<string, SuppressionEntry>();

  #key(objectA: ObjectId, objectB: ObjectId): string {
    const left = BigInt(objectA);
    const right = BigInt(objectB);
    return left < right ? `${objectA}:${objectB}` : `${objectB}:${objectA}`;
  }

  record(contact: CollisionContactRecord, separationHysteresisMeters: number): CollisionSuppressionState {
    const hysteresis = finite(separationHysteresisMeters, "separationHysteresisMeters");
    if (hysteresis < 0) throw new RangeError("separationHysteresisMeters must be non-negative");
    const entry: SuppressionEntry = Object.freeze({
      contactId: contact.contactId,
      objectA: contact.objectA,
      objectB: contact.objectB,
      releaseSeparationMeters: contact.collisionBoundingRadiusMetersA + contact.collisionBoundingRadiusMetersB + hysteresis,
      ...(contact.motionDependencyRevisionDigest === undefined ? {} : { dependencyDigest: contact.motionDependencyRevisionDigest }),
    });
    this.#entries.set(this.#key(contact.objectA, contact.objectB), entry);
    return Object.freeze({ ...entry });
  }

  isSuppressed(
    objectA: ObjectId,
    objectB: ObjectId,
    separationMeters: number,
    dependencyDigest?: string,
  ): boolean {
    const key = this.#key(objectA, objectB);
    const entry = this.#entries.get(key);
    if (entry === undefined) return false;
    if (entry.dependencyDigest !== dependencyDigest || finite(separationMeters, "separationMeters") > entry.releaseSeparationMeters) {
      this.#entries.delete(key);
      return false;
    }
    return true;
  }

  invalidate(objectA: ObjectId, objectB: ObjectId): boolean {
    return this.#entries.delete(this.#key(objectA, objectB));
  }

  get(objectA: ObjectId, objectB: ObjectId): CollisionSuppressionState | undefined {
    const entry = this.#entries.get(this.#key(objectA, objectB));
    return entry === undefined ? undefined : Object.freeze({ ...entry });
  }

  clear(): void {
    this.#entries.clear();
  }
}
