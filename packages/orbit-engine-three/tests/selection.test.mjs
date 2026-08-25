import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { objectId } from "orbit-engine";
import {
  DEFAULT_SELECTION_GAP_PIXELS,
  SelectionIndicator,
  selectionIndicatorPixelSizing,
} from "../dist/index.js";

test("selection indicator remains ObjectId-bound and uses four detached CSS-pixel arc markers", () => {
  const scene = new THREE.Scene();
  const indicator = new SelectionIndicator(scene);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  const id = objectId("42");
  const sizing = selectionIndicatorPixelSizing(5);
  indicator.update({ objectId: id, positionSceneUnits: { x: 0, y: 0, z: 0 }, bodyRadiusPixels: 5 }, camera, 800);

  assert.equal(DEFAULT_SELECTION_GAP_PIXELS, 14);
  assert.equal(sizing.innerRadiusPixels, 19);
  assert.equal(indicator.selectedObjectId, id);
  assert.equal(indicator.mesh.userData.objectId, id);
  assert.equal(indicator.mesh.userData.representation, "selection-indicator-segments");
  assert.equal(indicator.mesh.visible, true);
  assert.equal(indicator.diagnostics().outerRadiusPixels, sizing.outerRadiusPixels);
  assert.ok(indicator.mesh.scale.x > 0);
  assert.match(indicator.mesh.material.fragmentShader, /cardinalDistance = abs\(sin\(2\.0 \* angle\)\)/);
  assert.match(indicator.mesh.material.fragmentShader, /outerMask \* innerMask \* arcMask \* uOpacity/);
  assert.doesNotMatch(indicator.mesh.material.fragmentShader, /outerMask \* innerMask \* uOpacity/);

  indicator.clear();
  assert.equal(indicator.mesh.visible, false);
  indicator.dispose();
});
