import assert from "node:assert/strict";

import {
  DependencyKind,
  EncounterRecordLifecycle,
  EncounterRecordQuality,
  OrbitEngine,
  ScheduledWorkPayloadKind,
  ScheduledWorkPhase,
  ScheduledWorkSourceKind,
  createEncounterRecord,
  objectId,
  revisionId,
  type OrbitEngine as OrbitEngineType,
} from "../../src/index.js";
import { referenceFrameId } from "../../src/frames.js";
import { duration, simulationInstant, type Duration } from "../../src/time.js";

function record(
  encounterId: string,
  generation: string,
  start: number,
  end: number,
  dependencyRevision = "1",
  scheduledRefinementWorkId?: string,
) {
  return createEncounterRecord({
    encounterId,
    generation: revisionId(generation),
    objectA: objectId("1"),
    objectB: objectId(encounterId === "100" ? "3" : "2"),
    predictionInterval: { start: simulationInstant(start), end: simulationInstant(end) },
    closestApproachInstant: simulationInstant(Math.floor((start + end) / 2)),
    closestApproachDistanceMeters: 5,
    relativeVelocityAtClosestApproach: { x: 0, y: 0, z: 0 },
    quality: EncounterRecordQuality.refined,
    timeUncertainty: duration(1),
    distanceUncertaintyMeters: 0,
    domain: { domainId: "lifecycle-domain", frame: referenceFrameId("1") },
    dependencyRevisions: [{ kind: DependencyKind.motion, id: "1", revision: revisionId(dependencyRevision) }],
    policyRevision: revisionId("1"),
    profileId: "lifecycle",
    ...(scheduledRefinementWorkId === undefined ? {} : { scheduledRefinementWorkId: scheduledRefinementWorkId as never }),
  });
}

function work(instant: number) {
  return {
    instant: simulationInstant(instant),
    phase: ScheduledWorkPhase.predictionMaintenance,
    sourceKind: ScheduledWorkSourceKind.interaction,
    sourceId: objectId("1"),
    dependencies: [{ kind: DependencyKind.motion, id: "1", revision: revisionId("1") }],
    payload: { kind: ScheduledWorkPayloadKind.marker },
  } as const;
}

function boundedBound(id: string, x: number) {
  return {
    objectId: objectId(id),
    interval: { start: simulationInstant(0), end: simulationInstant(10) },
    domainId: "scaling-domain",
    min: { x, y: 0, z: 0 },
    max: { x: x + 1, y: 1, z: 1 },
    inflationMeters: 0,
  } as const;
}

export async function assertEncounterLifecycle(engine: OrbitEngineType): Promise<void> {
  const dependencyRevisions = [{ kind: DependencyKind.motion, id: "1", revision: revisionId("1") }] as const;
  const historical = engine.registerEncounter({ record: record("100", "1", 0, 5), dependencyRevisions });
  const staleCandidate = engine.registerEncounter({ record: record("101", "1", 10, 30), dependencyRevisions });
  const scheduledWork = engine.scheduleWork(work(20));
  engine.registerEncounter({ record: record("102", "1", 10, 30, "1", scheduledWork.id), dependencyRevisions });
  assert.equal(engine.getEncounter("101")?.lifecycle, EncounterRecordLifecycle.active);
  assert.deepEqual(engine.listUpcomingEncounters({ from: simulationInstant(0), to: simulationInstant(40) }).map((value) => value.encounterId), ["100", "101", "102"]);

  const report = engine.invalidateDependency(
    { kind: DependencyKind.motion, id: "1", revision: revisionId("2") },
    simulationInstant(15),
  );
  assert.deepEqual(report.retiredWorkIds, [scheduledWork.id]);
  assert.deepEqual(engine.getEncounter("100"), historical);
  assert.equal(engine.getEncounter("100")?.lifecycle, EncounterRecordLifecycle.active);
  assert.equal(engine.getEncounter("101")?.lifecycle, EncounterRecordLifecycle.stale);
  assert.equal(engine.getEncounter("102")?.lifecycle, EncounterRecordLifecycle.stale);
  assert.deepEqual(engine.listUpcomingEncounters({ from: simulationInstant(0), to: simulationInstant(40) }).map((value) => value.encounterId), ["100"]);
  assert.equal(engine.getEncounterDiagnostics("101")?.invalidationCount, 1);
  assert.equal(engine.advanceTo(simulationInstant(100)).processedWorkCount, 0);

  const rebuildInput = {
    record: record("101", "2", 15, 30, "2"),
    dependencyRevisions: [{ kind: DependencyKind.motion, id: "1", revision: revisionId("2") }],
  } as const;
  const scheduledRebuildInput = {
    record: record("102", "2", 15, 30, "2"),
    dependencyRevisions: [{ kind: DependencyKind.motion, id: "1", revision: revisionId("2") }],
  } as const;
  assert.equal(engine.enqueueEncounterRebuild([rebuildInput, scheduledRebuildInput]), 2);
  assert.equal(engine.rebuildEncounters(0).deferredCount, 2);
  const rebuilt = engine.rebuildEncounters(1);
  assert.deepEqual(rebuilt.rebuiltEncounterIds, ["101"]);
  assert.equal(engine.getEncounter("101")?.lifecycle, EncounterRecordLifecycle.active);
  assert.equal(engine.getEncounterCoverage({ profileId: "lifecycle" }).complete, false);
  engine.rebuildEncounters(1);
  assert.equal(engine.getEncounterCoverage({ profileId: "lifecycle" }).pendingRebuildCount, 0);
  assert.equal(engine.getEncounterCoverage({ profileId: "lifecycle" }).complete, true);

  const maintenance = await OrbitEngine.create({ backend: engine.backend });
  const profile = {
    profileId: "maintenance",
    lookahead: duration(100),
    maintenanceLead: duration(10),
    broadPhaseDistanceMeters: 100,
    refineDistanceMeters: 10,
    closestApproachDistanceToleranceMeters: 1,
    closestApproachTimeTolerance: duration(1),
    maxBroadPhaseWindows: 4,
    maxCandidatesPerMaintenance: 4,
    maxCoarseSubdivisionsPerCandidate: 4,
    maxRefinementIntervalsPerCandidate: 4,
    maxSolverIterationsPerMinimum: 4,
    maxPublishedEncountersPerPair: 4,
    policyRevision: revisionId("1"),
  } as const;
  maintenance.scheduleEncounterMaintenance({
    domainId: "maintenance-domain",
    sourceId: objectId("1"),
    profile,
    dependencyRevisions: [{ kind: DependencyKind.motion, id: "1", revision: revisionId("1") }],
  });
  const maintenanceInvalidation = maintenance.invalidateDependency(
    { kind: DependencyKind.motion, id: "1", revision: revisionId("2") },
    simulationInstant(90),
  );
  assert.deepEqual(maintenanceInvalidation.retiredWorkIds, ["1"]);
  assert.equal(maintenance.encounterSchedulingStatus().maintenanceCoverage.length, 0);

  const quiet = await OrbitEngine.create({ backend: engine.backend });
  const index = quiet.encounterBroadPhase();
  index.insert(boundedBound("1", 0));
  index.insert(boundedBound("2", 0.5));
  for (let indexValue = 3; indexValue <= 202; indexValue += 1) index.insert(boundedBound(String(indexValue), indexValue * 1_000));
  const candidates = index.candidatePairs();
  const diagnostics = quiet.encounterPerformanceDiagnostics();
  assert.deepEqual(candidates.map((value) => [value.objectA, value.objectB]), [["1", "2"]]);
  assert.equal(diagnostics.indexedBounds, 202);
  assert.equal(diagnostics.candidatePairs, 1);
  assert.ok(diagnostics.overlapTests < 202 * 202 / 4);
}
