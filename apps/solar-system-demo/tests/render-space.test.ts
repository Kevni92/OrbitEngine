import assert from "node:assert/strict";
import test from "node:test";
import { meters, vec3 } from "orbit-engine";
import { MERCURY_ID, SCENARIO_BODIES } from "../src/scenario/scenario-data.js";
import {
  ASTRONOMICAL_UNIT_METERS,
  J2000_ECLIPTIC_OBLIQUITY_RADIANS,
  MIN_ADAPTIVE_RADIUS_SCENE_UNITS,
  SCENE_UP_VECTOR,
  focusRelativePosition,
  icrsDirectionToRenderSpace,
  icrsToJ2000Ecliptic,
  j2000EclipticToIcrs,
  metersToSceneUnits,
  positionToSceneUnits,
  radiusToSceneUnits,
} from "../src/rendering/render-space.js";

test("render space uses a reversible J2000-ecliptic presentation transform", () => {
  assert.deepEqual(SCENE_UP_VECTOR, { x: 0, y: 0, z: 1 });
  assert.ok(J2000_ECLIPTIC_OBLIQUITY_RADIANS > 0);
  const ecliptic = vec3(12, -34, 56);
  const icrs = j2000EclipticToIcrs(ecliptic);
  const restored = icrsToJ2000Ecliptic(icrs);
  assert.ok(Math.abs(restored.x - ecliptic.x) < 1e-12);
  assert.ok(Math.abs(restored.y - ecliptic.y) < 1e-12);
  assert.ok(Math.abs(restored.z - ecliptic.z) < 1e-12);
  const scene = positionToSceneUnits(j2000EclipticToIcrs(vec3(0, ASTRONOMICAL_UNIT_METERS, 0)));
  assert.ok(Math.abs(scene.z) < 1e-12);
  assert.ok(Math.abs(scene.y - 100) < 1e-12);
});

test("presentation obliquity matches the committed primary-planet normalization", () => {
  const mercury = SCENARIO_BODIES.find((body) => body.id === MERCURY_ID)!;
  assert.ok(Math.abs(mercury.anchor.position.z) > 1e9);
  assert.ok(Math.abs(positionToSceneUnits(mercury.anchor.position).z) < 1e-12);
});

test("render space preserves focus-relative SI conversion before presentation rotation", () => {
  assert.deepEqual(focusRelativePosition(vec3(11, 22, 33), vec3(1, 2, 3)), { x: 10, y: 20, z: 30 });
  assert.deepEqual(positionToSceneUnits(vec3(ASTRONOMICAL_UNIT_METERS, 0, 0)), { x: 100, y: 0, z: 0 });
  assert.equal(metersToSceneUnits(ASTRONOMICAL_UNIT_METERS), 100);
});

test("render-space stellar directions use one rotation without translation or scale", () => {
  const stateDirection = { x: 0, y: 1, z: 0 };
  const renderDirection = icrsDirectionToRenderSpace(stateDirection);
  const expected = icrsToJ2000Ecliptic(stateDirection);
  const expectedLength = Math.hypot(expected.x, expected.y, expected.z);
  assert.ok(Math.abs(renderDirection.x - expected.x / expectedLength) < 1e-12);
  assert.ok(Math.abs(renderDirection.y - expected.y / expectedLength) < 1e-12);
  assert.ok(Math.abs(renderDirection.z - expected.z / expectedLength) < 1e-12);
  assert.ok(Math.abs(Math.hypot(renderDirection.x, renderDirection.y, renderDirection.z) - 1) < 1e-12);
  assert.throws(() => icrsDirectionToRenderSpace({ x: 0, y: 0, z: 0 }), /non-zero/);
  const translated = icrsDirectionToRenderSpace({ x: 0, y: 10, z: 0 });
  assert.ok(Math.abs(translated.x - renderDirection.x) < 1e-12);
  assert.ok(Math.abs(translated.y - renderDirection.y) < 1e-12);
  assert.ok(Math.abs(translated.z - renderDirection.z) < 1e-12);
});

test("radius policy keeps physical and adaptive presentation values separate", () => {
  const physical = radiusToSceneUnits({ mode: "physical", physicalRadiusMeters: meters(1) });
  const adaptive = radiusToSceneUnits({ mode: "adaptive", physicalRadiusMeters: meters(1), adaptiveRadiusSceneUnits: 0.2 });
  assert.equal(physical, metersToSceneUnits(1));
  assert.ok(adaptive >= MIN_ADAPTIVE_RADIUS_SCENE_UNITS);
  assert.ok(adaptive >= physical);
  assert.throws(() => radiusToSceneUnits({ mode: "adaptive", physicalRadiusMeters: meters(1) }), /camera-aware/);
});
