import assert from "node:assert/strict";
import test from "node:test";

import {
  EncounterPolicyManager,
  EncounterRecordLifecycle,
  EncounterRecordQuality,
  canonicalEncounterPair,
  createEncounterRecord,
  deserializeEncounterRecord,
  encounterIdForPair,
  normalizeEncounterPolicy,
  normalizeEncounterPredictionProfile,
  nextEncounterGeneration,
  resolveEncounterPolicy,
  serializeEncounterRecord,
  transitionEncounterRecordLifecycle,
  upgradeEncounterRecordQuality,
  type EncounterPredictionProfileInput,
} from "../../src/encounter.js";
import { DependencyKind } from "../../src/dependency.js";
import { objectId, ObjectType } from "../../src/objects.js";
import { ReferenceStatus } from "../../src/registry.js";
import { revisionId } from "../../src/propagation.js";
import { duration, simulationInstant } from "../../src/time.js";

const profile: EncounterPredictionProfileInput = {
  profileId: "transfer",
  lookahead: duration(86_400),
  maintenanceLead: duration(3_600),
  broadPhaseDistanceMeters: 10_000,
  refineDistanceMeters: 1_000,
  closestApproachDistanceToleranceMeters: 0.1,
  closestApproachTimeTolerance: duration(1),
  maxBroadPhaseWindows: 8,
  maxCandidatesPerMaintenance: 32,
  maxCoarseSubdivisionsPerCandidate: 16,
  maxRefinementIntervalsPerCandidate: 16,
  maxSolverIterationsPerMinimum: 32,
  maxPublishedEncountersPerPair: 4,
  policyRevision: revisionId("1"),
};

const objectA = objectId("9007199254740993");
const objectB = objectId("2");

test("encounter pairs are canonically ordered by numeric ObjectId", () => {
  assert.deepEqual(canonicalEncounterPair(objectA, objectB), { objectA: objectB, objectB: objectA });
  assert.throws(() => canonicalEncounterPair(objectA, objectA), /distinct/);
  assert.equal(encounterIdForPair({ objectA, objectB }), encounterIdForPair({ objectA: objectB, objectB: objectA }));
});

test("prediction profiles require explicit concrete values and validate thresholds/budgets", () => {
  const normalized = normalizeEncounterPredictionProfile(profile);
  assert.equal(normalized.profileId, "transfer");
  assert.equal(normalized.lookahead.seconds, 86_400);
  assert.throws(() => normalizeEncounterPredictionProfile({ ...profile, refineDistanceMeters: 10_001 }), /must not exceed/);
  assert.throws(() => normalizeEncounterPredictionProfile({ ...profile, maxSolverIterationsPerMinimum: 0 }), /positive/);
  assert.throws(() => normalizeEncounterPredictionProfile({ ...profile, lookahead: duration(0) }), /positive/);
});

test("policy resolution is explicit and has deterministic override precedence", () => {
  const policy = normalizeEncounterPolicy({
    revision: revisionId("2"),
    profiles: [{ ...profile, policyRevision: revisionId("2") }],
    objectOverrides: [{ objectId: objectB, resolution: { mode: "monitor", profileId: "transfer" } }],
    pairOverrides: [{ objectA, objectB, resolution: { mode: "disabled" } }],
    rules: [{
      id: "spacecraft-pair",
      priority: 2,
      objectTypes: [ObjectType.planet, ObjectType.spacecraft],
      resolution: { mode: "monitor", profileId: "transfer" },
    }],
  });
  const facts = {
    objectA: { objectId: objectB, type: ObjectType.planet, referenceStatus: ReferenceStatus.followingReference },
    objectB: { objectId: objectA, type: ObjectType.spacecraft, referenceStatus: ReferenceStatus.diverged },
  };
  assert.deepEqual(resolveEncounterPolicy(policy, objectA, objectB, facts), { mode: "disabled" });

  const withoutPairOverride = normalizeEncounterPolicy({
    ...policy,
    profiles: [{ ...profile, policyRevision: revisionId("2") }],
    pairOverrides: [],
  });
  assert.deepEqual(resolveEncounterPolicy(withoutPairOverride, objectA, objectB, facts), {
    mode: "monitor",
    profileId: "transfer",
  });
  assert.deepEqual(resolveEncounterPolicy(withoutPairOverride, objectId("3"), objectId("4")), { mode: "disabled" });
  assert.throws(() => normalizeEncounterPolicy({
    revision: "3",
    profiles: [{ ...profile, policyRevision: "3" }],
    rules: [{ id: "bad", resolution: { mode: "monitor", profileId: "missing" } }],
  }), /unknown profile/);
});

test("encounter records have stable IDs, revision digest, lifecycle and read-only serialization", () => {
  const input = {
    generation: revisionId("0"),
    objectA,
    objectB,
    predictionInterval: { start: simulationInstant(0), end: simulationInstant(10) },
    closestApproachInstant: simulationInstant(5),
    closestApproachDistanceMeters: 12,
    relativeVelocityAtClosestApproach: { x: 1, y: 2, z: 3 },
    quality: EncounterRecordQuality.coarse,
    timeUncertainty: duration(2),
    distanceUncertaintyMeters: 0.5,
    domain: { domainId: "local", frame: "1" as never },
    dependencyRevisions: [{ kind: DependencyKind.motion, id: objectA, revision: revisionId("4") }],
    policyRevision: revisionId("2"),
    profileId: "transfer",
  };
  const record = createEncounterRecord(input);
  const reordered = createEncounterRecord({ ...input, objectA: objectB, objectB: objectA });
  assert.equal(record.encounterId, reordered.encounterId);
  assert.equal(record.objectA, objectB);
  assert.equal(record.dependencyRevisionDigest !== undefined, true);
  assert.equal(Object.isFrozen(record), true);
  assert.equal(nextEncounterGeneration(record.generation), "1");
  assert.equal(upgradeEncounterRecordQuality(record, EncounterRecordQuality.refined).quality, EncounterRecordQuality.refined);
  const stale = transitionEncounterRecordLifecycle(record, EncounterRecordLifecycle.stale);
  assert.equal(stale.lifecycle, EncounterRecordLifecycle.stale);
  assert.equal(transitionEncounterRecordLifecycle(stale, EncounterRecordLifecycle.retired).lifecycle, EncounterRecordLifecycle.retired);
  assert.throws(() => transitionEncounterRecordLifecycle(stale, EncounterRecordLifecycle.active), /Invalid/);

  const roundTrip = deserializeEncounterRecord(serializeEncounterRecord(record));
  assert.deepEqual(serializeEncounterRecord(roundTrip), serializeEncounterRecord(record));
});

test("policy revisions invoke the invalidation hook only when contents change", () => {
  const changes: string[] = [];
  const manager = new EncounterPolicyManager(undefined, (previous, next) => changes.push(`${previous.revision}->${next.revision}`));
  manager.setPolicy({ revision: "1", profiles: [profile] });
  manager.setPolicy({ revision: "1", profiles: [profile] });
  assert.deepEqual(changes, ["0->1"]);
  assert.throws(() => manager.setPolicy({ revision: "1", profiles: [], defaultResolution: { mode: "disabled" } }), /revision must change/);
  manager.setPolicy({ revision: "2", profiles: [{ ...profile, policyRevision: "2" }] });
  assert.deepEqual(changes, ["0->1", "1->2"]);
});
