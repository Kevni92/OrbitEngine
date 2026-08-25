import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveSurfaceReflectance,
  LINEAR_SRGB_LUMINANCE,
} from "orbit-engine-three/presentation";
import {
  createProceduralSurfaceTexture,
  generateProceduralSurfaceData,
} from "../src/rendering/procedural-surface.js";
import {
  EARTH_ID,
  JUPITER_ID,
  NEPTUNE_ID,
  SCENARIO_BODIES,
} from "../src/scenario/scenario-data.js";
import * as THREE from "three";

function body(id: typeof EARTH_ID) {
  return SCENARIO_BODIES.find((candidate) => candidate.id === id)!;
}

function baselineFor(id: typeof EARTH_ID) {
  const definition = body(id);
  return deriveSurfaceReflectance(definition.appearance, definition.display.accentColor).linearReflectance;
}

function luminance(value: { r: number; g: number; b: number }): number {
  return value.r * LINEAR_SRGB_LUMINANCE.r
    + value.g * LINEAR_SRGB_LUMINANCE.g
    + value.b * LINEAR_SRGB_LUMINANCE.b;
}

test("procedural surface generation is deterministic and preserves the sourced mean reflectance", () => {
  const earth = body(EARTH_ID);
  const baseline = baselineFor(EARTH_ID);
  const first = generateProceduralSurfaceData(EARTH_ID, earth.appearance!, baseline, 48, 24)!;
  const second = generateProceduralSurfaceData(EARTH_ID, earth.appearance!, baseline, 48, 24)!;
  assert.deepEqual(first.pixels, second.pixels);
  assert.equal(first.kind, "solidSurface");
  assert.equal(first.hasCloudStructure, true);
  assert.ok(first.maxLuminance - first.minLuminance > 0.08);
  assert.ok(Math.abs(first.meanLinear.r - baseline.r) < 0.02);
  assert.ok(Math.abs(first.meanLinear.g - baseline.g) < 0.02);
  assert.ok(Math.abs(first.meanLinear.b - baseline.b) < 0.02);
  assert.ok(luminance(first.meanLinear) > 0);
});

test("cloud-deck planets receive repeatable band structure without body-name branches", () => {
  for (const id of [JUPITER_ID, NEPTUNE_ID] as const) {
    const definition = body(id);
    const baseline = baselineFor(id);
    const surface = generateProceduralSurfaceData(id, definition.appearance!, baseline, 64, 32)!;
    assert.equal(surface.kind, "cloudDeck");
    assert.equal(surface.hasCloudStructure, true);
    assert.ok(surface.maxLuminance - surface.minLuminance > 0.04);
    assert.ok(Math.abs(surface.meanLinear.r - baseline.r) < 0.025);
    assert.ok(Math.abs(surface.meanLinear.g - baseline.g) < 0.025);
    assert.ok(Math.abs(surface.meanLinear.b - baseline.b) < 0.025);
  }
});

test("procedural surface data creates an sRGB DataTexture and missing visible layers remain texture-free", () => {
  const earth = body(EARTH_ID);
  const data = generateProceduralSurfaceData(EARTH_ID, earth.appearance!, baselineFor(EARTH_ID), 32, 16)!;
  const texture = createProceduralSurfaceTexture(data);
  assert.equal(texture.image.width, 32);
  assert.equal(texture.image.height, 16);
  assert.equal(texture.colorSpace, THREE.SRGBColorSpace);
  assert.equal(texture.wrapS, THREE.RepeatWrapping);
  texture.dispose();

  const withoutLayer = { ...earth.appearance!, visibleLayer: undefined };
  assert.equal(generateProceduralSurfaceData(EARTH_ID, withoutLayer, baselineFor(EARTH_ID)), undefined);
});
