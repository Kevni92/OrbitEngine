import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { BatchedMarkerLayer } from "../dist/index.js";

test("large unresolved populations use one bounded marker drawable and stable ObjectId mapping", () => {
  const root = new THREE.Group();
  const layer = new BatchedMarkerLayer(root);
  const entries = Array.from({ length: 5_000 }, (_, index) => ({
    objectId: String(index + 1),
    positionSceneUnits: { x: index / 100, y: 0, z: -10 },
    sizePixels: 7,
    color: 0x6688aa,
  }));
  layer.setEntries([...entries].reverse());
  assert.equal(layer.count(), 5_000);
  assert.deepEqual(layer.objectIds.slice(0, 3), ["1", "2", "3"]);
  assert.equal(root.children.length, 1);
  assert.ok(root.children[0] instanceof THREE.Points);
  assert.equal(root.children.filter((child) => child instanceof THREE.Mesh).length, 0);
  assert.ok(Math.abs(layer.positionFor("4242").x - 42.41) < 1e-4);
  assert.equal(layer.sizeFor("4242"), 7);
  layer.setEntries([...entries].reverse());
  assert.equal(layer.objectIds[0], "1");
  layer.dispose();
  assert.equal(root.children.length, 0);
});

test("marker picking keeps a fixed interaction affordance for sub-pixel physical markers", () => {
  const root = new THREE.Group();
  const layer = new BatchedMarkerLayer(root, { pickRadiusPixels: 5, pickTolerancePixels: 0 });
  layer.setEntries([{ objectId: "99", positionSceneUnits: { x: 0, y: 0, z: 0 }, sizePixels: 0.1 }]);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.z = 10;
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  assert.equal(layer.pick(0, 0, camera, 800, 800)?.objectId, "99");
  layer.dispose();
});
