import assert from "node:assert/strict";

import {
  CollisionContactPredictionFailureReason,
  CollisionContactPredictionStatus,
  CollisionContactQuality,
  CollisionResponseMode,
  EncounterBroadPhaseIndex,
  buildCollisionSweptBound,
  collisionSignedSphereSeparation,
  collisionSphereContactFunction,
  normalizeCollisionProfile,
  normalizeCollisionSphere,
  objectId,
  predictCollisionContact,
  referenceFrameId,
  revisionId,
  type CollisionProfile,
  type OrbitEngine as OrbitEngineType,
} from "../../src/index.js";
import { duration, simulationInstant } from "../../src/time.js";

const profile: CollisionProfile = normalizeCollisionProfile({
  profileId: "continuous",
  responseMode: CollisionResponseMode.detectOnly,
  coefficientOfRestitution: 0,
  broadPhaseMarginMeters: 0.5,
  contactDistanceToleranceMeters: 0.001,
  contactTimeTolerance: duration(0, 1),
  separationHysteresisMeters: 0.25,
  maxCandidateSubdivisions: 64,
  maxRootIterations: 80,
  requiredPositionErrorMeters: 0.001,
  requiredVelocityErrorMetersPerSecond: 0.001,
  policyRevision: revisionId("1"),
});

function sourceAt(
  evaluator: (seconds: number) => number,
  calls?: SimulationCallLog,
) {
  const sampleAt = (instant: ReturnType<typeof simulationInstant>) => {
    const seconds = instant.seconds + instant.nanoseconds / 1e9;
    calls?.push(instant);
    const position = evaluator(seconds);
    return {
      instant,
      position: { x: position, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
    };
  };
  return {
    sampleAt,
    evaluateAtSeconds: (seconds: number, intervalStart: ReturnType<typeof simulationInstant>) => {
      const instant = simulationInstant(intervalStart.seconds + seconds, intervalStart.nanoseconds);
      const position = evaluator(seconds);
      calls?.push(instant);
      return {
        instant,
        position: { x: position, y: 0, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
      };
    },
  };
}

type SimulationCallLog = ReturnType<typeof simulationInstant>[];

function movingSource(
  positionAt: (seconds: number) => number,
  velocity: number,
  y = 0,
  calls?: SimulationCallLog,
) {
  return {
    sampleAt: (instant: ReturnType<typeof simulationInstant>) => {
      const seconds = instant.seconds + instant.nanoseconds / 1e9;
      calls?.push(instant);
      return { instant, position: { x: positionAt(seconds), y, z: 0 }, velocity: { x: velocity, y: 0, z: 0 } };
    },
    evaluateAtSeconds: (seconds: number, intervalStart: ReturnType<typeof simulationInstant>) => {
      const instant = simulationInstant(intervalStart.seconds + seconds, intervalStart.nanoseconds);
      calls?.push(instant);
      return { instant, position: { x: positionAt(seconds), y, z: 0 }, velocity: { x: velocity, y: 0, z: 0 } };
    },
  };
}

function sphere(id: string, radius: number, shapeRevision = "1") {
  return normalizeCollisionSphere({
    objectId: objectId(id),
    collisionBoundingRadiusMeters: radius,
    collisionShapeRevision: revisionId(shapeRevision),
  });
}

export async function assertCollisionDetection(engine: OrbitEngineType): Promise<void> {
  assert.equal(collisionSignedSphereSeparation({ x: 3, y: 0, z: 0 }, 1, 1), 1);
  assert.equal(collisionSphereContactFunction({ x: 3, y: 0, z: 0 }, 1, 1), 5);

  const interval = { start: simulationInstant(0), end: simulationInstant(10) };
  const bounds = new EncounterBroadPhaseIndex();
  const profileForBounds = { ...profile, broadPhaseMarginMeters: 1 };
  bounds.insert(buildCollisionSweptBound({
    sphere: sphere("2", 2),
    profile: profileForBounds,
    interval,
    domainId: "collision-domain",
    samples: [{ instant: interval.start, position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 } }],
    maxSamples: 4,
    minimumWindowSpan: duration(1),
  }));
  bounds.insert(buildCollisionSweptBound({
    sphere: sphere("3", 0),
    profile: profileForBounds,
    interval,
    domainId: "collision-domain",
    samples: [{ instant: interval.start, position: { x: 3, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 } }],
    maxSamples: 4,
    minimumWindowSpan: duration(1),
  }));
  assert.equal(bounds.candidatePairs().length, 1);
  assert.equal(bounds.listBounds()[0]?.inflationMeters, 3);

  const nearMiss = engine.predictCollisionContact({
    interval,
    sphereA: sphere("2", 0.5),
    sphereB: sphere("3", 0.5),
    source: movingSource((seconds) => seconds - 5, 1, 2),
    profile,
  });
  assert.equal(nearMiss.status, CollisionContactPredictionStatus.noContact);

  const touching = engine.predictCollisionContact({
    interval,
    sphereA: sphere("2", 0.5),
    sphereB: sphere("3", 0.5),
    source: movingSource(() => 1, 0),
    profile,
  });
  assert.equal(touching.status, CollisionContactPredictionStatus.contact);
  assert.equal(touching.prediction?.exactContactInstant.seconds, 0);
  assert.equal(touching.prediction?.quality, CollisionContactQuality.refined);

  const highSpeed = engine.predictCollisionContact({
    interval,
    sphereA: sphere("2", 1),
    sphereB: sphere("3", 1),
    source: movingSource((seconds) => -100 + 40 * seconds, 40),
    profile,
  });
  assert.equal(highSpeed.status, CollisionContactPredictionStatus.contact);
  assert.equal(highSpeed.prediction?.exactContactInstant.seconds, 2);
  assert.equal(highSpeed.prediction?.exactContactInstant.nanoseconds, 449_975_000);
  assert.equal(highSpeed.evaluatedSamples > 0, true);

  const pointAgainstSphere = engine.predictCollisionContact({
    interval: { start: simulationInstant(0), end: simulationInstant(4) },
    sphereA: sphere("2", 0),
    sphereB: sphere("3", 1),
    source: movingSource((seconds) => 3 - seconds, -1),
    profile,
  });
  assert.equal(pointAgainstSphere.status, CollisionContactPredictionStatus.contact);
  assert.equal(pointAgainstSphere.prediction?.exactContactInstant.seconds, 1);
  assert.equal(pointAgainstSphere.prediction?.exactContactInstant.nanoseconds, 999_000_000);

  const callLog: SimulationCallLog = [];
  const boundary = engine.predictCollisionContact({
    interval,
    boundaries: [simulationInstant(5)],
    sphereA: sphere("2", 1),
    sphereB: sphere("3", 0),
    source: sourceAt((seconds) => seconds < 5 ? 5 : 0, callLog),
    profile,
  });
  assert.equal(boundary.status, CollisionContactPredictionStatus.contact);
  assert.equal(boundary.prediction?.exactContactInstant.seconds, 5);
  assert.equal(callLog.some((instant) => instant.seconds === 5), true);

  const budgetProfile = Object.freeze({ ...profile, maxCandidateSubdivisions: 1 });
  const budget = predictCollisionContact({
    interval,
    sphereA: sphere("2", 1),
    sphereB: sphere("3", 1),
    source: movingSource((seconds) => -9.2 + 4 * seconds, 4),
    profile: budgetProfile,
  });
  assert.equal(budget.status, CollisionContactPredictionStatus.incomplete);
  assert.equal(budget.failureReason, CollisionContactPredictionFailureReason.budgetExceeded);

  const nonConvergentProfile = Object.freeze({ ...profile, maxRootIterations: 1 });
  const nonConvergent = predictCollisionContact({
    interval: { start: simulationInstant(0), end: simulationInstant(4) },
    sphereA: sphere("2", 1),
    sphereB: sphere("3", 1),
    source: movingSource((seconds) => 6 - 2 * seconds, -2),
    profile: nonConvergentProfile,
  });
  assert.equal(nonConvergent.status, CollisionContactPredictionStatus.failed);
  assert.equal(nonConvergent.failureReason, CollisionContactPredictionFailureReason.nonConvergent);

  const uncertain = predictCollisionContact({
    interval: { start: simulationInstant(0), end: simulationInstant(2) },
    sphereA: sphere("2", 1),
    sphereB: sphere("3", 0),
    source: {
      sampleAt: (instant) => ({
        instant,
        position: { x: 1.5, y: 0, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
        positionUncertaintyMeters: 1,
      }),
    },
    profile: Object.freeze({ ...profile, maxCandidateSubdivisions: 4 }),
  });
  assert.notEqual(uncertain.status, CollisionContactPredictionStatus.noContact);
}
