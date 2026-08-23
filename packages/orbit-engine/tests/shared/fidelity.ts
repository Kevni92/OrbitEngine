import assert from "node:assert/strict";

import {
  FidelitySelectionError,
  OrbitEngine,
  combineFidelityRequirements,
  fidelityRequirement,
  objectId,
  revisionId,
  selectFidelityCandidate,
  type FidelityCandidateInput,
  type OrbitEngine as OrbitEngineType,
} from "../../src/index.js";
import { simulationInstant } from "../../src/time.js";

const source = objectId("9");

const candidates: readonly FidelityCandidateInput[] = [
  {
    id: "cheap-analytical",
    authorityKind: "twoBodyAnalytical",
    configurationRevision: revisionId("1"),
    cost: 1,
    capabilities: {
      maxPositionErrorMeters: 100,
      maxVelocityErrorMetersPerSecond: 1,
    },
  },
  {
    id: "numerical",
    authorityKind: "numerical",
    configurationRevision: revisionId("4"),
    cost: 4,
    capabilities: {
      maxPositionErrorMeters: 10,
      maxVelocityErrorMetersPerSecond: 0.1,
      supportsPerturbations: true,
      supportsNumericalIntegration: true,
      gravitySources: [source],
    },
  },
  {
    id: "coupled",
    authorityKind: "coupledNumerical",
    configurationRevision: revisionId("2"),
    cost: 8,
    capabilities: {
      maxPositionErrorMeters: 1,
      maxVelocityErrorMetersPerSecond: 0.01,
      supportsPerturbations: true,
      supportsNumericalIntegration: true,
      supportsMutualCoupling: true,
      supportsContinuousThrust: true,
      supportsEncounterRefinement: true,
      supportsCollisionPrecision: true,
      gravitySources: [source],
    },
  },
];

export async function assertFidelityManager(engine: OrbitEngineType): Promise<void> {
  const combined = combineFidelityRequirements([
    {
      maxPositionErrorMeters: 100,
      requiresPerturbations: true,
      requiredGravitySources: [source],
      reasons: ["encounter"],
    },
    {
      maxPositionErrorMeters: 10,
      maxVelocityErrorMetersPerSecond: 0.1,
      requiresContinuousThrust: true,
      reasons: ["maneuver", "encounter"],
    },
  ]);
  assert.equal(combined.maxPositionErrorMeters, 10);
  assert.equal(combined.maxVelocityErrorMetersPerSecond, 0.1);
  assert.equal(combined.requiresPerturbations, true);
  assert.equal(combined.requiresContinuousThrust, true);
  assert.deepEqual(combined.requiredGravitySources, [source]);
  assert.deepEqual(combined.reasons, ["encounter", "maneuver"]);

  const forward = selectFidelityCandidate(
    { maxPositionErrorMeters: 20, requiresNumericalIntegration: true },
    candidates,
  );
  const reversed = selectFidelityCandidate(
    { maxPositionErrorMeters: 20, requiresNumericalIntegration: true },
    [...candidates].reverse(),
  );
  assert.equal(forward.candidate.id, "numerical");
  assert.equal(reversed.candidate.id, forward.candidate.id);

  const object = objectId("42");
  engine.configureFidelityCandidates(object, candidates);
  const selected = engine.setMinimumFidelityRequirement(object, {
    maxPositionErrorMeters: 20,
    maxVelocityErrorMetersPerSecond: 0.2,
    requiresNumericalIntegration: true,
    requiredGravitySources: [source],
    reevaluateBy: simulationInstant(60),
    reasons: ["explicitMinimum"],
  });
  assert.equal(selected.currentAuthorityKind, "numerical");
  assert.equal(selected.currentCandidateId, "numerical");
  assert.equal(selected.currentConfigurationRevision, "4");
  assert.deepEqual(selected.reasons, ["explicitMinimum"]);
  assert.deepEqual(selected.nextReevaluation, simulationInstant(60));

  const strongerSignal = engine.setFidelitySignal(object, "collision-window", {
    requiresCollisionPrecision: true,
    reasons: ["collision-window"],
  });
  assert.equal(strongerSignal.currentAuthorityKind, "coupledNumerical");
  assert.deepEqual(strongerSignal.reasons, ["collision-window", "explicitMinimum"]);

  const stable = engine.setFidelitySignal(object, "collision-window", null);
  assert.equal(stable.currentAuthorityKind, "coupledNumerical");

  const failing = objectId("43");
  engine.configureFidelityCandidates(failing, [candidates[0]!]);
  assert.throws(
    () => engine.setMinimumFidelityRequirement(failing, { requiresNumericalIntegration: true }),
    (error: unknown) => error instanceof FidelitySelectionError && error.code === "noCandidate",
  );
  const failureStatus = engine.getFidelityStatus(failing);
  assert.equal(failureStatus.lastTransitionResult?.code, "noCandidate");
  assert.equal(failureStatus.currentAuthorityKind, undefined);

  const empty = fidelityRequirement();
  assert.equal(empty.requiresPerturbations, false);
  assert.equal(empty.reasons.length, 0);
}
