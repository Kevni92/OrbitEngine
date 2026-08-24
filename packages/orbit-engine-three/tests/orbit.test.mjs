import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { objectId, simulationInstant } from "orbit-engine";
import {
  DEFAULT_ORBIT_PATH_SAMPLES,
  OrbitPathCache,
  OrbitPathRenderer,
  createOrbitPathSnapshot,
  sampleOrbitPath,
} from "../dist/index.js";

const BODY_ID = objectId("20");
const PARENT_ID = objectId("10");
const FRAME_ID = "1";

function path(samples = 4) {
  return sampleOrbitPath({
    objectId: BODY_ID,
    parentId: PARENT_ID,
    origin: { kind: "object", objectId: PARENT_ID, frameId: FRAME_ID },
    interval: { start: simulationInstant(0), end: simulationInstant(10) },
    sampleCount: samples,
    motionRevision: "1",
    sourceRevision: "2",
    positionAt: (instant) => ({ x: instant.seconds, y: instant.nanoseconds / 1e9, z: 0 }),
  });
}

test("orbit path snapshots sample exact bounded instants and expose cache identity", () => {
  const value = path();
  assert.equal(value.sampleCount, 4);
  assert.deepEqual(value.sampleInstants.map((instant) => instant.seconds), [0, 2, 5, 7]);
  assert.equal(value.samples.at(-1).instant.seconds < value.interval.end.seconds, true);
  assert.equal(value.frameId, FRAME_ID);
  assert.equal(value.origin.objectId, PARENT_ID);
  assert.equal(value.closedReferenceOrbit, true);
  assert.equal(typeof value.fingerprint, "string");
  assert.equal(DEFAULT_ORBIT_PATH_SAMPLES, 128);
  assert.throws(() => createOrbitPathSnapshot({
    ...value,
    samples: [value.samples[0], value.samples[0]],
  }), /strictly increasing/);
});

test("orbit cache reuses paths and invalidates related ObjectIds", () => {
  const cache = new OrbitPathCache(1);
  const first = cache.getOrCreate("first", () => path());
  assert.strictEqual(cache.getOrCreate("first", () => path(8)), first);
  cache.invalidateObject(PARENT_ID);
  assert.equal(cache.size(), 0);
});

test("orbit renderer anchors parent-relative samples, emphasizes selection, and keeps ObjectId identity", () => {
  const scene = new THREE.Scene();
  const renderer = new OrbitPathRenderer(scene, {
    renderSpace: {
      metersPerSceneUnit: 1,
      presentationAxisTransform: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    },
    defaultStyle: { color: 0x44aaff, direction: { enabled: true } },
  });
  const value = path();
  renderer.setPath(value);
  renderer.updateBodyPositions(new Map([
    [PARENT_ID, new THREE.Vector3(100, 0, 0)],
    [BODY_ID, new THREE.Vector3(105, 0, 0)],
  ]));
  const group = renderer.group.getObjectByName(`Orbit ${BODY_ID}`);
  assert.ok(group);
  const line = group.children[0];
  assert.deepEqual(line.geometry.getAttribute("position").getX(0), 100);
  renderer.setSelected(BODY_ID);
  assert.equal(renderer.guideDiagnostics()[0].selected, true);
  assert.equal(group.children[1].visible, true);
  assert.equal(renderer.pick(0, 0, new THREE.PerspectiveCamera()), undefined);
  renderer.dispose();
  assert.equal(renderer.pathCount(), 0);
});
