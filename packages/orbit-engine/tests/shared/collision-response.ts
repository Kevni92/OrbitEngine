import assert from "node:assert/strict";

import {
  CollisionAtomicHandoffStatus,
  CollisionContactLifecycle,
  CollisionContactQuality,
  CollisionContactSuppressionManager,
  CollisionResponseErrorCode,
  CollisionResponseMode,
  CollisionResponseResult,
  ReferenceStatus,
  createCollisionContactRecord,
  normalizeCollisionProfile,
  recordCollisionResponseResult,
  resolveCollisionVelocityResponse,
  type CollisionContactRecord,
  type CollisionProfile,
  type OrbitEngine as OrbitEngineType,
} from "../../src/index.js";
import { propagationState, revisionId } from "../../src/propagation.js";
import { duration, simulationInstant } from "../../src/time.js";
import { meters, metersPerSecond } from "../../src/units.js";

const exact = simulationInstant(4, 25);

function profile(responseMode: CollisionResponseMode, coefficientOfRestitution: number, profileId: string): CollisionProfile {
  return normalizeCollisionProfile({
    profileId,
    responseMode,
    coefficientOfRestitution,
    broadPhaseMarginMeters: 0,
    contactDistanceToleranceMeters: 0.001,
    contactTimeTolerance: duration(0, 1),
    separationHysteresisMeters: 0.5,
    maxCandidateSubdivisions: 16,
    maxRootIterations: 64,
    requiredPositionErrorMeters: 0.001,
    requiredVelocityErrorMetersPerSecond: 0.001,
    policyRevision: revisionId("1"),
  });
}

function state(positionX: number, velocityX: number, velocityY: number) {
  return propagationState({
    position: { x: meters(positionX), y: meters(0), z: meters(0) },
    velocity: { x: metersPerSecond(velocityX), y: metersPerSecond(velocityY), z: metersPerSecond(0) },
    epoch: exact,
    referenceFrame: "1" as never,
  });
}

function contact(responseMode: CollisionResponseMode, responseResult: CollisionResponseResult = CollisionResponseResult.notApplied): CollisionContactRecord {
  return createCollisionContactRecord({
    generation: revisionId("1"),
    objectA: "2" as never,
    objectB: "3" as never,
    exactContactInstant: exact,
    evaluationFrame: "1" as never,
    stateA: state(0, 1, 5),
    stateB: state(2, -3, 1),
    collisionBoundingRadiusMetersA: 1,
    collisionBoundingRadiusMetersB: 1,
    timeUncertainty: duration(0),
    separationUncertaintyMeters: 0,
    policyRevision: revisionId("1"),
    profileId: responseMode === CollisionResponseMode.detectOnly ? "detect" : "impulse",
    collisionShapeRevisionA: revisionId("1"),
    collisionShapeRevisionB: revisionId("1"),
    responseMode,
    responseResult,
    quality: CollisionContactQuality.refined,
    lifecycle: CollisionContactLifecycle.active,
  });
}

export async function assertCollisionResponse(engine: OrbitEngineType): Promise<void> {
  const detectProfile = profile(CollisionResponseMode.detectOnly, 0, "detect");
  const detectContact = contact(CollisionResponseMode.detectOnly);
  const detect = engine.resolveCollisionVelocityResponse({ contact: detectContact, profile: detectProfile });
  assert.equal(detect.responseResult, CollisionResponseResult.notApplied);
  assert.deepEqual(detect.postStateA, detect.preStateA);
  assert.deepEqual(detect.postStateB, detect.preStateB);

  const suppression = new CollisionContactSuppressionManager();
  const suppressionState = suppression.record(detectContact, detectProfile.separationHysteresisMeters);
  assert.equal(suppressionState.releaseSeparationMeters, 2.5);
  assert.equal(suppression.isSuppressed("3" as never, "2" as never, 2.4), true);
  assert.equal(suppression.isSuppressed("2" as never, "3" as never, 2.5), true);
  assert.equal(suppression.isSuppressed("2" as never, "3" as never, 2.6), false);
  suppression.record(detectContact, detectProfile.separationHysteresisMeters);
  assert.equal(suppression.isSuppressed("2" as never, "3" as never, 2, "changed"), false);
  suppression.record(detectContact, detectProfile.separationHysteresisMeters);
  assert.equal(suppression.invalidate("2" as never, "3" as never), true);

  const elasticProfile = profile(CollisionResponseMode.frictionlessImpulse, 1, "impulse");
  const elasticContact = contact(CollisionResponseMode.frictionlessImpulse);
  const elastic = engine.resolveCollisionVelocityResponse({ contact: elasticContact, profile: elasticProfile, massA: 2, massB: 1 });
  assert.equal(elastic.responseResult, CollisionResponseResult.applied);
  assert.ok(Math.abs(elastic.postStateA.velocity.x - (-5 / 3)) < 1e-12);
  assert.ok(Math.abs(elastic.postStateB.velocity.x - (7 / 3)) < 1e-12);
  assert.equal(elastic.postStateA.velocity.y, elasticContact.stateA.velocity.y);
  assert.equal(elastic.postStateB.velocity.y, elasticContact.stateB.velocity.y);
  assert.ok(Math.abs(2 * elastic.postStateA.velocity.x + elastic.postStateB.velocity.x + 1) < 1e-12);
  assert.equal(elastic.normalRelativeSpeed, -4);

  const inelasticProfile = profile(CollisionResponseMode.frictionlessImpulse, 0, "impulse-zero");
  const inelasticContact = createCollisionContactRecord({ ...elasticContact, profileId: "impulse-zero" });
  const inelastic = resolveCollisionVelocityResponse({ contact: inelasticContact, profile: inelasticProfile, massA: 2, massB: 1 });
  assert.equal(inelastic.responseResult, CollisionResponseResult.applied);
  assert.ok(Math.abs(inelastic.postStateB.velocity.x - inelastic.postStateA.velocity.x) < 1e-12);

  const separatingContact = createCollisionContactRecord({
    ...elasticContact,
    stateA: state(0, -1, 5),
    stateB: state(2, 1, 1),
  });
  const separating = resolveCollisionVelocityResponse({ contact: separatingContact, profile: elasticProfile, massA: 2, massB: 1 });
  assert.equal(separating.responseResult, CollisionResponseResult.notApproaching);
  assert.deepEqual(separating.postStateA, separating.preStateA);

  const missingMass = resolveCollisionVelocityResponse({ contact: elasticContact, profile: elasticProfile, massA: 2 });
  assert.equal(missingMass.responseResult, CollisionResponseResult.failed);
  assert.equal(missingMass.errorCode, CollisionResponseErrorCode.missingMass);
  const invalidMass = resolveCollisionVelocityResponse({ contact: elasticContact, profile: elasticProfile, massA: 0, massB: 1 });
  assert.equal(invalidMass.responseResult, CollisionResponseResult.failed);
  assert.equal(invalidMass.errorCode, CollisionResponseErrorCode.invalidMass);

  const coincident = createCollisionContactRecord({
    ...elasticContact,
    stateB: state(0, -3, 1),
    contactNormal: undefined,
  });
  const missingNormal = resolveCollisionVelocityResponse({ contact: coincident, profile: elasticProfile, massA: 2, massB: 1 });
  assert.equal(missingNormal.responseResult, CollisionResponseResult.unsupported);
  assert.equal(missingNormal.errorCode, CollisionResponseErrorCode.missingContactNormal);

  const committed = engine.applyCollisionResponseAtomically({
    contact: elasticContact,
    profile: elasticProfile,
    massA: 2,
    massB: 1,
    referenceStatusA: ReferenceStatus.followingReference,
    referenceStatusB: ReferenceStatus.none,
  });
  assert.equal(committed.status, CollisionAtomicHandoffStatus.committed);
  assert.equal(committed.stateA.epoch.seconds, exact.seconds);
  assert.equal(committed.referenceStatusA, ReferenceStatus.diverged);
  assert.equal(committed.referenceStatusB, ReferenceStatus.none);
  assert.equal(committed.stateA.velocity.x, elastic.postStateA.velocity.x);
  assert.equal(committed.stateB.velocity.x, elastic.postStateB.velocity.x);

  const rolledBack = engine.applyCollisionResponseAtomically({
    contact: elasticContact,
    profile: elasticProfile,
    massA: 2,
    massB: 1,
    referenceStatusA: ReferenceStatus.followingReference,
    referenceStatusB: ReferenceStatus.none,
    successorValidation: { objectA: true, objectB: false },
  });
  assert.equal(rolledBack.status, CollisionAtomicHandoffStatus.rolledBack);
  assert.equal(rolledBack.errorCode, CollisionResponseErrorCode.successorValidationFailed);
  assert.deepEqual(rolledBack.stateA, elasticContact.stateA);
  assert.deepEqual(rolledBack.stateB, elasticContact.stateB);
  assert.equal(rolledBack.referenceStatusA, ReferenceStatus.followingReference);

  const failedContact = recordCollisionResponseResult(elasticContact, CollisionResponseResult.failed, CollisionContactLifecycle.failed);
  assert.equal(failedContact.responseResult, CollisionResponseResult.failed);
  assert.equal(failedContact.lifecycle, CollisionContactLifecycle.failed);
}
