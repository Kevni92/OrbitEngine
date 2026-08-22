import assert from "node:assert/strict";
import test from "node:test";
import {
  adaptiveRadiusPixels,
  cappedAdaptiveRadiusSceneUnits,
  projectedPixelsToSceneRadius,
  projectedRadiusPixels,
} from "../src/rendering/adaptive-sizing.js";

test("adaptive sizing is monotonic and never shrinks physical projection", () => {
  const values = [0, 0.1, 1, 2, 5, 7, 12].map(adaptiveRadiusPixels);
  for (let index = 1; index < values.length; index += 1) assert.ok(values[index]! >= values[index - 1]!);
  assert.ok(values.every((value, index) => value >= [0, 0.1, 1, 2, 5, 7, 12][index]!));
  assert.equal(adaptiveRadiusPixels(7), 7);
  assert.equal(adaptiveRadiusPixels(12), 12);
});

test("projected radius conversion is reversible and separation cap preserves physical radius", () => {
  const pixels = projectedRadiusPixels(0.5, 10, Math.PI / 3, 900);
  const sceneRadius = projectedPixelsToSceneRadius(pixels, 10, Math.PI / 3, 900);
  assert.ok(Math.abs(sceneRadius - 0.5) < 1e-12);
  assert.equal(cappedAdaptiveRadiusSceneUnits(10, 1, 4), 1.2);
  assert.equal(cappedAdaptiveRadiusSceneUnits(0.2, 1, 4), 1);
});
