import assert from "node:assert/strict";

import {
  EncounterCouplingAssessmentStatus,
  EncounterFidelityScheduleStatus,
  EncounterRecordQuality,
  EncounterSchedulingDiagnosticCode,
  EncounterSchedulingError,
  OrbitEngine,
  createEncounterRecord,
  objectId,
  revisionId,
  type OrbitEngine as OrbitEngineType,
} from "../../src/index.js";
import { referenceFrameId } from "../../src/frames.js";
import { duration, simulationInstant, type Duration } from "../../src/time.js";

const profile = {
  profileId: "scheduling",
  lookahead: duration(100),
  maintenanceLead: duration(10),
  broadPhaseDistanceMeters: 100,
  refineDistanceMeters: 10,
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

function record(timeUncertainty: Duration = duration(0)) {
  return createEncounterRecord({
    encounterId: "41",
    generation: revisionId("1"),
    objectA: objectId("1"),
    objectB: objectId("2"),
    predictionInterval: { start: simulationInstant(10), end: simulationInstant(100) },
    closestApproachInstant: simulationInstant(60),
    closestApproachDistanceMeters: 5,
    relativeVelocityAtClosestApproach: { x: 0, y: 0, z: 0 },
    quality: EncounterRecordQuality.coarse,
    timeUncertainty,
    distanceUncertaintyMeters: 1,
    domain: { domainId: "scheduling-domain", frame: referenceFrameId("1") },
    policyRevision: revisionId("1"),
    profileId: profile.profileId,
  });
}

function configureCandidate(engine: OrbitEngineType): void {
  engine.configureFidelityCandidates(objectId("1"), [{
    id: "encounter-high",
    authorityKind: "numerical",
    configurationRevision: revisionId("1"),
    cost: 2,
    capabilities: {
      maxPositionErrorMeters: 1,
      maxVelocityErrorMetersPerSecond: 1,
      supportsNumericalIntegration: true,
      supportsEncounterRefinement: true,
    },
  }]);
}

export async function assertEncounterScheduling(engine: OrbitEngineType): Promise<void> {
  configureCandidate(engine);
  const scheduled = engine.scheduleEncounterFidelity({
    record: record(duration(5)),
    profile,
    promotionLeadTime: duration(10),
    requirement: {
      maxPositionErrorMeters: 1,
      maxVelocityErrorMetersPerSecond: 1,
    },
  });
  assert.equal(scheduled.status, EncounterFidelityScheduleStatus.scheduled);
  assert.deepEqual(scheduled.promotionInstant, simulationInstant(45));
  assert.deepEqual(scheduled.refinementInstant, simulationInstant(55));
  assert.deepEqual(scheduled.requirement?.validFrom, simulationInstant(45));
  assert.deepEqual(scheduled.requirement?.reevaluateBy, simulationInstant(100));
  assert.deepEqual(engine.listScheduledWorkDiagnostics().map((item) => item.instant), [simulationInstant(45), simulationInstant(55), simulationInstant(100)]);

  const beforePromotion = engine.advanceTo(simulationInstant(44));
  assert.equal(beforePromotion.reachedTarget, true);
  assert.equal(engine.getFidelityStatus(objectId("1")).currentCandidateId, undefined);
  const promotion = engine.advanceTo(simulationInstant(45));
  assert.equal(promotion.processedWorkCount, 1);
  assert.equal(engine.getFidelityStatus(objectId("1")).currentCandidateId, "encounter-high");
  const expiry = engine.advanceTo(simulationInstant(100));
  assert.equal(expiry.processedWorkCount, 2);
  assert.equal(engine.getFidelityStatus(objectId("1")).effectiveRequirement.requiresEncounterRefinement, false);
  assert.equal(engine.encounterSchedulingStatus().fidelitySchedules.length, 0);

  const uncertaintyEngine = await OrbitEngine.create({ backend: engine.backend });
  configureCandidate(uncertaintyEngine);
  const nominal = uncertaintyEngine.scheduleEncounterFidelity({ record: record(), profile, promotionLeadTime: duration(10) });
  const uncertainEngine = await OrbitEngine.create({ backend: engine.backend });
  configureCandidate(uncertainEngine);
  const uncertain = uncertainEngine.scheduleEncounterFidelity({ record: record(duration(5)), profile, promotionLeadTime: duration(10) });
  assert.deepEqual(nominal.promotionInstant, simulationInstant(50));
  assert.deepEqual(uncertain.promotionInstant, simulationInstant(45));

  const maintenance = await OrbitEngine.create({ backend: engine.backend });
  const coverage = maintenance.scheduleEncounterMaintenance({ domainId: "rolling", sourceId: objectId("1"), profile });
  assert.deepEqual(coverage.maintenanceInstant, simulationInstant(90));
  const warped = maintenance.advanceTo(simulationInstant(250));
  assert.equal(warped.reachedTarget, true);
  assert.equal(warped.processedWorkCount, 2);
  assert.deepEqual(maintenance.encounterSchedulingStatus().nextScheduledInstant, simulationInstant(270));
  assert.deepEqual(maintenance.encounterSchedulingStatus().maintenanceCoverage[0]?.interval.start, simulationInstant(180));

  const invalidHorizon = await OrbitEngine.create({ backend: engine.backend });
  assert.throws(
    () => invalidHorizon.scheduleEncounterMaintenance({ domainId: "invalid", sourceId: objectId("1"), profile: { ...profile, maintenanceLead: duration(100) } }),
    (error: unknown) => error instanceof EncounterSchedulingError && error.code === "invalidHorizon",
  );
  assert.equal(invalidHorizon.encounterSchedulingStatus().diagnostics.at(-1)?.code, EncounterSchedulingDiagnosticCode.incompleteHorizon);

  const overloaded = await OrbitEngine.create({ backend: engine.backend, scheduler: { maxScheduledWorkItems: 1 } });
  configureCandidate(overloaded);
  assert.throws(
    () => overloaded.scheduleEncounterFidelity({ record: record(), profile, promotionLeadTime: duration(10), requirement: { requiresNumericalIntegration: true } }),
    (error: unknown) => error instanceof EncounterSchedulingError && error.code === "overload",
  );
  assert.equal(overloaded.encounterSchedulingStatus().diagnostics.at(-1)?.code, EncounterSchedulingDiagnosticCode.overload);

  const insignificant = engine.assessEncounterMutualCoupling({
    requiredPair: { objectA: objectId("1"), objectB: objectId("2") },
    bodies: [{ objectId: objectId("1"), mu: 1 }, { objectId: objectId("2"), mu: 1 }],
    interactions: [{ objectA: objectId("1"), objectB: objectId("2"), distanceMeters: 1e9 }],
    interactionWindow: duration(10),
    maxPositionErrorMeters: 1,
    maxVelocityErrorMetersPerSecond: 1,
    perturbationFraction: 0.5,
  });
  assert.equal(insignificant.status, EncounterCouplingAssessmentStatus.notRequired);
  const massOnly = engine.assessEncounterMutualCoupling({
    requiredPair: { objectA: objectId("1"), objectB: objectId("2") },
    bodies: [{ objectId: objectId("1"), massKilograms: 1e30 }, { objectId: objectId("2"), massKilograms: 1e30 }],
    interactions: [{ objectA: objectId("1"), objectB: objectId("2"), distanceMeters: 1 }],
    interactionWindow: duration(10),
    perturbationFraction: 0.5,
  });
  assert.equal(massOnly.requiresMutualCoupling, false);
  const significant = engine.assessEncounterMutualCoupling({
    requiredPair: { objectA: objectId("1"), objectB: objectId("2") },
    bodies: [{ objectId: objectId("1"), mu: 1e6 }, { objectId: objectId("2"), mu: 1e6 }],
    interactions: [{ objectA: objectId("1"), objectB: objectId("2"), distanceMeters: 100 }],
    interactionWindow: duration(10),
    maxPositionErrorMeters: 1,
    maxVelocityErrorMetersPerSecond: 1,
    perturbationFraction: 0.5,
  });
  assert.equal(significant.status, EncounterCouplingAssessmentStatus.required);
  assert.deepEqual(significant.participantIds, [objectId("1"), objectId("2")]);

  const merged = engine.mergeEncounterCouplingWindows([
    { proposalId: "b", window: { start: simulationInstant(0), end: simulationInstant(10) }, participantIds: [objectId("2"), objectId("1")] },
    { proposalId: "a", window: { start: simulationInstant(5), end: simulationInstant(15) }, participantIds: [objectId("3"), objectId("2")] },
  ]);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0]?.participantIds, [objectId("1"), objectId("2"), objectId("3")]);
  assert.deepEqual(merged[0]?.window.end, simulationInstant(15));
  const limited = engine.mergeEncounterCouplingWindows([
    { window: { start: simulationInstant(0), end: simulationInstant(10) }, participantIds: [objectId("1"), objectId("2")] },
    { window: { start: simulationInstant(5), end: simulationInstant(15) }, participantIds: [objectId("3")] },
  ], 2);
  assert.equal(limited[0]?.status, "failed");
  assert.equal(limited[0]?.failure !== undefined, true);
}
