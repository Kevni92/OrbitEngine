import assert from "node:assert/strict";
import test from "node:test";
import {
  blackbodyTemperatureToLinearRgb,
  displayExposureDiagnostics,
  displayExposureForIrradiance,
  MAX_DISPLAY_EXPOSURE,
  MIN_DISPLAY_EXPOSURE,
  deriveSurfaceReflectance,
  LAMBERT_RENDERER_IRRADIANCE_NORMALIZATION,
  LINEAR_SRGB_LUMINANCE,
  mapIrradianceToSceneIntensity,
  mapSceneDiffuseContributionToLambertLightIntensity,
  normalizeLinearReflectanceToAlbedo,
  resolveStellarIllumination,
} from "../src/rendering/celestial-appearance-rendering.js";
import { icrsToJ2000Ecliptic } from "../src/rendering/render-space.js";
import { opticalMaterial } from "../src/scenario/celestial-appearance.js";
import { EARTH_ID, SUN_ID } from "../src/scenario/scenario-data.js";

const AU = 149_597_870_700;

test("surface reflectance uses calibrated data before composition and preserves linear RGB", () => {
  const appearance = {
    schemaVersion: "1.0" as const,
    visibleLayer: {
      kind: "solidSurface" as const,
      composition: [{ materialId: "basaltic-rock", fraction: 1 }],
      calibratedReflectance: { r: 0.7, g: 0.2, b: 0.1 },
    },
    provenance: [{
      source: "test", sourceIdentifier: "test:1", fields: ["visibleLayer"],
      normalization: "linear", limitations: "test",
    }],
  };
  const calibrated = deriveSurfaceReflectance(appearance, 0x00ff00);
  assert.equal(calibrated.source, "calibratedReflectance");
  assert.deepEqual(calibrated.linearReflectance, { r: 0.7, g: 0.2, b: 0.1 });

  const composition = deriveSurfaceReflectance({ ...appearance, visibleLayer: { ...appearance.visibleLayer, calibratedReflectance: undefined } }, 0x00ff00);
  const basalt = opticalMaterial("basaltic-rock")!.linearReflectance;
  assert.equal(composition.source, "composition");
  assert.deepEqual(composition.linearReflectance, basalt);
  assert.equal(composition.opticalLibraryVersion, "orbit-engine-three-optics-1");
});

test("visual albedo normalization preserves chromaticity and targets linear luminance", () => {
  const normalized = normalizeLinearReflectanceToAlbedo({ r: 0.2, g: 0.4, b: 0.8 }, 0.3);
  const luminance = normalized.r * LINEAR_SRGB_LUMINANCE.r
    + normalized.g * LINEAR_SRGB_LUMINANCE.g
    + normalized.b * LINEAR_SRGB_LUMINANCE.b;
  assert.ok(Math.abs(luminance - 0.3) < 1e-12);
  assert.ok(Math.abs(normalized.g / normalized.r - 2) < 1e-12);
  assert.equal(deriveSurfaceReflectance(undefined, 0x4f83cc).source, "fallbackAccent");
});

test("blackbody chromaticity changes continuously with reference temperature", () => {
  const cool = blackbodyTemperatureToLinearRgb(3_000);
  const solar = blackbodyTemperatureToLinearRgb(5_772);
  const hot = blackbodyTemperatureToLinearRgb(20_000);
  assert.ok(cool.r > cool.b);
  assert.ok(hot.b > hot.r);
  assert.ok(solar.g > 0 && solar.r > 0 && solar.b > 0);
  assert.throws(() => blackbodyTemperatureToLinearRgb(500), /outside/);
});

test("stellar illumination uses authoritative SI distance and inverse-square falloff", () => {
  const oneDistance = resolveStellarIllumination({ x: 0, y: 0, z: 0 }, [{
    objectId: SUN_ID,
    position: { x: AU, y: 0, z: 0 },
    effectiveTemperatureKelvin: 5_772,
    luminosityWatts: 4 * Math.PI * AU ** 2,
  }]);
  const twoDistance = resolveStellarIllumination({ x: 0, y: 0, z: 0 }, [{
    objectId: SUN_ID,
    position: { x: AU * 2, y: 0, z: 0 },
    effectiveTemperatureKelvin: 5_772,
    luminosityWatts: 4 * Math.PI * AU ** 2,
  }]);
  assert.ok(Math.abs(oneDistance.contributions[0]!.irradianceWattsPerSquareMeter / 4
    - twoDistance.contributions[0]!.irradianceWattsPerSquareMeter) < 1e-15);
  assert.equal(oneDistance.contributions[0]!.directionToEmitter.x, 1);
  assert.deepEqual(oneDistance.contributions[0]!.renderDirectionToEmitter, { x: 1, y: 0, z: 0 });
  assert.equal(mapIrradianceToSceneIntensity(1_361), 1);
  assert.throws(() => resolveStellarIllumination({ x: 0, y: 0, z: 0 }, [{
    objectId: EARTH_ID,
    position: { x: 0, y: 0, z: 0 },
    effectiveTemperatureKelvin: 5_772,
    luminosityWatts: 1,
  }]), /finite guard/);
});

test("stellar diagnostics retain physical direction and expose the once-rotated render direction", () => {
  const direction = { x: 0, y: 1, z: 0 } as const;
  const illumination = resolveStellarIllumination({ x: 0, y: 0, z: 0 }, [{
    objectId: SUN_ID,
    position: direction,
    effectiveTemperatureKelvin: 5_772,
    luminosityWatts: 4 * Math.PI,
  }]);
  const contribution = illumination.contributions[0]!;
  const expected = icrsToJ2000Ecliptic(direction);
  assert.deepEqual(contribution.directionToEmitter, direction);
  assert.ok(Math.abs(contribution.renderDirectionToEmitter.x - expected.x) < 1e-12);
  assert.ok(Math.abs(contribution.renderDirectionToEmitter.y - expected.y) < 1e-12);
  assert.ok(Math.abs(contribution.renderDirectionToEmitter.z - expected.z) < 1e-12);
});

test("display exposure adapts to physical irradiance without changing the pre-exposure mapping", () => {
  const earth = displayExposureDiagnostics(1_361);
  const mercury = displayExposureDiagnostics(9_000);
  const neptune = displayExposureDiagnostics(1.2);
  assert.equal(earth.preExposureMappedIrradiance, 1);
  assert.equal(earth.toneMappingMode, "ACESFilmic");
  assert.ok(mercury.displayExposure < earth.displayExposure);
  assert.ok(neptune.displayExposure > earth.displayExposure);
  assert.ok(neptune.displayExposure <= MAX_DISPLAY_EXPOSURE);
  assert.ok(mercury.displayExposure >= MIN_DISPLAY_EXPOSURE);
  assert.ok(Number.isFinite(displayExposureForIrradiance(0)));
  assert.ok(Number.isFinite(displayExposureForIrradiance(Number.MAX_VALUE)));
  assert.throws(() => displayExposureForIrradiance(-1), /non-negative/);
});

test("Lambert renderer conversion compensates reciprocal PI exactly once", () => {
  assert.equal(LAMBERT_RENDERER_IRRADIANCE_NORMALIZATION, Math.PI);
  assert.ok(Math.abs(mapSceneDiffuseContributionToLambertLightIntensity(1) / Math.PI - 1) < 1e-15);
  assert.ok(Math.abs(mapSceneDiffuseContributionToLambertLightIntensity(0.18) / Math.PI - 0.18) < 1e-15);
  assert.ok(Math.abs(mapSceneDiffuseContributionToLambertLightIntensity(0.25) / Math.PI - 0.25) < 1e-15);
  assert.throws(() => mapSceneDiffuseContributionToLambertLightIntensity(-0.01), /non-negative/);
});

test("multiple emitters add linearly and do not depend on rendered radius", () => {
  const emitter = (objectId: typeof SUN_ID, position: { x: number; y: number; z: number }) => ({
    objectId,
    position,
    effectiveTemperatureKelvin: 5_772,
    luminosityWatts: 4 * Math.PI * AU ** 2,
  });
  const one = resolveStellarIllumination({ x: 0, y: 0, z: 0 }, [emitter(SUN_ID, { x: AU, y: 0, z: 0 })]);
  const two = resolveStellarIllumination({ x: 0, y: 0, z: 0 }, [
    emitter(SUN_ID, { x: AU, y: 0, z: 0 }),
    emitter(EARTH_ID, { x: 0, y: AU, z: 0 }),
  ]);
  assert.ok(Math.abs(two.totalIrradianceWattsPerSquareMeter - one.totalIrradianceWattsPerSquareMeter * 2) < 1e-12);
  assert.ok(Math.abs(two.additiveLinearLight.r - one.additiveLinearLight.r * 2) < 1e-12);
  // The pure resolver receives only SI positions; adaptive/presented sphere
  // radii cannot enter the physical illumination calculation.
  assert.equal(Object.keys(one).includes("radius"), false);
});
