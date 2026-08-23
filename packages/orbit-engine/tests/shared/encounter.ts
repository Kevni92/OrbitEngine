import assert from "node:assert/strict";

import {
  DependencyKind,
  EncounterPolicyMode,
  ObjectType,
  ReferenceStatus,
  ScheduledWorkPayloadKind,
  ScheduledWorkPhase,
  ScheduledWorkSourceKind,
  objectId,
  revisionId,
  type OrbitEngine as OrbitEngineType,
} from "../../src/index.js";
import { duration, simulationInstant } from "../../src/time.js";

export async function assertEncounterPrimitives(engine: OrbitEngineType): Promise<void> {
  const profile = {
    profileId: "parity",
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
  } as const;
  const objectA = objectId("2");
  const objectB = objectId("9007199254740993");
  engine.configureEncounterPolicy({
    revision: revisionId("1"),
    profiles: [profile],
    rules: [{
      id: "spacecraft-planet",
      objectTypes: [ObjectType.planet, ObjectType.spacecraft],
      resolution: { mode: EncounterPolicyMode.monitor, profileId: profile.profileId },
    }],
  });
  assert.deepEqual(engine.resolveEncounterPolicy(
    { objectA: objectB, objectB: objectA },
    {
      objectA: { objectId: objectA, type: ObjectType.planet, referenceStatus: ReferenceStatus.followingReference },
      objectB: { objectId: objectB, type: ObjectType.spacecraft, referenceStatus: ReferenceStatus.diverged },
    },
  ), { mode: EncounterPolicyMode.monitor, profileId: profile.profileId });
  assert.deepEqual(engine.resolveEncounterPolicy({ objectA, objectB }), { mode: EncounterPolicyMode.disabled });

  const work = engine.scheduleWork({
    instant: simulationInstant(5),
    phase: ScheduledWorkPhase.predictionMaintenance,
    sourceKind: ScheduledWorkSourceKind.interaction,
    sourceId: objectA,
    dependencies: [{ kind: DependencyKind.interactionPolicy, id: "encounter-policy", revision: revisionId("1") }],
    payload: { kind: ScheduledWorkPayloadKind.marker },
  });
  engine.configureEncounterPolicy({ revision: revisionId("2"), profiles: [{ ...profile, policyRevision: revisionId("2") }] });
  assert.deepEqual(engine.listScheduledWorkDiagnostics(), []);
  assert.equal(engine.listInvalidationDiagnostics().at(-1)?.dependency.kind, DependencyKind.interactionPolicy);
  assert.equal(work.generation, revisionId("1"));
}
