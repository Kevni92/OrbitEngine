import assert from "node:assert/strict";
import test from "node:test";
import {
  atmosphereCompositeAlpha,
  atmosphereCompositeRadiance,
  atmosphereOpticalDepth,
  atmosphereOuterShellFade,
  atmosphereSurfaceCompositeBlend,
  atmosphereSingleScatteringSample,
  atmosphereTransmittance,
  normalizeAtmosphereOpticsForTransport,
} from "../dist/presentation/atmosphere-math.js";
import { resolveAtmosphereOptics } from "../dist/presentation/atmosphere.js";
import { createCelestialAppearance } from "../dist/presentation/appearance.js";
import { mapIrradianceToSceneIntensity, displayExposureForIrradiance } from "../dist/presentation/optics.js";
import { resolveStellarIllumination } from "../dist/presentation/illumination.js";

const source = {
  source: "test",
  sourceIdentifier: "test:atmosphere-math",
  fields: ["atmosphere"],
  normalization: "test fixture",
  limitations: "test fixture",
};

function optics(overrides = {}) {
  return normalizeAtmosphereOpticsForTransport({
    rayleighScattering: { r: 0.08, g: 0.24, b: 0.8 },
    mieScattering: { r: 0.24, g: 0.18, b: 0.12 },
    absorption: { r: 0.08, g: 0.12, b: 0.16 },
    referenceVerticalOpticalDepth: 0.4,
    mieAnisotropy: 0.5,
    source: "explicit",
    ...overrides,
  });
}

function sample(transport, overrides = {}) {
  return atmosphereSingleScatteringSample(transport, {
    sampleDensityColumnScaleHeights: 0.1,
    verticalDensityIntegral: 0.98,
    viewDensityPath: 0.2,
    lightDensityPath: 0.15,
    lightVisible: true,
    rayleighPhase: 0.75,
    miePhase: 0.4,
    lightIntensity: 1,
    ...overrides,
  });
}

test("thin-atmosphere source weight is independent of reference optical depth", () => {
  const thin = optics({ referenceVerticalOpticalDepth: 0.2 });
  const thicker = optics({ referenceVerticalOpticalDepth: 0.4 });
  assert.deepEqual(sample(thin, { viewDensityPath: 0, lightDensityPath: 0 }), sample(thicker, { viewDensityPath: 0, lightDensityPath: 0 }));
  const thinRadiance = atmosphereCompositeRadiance(sample(thin, { viewDensityPath: 0, lightDensityPath: 0 }), atmosphereCompositeAlpha(thin, 0.1), 1);
  const thickRadiance = atmosphereCompositeRadiance(sample(thicker, { viewDensityPath: 0, lightDensityPath: 0 }), atmosphereCompositeAlpha(thicker, 0.1), 1);
  assert.ok(thickRadiance.b / thinRadiance.b > 1.8 && thickRadiance.b / thinRadiance.b < 2.2);
});

test("longer paths increase optical depth while leaving an unobscured source nonzero", () => {
  const transport = optics();
  const shortDepth = atmosphereOpticalDepth(transport, 0.2);
  const longDepth = atmosphereOpticalDepth(transport, 2);
  assert.ok(longDepth.r > shortDepth.r);
  assert.ok(longDepth.b > shortDepth.b);
  const longSample = sample(transport, { viewDensityPath: 2, lightDensityPath: 1.5 });
  assert.ok(longSample.r > 0 && longSample.g > 0 && longSample.b > 0);
});

test("wavelength-dependent extinction changes chromaticity on a tangent path", () => {
  const transport = optics({
    rayleighScattering: { r: 0.02, g: 0.1, b: 1 },
    mieScattering: { r: 0.02, g: 0.02, b: 0.02 },
    absorption: { r: 0.01, g: 0.05, b: 0.5 },
    referenceVerticalOpticalDepth: 1,
  });
  const transmittance = atmosphereTransmittance(transport, 4);
  assert.ok(transmittance.r > transmittance.b);
  assert.notEqual(transmittance.r / transmittance.b, 1);
});

test("unobstructed high-altitude terminator samples are not removed by a local-normal gate", () => {
  const result = sample(optics(), { lightVisible: true, viewDensityPath: 0.5, lightDensityPath: 0.5 });
  assert.ok(result.r > 0 && result.g > 0 && result.b > 0);
});

test("body-occluded stellar rays produce no direct contribution", () => {
  assert.deepEqual(sample(optics(), { lightVisible: false }), { r: 0, g: 0, b: 0 });
});

test("explicit haze remains a bounded spectral source instead of multiplying optical strength twice", () => {
  const appearance = createCelestialAppearance({
    schemaVersion: "1.0",
    atmosphere: {
      referencePressurePa: 100_000,
      scaleHeightMeters: 20_000,
      gases: [{ gasId: "N2", mixingRatio: 1 }],
      optics: {
        rayleighScattering: { r: 0.1, g: 0.2, b: 0.4 },
        mieScattering: { r: 0.2, g: 0.15, b: 0.1 },
        absorption: { r: 0.1, g: 0.1, b: 0.1 },
        referenceVerticalOpticalDepth: 0.8,
        mieAnisotropy: 0.7,
      },
      haze: {
        hazeId: "test-haze",
        opticalDepthContribution: 1.2,
        calibratedScattering: { r: 0.5, g: 0.2, b: 0.05 },
      },
      cloudLayers: [],
    },
    provenance: [source],
  });
  const resolved = resolveAtmosphereOptics(appearance);
  const transport = normalizeAtmosphereOpticsForTransport(resolved);
  assert.equal(transport.referenceVerticalOpticalDepth, 2);
  assert.ok(Math.abs(transport.extinction.r * 0.2126 + transport.extinction.g * 0.7152 + transport.extinction.b * 0.0722 - 1) < 1e-12);
  const sourceSample = sample(transport, { viewDensityPath: 0, lightDensityPath: 0 });
  assert.ok(sourceSample.r > 0 && sourceSample.r < 1);
});

test("display exposure changes atmosphere presentation without changing physical irradiance", () => {
  const emitter = {
    objectId: "sun",
    position: { x: 1, y: 0, z: 0 },
    effectiveTemperatureKelvin: 5772,
    luminosityWatts: 4 * Math.PI,
  };
  const illumination = resolveStellarIllumination({ x: 0, y: 0, z: 0 }, [emitter]);
  const physicalIrradiance = illumination.totalIrradianceWattsPerSquareMeter;
  const baseline = atmosphereCompositeRadiance({ r: 0.1, g: 0.2, b: 0.4 }, 0.5, 1);
  const exposed = atmosphereCompositeRadiance({ r: 0.1, g: 0.2, b: 0.4 }, 0.5, 4);
  assert.equal(illumination.totalIrradianceWattsPerSquareMeter, physicalIrradiance);
  assert.equal(physicalIrradiance, 1);
  assert.equal(mapIrradianceToSceneIntensity(physicalIrradiance), illumination.contributions[0].exposureMappedIrradiance);
  assert.equal(exposed.b / baseline.b, 4);
  assert.equal(displayExposureForIrradiance(physicalIrradiance), 512);
});


test("presentation shell fades continuously to zero before the finite mesh edge", () => {
  assert.equal(atmosphereOuterShellFade(-0.5), 1);
  assert.equal(atmosphereOuterShellFade(0), 1);
  assert.equal(atmosphereOuterShellFade(0.35), 1);
  const middle = atmosphereOuterShellFade(0.7);
  assert.ok(middle > 0 && middle < 1);
  assert.equal(atmosphereOuterShellFade(1), 0);
  assert.equal(atmosphereOuterShellFade(2), 0);
});

test("surface composite gain hands off continuously to the exterior limb gain", () => {
  assert.equal(atmosphereSurfaceCompositeBlend(-2, true), 1);
  const inner = atmosphereSurfaceCompositeBlend(-1, true);
  const nearLimb = atmosphereSurfaceCompositeBlend(-0.1, true);
  assert.ok(inner > nearLimb);
  assert.ok(nearLimb > 0 && nearLimb < 1);
  assert.equal(atmosphereSurfaceCompositeBlend(0.1, true), 0);
  assert.equal(atmosphereSurfaceCompositeBlend(-2, false), 0);
});
