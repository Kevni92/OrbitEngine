import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { objectId, type ObjectId } from "orbit-engine";
import type { RegisteredScenarioBody } from "../src/scenario/load-solar-system.js";
import {
  BatchedMarkerLayer,
  MARKER_PICK_RADIUS_PIXELS,
} from "../src/rendering/runtime-asteroid-markers.js";

const VIEWPORT = 1_000;

function body(id: ObjectId): RegisteredScenarioBody {
  return { definition: { id } } as unknown as RegisteredScenarioBody;
}

function camera(): THREE.PerspectiveCamera {
  const result = new THREE.PerspectiveCamera(45, 1, 0.01, 1_000);
  result.position.set(0, 0, 10);
  result.lookAt(0, 0, 0);
  result.updateProjectionMatrix();
  result.updateMatrixWorld(true);
  return result;
}

function ndcPixels(pixels: number): number {
  return pixels * 2 / VIEWPORT;
}

test("marker picking uses the rendered screen-space footprint instead of scene-unit distance", () => {
  const scene = new THREE.Scene();
  const layer = new BatchedMarkerLayer(scene);
  const markerId = objectId("2001");
  const view = camera();

  layer.setBodies([body(markerId)], new Map([[markerId, new THREE.Vector3(0, 0, 0)]]));
  assert.equal(
    layer.pick(ndcPixels(MARKER_PICK_RADIUS_PIXELS - 0.25), 0, view, VIEWPORT, VIEWPORT),
    markerId,
  );
  assert.equal(
    layer.pick(ndcPixels(MARKER_PICK_RADIUS_PIXELS + 0.25), 0, view, VIEWPORT, VIEWPORT),
    undefined,
  );

  // Moving the same 7 px marker tens of scene units away must not inflate its
  // invisible hit target; the pixel-boundary result stays identical.
  layer.setBodies([body(markerId)], new Map([[markerId, new THREE.Vector3(0, 0, -50)]]));
  assert.equal(
    layer.pick(ndcPixels(MARKER_PICK_RADIUS_PIXELS - 0.25), 0, view, VIEWPORT, VIEWPORT),
    markerId,
  );
  assert.equal(
    layer.pick(ndcPixels(MARKER_PICK_RADIUS_PIXELS + 0.25), 0, view, VIEWPORT, VIEWPORT),
    undefined,
  );

  layer.dispose();
});

test("overlapping marker hit regions select the visually front-most marker", () => {
  const scene = new THREE.Scene();
  const layer = new BatchedMarkerLayer(scene);
  const farId = objectId("2002");
  const nearId = objectId("2003");
  const view = camera();

  // Deliberately put the farther marker first to prove membership order does
  // not decide the result.
  layer.setBodies(
    [body(farId), body(nearId)],
    new Map([
      [farId, new THREE.Vector3(0, 0, -20)],
      [nearId, new THREE.Vector3(0, 0, 0)],
    ]),
  );

  assert.equal(layer.pick(0, 0, view, VIEWPORT, VIEWPORT), nearId);
  layer.dispose();
});

test("a marker hidden behind a visible body sphere cannot steal its click", () => {
  const scene = new THREE.Scene();
  const layer = new BatchedMarkerLayer(scene);
  const moonId = objectId("2004");
  const marsId = objectId("1005");
  const view = camera();

  const mars = new THREE.Mesh(
    new THREE.SphereGeometry(1, 16, 12),
    new THREE.MeshBasicMaterial(),
  );
  mars.userData.objectId = marsId;
  mars.position.set(0, 0, 0);
  scene.add(mars);

  layer.setBodies([body(moonId)], new Map([[moonId, new THREE.Vector3(0, 0, -5)]]));
  scene.updateMatrixWorld(true);

  assert.equal(layer.pick(0, 0, view, VIEWPORT, VIEWPORT), undefined);

  layer.dispose();
  mars.geometry.dispose();
  mars.material.dispose();
});

test("a marker in front of a sphere remains selectable inside its visible disc", () => {
  const scene = new THREE.Scene();
  const layer = new BatchedMarkerLayer(scene);
  const moonId = objectId("2005");
  const marsId = objectId("1005");
  const view = camera();

  const mars = new THREE.Mesh(
    new THREE.SphereGeometry(1, 16, 12),
    new THREE.MeshBasicMaterial(),
  );
  mars.userData.objectId = marsId;
  mars.position.set(0, 0, 0);
  scene.add(mars);

  layer.setBodies([body(moonId)], new Map([[moonId, new THREE.Vector3(0, 0, 2)]]));
  scene.updateMatrixWorld(true);

  assert.equal(layer.pick(0, 0, view, VIEWPORT, VIEWPORT), moonId);

  layer.dispose();
  mars.geometry.dispose();
  mars.material.dispose();
});
