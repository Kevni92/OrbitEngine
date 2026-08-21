import assert from "node:assert/strict";
import test from "node:test";
import {
  meters,
  metersPerSecond,
  objectId,
  propagationState,
  referenceFrameId,
  revisionId,
  simulationInstant,
} from "orbit-engine";
import {
  MAX_PATH_SAMPLES,
  PathCache,
  sampleOrbitPath,
} from "../src/simulation/path-sampling.js";

const BODY_ID = objectId("1003");
const FOCUS_ID = objectId("1000");
const FRAME_ID = referenceFrameId("1");
const start = simulationInstant(0);
const end = simulationInstant(100);

function request(sampleCount: number, calls: number[]): Parameters<typeof sampleOrbitPath>[0] {
  return {
    objectId: BODY_ID,
    focusId: FOCUS_ID,
    outputFrame: FRAME_ID,
    interval: { start, end },
    sampleCount,
    motionRevision: revisionId("1"),
    configurationRevision: revisionId("2"),
    stateAt: (objectId, target, frame) => {
      calls.push(target.seconds);
      return propagationState({
        position: { x: meters(target.seconds), y: meters(0), z: meters(0) },
        velocity: { x: metersPerSecond(1), y: metersPerSecond(0), z: metersPerSecond(0) },
        epoch: target,
        referenceFrame: frame,
      });
    },
  };
}

test("path sampling calls the public state source at bounded exact instants", () => {
  const calls: number[] = [];
  const path = sampleOrbitPath(request(5, calls));
  assert.equal(calls.length, 5);
  assert.deepEqual(calls, [0, 20, 40, 60, 80]);
  assert.equal(path.samples[0]?.instant.seconds, 0);
  assert.equal(path.samples.at(-1)?.instant.seconds, 80);
  assert.ok(path.samples.every((sample) => sample.instant.seconds < end.seconds));
  assert.deepEqual(path.samples.map((sample) => sample.state.position.x), [0, 20, 40, 60, 80]);
});

test("path cache is bounded and keys include context and authority revisions", () => {
  const calls: number[] = [];
  const cache = new PathCache(1);
  const first = cache.getOrCreate(request(4, calls));
  assert.strictEqual(cache.getOrCreate(request(4, calls)), first);
  assert.equal(calls.length, 4);
  const changedRevision = { ...request(4, calls), motionRevision: revisionId("3") };
  const second = cache.getOrCreate(changedRevision);
  assert.notStrictEqual(second, first);
  assert.equal(cache.size(), 1);
  cache.invalidateObject(BODY_ID);
  assert.equal(cache.size(), 0);
});

test("path sample count is bounded by the application contract", () => {
  const calls: number[] = [];
  assert.throws(() => sampleOrbitPath(request(MAX_PATH_SAMPLES + 1, calls)), /sample count/);
  assert.throws(() => sampleOrbitPath(request(1, calls)), /sample count/);
});
