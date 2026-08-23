import assert from "node:assert/strict";
import test from "node:test";

import {
  CoarseEncounterDecision,
  ClosestApproachSolveStatus,
  refineClosestApproach,
  solveCoarseClosestApproach,
} from "../../src/closest-approach.js";
import { duration, simulationInstant, type SimulationInstant } from "../../src/time.js";

function linearSource(start: SimulationInstant, offset = 5) {
  return {
    sampleAt: (instant: SimulationInstant) => {
      const seconds = instant.seconds - start.seconds + (instant.nanoseconds - start.nanoseconds) / 1e9;
      return { instant, position: { x: seconds - offset, y: 0, z: 0 }, velocity: { x: 1, y: 0, z: 0 } };
    },
    evaluateAtSeconds: (seconds: number, intervalStart: SimulationInstant) => ({
      instant: simulationInstant(intervalStart.seconds + seconds, intervalStart.nanoseconds),
      position: { x: seconds - offset, y: 0, z: 0 },
      velocity: { x: 1, y: 0, z: 0 },
    }),
  };
}

test("coarse Hermite stage rejects only when the conservative lower bound is outside refinement", () => {
  const interval = { start: simulationInstant(0), end: simulationInstant(10) };
  const near = solveCoarseClosestApproach({
    interval,
    source: linearSource(interval.start),
    refineDistanceMeters: 1,
    distanceToleranceMeters: 0.01,
    maxSamples: 5,
  });
  assert.equal(near.decision, CoarseEncounterDecision.refine);
  assert.ok(near.lowerDistanceBoundMeters <= 1);
  const far = solveCoarseClosestApproach({
    interval,
    source: linearSource(interval.start, -100),
    refineDistanceMeters: 1,
    distanceToleranceMeters: 0.01,
    maxSamples: 5,
  });
  assert.equal(far.decision, CoarseEncounterDecision.reject);
  assert.ok(far.lowerDistanceBoundMeters > 1);
  const betweenSamples = solveCoarseClosestApproach({
    interval,
    source: linearSource(interval.start, 2.5),
    refineDistanceMeters: 0.01,
    distanceToleranceMeters: 0.0001,
    maxSamples: 3,
  });
  assert.equal(betweenSamples.decision, CoarseEncounterDecision.refine);
});

test("refined solver brackets a linear crossing and chooses an exact nanosecond instant", () => {
  const interval = { start: simulationInstant(0), end: simulationInstant(10) };
  const result = refineClosestApproach({
    interval,
    source: linearSource(interval.start),
    closestApproachTimeTolerance: duration(0, 1),
    closestApproachDistanceToleranceMeters: 0.0001,
    maxRefinementIntervals: 16,
    maxSolverIterations: 64,
    maxPublishedMinima: 4,
  });
  assert.equal(result.status, ClosestApproachSolveStatus.converged);
  assert.equal(result.minima.some((minimum) => minimum.instant.seconds === 5 && minimum.distanceMeters === 0), true);
  assert.ok(result.minima.every((minimum) => minimum.instant.nanoseconds >= 0 && minimum.instant.nanoseconds < 1_000_000_000));
});

test("refinement splits at discontinuities, represents multiple minima and reports budget failure", () => {
  const interval = { start: simulationInstant(0), end: simulationInstant(7) };
  const source = {
    sampleAt: (instant: SimulationInstant) => {
      const t = instant.seconds + instant.nanoseconds / 1e9;
      const position = (t - 2) * (t - 5);
      return { instant, position: { x: position, y: 0, z: 0 }, velocity: { x: 2 * t - 7, y: 0, z: 0 } };
    },
    evaluateAtSeconds: (seconds: number, intervalStart: SimulationInstant) => {
      const position = (seconds - 2) * (seconds - 5);
      return { instant: simulationInstant(intervalStart.seconds + seconds, intervalStart.nanoseconds), position: { x: position, y: 0, z: 0 }, velocity: { x: 2 * seconds - 7, y: 0, z: 0 } };
    },
  };
  const result = refineClosestApproach({
    interval,
    source,
    boundaries: [simulationInstant(3)],
    closestApproachTimeTolerance: duration(0, 1),
    closestApproachDistanceToleranceMeters: 0.0001,
    maxRefinementIntervals: 32,
    maxSolverIterations: 64,
    maxPublishedMinima: 8,
  });
  assert.equal(result.status, ClosestApproachSolveStatus.converged);
  assert.equal(result.minima.some((minimum) => minimum.instant.seconds === 2), true);
  assert.equal(result.minima.some((minimum) => minimum.instant.seconds === 5), true);
  const failed = refineClosestApproach({
    interval: { start: simulationInstant(0), end: simulationInstant(10) },
    source: linearSource(simulationInstant(0)),
    closestApproachTimeTolerance: duration(0, 1),
    closestApproachDistanceToleranceMeters: 0.0001,
    maxRefinementIntervals: 4,
    maxSolverIterations: 1,
    maxPublishedMinima: 4,
  });
  assert.equal(failed.status, ClosestApproachSolveStatus.failed);
  assert.equal(failed.failureReason, "nonConvergent");
});
