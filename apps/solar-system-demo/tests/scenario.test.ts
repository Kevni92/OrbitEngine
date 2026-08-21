import assert from "node:assert/strict";
import test from "node:test";
import {
  EARTH_ID,
  MOON_ID,
  SCENARIO_BODIES,
  SCENARIO_OBJECT_IDS,
  SCENARIO_PROVENANCE,
  SCENARIO_ROOT_FRAME,
  SUN_ID,
  SUN_CENTERED_FRAME,
  EARTH_CENTERED_FRAME,
} from "../src/scenario/scenario-data.js";

test("scenario contains the exact offline Sun, eight planets, and Moon fixture", () => {
  assert.equal(SCENARIO_BODIES.length, 10);
  assert.deepEqual(new Set(SCENARIO_OBJECT_IDS).size, 10);
  assert.deepEqual(new Set(SCENARIO_BODIES.map((body) => body.name)), new Set([
    "Sun", "Mercury", "Venus", "Earth", "Moon", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune",
  ]));
  assert.equal(SCENARIO_BODIES.find((body) => body.id === SUN_ID)?.propagationFrame, SCENARIO_ROOT_FRAME);
  assert.equal(SCENARIO_BODIES.find((body) => body.id === EARTH_ID)?.propagationFrame, SUN_CENTERED_FRAME);
  assert.equal(SCENARIO_BODIES.find((body) => body.id === MOON_ID)?.propagationFrame, EARTH_CENTERED_FRAME);
});

test("scenario declares central-body dependencies and normalized provenance", () => {
  const sun = SCENARIO_BODIES.find((body) => body.id === SUN_ID)!;
  const earth = SCENARIO_BODIES.find((body) => body.id === EARTH_ID)!;
  const moon = SCENARIO_BODIES.find((body) => body.id === MOON_ID)!;
  assert.equal(sun.centralBody, undefined);
  assert.equal(earth.centralBody, SUN_ID);
  assert.equal(moon.centralBody, EARTH_ID);
  assert.ok(SCENARIO_BODIES.every((body) => body.properties.mass !== undefined));
  assert.ok(SCENARIO_BODIES.every((body) => body.properties.mu !== undefined));
  assert.ok(SCENARIO_BODIES.every((body) => body.properties.physicalRadius !== undefined));
  assert.equal(SCENARIO_PROVENANCE.retrievalDate, "2026-08-21");
  assert.equal(SCENARIO_PROVENANCE.sourceEpoch, "J2000 TDB");
  assert.match(SCENARIO_PROVENANCE.limitations, /educational fixture/);
  assert.ok(SCENARIO_PROVENANCE.sourceUrls.every((url) => url.startsWith("https://")));
});
