import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { meters, metersPerSecond, objectId, propagationState, referenceFrameId, simulationInstant } from "orbit-engine";
import { AsteroidMarkerLayer } from "../src/rendering/asteroid-marker-layer.js";

function state(x: number) {
  return propagationState({
    position: { x: meters(x), y: meters(0), z: meters(0) },
    velocity: { x: metersPerSecond(0), y: metersPerSecond(0), z: metersPerSecond(0) },
    epoch: simulationInstant(0),
    referenceFrame: referenceFrameId("1"),
  });
}

test("large runtime asteroid populations remain one batched Points drawable", () => {
  const scene = new THREE.Scene();
  const layer = new AsteroidMarkerLayer(scene);
  const ids = Array.from({ length: 1000 }, (_, index) => objectId(String(9_000_000_000_000_000_000n + BigInt(index))));
  const states = ids.map((_, index) => state(index * 1000));
  layer.update(ids, states, ids);

  assert.equal(layer.markerCount(), 1000);
  assert.equal(layer.objectIdAt(0), ids[0]);
  assert.equal(layer.objectIdAt(999), ids[999]);
  assert.equal(scene.children.filter((child) => child instanceof THREE.Points).length, 1);
  assert.equal(layer.pointsObject().geometry.getAttribute("position").count, 1000);

  layer.clear();
  assert.equal(layer.markerCount(), 0);
  assert.equal(layer.pointsObject().geometry.getAttribute("position").count, 0);
  layer.dispose();
  assert.equal(scene.children.includes(layer.pointsObject()), false);
});

test("marker layer matches runtime IDs to their explicit frame states rather than array identity", () => {
  const scene = new THREE.Scene();
  const layer = new AsteroidMarkerLayer(scene);
  const committed = objectId("1000");
  const runtime = objectId("9000000000000000000");
  layer.update([committed, runtime], [state(1), state(2)], [runtime]);
  assert.equal(layer.markerCount(), 1);
  assert.equal(layer.objectIdAt(0), runtime);
  layer.dispose();
});
