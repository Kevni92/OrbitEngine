import assert from "node:assert/strict";
import test from "node:test";
import {
  CELESTIAL_APPEARANCE_SCHEMA_VERSION,
  createCelestialAppearance,
  validateCelestialAppearance,
} from "../src/scenario/celestial-appearance.js";
import {
  EARTH_ID,
  MARS_ID,
  NEPTUNE_ID,
  SCENARIO_BODIES,
  SATURN_ID,
  SUN_ID,
  TITAN_ID,
  URANUS_ID,
  VESTA_ID,
  VENUS_ID,
} from "../src/scenario/scenario-data.js";

function source() {
  return {
    source: "test source",
    sourceIdentifier: "test:appearance",
    sourceUrl: "https://example.test/appearance",
    fields: ["visibleLayer"],
    normalization: "linear RGB and SI",
    limitations: "test approximation",
  } as const;
}

function validAppearance() {
  return createCelestialAppearance({
    schemaVersion: CELESTIAL_APPEARANCE_SCHEMA_VERSION,
    visibleLayer: {
      kind: "solidSurface",
      composition: [{ materialId: "basaltic-rock", fraction: 1 }],
      calibratedReflectance: { r: 0.2, g: 0.3, b: 0.4 },
      visualAlbedo: 0.3,
    },
    atmosphere: {
      referencePressurePa: 101_325,
      scaleHeightMeters: 8_434,
      gases: [{ gasId: "N2", mixingRatio: 1 }],
      optics: {
        rayleighScattering: { r: 0.1, g: 0.2, b: 0.4 },
        mieScattering: { r: 0.2, g: 0.2, b: 0.2 },
        absorption: { r: 0.01, g: 0.02, b: 0.03 },
        referenceVerticalOpticalDepth: 0.3,
        mieAnisotropy: 0.5,
      },
      cloudLayers: [{
        lowerAltitudeMeters: 1_000,
        upperAltitudeMeters: 2_000,
        materialId: "water-ice",
        coverageFraction: 0.5,
        opticalDepth: 0.2,
      }],
    },
    stellarEmission: { effectiveTemperatureKelvin: 5_772, luminosityWatts: 3.828e26 },
    provenance: [source()],
  });
}

test("appearance validator accepts optional sections and freezes nested data", () => {
  const appearance = validAppearance();
  assert.equal(Object.isFrozen(appearance), true);
  assert.equal(Object.isFrozen(appearance.visibleLayer), true);
  assert.equal(Object.isFrozen(appearance.visibleLayer!.composition), true);
  assert.equal(Object.isFrozen(appearance.atmosphere!.optics), true);
  assert.equal(Object.isFrozen(appearance.provenance[0]), true);
  assert.doesNotThrow(() => validateCelestialAppearance(undefined));
  assert.doesNotThrow(() => validateCelestialAppearance({ schemaVersion: "1.0", provenance: [source()] }));
});

test("appearance validator rejects duplicate and non-normalized compositions", () => {
  const base = validAppearance();
  assert.throws(() => createCelestialAppearance({
    ...base,
    visibleLayer: { ...base.visibleLayer!, composition: [{ materialId: "basaltic-rock", fraction: 0.5 }, { materialId: "basaltic-rock", fraction: 0.5 }] },
  }), /duplicate identifier/);
  assert.throws(() => createCelestialAppearance({
    ...base,
    visibleLayer: { ...base.visibleLayer!, composition: [{ materialId: "basaltic-rock", fraction: 0.9 }] },
  }), /sum to 1/);
  assert.throws(() => createCelestialAppearance({
    ...base,
    atmosphere: { ...base.atmosphere!, gases: [{ gasId: "N2", mixingRatio: 0.9 }] },
  }), /sum to 1/);
});

test("appearance validator rejects optical, bulk, cloud, and stellar invariants", () => {
  const base = validAppearance();
  assert.throws(() => createCelestialAppearance({
    ...base,
    visibleLayer: { ...base.visibleLayer!, visualAlbedo: 1.1 },
  }), /visualAlbedo/);
  assert.throws(() => createCelestialAppearance({
    ...base,
    atmosphere: { ...base.atmosphere!, scaleHeightMeters: 0 },
  }), /scaleHeightMeters/);
  assert.throws(() => createCelestialAppearance({
    ...base,
    atmosphere: { ...base.atmosphere!, cloudLayers: [{ ...base.atmosphere!.cloudLayers[0]!, lowerAltitudeMeters: 2_000, upperAltitudeMeters: 1_000 }] },
  }), /upper altitude/);
  assert.throws(() => createCelestialAppearance({
    ...base,
    stellarEmission: { effectiveTemperatureKelvin: 10, luminosityWatts: 0 },
  }), /effectiveTemperatureKelvin/);
  assert.throws(() => createCelestialAppearance({
    ...base,
    stellarEmission: { effectiveTemperatureKelvin: 5_772, luminosityWatts: -1 },
  }), /luminosityWatts/);
});

test("committed representative bodies carry independent appearance records", () => {
  for (const id of [SUN_ID, EARTH_ID, VENUS_ID, MARS_ID, SATURN_ID, URANUS_ID, NEPTUNE_ID, TITAN_ID, VESTA_ID]) {
    const body = SCENARIO_BODIES.find((candidate) => candidate.id === id);
    assert.ok(body?.appearance, `missing appearance for ${id}`);
    assert.ok(body?.appearance?.provenance.length);
    assert.notEqual(body?.appearance, body?.provenance);
    assert.equal("appearance" in body!.properties, false);
  }
  assert.equal(SCENARIO_BODIES.find((body) => body.id === EARTH_ID)!.appearance!.atmosphere!.gases
    .reduce((sum, gas) => sum + gas.mixingRatio, 0), 1);
  assert.equal(SCENARIO_BODIES.find((body) => body.id === TITAN_ID)!.appearance!.atmosphere!.haze!.hazeId, "titan-organic-haze");
  assert.equal(SCENARIO_BODIES.find((body) => body.id === VESTA_ID)!.appearance!.atmosphere, undefined);
  assert.equal(SCENARIO_BODIES.find((body) => body.id === SUN_ID)!.appearance!.stellarEmission!.luminosityWatts, 3.828e26);
});

