import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import {
  CAMERA_FAR_HEADROOM,
  DEFAULT_CAMERA_FAR,
  DEFAULT_CAMERA_NEAR,
  MAX_CAMERA_FAR,
  cameraFarForDistance,
  updateCameraClipPlanes,
} from "../src/rendering/three-shell.js";

test("camera far plane expands with zoom distance without imposing a max distance", () => {
  assert.equal(cameraFarForDistance(0), DEFAULT_CAMERA_FAR);
  assert.equal(cameraFarForDistance(2_500), DEFAULT_CAMERA_FAR);
  assert.equal(cameraFarForDistance(20_000), 20_000 * CAMERA_FAR_HEADROOM);
  assert.equal(cameraFarForDistance(Number.MAX_VALUE), MAX_CAMERA_FAR);
  assert.throws(() => cameraFarForDistance(Number.POSITIVE_INFINITY), /finite/);
});

test("camera clip planes stay valid and update only when distance changes", () => {
  const camera = new THREE.PerspectiveCamera(45, 1, DEFAULT_CAMERA_NEAR, DEFAULT_CAMERA_FAR);
  const target = new THREE.Vector3();
  camera.position.set(0, -30, 18);
  assert.equal(updateCameraClipPlanes(camera, target), false);
  camera.position.set(0, -20_000, 0);
  assert.equal(updateCameraClipPlanes(camera, target), true);
  assert.equal(camera.near, DEFAULT_CAMERA_NEAR);
  assert.equal(camera.far, 80_000);
  assert.ok(camera.near > 0 && camera.near < camera.far);
  assert.equal(updateCameraClipPlanes(camera, target), false);

  camera.position.set(Number.MAX_VALUE / 4, 0, 0);
  assert.equal(updateCameraClipPlanes(camera, target), true);
  assert.equal(camera.far, MAX_CAMERA_FAR);
  assert.ok(camera.projectionMatrix.elements.every(Number.isFinite));
});
