import assert from "node:assert/strict";
import test from "node:test";
import {
  adaptiveProjectedRadiusCssPixels,
  DEFAULT_ADAPTIVE_BODY_SIZE_POLICY,
  physicalProjectedRadiusCssPixels,
  sceneRadiusForProjectedCssPixels,
  separationBoundedProjectedRadiusCssPixels,
} from "../src/rendering/adaptive-body-size.js";

const FOV = 60 * Math.PI / 180;
const HEIGHT = 1000;

test("adaptive curve is continuous, monotonic, and converges to physical size", () => {
  const resolved = DEFAULT_ADAPTIVE_BODY_SIZE_POLICY.resolvedRadiusCssPx;
  const below = adaptiveProjectedRadiusCssPixels(resolved - 1e-9);
  const at = adaptiveProjectedRadiusCssPixels(resolved);
  assert.ok(Math.abs(below - at) < 1e-6);
  let previous = 0;
  for (let index = 0; index <= 100; index += 1) {
    const physical = resolved * index / 100;
    const adaptive = adaptiveProjectedRadiusCssPixels(physical);
    assert.ok(adaptive >= previous);
    previous = adaptive;
  }
  assert.equal(adaptiveProjectedRadiusCssPixels(resolved * 2), resolved * 2);
});

test("projection and inverse projection round-trip in CSS pixels", () => {
  const sceneRadius = 0.25;
  const depth = 20;
  const pixels = physicalProjectedRadiusCssPixels(sceneRadius, depth, FOV, HEIGHT);
  const restored = sceneRadiusForProjectedCssPixels(pixels, depth, FOV, HEIGHT);
  assert.ok(Math.abs(restored - sceneRadius) < 1e-12);
});

test("zooming closer increases physical projected size and naturally reduces relative enhancement", () => {
  const far = physicalProjectedRadiusCssPixels(0.1, 100, FOV, HEIGHT);
  const near = physicalProjectedRadiusCssPixels(0.1, 5, FOV, HEIGHT);
  assert.ok(near > far);
  const farEnhanced = adaptiveProjectedRadiusCssPixels(far);
  const nearEnhanced = adaptiveProjectedRadiusCssPixels(near);
  assert.ok(farEnhanced / far > nearEnhanced / near);
});

test("separation cap prevents avoidable enhancement overlap but never shrinks below physical size", () => {
  const physical = 1;
  const adaptive = 4;
  const bounded = separationBoundedProjectedRadiusCssPixels(physical, adaptive, 8, 0.3);
  assert.equal(bounded, 2.4);
  const physicallyOverlapping = separationBoundedProjectedRadiusCssPixels(5, 7, 8, 0.3);
  assert.equal(physicallyOverlapping, 5);
});

test("larger physical projected radii cannot become smaller through the enhancement curve", () => {
  const small = adaptiveProjectedRadiusCssPixels(0.01);
  const medium = adaptiveProjectedRadiusCssPixels(0.1);
  const large = adaptiveProjectedRadiusCssPixels(1);
  assert.ok(small <= medium);
  assert.ok(medium <= large);
});
