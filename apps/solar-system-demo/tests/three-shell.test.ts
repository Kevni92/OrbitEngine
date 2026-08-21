import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { translateViewTo } from "../src/rendering/three-shell.js";

test("view centering translates camera and target together", () => {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(10, -20, 8);
  const currentTarget = new THREE.Vector3(2, 3, 4);
  const cameraOffset = camera.position.clone().sub(currentTarget);
  const nextTarget = new THREE.Vector3(-7, 11, 5);

  translateViewTo(camera, currentTarget, nextTarget);

  assert.deepEqual(currentTarget.toArray(), nextTarget.toArray());
  assert.deepEqual(camera.position.toArray(), nextTarget.clone().add(cameraOffset).toArray());
});
