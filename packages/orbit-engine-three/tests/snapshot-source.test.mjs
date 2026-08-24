import assert from "node:assert/strict";
import test from "node:test";
import { objectId, simulationInstant } from "orbit-engine";
import { createOrbitEngineSnapshotSource } from "../dist/index.js";

const FRAME = "1";
const PARENT = objectId("10");
const CHILD = objectId("20");
const instant = simulationInstant(100, 5);

function record(id, structuralParent) {
  return {
    id,
    type: id === PARENT ? "planet" : "moon",
    properties: { physicalRadius: id === PARENT ? 10 : 1 },
    structuralParent,
    propertyRevision: "3",
    motion: {
      propagationFrame: FRAME,
      motionRevision: id === PARENT ? "4" : "5",
      configurationRevision: "6",
    },
  };
}

function state(position) {
  return { position, velocity: { x: 1, y: 2, z: 3 }, epoch: instant, referenceFrame: FRAME };
}

test("snapshot adapter uses bounded same-epoch public reads without advancing or changing fidelity", () => {
  const calls = { states: 0, relative: 0, single: 0 };
  const fake = {
    registry: () => ({ get: (id) => id === PARENT ? record(PARENT) : record(CHILD, PARENT) }),
    statesAt: (ids, target, frame) => {
      calls.states += 1;
      assert.strictEqual(target, instant);
      assert.equal(frame, FRAME);
      return ids.map((id) => state({ x: id === PARENT ? 0 : 10, y: 0, z: 0 }));
    },
    relativeStateAt: (targetId, observerId, target, frame) => {
      calls.relative += 1;
      assert.equal(observerId, PARENT);
      assert.strictEqual(target, instant);
      assert.equal(frame, FRAME);
      return state({ x: targetId === PARENT ? 0 : 10, y: 0, z: 0 });
    },
    stateAt: () => {
      calls.single += 1;
      return state({ x: 0, y: 0, z: 0 });
    },
  };
  const source = createOrbitEngineSnapshotSource(fake, undefined, { maxSnapshotBodies: 2 });
  const snapshot = source.snapshot({
    instant,
    objectIds: [PARENT, CHILD],
    origin: { kind: "frame", frameId: FRAME },
    include: { velocity: false },
  });
  assert.equal(calls.states, 1);
  assert.equal(calls.relative, 0);
  assert.equal(calls.single, 0);
  assert.deepEqual(snapshot.bodies.map((body) => body.parentId), [undefined, PARENT]);
  assert.equal(snapshot.bodies[0].velocityRelativeToOriginMetersPerSecond, undefined);
  assert.equal(snapshot.bodies[1].physicalRadiusMeters, 1);
  assert.equal(snapshot.bodies[1].stateRevision, "5");
});

test("snapshot adapter samples parent-relative paths, caches them, and never runs local orbital math", () => {
  let relativeCalls = 0;
  const fake = {
    registry: () => ({ get: () => record(CHILD, PARENT) }),
    statesAt: () => [],
    relativeStateAt: (targetId, observerId, target, frame) => {
      relativeCalls += 1;
      assert.equal(targetId, CHILD);
      assert.equal(observerId, PARENT);
      return { ...state({ x: target.seconds, y: 0, z: 0 }), epoch: target, referenceFrame: frame };
    },
    stateAt: () => { throw new Error("frame stateAt should not be used for parent-relative sampling"); },
  };
  const source = createOrbitEngineSnapshotSource(fake);
  const request = {
    objectId: CHILD,
    frame: FRAME,
    interval: { start: simulationInstant(0), end: simulationInstant(10) },
    sampleCount: 4,
  };
  const first = source.sampleOrbitPath(request);
  const second = source.sampleOrbitPath(request);
  assert.strictEqual(first, second);
  assert.equal(relativeCalls, 4);
  assert.equal(first.parentId, PARENT);
  assert.equal(first.origin.objectId, PARENT);
  assert.equal(first.samplePositionsRelativeToOriginMeters[2].x, 5);
  source.invalidateObject(PARENT);
  assert.equal(source.sampleOrbitPath(request).fingerprint, first.fingerprint);
  assert.equal(relativeCalls, 8);
});
