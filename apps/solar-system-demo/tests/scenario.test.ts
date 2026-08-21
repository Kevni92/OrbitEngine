import assert from "node:assert/strict";
import test from "node:test";
import {
  APOPHIS_ID,
  CERES_ID,
  EARTH_CENTERED_FRAME,
  EARTH_ID,
  EUROPA_ID,
  MARS_ID,
  JUPITER_ID,
  MOON_ID,
  SCENARIO_BODIES,
  SCENARIO_CENTERED_FRAMES,
  SCENARIO_OBJECT_IDS,
  SCENARIO_PROVENANCE,
  SCENARIO_ROOT_FRAME,
  SUN_CENTERED_FRAME,
  SUN_ID,
} from "../src/scenario/scenario-data.js";
import { createCelestialCatalog } from "../src/scenario/celestial-catalog.js";

test("scenario contains a unique offline catalog with representative categories", () => {
  const catalog = createCelestialCatalog(SCENARIO_BODIES, SCENARIO_CENTERED_FRAMES);
  assert.equal(SCENARIO_BODIES.length, 48);
  assert.equal(new Set(SCENARIO_OBJECT_IDS).size, 48);
  assert.equal(catalog.roots.length, 1);
  assert.equal(catalog.roots[0], SUN_ID);
  assert.equal(catalog.bodyById.get(SUN_ID)?.propagation.propagationFrame, SCENARIO_ROOT_FRAME);
  assert.equal(catalog.bodyById.get(EARTH_ID)?.propagation.propagationFrame, SUN_CENTERED_FRAME);
  assert.equal(catalog.bodyById.get(MOON_ID)?.propagation.propagationFrame, EARTH_CENTERED_FRAME);
  assert.equal(catalog.parentOf(EUROPA_ID), JUPITER_ID);
  assert.equal(catalog.bodyById.get(CERES_ID)?.display.category, "dwarfPlanet");
  assert.equal(catalog.bodyById.get(APOPHIS_ID)?.display.category, "asteroid");
  assert.ok(catalog.childrenOf(MARS_ID).length >= 2);
  assert.deepEqual([
    "Moon", "Phobos", "Deimos", "Io", "Europa", "Ganymede", "Callisto", "Amalthea",
    "Mimas", "Enceladus", "Tethys", "Dione", "Rhea", "Titan", "Hyperion", "Iapetus", "Phoebe",
    "Miranda", "Ariel", "Umbriel", "Titania", "Oberon", "Triton", "Nereid", "Proteus", "Larissa", "Charon",
  ].every((name) => SCENARIO_BODIES.some((body) => body.name === name)), true);
});

test("catalog search and registration order are source-order independent", () => {
  const catalog = createCelestialCatalog(SCENARIO_BODIES, SCENARIO_CENTERED_FRAMES);
  const reversed = createCelestialCatalog([...SCENARIO_BODIES].reverse(), [...SCENARIO_CENTERED_FRAMES].reverse());
  assert.deepEqual(reversed.registrationOrder, catalog.registrationOrder);
  assert.deepEqual(catalog.search("101955"), [SCENARIO_BODIES.find((body) => body.name === "Bennu")!.id]);
  assert.deepEqual(catalog.search("pluto i"), [SCENARIO_BODIES.find((body) => body.name === "Charon")!.id]);
  assert.deepEqual(catalog.byCategory.get("asteroid")?.length, 7);
});

test("catalog rejects duplicate IDs, missing parents, self-parents, and cycles", () => {
  const sun = SCENARIO_BODIES.find((body) => body.id === SUN_ID)!;
  const earth = SCENARIO_BODIES.find((body) => body.id === EARTH_ID)!;
  const moon = SCENARIO_BODIES.find((body) => body.id === MOON_ID)!;
  const frames = SCENARIO_CENTERED_FRAMES.slice(0, 2);
  assert.throws(() => createCelestialCatalog([sun, earth, sun], frames), /Duplicate catalog ObjectId/);
  assert.throws(() => createCelestialCatalog([sun, { ...earth, centralBody: "9999" as typeof SUN_ID }], frames), /unknown central body/);
  assert.throws(() => createCelestialCatalog([sun, { ...moon, centralBody: MOON_ID }], frames), /own central body/);
  assert.throws(() => createCelestialCatalog([sun, { ...earth, centralBody: MOON_ID }, { ...moon, centralBody: EARTH_ID }], frames), /central-body cycle/);
});

test("scenario definitions carry normalized physical and per-body provenance data", () => {
  assert.ok(SCENARIO_BODIES.every((body) => body.properties.mass !== undefined));
  assert.ok(SCENARIO_BODIES.every((body) => body.properties.mu !== undefined));
  assert.ok(SCENARIO_BODIES.every((body) => body.properties.physicalRadius !== undefined));
  assert.ok(SCENARIO_BODIES.every((body) => body.provenance.sourceUrl.startsWith("https://")));
  assert.equal(SCENARIO_PROVENANCE.retrievalDate, "2026-08-21");
  assert.equal(SCENARIO_PROVENANCE.sourceEpoch, "J2000 TDB");
  assert.match(SCENARIO_PROVENANCE.limitations, /educational fixture/);
  const sun = SCENARIO_BODIES.find((body) => body.id === SUN_ID)!;
  const earth = SCENARIO_BODIES.find((body) => body.id === EARTH_ID)!;
  const moon = SCENARIO_BODIES.find((body) => body.id === MOON_ID)!;
  assert.equal(sun.centralBody, undefined);
  assert.equal(earth.centralBody, SUN_ID);
  assert.equal(earth.provenance.sourceIdentifier, "399 Earth");
  assert.match(earth.provenance.limitations, /not a precision long-term ephemeris/);
  assert.equal(moon.centralBody, EARTH_ID);
});
