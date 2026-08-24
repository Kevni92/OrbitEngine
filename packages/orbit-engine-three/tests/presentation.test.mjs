import assert from "node:assert/strict";
import test from "node:test";
import {
  createCelestialAppearance,
  deriveSurfaceReflectance,
  displayExposureDiagnostics,
  resolveAtmosphereOptics,
  resolveStellarIllumination,
  blackbodyTemperatureToLinearRgb,
  opticalMaterial,
} from "../dist/presentation.js";

const source = {
  source: "test",
  sourceIdentifier: "test:presentation",
  fields: ["visibleLayer", "atmosphere", "stellarEmission"],
  normalization: "test values are already normalized",
  limitations: "test fixture",
};

function appearance(overrides = {}) {
  return createCelestialAppearance({
    schemaVersion: "1.0",
    visibleLayer: {
      kind: "solidSurface",
      composition: [{ materialId: "basaltic-rock", fraction: 1 }],
    },
    provenance: [source],
    ...overrides,
  });
}

test("appearance validation, optical fallback, and derivation stay deterministic", () => {
  const record = appearance();
  assert.equal(Object.isFrozen(record), true);
  assert.equal(deriveSurfaceReflectance(record, 0xff00ff).source, "composition");
  assert.deepEqual(deriveSurfaceReflectance(record, 0xff00ff).linearReflectance, opticalMaterial("basaltic-rock").linearReflectance);
  assert.equal(deriveSurfaceReflectance(undefined, 0x4f83cc).source, "fallbackAccent");
  assert.throws(() => createCelestialAppearance({
    ...record,
    visibleLayer: { ...record.visibleLayer, composition: [
      { materialId: "basaltic-rock", fraction: 0.5 },
      { materialId: "basaltic-rock", fraction: 0.5 },
    ] },
  }), /duplicate identifier/);
});

test("atmosphere resolver prefers explicit optics and uses conservative fallbacks", () => {
  const explicit = resolveAtmosphereOptics(appearance({
    atmosphere: {
      referencePressurePa: 101325,
      scaleHeightMeters: 8500,
      gases: [{ gasId: "N2", mixingRatio: 1 }],
      optics: {
        rayleighScattering: { r: 0.1, g: 0.2, b: 0.9 },
        mieScattering: { r: 0.2, g: 0.1, b: 0.05 },
        absorption: { r: 0.01, g: 0.02, b: 0.03 },
        referenceVerticalOpticalDepth: 0.5,
        mieAnisotropy: 0.1,
      },
      cloudLayers: [],
    },
  }));
  assert.equal(explicit.source, "explicit");
  assert.equal(resolveAtmosphereOptics(appearance({
    atmosphere: { referencePressurePa: 1, scaleHeightMeters: 1, gases: [{ gasId: "N2", mixingRatio: 1 }], cloudLayers: [] },
  })).source, "gas-library");
  assert.equal(resolveAtmosphereOptics(appearance({
    atmosphere: { referencePressurePa: 1, scaleHeightMeters: 1, gases: [{ gasId: "unknown", mixingRatio: 1 }], cloudLayers: [] },
  })).source, "zero-fallback");
});

test("blackbody colors and exposure remain physical, bounded, and renderer-neutral", () => {
  const cool = blackbodyTemperatureToLinearRgb(3000);
  const hot = blackbodyTemperatureToLinearRgb(20000);
  assert.ok(cool.r > cool.b);
  assert.ok(hot.b > hot.r);
  assert.equal(displayExposureDiagnostics(1361).displayExposure, 1);
  assert.ok(displayExposureDiagnostics(0).displayExposure > 1);
  assert.equal("toneMappingMode" in displayExposureDiagnostics(1361), false);
});

test("stellar illumination uses authoritative SI positions and deterministic capped selection", () => {
  const emitter = (id, distance, luminosity = 4 * Math.PI) => ({
    objectId: id,
    position: { x: distance, y: 0, z: 0 },
    effectiveTemperatureKelvin: 5772,
    luminosityWatts: luminosity,
  });
  const illumination = resolveStellarIllumination({ x: 0, y: 0, z: 0 }, [
    emitter("30", 1, 12 * Math.PI),
    emitter("10", 1, 12 * Math.PI),
    emitter("20", 1),
    emitter("40", 1, Math.PI),
    emitter("50", 1, Math.PI / 2),
  ], { maxStellarContributors: 2 });
  assert.deepEqual(illumination.contributions.map((entry) => entry.emitterId), ["10", "30"]);
  assert.deepEqual(illumination.diagnostics.truncatedEmitterIds, ["20", "40", "50"]);
  assert.equal(illumination.diagnostics.selectedEmitterCount, 2);
  assert.equal(illumination.allContributions.length, 5);
  assert.equal(illumination.totalIrradianceWattsPerSquareMeter, 3 + 3 + 1 + 0.25 + 0.125);
  assert.deepEqual(illumination.contributions[0].directionToEmitter, { x: 1, y: 0, z: 0 });
  assert.equal("radius" in illumination, false);
  assert.throws(() => resolveStellarIllumination({ x: 0, y: 0, z: 0 }, [emitter("1", 0)]), /finite guard/);
});
