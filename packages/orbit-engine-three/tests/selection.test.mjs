import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { objectId } from "orbit-engine";
import { SelectionIndicator, selectionIndicatorPixelSizing } from "../dist/index.js";

test("selection indicator remains ObjectId-bound and uses CSS-pixel sizing", () => {
  const scene = new THREE.Scene();
  const indicator = new SelectionIndicator(scene);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  const id = objectId("42");
  const sizing = selectionIndicatorPixelSizing(5);
  indicator.update({ objectId: id, positionSceneUnits: { x: 0, y: 0, z: 0 }, bodyRadiusPixels: 5 }, camera, 800);
  assert.equal(indicator.selectedObjectId, id);
  assert.equal(indicator.mesh.userData.objectId, id);
  assert.equal(indicator.mesh.visible, true);
  assert.equal(indicator.diagnostics().outerRadiusPixels, sizing.outerRadiusPixels);
  assert.ok(indicator.mesh.scale.x > 0);
  indicator.clear();
  assert.equal(indicator.mesh.visible, false);
  indicator.dispose();
});
