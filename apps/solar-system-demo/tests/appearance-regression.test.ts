import assert from "node:assert/strict";
import test from "node:test";
import {
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
