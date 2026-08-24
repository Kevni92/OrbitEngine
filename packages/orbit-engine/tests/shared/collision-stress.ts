import assert from "node:assert/strict";

import {
  EncounterBroadPhaseIndex,
  SweptEncounterBoundStatus,
  createSweptEncounterBound,
  objectId,
  type OrbitEngine as OrbitEngineType,
} from "../../src/index.js";
import { simulationInstant } from "../../src/time.js";

function quietBound(id: string, x: number) {
  return createSweptEncounterBound({
    objectId: objectId(id),
    interval: { start: simulationInstant(0), end: simulationInstant(10) },
    domainId: "collision-stress",
    min: { x, y: 0, z: 0 },
    max: { x: x + 1, y: 1, z: 1 },
    inflationMeters: 0,
    status: SweptEncounterBoundStatus.bounded,
  });
}

export async function assertCollisionStress(engine: OrbitEngineType): Promise<void> {
  const index: EncounterBroadPhaseIndex = engine.encounterBroadPhase();
  const quietCount = 1_000;
  for (let indexValue = 0; indexValue < quietCount; indexValue += 1) {
    index.insert(quietBound(String(indexValue + 1), indexValue * 10));
  }
  index.insert(quietBound("900000", 5_000));
  const candidates = index.candidatePairs();
  const diagnostics = index.diagnostics();

  assert.deepEqual(candidates.map((value) => [value.objectA, value.objectB]), [["501", "900000"]]);
  assert.equal(diagnostics.indexedBounds, quietCount + 1);
  assert.ok(diagnostics.overlapTests < (quietCount + 1) * 4);
  assert.equal(diagnostics.candidatePairs, 1);
}
