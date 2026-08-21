import assert from "node:assert/strict";
import test from "node:test";
import { meters, vec3 } from "orbit-engine";
import {
  IDENTITY_AXIS_MAPPING,
  MIN_VISIBLE_RADIUS_SCENE_UNITS,
  SCENE_UP_VECTOR,
  focusRelativePosition,
  metersToSceneUnits,
  positionToSceneUnits,
  radiusToSceneUnits,
} from "../src/rendering/render-space.js";

test("render space preserves identity axes and uses focus-relative SI conversion", () => {
  assert.deepEqual(IDENTITY_AXIS_MAPPING, { x: "x", y: "y", z: "z" });
  assert.deepEqual(SCENE_UP_VECTOR, { x: 0, y: 0, z: 1 });
  assert.deepEqual(focusRelativePosition(vec3(11, 22, 33), vec3(1, 2, 3)), { x: 10, y: 20, z: 30 });
  assert.deepEqual(positionToSceneUnits(vec3(149_597_870_700, 0, 0)), { x: 100, y: 0, z: 0 });
  assert.equal(metersToSceneUnits(149_597_870_700), 100);
});

test("radius policy keeps physical and visible presentation values separate", () => {
  const physical = radiusToSceneUnits({ mode: "physical", physicalRadiusMeters: meters(1) });
  const visible = radiusToSceneUnits({ mode: "visible", physicalRadiusMeters: meters(1) });
  assert.equal(physical, metersToSceneUnits(1));
  assert.ok(visible >= MIN_VISIBLE_RADIUS_SCENE_UNITS);
  assert.notEqual(visible, physical);
});
