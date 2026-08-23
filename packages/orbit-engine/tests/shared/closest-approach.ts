import assert from "node:assert/strict";

import {
  ClosestApproachSolveStatus,
  refineClosestApproach,
  solveCoarseClosestApproach,
  type OrbitEngine as OrbitEngineType,
} from "../../src/index.js";
import { duration, simulationInstant } from "../../src/time.js";

export async function assertClosestApproachSolvers(_engine: OrbitEngineType): Promise<void> {
  const interval = { start: simulationInstant(0), end: simulationInstant(10) };
  const source = {
    sampleAt: (instant: typeof interval.start) => {
      const seconds = instant.seconds + instant.nanoseconds / 1e9;
      return { instant, position: { x: seconds - 5, y: 0, z: 0 }, velocity: { x: 1, y: 0, z: 0 } };
    },
    evaluateAtSeconds: (seconds: number, intervalStart: typeof interval.start) => ({
      instant: simulationInstant(intervalStart.seconds + seconds, intervalStart.nanoseconds),
      position: { x: seconds - 5, y: 0, z: 0 },
      velocity: { x: 1, y: 0, z: 0 },
    }),
  };
  const coarse = solveCoarseClosestApproach({ interval, source, refineDistanceMeters: 1, distanceToleranceMeters: 0.01, maxSamples: 5 });
  assert.equal(coarse.decision, "refine");
  const refined = refineClosestApproach({
    interval,
    source,
    closestApproachTimeTolerance: duration(0, 1),
    closestApproachDistanceToleranceMeters: 0.001,
    maxRefinementIntervals: 16,
    maxSolverIterations: 64,
    maxPublishedMinima: 4,
  });
  assert.equal(refined.status, ClosestApproachSolveStatus.converged);
  assert.equal(refined.minima.some((minimum) => minimum.instant.seconds === 5 && minimum.distanceMeters === 0), true);
}
