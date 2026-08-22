import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { vec3 } from "orbit-engine";
import { j2000EclipticToIcrs, positionToSceneUnits } from "../src/rendering/render-space.js";
import { updateCameraClipPlanes, translateViewTo } from "../src/rendering/three-shell.js";

test("view centering translates camera and target together for presentation-space targets", () => {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(10, -20, 8);
  const currentTarget = new THREE.Vector3(2, 3, 4);
  const cameraOffset = camera.position.clone().sub(currentTarget);
  const icrsTarget = j2000EclipticToIcrs(vec3(-7, 11, 5));
  const renderedTarget = positionToSceneUnits(icrsTarget);
  const nextTarget = new THREE.Vector3(renderedTarget.x, renderedTarget.y, renderedTarget.z);

  translateViewTo(camera, currentTarget, nextTarget);

  assert.deepEqual(currentTarget.toArray(), nextTarget.toArray());
  assert.deepEqual(camera.position.toArray(), nextTarget.clone().add(cameraOffset).toArray());
});

test("camera clipping adapts near plane for compact local-system framing", () => {
  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 10_000);
  camera.position.set(0, -0.02, 0.01);
  const changed = updateCameraClipPlanes(camera, new THREE.Vector3());
  assert.equal(changed, true);
  assert.ok(camera.near < 0.01);
  assert.ok(Number.isFinite(camera.far));
  assert.ok(camera.near < camera.far / 2);
});
