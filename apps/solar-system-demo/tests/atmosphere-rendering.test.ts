import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import {
  ATMOSPHERE_ENTER_DIAMETER_PIXELS,
  ATMOSPHERE_EXIT_DIAMETER_PIXELS,
  ATMOSPHERE_MAX_RIM_FRACTION,
  ATMOSPHERE_PHYSICAL_EXTENT_SCALE_HEIGHTS,
  ATMOSPHERE_RIM_THICKNESS_CSS_PIXELS,
  ATMOSPHERE_VIEW_SAMPLES,
  AtmosphereShellManager,
  atmosphereLodState,
  atmosphereViewPathLength,
  presentationAltitudeScaleHeights,
  presentationAtmosphereThickness,
  resolveAtmosphereOptics,
} from "../src/rendering/atmosphere-rendering.js";
import { resolveStellarIllumination } from "../src/rendering/celestial-appearance-rendering.js";
import { createCelestialAppearance } from "../src/scenario/celestial-appearance.js";
import { EARTH_ID, SCENARIO_BODIES, SUN_ID } from "../src/scenario/scenario-data.js";
import { positionToSceneUnits } from "../src/rendering/render-space.js";
import { objectId } from "orbit-engine";
import type { RegisteredScenarioBody } from "../src/scenario/load-solar-system.js";

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

test("presentation shell altitude maps back to physical scale heights independent of shell inflation", () => {
  const thinShellMidpoint = presentationAltitudeScaleHeights(1.05, 1, 1.1);
  const inflatedShellMidpoint = presentationAltitudeScaleHeights(1.25, 1, 1.5);
  assert.ok(Math.abs(thinShellMidpoint - ATMOSPHERE_PHYSICAL_EXTENT_SCALE_HEIGHTS / 2) < 1e-12);
  assert.ok(Math.abs(inflatedShellMidpoint - ATMOSPHERE_PHYSICAL_EXTENT_SCALE_HEIGHTS / 2) < 1e-12);
  assert.equal(presentationAltitudeScaleHeights(1, 1, 1.5), 0);
  assert.equal(
    presentationAltitudeScaleHeights(1.5, 1, 1.5),
    ATMOSPHERE_PHYSICAL_EXTENT_SCALE_HEIGHTS,
  );
});

test("atmosphere view path increases strongly toward the body limb", () => {
  const radialPath = atmosphereViewPathLength(1, 1.08, 0);
  const grazingPath = atmosphereViewPathLength(1, 1.08, 1);
  assert.ok(Math.abs(radialPath - 0.08) < 1e-12);
  assert.ok(grazingPath > radialPath * 5);
  assert.equal(atmosphereViewPathLength(1, 1.08, 1.08), 0);
});

test("atmosphere shell resources are allocated only for forced sphere bodies and use bounded ray-shell shader work", () => {
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
  assert.equal(active.physicalExtentScaleHeights, ATMOSPHERE_PHYSICAL_EXTENT_SCALE_HEIGHTS);
  const mesh = scene.getObjectByName(`Atmosphere ${EARTH_ID}`) as THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  assert.ok(mesh.material.fragmentShader.includes(`const int VIEW_SAMPLES = ${ATMOSPHERE_VIEW_SAMPLES};`));
  assert.ok(mesh.material.fragmentShader.includes("raySphereInterval"));
  assert.ok(mesh.material.fragmentShader.includes("uLightChromaticities"));
  assert.ok(mesh.material.fragmentShader.includes("altitudeScaleHeights"));
  assert.ok(mesh.material.fragmentShader.includes("bodyOccludesShell"));
  assert.equal(mesh.material.fragmentShader.includes("while"), false);
  assert.equal(mesh.material.fragmentShader.includes("uScaleHeight"), false);
  assert.equal(mesh.material.fragmentShader.includes("DISPLAY_CHROMATICITY"), false);
  assert.equal(mesh.material.fragmentShader.includes("* 4.0"), false);
  assert.equal(mesh.material.fragmentShader.includes("* 0.3"), false);
  assert.equal(mesh.material.premultipliedAlpha, true);
  assert.equal(mesh.material.blending, THREE.NormalBlending);

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

test("atmosphere shader directions use the render-world vector exactly once", () => {
  const earthDefinition = SCENARIO_BODIES.find((body) => body.id === EARTH_ID)!;
  const entry = {
    definition: earthDefinition,
    record: { properties: earthDefinition.properties },
  } as never;
  const bodyPosition = positionToSceneUnits(earthDefinition.anchor.position);
  const scene = new THREE.Scene();
  const manager = new AtmosphereShellManager(scene);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 10_000);
  camera.position.set(bodyPosition.x, bodyPosition.y - 1, bodyPosition.z + 0.6);
  camera.lookAt(bodyPosition.x, bodyPosition.y, bodyPosition.z);
  const illumination = resolveStellarIllumination(
    { x: 0, y: 0, z: 0 },
    [{
      objectId: SUN_ID,
      position: { x: 0, y: 1, z: 0 },
      effectiveTemperatureKelvin: 5_772,
      luminosityWatts: 4 * Math.PI,
    }],
  );
  manager.update(
    [entry],
    new Map([[EARTH_ID, "sphere"]]),
    new Map([[EARTH_ID, new THREE.Vector3(bodyPosition.x, bodyPosition.y, bodyPosition.z)]]),
    new Map([[EARTH_ID, 0.02]]),
    camera,
    900,
    new Set([EARTH_ID]),
    new Map([[EARTH_ID, illumination]]),
  );
  const mesh = scene.getObjectByName(`Atmosphere ${EARTH_ID}`) as THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  const shaderDirection = (mesh.material.uniforms.uLightDirections!.value as THREE.Vector3[])[0]!;
  const contribution = illumination.contributions[0]!;
  assert.ok(Math.abs(shaderDirection.x - contribution.renderDirectionToEmitter.x) < 1e-12);
  assert.ok(Math.abs(shaderDirection.y - contribution.renderDirectionToEmitter.y) < 1e-12);
  assert.ok(Math.abs(shaderDirection.z - contribution.renderDirectionToEmitter.z) < 1e-12);
  assert.deepEqual(manager.diagnosticsFor(EARTH_ID).shaderLightDirections, [{
    emitterId: SUN_ID,
    physicalDirectionToEmitter: contribution.directionToEmitter,
    shaderDirectionToEmitter: contribution.renderDirectionToEmitter,
  }]);
  manager.dispose();
});

test("large marker-only atmospheric populations allocate no per-object shell resources", () => {
  const earthDefinition = SCENARIO_BODIES.find((body) => body.id === EARTH_ID)!;
  const entries = Array.from({ length: 512 }, (_, index) => {
    const id = objectId(String(9_000_000_000_000_000_000n + BigInt(index)));
    return {
      definition: { ...earthDefinition, id, name: `Synthetic atmospheric marker ${index}` },
      record: { properties: earthDefinition.properties },
    } as RegisteredScenarioBody;
  });
  const scene = new THREE.Scene();
  const manager = new AtmosphereShellManager(scene);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 10_000);
  camera.position.set(0, -30, 18);
  const representations = new Map(entries.map((entry) => [entry.definition.id, "marker" as const]));
  const positions = new Map(entries.map((entry, index) => [entry.definition.id, new THREE.Vector3(index * 0.01, 0, 0)]));
  const radii = new Map(entries.map((entry) => [entry.definition.id, 0.02]));
  manager.update(entries, representations, positions, radii, camera, 900, new Set(), new Map());
  assert.equal(manager.resourceCount(), 0);
  assert.equal(scene.children.filter((child) => child.name.startsWith("Atmosphere ")).length, 0);
  manager.dispose();
});
