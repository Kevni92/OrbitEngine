import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import {
  DEFAULT_SCENE_GUIDE_SETTINGS,
  SceneGuides,
  niceGridStep,
} from "../src/rendering/scene-guides.js";

test("scene guides default to grid on and axes off with independent toggles", () => {
  const scene = new THREE.Scene();
  const guides = new SceneGuides(scene);
  assert.deepEqual(guides.settings(), DEFAULT_SCENE_GUIDE_SETTINGS);
  guides.setAxesVisible(true);
  assert.deepEqual(guides.settings(), { axesVisible: true, gridVisible: true });
  guides.setGridVisible(false);
  assert.deepEqual(guides.settings(), { axesVisible: true, gridVisible: false });
  guides.dispose();
});
test("adaptive grid uses bounded nice steps and avoids insignificant rebuilds", () => {
  assert.equal(niceGridStep(1), 1);
  assert.equal(niceGridStep(1.9), 2);
  assert.equal(niceGridStep(4.9), 5);

  const scene = new THREE.Scene();
  const guides = new SceneGuides(scene);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1_000);
  camera.position.set(0, -30, 18);
  guides.updateForCamera(camera);
  const firstStep = guides.gridStep();
  assert.ok(firstStep !== undefined);
  assert.ok(guides.gridRebuildCount() === 1);
  guides.updateForCamera(camera);
  assert.equal(guides.gridRebuildCount(), 1);
  camera.position.multiplyScalar(1.1);
  guides.updateForCamera(camera);
  assert.equal(guides.gridRebuildCount(), 1);
  camera.position.multiplyScalar(4);
  guides.updateForCamera(camera);
  assert.equal(guides.gridRebuildCount(), 2);
  assert.ok(guides.gridStep()! > firstStep!);
  guides.dispose();
});

test("grid geometry is planar in the XY plane", () => {
  const scene = new THREE.Scene();
  const guides = new SceneGuides(scene);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1_000);
  camera.position.set(0, -30, 18);
  guides.updateForCamera(camera);
  const root = scene.getObjectByName("scene-guides")!;
  const lines = root.children.filter((child) => child.name.startsWith("reference-grid"));
  assert.ok(lines.length > 0);
  for (const line of lines) {
    const attribute = (line as THREE.LineSegments).geometry.getAttribute("position");
    for (let index = 2; index < attribute.count * 3; index += 3) assert.equal(attribute.getX(index / 3), 0);
  }
  guides.dispose();
});
