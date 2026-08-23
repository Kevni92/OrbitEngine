import assert from "node:assert/strict";

import {
  CollisionContactLifecycle,
  CollisionContactQuality,
  CollisionPolicyMode,
  CollisionResponseMode,
  CollisionResponseResult,
  ObjectType,
  ReferenceStatus,
  canonicalCollisionPair,
  collisionContactIdForPair,
  createCollisionContactRecord,
  deserializeCollisionContactRecord,
  collisionSphereParticipates,
  nextCollisionGeneration,
  normalizeCollisionPolicy,
  normalizeCollisionProfile,
  normalizeCollisionSphere,
  requireCollisionSphere,
  serializeCollisionContactRecord,
  transitionCollisionContactRecordLifecycle,
  type OrbitEngine as OrbitEngineType,
} from "../../src/index.js";
import { propagationState, revisionId } from "../../src/propagation.js";
import { duration, simulationInstant } from "../../src/time.js";
import { meters, metersPerSecond } from "../../src/units.js";

const profile = {
  profileId: "detect",
  responseMode: CollisionResponseMode.detectOnly,
  coefficientOfRestitution: 0,
  broadPhaseMarginMeters: 5,
  contactDistanceToleranceMeters: 0.001,
  contactTimeTolerance: duration(1, 1),
  separationHysteresisMeters: 0.25,
  maxCandidateSubdivisions: 16,
  maxRootIterations: 32,
  requiredPositionErrorMeters: 0.01,
  requiredVelocityErrorMetersPerSecond: 0.001,
  policyRevision: revisionId("1"),
} as const;

export async function assertCollisionPrimitives(engine: OrbitEngineType): Promise<void> {
  const policy = engine.configureCollisionPolicy({
    revision: revisionId("1"),
    profiles: [profile],
    rules: [{
      id: "spacecraft-planet",
      priority: 10,
      objectTypes: [ObjectType.planet, ObjectType.spacecraft],
      referenceStatuses: [ReferenceStatus.followingReference, ReferenceStatus.diverged],
      requiredInteractionTags: ["physical"],
      requiresCollisionGeometry: true,
      resolution: { mode: CollisionPolicyMode.enabled, profileId: profile.profileId },
    }],
  });
  assert.equal(policy.revision, revisionId("1"));
  assert.deepEqual(engine.resolveCollisionPolicy(
    { objectA: "9007199254740993" as never, objectB: "2" as never },
    {
      objectA: { objectId: "2" as never, type: ObjectType.planet, referenceStatus: ReferenceStatus.followingReference },
      objectB: { objectId: "9007199254740993" as never, type: ObjectType.spacecraft, referenceStatus: ReferenceStatus.diverged },
      interactionTags: ["physical"],
      hasCollisionGeometry: true,
    },
  ), { mode: CollisionPolicyMode.enabled, profileId: profile.profileId });
  assert.deepEqual(engine.resolveCollisionPolicy({ objectA: "2" as never, objectB: "9007199254740993" as never }), { mode: CollisionPolicyMode.disabled });
  assert.deepEqual(engine.getEncounterPolicy().defaultResolution, { mode: "disabled" });

  engine.configureCollisionPolicy({
    revision: revisionId("2"),
    profiles: [{ ...profile, policyRevision: revisionId("2") }],
    pairOverrides: [{ objectA: "9007199254740993" as never, objectB: "2" as never, resolution: { mode: CollisionPolicyMode.disabled } }],
    objectOverrides: [{ objectId: "2" as never, resolution: { mode: CollisionPolicyMode.enabled, profileId: profile.profileId } }],
    defaultResolution: { mode: CollisionPolicyMode.enabled, profileId: profile.profileId },
  });
  assert.deepEqual(engine.resolveCollisionPolicy({ objectA: "2" as never, objectB: "9007199254740993" as never }), { mode: CollisionPolicyMode.disabled });
  assert.deepEqual(engine.resolveCollisionPolicy({ objectA: "2" as never, objectB: "3" as never }), { mode: CollisionPolicyMode.enabled, profileId: profile.profileId });

  const point = normalizeCollisionSphere({ objectId: "2" as never });
  assert.equal(point.collisionBoundingRadiusMeters, undefined);
  assert.equal(point.collisionShapeRevision, undefined);
  assert.equal(collisionSphereParticipates(point), false);
  assert.throws(() => requireCollisionSphere(point), /no explicit collision sphere geometry/);
  assert.throws(() => normalizeCollisionSphere({ objectId: "2" as never, collisionBoundingRadiusMeters: 1 }), /collisionShapeRevision is required/);

  const zero = normalizeCollisionSphere({
    objectId: "2" as never,
    collisionBoundingRadiusMeters: 0,
    collisionShapeRevision: revisionId("7"),
  });
  assert.equal(zero.collisionBoundingRadiusMeters, 0);
  assert.equal(zero.collisionShapeRevision, revisionId("7"));
  assert.equal(collisionSphereParticipates(zero), true);
  assert.equal(requireCollisionSphere(zero).collisionBoundingRadiusMeters, 0);
  assert.throws(() => normalizeCollisionSphere({ objectId: "2" as never, collisionShapeRevision: revisionId("1") }), /requires an explicit/);

  assert.throws(() => normalizeCollisionProfile({ ...profile, coefficientOfRestitution: 1.1 }));
  assert.throws(() => normalizeCollisionProfile({ ...profile, maxRootIterations: 0 }));
  assert.throws(() => normalizeCollisionProfile({ ...profile, contactTimeTolerance: duration(0) }));
  assert.equal(normalizeCollisionProfile(profile).responseMode, CollisionResponseMode.detectOnly);
  assert.equal(normalizeCollisionPolicy({ revision: revisionId("0"), profiles: [] }).defaultResolution.mode, CollisionPolicyMode.disabled);

  const exact = simulationInstant(10, 25);
  const stateA = propagationState({
    position: { x: meters(0), y: meters(0), z: meters(0) },
    velocity: { x: metersPerSecond(1), y: metersPerSecond(0), z: metersPerSecond(0) },
    epoch: exact,
    referenceFrame: "1" as never,
  });
  const stateB = propagationState({
    position: { x: meters(5), y: meters(0), z: meters(0) },
    velocity: { x: metersPerSecond(-1), y: metersPerSecond(0), z: metersPerSecond(0) },
    epoch: exact,
    referenceFrame: "1" as never,
  });
  const input = {
    generation: revisionId("1"),
    objectA: "2" as never,
    objectB: "9007199254740993" as never,
    exactContactInstant: exact,
    evaluationFrame: "1" as never,
    stateA,
    stateB,
    collisionBoundingRadiusMetersA: 2,
    collisionBoundingRadiusMetersB: 3,
    timeUncertainty: duration(0, 10),
    separationUncertaintyMeters: 0.001,
    policyRevision: revisionId("1"),
    profileId: profile.profileId,
    collisionShapeRevisionA: revisionId("4"),
    collisionShapeRevisionB: revisionId("8"),
    dependencyRevisions: [{ kind: "motion" as const, id: "2", revision: revisionId("12") }],
    responseMode: CollisionResponseMode.detectOnly,
    responseResult: CollisionResponseResult.notApplied,
    quality: CollisionContactQuality.refined,
  } as const;
  const record = createCollisionContactRecord(input);
  assert.equal(record.contactId, collisionContactIdForPair(canonicalCollisionPair("2" as never, "9007199254740993" as never)));
  assert.equal(record.objectA, "2");
  assert.equal(record.objectB, "9007199254740993");
  assert.deepEqual(record.contactNormal, { x: 1, y: 0, z: 0 });
  assert.deepEqual(record.contactPointApproximation, { x: 2, y: 0, z: 0 });
  assert.equal(record.normalRelativeSpeed, -2);
  assert.equal(record.motionDependencyRevisionDigest !== undefined, true);
  assert.equal(record.lifecycle, CollisionContactLifecycle.active);
  assert.equal(nextCollisionGeneration(record.generation), revisionId("2"));

  const reversed = createCollisionContactRecord({
    ...input,
    objectA: input.objectB,
    objectB: input.objectA,
    stateA: stateB,
    stateB: stateA,
    collisionBoundingRadiusMetersA: input.collisionBoundingRadiusMetersB,
    collisionBoundingRadiusMetersB: input.collisionBoundingRadiusMetersA,
    collisionShapeRevisionA: input.collisionShapeRevisionB,
    collisionShapeRevisionB: input.collisionShapeRevisionA,
  });
  assert.equal(reversed.contactId, record.contactId);
  assert.deepEqual(reversed, record);

  const serialized = serializeCollisionContactRecord(record);
  assert.deepEqual(deserializeCollisionContactRecord(serialized), record);
  const stale = transitionCollisionContactRecordLifecycle(record, CollisionContactLifecycle.stale);
  assert.equal(stale.lifecycle, CollisionContactLifecycle.stale);
  const retired = transitionCollisionContactRecordLifecycle(stale, CollisionContactLifecycle.retired);
  assert.equal(retired.lifecycle, CollisionContactLifecycle.retired);
  assert.throws(() => transitionCollisionContactRecordLifecycle(retired, CollisionContactLifecycle.active));
}
