import assert from "node:assert/strict";

import {
  EncounterDomainRegistry,
  EncounterBroadPhaseIndex,
  SweptEncounterBoundStatus,
  type SweptEncounterBoundStatus as SweptEncounterBoundStatusValue,
  createSweptEncounterBound,
  objectId,
  type OrbitEngine as OrbitEngineType,
} from "../../src/index.js";
import { referenceFrameId } from "../../src/frames.js";
import { duration, simulationInstant } from "../../src/time.js";

function bound(id: string, x: number, status: SweptEncounterBoundStatusValue = SweptEncounterBoundStatus.bounded) {
  return createSweptEncounterBound({
    objectId: objectId(id),
    interval: { start: simulationInstant(0), end: simulationInstant(4) },
    domainId: "parity-domain",
    min: { x, y: 0, z: 0 },
    max: { x: x + 1, y: 1, z: 1 },
    inflationMeters: 0,
    status,
  });
}

export async function assertBroadPhasePrimitives(engine: OrbitEngineType): Promise<void> {
  const domains: EncounterDomainRegistry = engine.encounterDomains();
  domains.register({ domainId: "parity-domain", frame: referenceFrameId("1"), revision: "1", maxWindowSpan: duration(4) });
  domains.setMembership({ domainId: "parity-domain", objectId: objectId("2"), revision: "1" });
  assert.deepEqual(domains.membersAt("parity-domain").map((value) => value.objectId), ["2"]);

  const index: EncounterBroadPhaseIndex = engine.encounterBroadPhase();
  index.insert(bound("2", 0));
  index.insert(bound("3", 0));
  index.insert(bound("4", 10_000, SweptEncounterBoundStatus.unbounded));
  assert.deepEqual(index.candidatePairs().map((value) => [value.objectA, value.objectB]), [["2", "3"], ["2", "4"], ["3", "4"]]);
}
