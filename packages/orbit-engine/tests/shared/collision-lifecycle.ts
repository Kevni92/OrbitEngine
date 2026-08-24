import assert from "node:assert/strict";

import {
  CollisionContactBatchErrorCode,
  CollisionContactBatchStatus,
  CollisionContactLifecycle,
  CollisionContactQuality,
  CollisionResponseMode,
  CollisionResponseResult,
  DependencyKind,
  ReferenceStatus,
  createCollisionContactRecord,
  groupCollisionContactsByInstant,
  normalizeCollisionProfile,
  type CollisionContactRecord,
  type CollisionProfile,
  type OrbitEngine as OrbitEngineType,
} from "../../src/index.js";
import { propagationState, revisionId } from "../../src/propagation.js";
import { duration, simulationInstant } from "../../src/time.js";
import { meters, metersPerSecond } from "../../src/units.js";

const exact = simulationInstant(12, 7);

function profile(responseMode: CollisionResponseMode, profileId: string): CollisionProfile {
  return normalizeCollisionProfile({
    profileId,
    responseMode,
    coefficientOfRestitution: responseMode === CollisionResponseMode.detectOnly ? 0 : 1,
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

function state(positionX: number, velocityX: number, epoch = exact) {
  return propagationState({
    position: { x: meters(positionX), y: meters(0), z: meters(0) },
    velocity: { x: metersPerSecond(velocityX), y: metersPerSecond(0), z: metersPerSecond(0) },
    epoch,
    referenceFrame: "1" as never,
  });
}

function contact(
  objectA: string,
  objectB: string,
  responseMode: CollisionResponseMode,
  exactContactInstant = exact,
  dependencyRevisions?: readonly { readonly kind: DependencyKind; readonly id: string; readonly revision: string }[],
): CollisionContactRecord {
  const sourceA = state(0, 1, exactContactInstant);
  const sourceB = state(2, -3, exactContactInstant);
  return createCollisionContactRecord({
    generation: revisionId("1"),
    objectA: objectA as never,
    objectB: objectB as never,
    exactContactInstant,
    evaluationFrame: "1" as never,
    stateA: sourceA,
    stateB: sourceB,
    collisionBoundingRadiusMetersA: 1,
    collisionBoundingRadiusMetersB: 1,
    timeUncertainty: duration(0, 1),
    separationUncertaintyMeters: 0,
    policyRevision: revisionId("1"),
    profileId: responseMode === CollisionResponseMode.detectOnly ? "detect" : "impulse",
    collisionShapeRevisionA: revisionId("1"),
    collisionShapeRevisionB: revisionId("1"),
    dependencyRevisions: dependencyRevisions?.map((value) => ({ ...value, revision: revisionId(value.revision) })),
    responseMode,
    responseResult: CollisionResponseResult.notApplied,
    quality: CollisionContactQuality.refined,
    lifecycle: CollisionContactLifecycle.active,
  });
}

function input(record: CollisionContactRecord, collisionProfile: CollisionProfile) {
  return {
    contact: record,
    profile: collisionProfile,
    ...(record.responseMode === CollisionResponseMode.frictionlessImpulse ? { massA: 2, massB: 1 } : {}),
    referenceStatusA: ReferenceStatus.none,
    referenceStatusB: ReferenceStatus.none,
  } as const;
}

export async function assertCollisionLifecycle(engine: OrbitEngineType): Promise<void> {
  const detectProfile = profile(CollisionResponseMode.detectOnly, "detect");
  const impulseProfile = profile(CollisionResponseMode.frictionlessImpulse, "impulse");

  const first = contact("9", "2", CollisionResponseMode.detectOnly);
  const second = contact("4", "5", CollisionResponseMode.detectOnly);
  const later = contact("6", "7", CollisionResponseMode.detectOnly, simulationInstant(12, 8));
  const groups = groupCollisionContactsByInstant([later, first, second]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0]?.exactContactInstant.nanoseconds, 7);
  assert.deepEqual(groups[0]?.contacts.map((value) => [value.objectA, value.objectB]), [["2", "9"], ["4", "5"]]);
  assert.equal(groups[1]?.contacts[0]?.contactId, later.contactId);

  const detectBatch = engine.resolveSimultaneousCollisionContacts([
    input(first, detectProfile),
    input(contact("2", "8", CollisionResponseMode.detectOnly), detectProfile),
  ]);
  assert.equal(detectBatch.status, CollisionContactBatchStatus.committed);
  assert.equal(detectBatch.outcomes.length, 2);
  assert.deepEqual(detectBatch.outcomes.map((value) => [value.contact.objectA, value.contact.objectB]), [["2", "8"], ["2", "9"]]);
  for (const value of detectBatch.outcomes) {
    assert.deepEqual(value.stateA, value.contact.stateA);
    assert.deepEqual(value.stateB, value.contact.stateB);
  }

  const disjoint = engine.resolveSimultaneousCollisionContacts([
    input(contact("10", "11", CollisionResponseMode.frictionlessImpulse), impulseProfile),
    input(contact("12", "13", CollisionResponseMode.frictionlessImpulse), impulseProfile),
  ]);
  assert.equal(disjoint.status, CollisionContactBatchStatus.committed);
  assert.equal(disjoint.outcomes[0]?.handoff.status, "committed");
  assert.equal(disjoint.outcomes[1]?.handoff.status, "committed");

  const sharedLeft = contact("14", "15", CollisionResponseMode.frictionlessImpulse);
  const sharedRight = contact("14", "16", CollisionResponseMode.frictionlessImpulse);
  const shared = engine.resolveSimultaneousCollisionContacts([
    input(sharedLeft, impulseProfile),
    input(sharedRight, impulseProfile),
  ]);
  assert.equal(shared.status, CollisionContactBatchStatus.rolledBack);
  assert.equal(shared.errorCode, CollisionContactBatchErrorCode.unsupportedSimultaneousImpulseContact);
  assert.deepEqual(shared.outcomes[0]?.stateA, sharedLeft.stateA);
  assert.deepEqual(shared.outcomes[1]?.stateA, sharedRight.stateA);

  const failedDependency = engine.validateCollisionRemovalDependencies({
    objectId: "20" as never,
    dependencies: [{ kind: "structural", id: "21" }],
  });
  assert.equal(failedDependency.canRemove, false);
  assert.deepEqual(failedDependency.blockers, [{ kind: "structural", id: "21" }]);

  const active = contact("22", "23", CollisionResponseMode.detectOnly);
  engine.registerCollisionContact({ record: active });
  const activeRemoval = engine.checkCollisionRemovalDependencies("22" as never);
  assert.equal(activeRemoval.canRemove, false);
  assert.deepEqual(activeRemoval.blockers, [{ kind: "collisionContact", id: active.contactId }]);
  assert.equal(engine.getCollisionContact(active.contactId)?.lifecycle, CollisionContactLifecycle.active);

  const dependencyContact = contact("24", "25", CollisionResponseMode.detectOnly, exact, [
    { kind: DependencyKind.motion, id: "24", revision: "1" },
  ]);
  engine.registerCollisionContact({
    record: dependencyContact,
    dependencyRevisions: [{ kind: DependencyKind.motion, id: "24", revision: revisionId("1") }],
  });
  assert.equal(engine.isCollisionContactGenerationCurrent(dependencyContact), true);
  const invalidation = engine.invalidateDependency(
    { kind: DependencyKind.motion, id: "24", revision: revisionId("2") },
    exact,
  );
  assert.equal(invalidation.retiredWorkIds.length, 0);
  assert.equal(engine.getCollisionContact(dependencyContact.contactId)?.lifecycle, CollisionContactLifecycle.stale);
  assert.equal(engine.getCollisionDiagnostics(dependencyContact.contactId)?.invalidationCount, 1);
  assert.equal(engine.isCollisionContactGenerationCurrent(dependencyContact), false);

  const staleExecution = engine.executeSimultaneousCollisionContacts([input(dependencyContact, detectProfile)]);
  assert.equal(staleExecution.status, CollisionContactBatchStatus.rolledBack);
  assert.equal(staleExecution.errorCode, CollisionContactBatchErrorCode.staleGeneration);
  assert.deepEqual(staleExecution.outcomes[0]?.stateA, dependencyContact.stateA);
}
