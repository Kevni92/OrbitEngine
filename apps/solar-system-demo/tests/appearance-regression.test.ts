import assert from "node:assert/strict";
import test from "node:test";
import {
  displayExposureDiagnostics,
  deriveSurfaceReflectance,
  resolveStellarIllumination,
} from "../src/rendering/celestial-appearance-rendering.js";
import { resolveAtmosphereOptics } from "../src/rendering/atmosphere-rendering.js";
import {
  EARTH_ID,
  JUPITER_ID,
  MARS_ID,
  SCENARIO_BODIES,
  SUN_ID,
  TITAN_ID,
  VENUS_ID,
  VESTA_ID,
} from "../src/scenario/scenario-data.js";

function body(id: typeof SUN_ID) {
  return SCENARIO_BODIES.find((candidate) => candidate.id === id)!;
}

test("representative appearance matrix keeps optical sources and conservative fallbacks explicit", () => {
  const sun = body(SUN_ID);
  const venus = body(VENUS_ID);
  const earth = body(EARTH_ID);
  const mars = body(MARS_ID);
  const jupiter = body(JUPITER_ID);
  const titan = body(TITAN_ID);
  const vesta = body(VESTA_ID);
  const fallback = SCENARIO_BODIES.find((candidate) => candidate.appearance === undefined)!;

  assert.equal(sun.appearance?.stellarEmission?.effectiveTemperatureKelvin, 5_772);
  assert.equal(resolveAtmosphereOptics(earth.appearance)?.source, "explicit");
  assert.equal(resolveAtmosphereOptics(venus.appearance)?.source, "explicit");
  assert.equal(resolveAtmosphereOptics(mars.appearance)?.source, "explicit");
  assert.equal(resolveAtmosphereOptics(titan.appearance)?.source, "explicit");
  assert.equal(resolveAtmosphereOptics(jupiter.appearance)?.source, "explicit");
  assert.equal(resolveAtmosphereOptics(vesta.appearance), undefined);
  assert.equal(resolveAtmosphereOptics(fallback.appearance), undefined);
  assert.equal(deriveSurfaceReflectance(fallback.appearance, fallback.display.accentColor).source, "fallbackAccent");
});

test("Earth and Mars keep distinct body-driven atmosphere chromaticity", () => {
  const earth = resolveAtmosphereOptics(body(EARTH_ID).appearance)!;
  const mars = resolveAtmosphereOptics(body(MARS_ID).appearance)!;
  const earthRayleighBlueRatio = earth.rayleighScattering.b / earth.rayleighScattering.r;
  const marsMieWarmRatio = mars.mieScattering.r / mars.mieScattering.b;
  assert.ok(earthRayleighBlueRatio > 10);
  assert.ok(marsMieWarmRatio > 3);

  const changedMars = resolveAtmosphereOptics({
    ...body(MARS_ID).appearance!,
    atmosphere: {
      ...body(MARS_ID).appearance!.atmosphere!,
      optics: {
        ...body(MARS_ID).appearance!.atmosphere!.optics!,
        mieScattering: { r: 0.08, g: 0.12, b: 0.42 },
      },
    },
  })!;
  assert.notDeepEqual(changedMars.mieScattering, mars.mieScattering);
  assert.equal(displayExposureDiagnostics(1_361).displayExposure, 1);
});

test("appearance diagnostics do not depend on presentation radius and preserve authoritative positions", () => {
  const sun = body(SUN_ID);
  const earth = body(EARTH_ID);
  const sunPosition = sun.anchor.position;
  const earthPosition = earth.anchor.position;
  const beforeSun = { ...sunPosition };
  const beforeEarth = { ...earthPosition };
  const emitters = [{
    objectId: SUN_ID,
    position: sunPosition,
    effectiveTemperatureKelvin: sun.appearance!.stellarEmission!.effectiveTemperatureKelvin,
    luminosityWatts: sun.appearance!.stellarEmission!.luminosityWatts,
  }];
  const physical = resolveStellarIllumination(earthPosition, emitters);
  const samePhysicalAtAdaptiveRadius = resolveStellarIllumination(earthPosition, emitters);
  assert.equal(samePhysicalAtAdaptiveRadius.totalIrradianceWattsPerSquareMeter, physical.totalIrradianceWattsPerSquareMeter);
  assert.deepEqual(sunPosition, beforeSun);
  assert.deepEqual(earthPosition, beforeEarth);
});
