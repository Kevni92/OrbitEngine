import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import {
  ATMOSPHERE_ENTER_DIAMETER_PIXELS,
  ATMOSPHERE_EXIT_DIAMETER_PIXELS,
  ATMOSPHERE_MAX_RIM_FRACTION,
  ATMOSPHERE_RIM_THICKNESS_CSS_PIXELS,
  ATMOSPHERE_VIEW_SAMPLES,
  AtmosphereShellManager,
  atmosphereLodState,
  presentationAtmosphereThickness,
  resolveAtmosphereOptics,
} from "../src/rendering/atmosphere-rendering.js";
import { createCelestialAppearance } from "../src/scenario/celestial-appearance.js";
import { EARTH_ID, SCENARIO_BODIES } from "../src/scenario/scenario-data.js";
import { positionToSceneUnits } from "../src/rendering/render-space.js";

test("atmosphere optics prefer explicit calibration and distinguish gas/haze fallbacks", () => {
  const earth = SCENARIO_BODIES.find((body) => body.id === EARTH_ID)!;
  assert.equal(resolveAtmosphereOptics(earth.appearance)?.source, "explicit");
  const gasOnly = createCelestialAppearance({
    schemaVersion: "1.0",
    atmosphere: {
      referencePressurePa: 1,
      scaleHeightMeters: 1,
      gases: [{ gasId: "N2", mixingRatio: 1 }],
      cloudLayers: [],
    },
    provenance: [{ source: "test", sourceIdentifier: "test:gas", fields: ["atmosphere"], normalization: "SI", limitations: "test" }],
  });
  assert.equal(resolveAtmosphereOptics(gasOnly)?.source, "gas-library");
  const unknownOnly = createCelestialAppearance({
    schemaVersion: "1.0",
    atmosphere: {
      referencePressurePa: 1,
      scaleHeightMeters: 1,
      gases: [{ gasId: "unknown", mixingRatio: 1 }],
      cloudLayers: [],
    },
    provenance: [{ source: "test", sourceIdentifier: "test:unknown", fields: ["atmosphere"], normalization: "SI", limitations: "test" }],
  });
  assert.equal(resolveAtmosphereOptics(unknownOnly)?.source, "zero-fallback");
});

test("atmosphere LOD uses fixed thresholds, hysteresis, and force override", () => {
  assert.equal(atmosphereLodState(undefined, ATMOSPHERE_ENTER_DIAMETER_PIXELS - 0.01, false).enabled, false);
  assert.equal(atmosphereLodState(undefined, ATMOSPHERE_ENTER_DIAMETER_PIXELS, false).enabled, true);
  assert.equal(atmosphereLodState(true, ATMOSPHERE_EXIT_DIAMETER_PIXELS, false).enabled, true);
  assert.equal(atmosphereLodState(true, ATMOSPHERE_EXIT_DIAMETER_PIXELS - 0.01, false).enabled, false);
  assert.equal(atmosphereLodState(undefined, 0, true).enabled, true);
});

test("presentation atmosphere thickness is readable but capped and non-authoritative", () => {
  const thickness = presentationAtmosphereThickness(0.001, 1, 100);
  assert.equal(thickness, ATMOSPHERE_MAX_RIM_FRACTION);
  const minimum = presentationAtmosphereThickness(0, 1, 100);
  assert.equal(minimum, ATMOSPHERE_RIM_THICKNESS_CSS_PIXELS / 100);
  assert.throws(() => presentationAtmosphereThickness(1, 0, 100), /dimensions/);
});

test("atmosphere shell resources are allocated only for forced sphere bodies and use bounded shader work", () => {
  const earthDefinition = SCENARIO_BODIES.find((body) => body.id === EARTH_ID)!;
  const entry = {
    definition: earthDefinition,
    record: { properties: earthDefinition.properties },
  } as never;
  const position = positionToSceneUnits(earthDefinition.anchor.position);
  const scene = new THREE.Scene();
  const manager = new AtmosphereShellManager(scene);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 10_000);
  camera.position.set(position.x, position.y - 1, position.z + 0.6);
  camera.lookAt(position.x, position.y, position.z);
  manager.update(
    [entry],
    new Map([[EARTH_ID, "sphere"]]),
    new Map([[EARTH_ID, new THREE.Vector3(position.x, position.y, position.z)]]),
    new Map([[EARTH_ID, 0.02]]),
    camera,
    900,
    new Set([EARTH_ID]),
    new Map(),
  );
  const active = manager.diagnosticsFor(EARTH_ID);
  assert.equal(active.resourcesAllocated, true);
  assert.equal(active.visible, true);
  assert.equal(active.viewSampleCount, ATMOSPHERE_VIEW_SAMPLES);
  const mesh = scene.getObjectByName(`Atmosphere ${EARTH_ID}`) as THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  assert.ok(mesh.material.fragmentShader.includes(`const int VIEW_SAMPLES = ${ATMOSPHERE_VIEW_SAMPLES};`));
  assert.equal(mesh.material.fragmentShader.includes("while"), false);

  manager.update(
    [entry],
    new Map([[EARTH_ID, "marker"]]),
    new Map([[EARTH_ID, new THREE.Vector3(position.x, position.y, position.z)]]),
    new Map(),
    camera,
    900,
    new Set(),
    new Map(),
  );
  assert.equal(manager.diagnosticsFor(EARTH_ID).resourcesAllocated, false);
  assert.equal(manager.resourceCount(), 0);
  manager.dispose();
});

