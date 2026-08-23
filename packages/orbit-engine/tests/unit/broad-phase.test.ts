import assert from "node:assert/strict";
import test from "node:test";

import {
  EncounterBroadPhaseIndex,
  EncounterDomainRegistry,
  SweptEncounterBoundStatus,
  type SweptEncounterBoundStatus as SweptEncounterBoundStatusValue,
  buildConservativeSweptBound,
  createEncounterBoundShard,
  createSweptEncounterBound,
  splitEncounterPredictionWindows,
} from "../../src/broad-phase.js";
import { objectId } from "../../src/objects.js";
import { referenceFrameId } from "../../src/frames.js";
import { duration, simulationInstant } from "../../src/time.js";

const interval = { start: simulationInstant(0), end: simulationInstant(10) };

function bound(id: string, start: number, end: number, x: number, status: SweptEncounterBoundStatusValue = SweptEncounterBoundStatus.bounded) {
  return createSweptEncounterBound({
    objectId: objectId(id),
    interval: { start: simulationInstant(start), end: simulationInstant(end) },
    domainId: "local",
    min: { x, y: 0, z: 0 },
    max: { x: x + 1, y: 1, z: 1 },
    inflationMeters: 0,
    status,
  });
}

test("domain membership is explicit, revisioned, and time-valid", () => {
  const domains = new EncounterDomainRegistry();
  domains.register({ domainId: "local", frame: referenceFrameId("1"), revision: "1", maxWindowSpan: duration(10) });
  domains.setMembership({ domainId: "local", objectId: objectId("2"), revision: "1", validity: interval });
  assert.deepEqual(domains.membersAt("local", simulationInstant(5)).map((value) => value.objectId), ["2"]);
  assert.deepEqual(domains.membersAt("local", simulationInstant(10)), []);
  assert.throws(() => domains.setMembership({ domainId: "local", objectId: objectId("2"), revision: "1", validity: { start: simulationInstant(0), end: simulationInstant(9) } }), /revision must change/);
  assert.throws(() => domains.get("missing"), /Unknown/);
});

test("window splitting includes exact validity boundaries and policy span cuts", () => {
  const windows = splitEncounterPredictionWindows({
    interval,
    maxWindowSpan: duration(4),
    boundaries: [simulationInstant(3), simulationInstant(7)],
  });
  assert.deepEqual(windows.map((value) => [value.start.seconds, value.end.seconds]), [[0, 3], [3, 7], [7, 10]]);
  assert.throws(() => splitEncounterPredictionWindows({ interval, maxWindowSpan: duration(0) }), /positive/);
  assert.throws(() => splitEncounterPredictionWindows({ interval, maxWindowSpan: duration(4), boundaries: [simulationInstant(3), simulationInstant(3)] }), /unique/);
});

test("swept bounds inflate uncertainty and retain uncertifiable trajectories", () => {
  const certain = buildConservativeSweptBound({
    objectId: objectId("2"),
    domainId: "local",
    interval,
    broadPhaseDistanceMeters: 10,
    samples: [
      { instant: interval.start, position: { x: 0, y: 0, z: 0 }, velocity: { x: 1, y: 0, z: 0 } },
      { instant: interval.end, position: { x: 10, y: 0, z: 0 }, velocity: { x: 1, y: 0, z: 0 } },
    ],
    maxSamples: 4,
    minimumWindowSpan: duration(1),
  });
  const uncertain = buildConservativeSweptBound({
    objectId: objectId("3"),
    domainId: "local",
    interval,
    broadPhaseDistanceMeters: 10,
    samples: [{ instant: interval.start, position: { x: 100_000, y: 0, z: 0 }, certified: false }],
    maxSamples: 1,
    minimumWindowSpan: duration(1),
  });
  assert.equal(certain.status, SweptEncounterBoundStatus.bounded);
  assert.equal(uncertain.status, SweptEncounterBoundStatus.unbounded);
  assert.ok(uncertain.min.x <= uncertain.max.x);
  const budgetFallback = buildConservativeSweptBound({
    objectId: objectId("4"), domainId: "local", interval, broadPhaseDistanceMeters: 0,
    sampleAt: () => ({ instant: interval.start, position: { x: 0, y: 0, z: 0 } }),
    maxSamples: 1, minimumWindowSpan: duration(1),
  });
  assert.equal(budgetFallback.status, SweptEncounterBoundStatus.unbounded);
});

test("broad phase uses deterministic overlap candidates, conservative fallback, deduplication and shards", () => {
  const index = new EncounterBroadPhaseIndex();
  index.insert(bound("2", 0, 5, 0));
  index.insert(bound("3", 1, 4, 0));
  index.insert(bound("4", 1, 4, 100));
  index.insert(bound("5", 1, 4, 100_000, SweptEncounterBoundStatus.unbounded));
  const candidates = index.candidatePairs();
  assert.deepEqual(candidates.map((value) => [value.objectA, value.objectB]), [["2", "3"], ["2", "5"], ["3", "5"], ["4", "5"]]);
  assert.deepEqual(index.candidatePairs({ pairEnabled: (pair) => pair.objectA === "2" && pair.objectB === "3" }).map((value) => [value.objectA, value.objectB]), [["2", "3"]]);

  const shard = createEncounterBoundShard({ shardId: "catalog-1", domainId: "local", revision: "1", bounds: [bound("7", 0, 2, 1)] });
  index.publishShard(shard);
  assert.equal(index.diagnostics().indexedShards, 1);
  index.publishShard({ ...shard, revision: "2", bounds: [bound("8", 0, 2, 1)] });
  assert.deepEqual(index.listBounds().map((value) => value.objectId).sort(), ["2", "3", "4", "5", "8"]);
  assert.equal(index.removeShard("catalog-1"), true);
  assert.equal(index.removeShard("catalog-1"), false);
});
