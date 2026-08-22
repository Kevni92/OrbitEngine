import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { revisionId, simulationInstant, type ObjectId } from "orbit-engine";
import { OrbitRenderer } from "../src/rendering/orbit-renderer.js";
import { BatchedMarkerLayer } from "../src/rendering/runtime-asteroid-markers.js";
import { SolarSystemScene } from "../src/rendering/solar-system-scene.js";
import {
  EARTH_ID,
  MARS_ID,
  PHOBOS_ID,
  SCENARIO_BODIES,
  SCENARIO_OBJECT_IDS,
  SUN_CENTERED_FRAME,
  SUN_ID,
} from "../src/scenario/scenario-data.js";
import type { RegisteredScenarioBody, SolarSystemScenario } from "../src/scenario/load-solar-system.js";
import type { OrbitPath } from "../src/simulation/path-sampling.js";

function registeredBody(objectId: ObjectId): RegisteredScenarioBody {
  const definition = SCENARIO_BODIES.find((candidate) => candidate.id === objectId);
  if (definition === undefined) throw new Error(`Missing fixture body ${objectId}`);
  return {
    definition,
    record: { properties: definition.properties } as RegisteredScenarioBody["record"],
  };
}

function scenario(): SolarSystemScenario {
  const bodies = SCENARIO_BODIES.map((definition) => ({
    definition,
    record: { properties: definition.properties } as SolarSystemScenario["bodies"][number]["record"],
  }));
  return {
    epoch: bodies[0]!.definition.anchor.epoch,
    validity: { start: bodies[0]!.definition.anchor.epoch },
    provenance: {} as SolarSystemScenario["provenance"],
    catalog: {} as SolarSystemScenario["catalog"],
    centeredFrames: [],
    rootFrame: bodies[0]!.definition.propagation.propagationFrame,
    sunCenteredFrame: bodies[1]!.definition.propagation.propagationFrame,
    earthCenteredFrame: bodies[3]!.definition.propagation.propagationFrame,
    bodies,
    bodyById: new Map(bodies.map((body) => [body.definition.id, body])),
    objectIds: SCENARIO_OBJECT_IDS,
  };
}

function pathFor(objectId: ObjectId, focusId: ObjectId): OrbitPath {
  const body = SCENARIO_BODIES.find((candidate) => candidate.id === objectId);
  if (body === undefined) throw new Error(`Missing fixture body ${objectId}`);
  return {
    objectId,
    focusId,
    outputFrame: SUN_CENTERED_FRAME,
    interval: { start: simulationInstant(0), end: simulationInstant(1) },
    sampleCount: 2,
    motionRevision: revisionId("1"),
    configurationRevision: revisionId("1"),
    samples: [
      { instant: simulationInstant(0), state: body.anchor },
      { instant: simulationInstant(1), state: body.anchor },
    ],
  };
}

function displayColor(objectId: ObjectId): number {
  const body = SCENARIO_BODIES.find((candidate) => candidate.id === objectId);
  if (body === undefined) throw new Error(`Missing fixture body ${objectId}`);
  return body.display.color;
}

test("batched markers retain each body's configured display color", () => {
  const root = new THREE.Scene();
  const layer = new BatchedMarkerLayer(root);
  const entries = [registeredBody(SUN_ID), registeredBody(EARTH_ID), registeredBody(MARS_ID)];
  layer.setBodies(entries, new Map([
    [SUN_ID, new THREE.Vector3(0, 0, 0)],
    [EARTH_ID, new THREE.Vector3(1, 0, 0)],
    [MARS_ID, new THREE.Vector3(2, 0, 0)],
  ]));

  const points = root.getObjectByName("Runtime asteroid markers");
  assert.ok(points instanceof THREE.Points);
  const colors = points.geometry.getAttribute("color");
  assert.ok(colors instanceof THREE.BufferAttribute);
  assert.equal(colors.count, entries.length);
  assert.equal(points.material instanceof THREE.ShaderMaterial, true);
  assert.equal((points.material as THREE.ShaderMaterial).uniforms.uColor, undefined,
    "one global gray marker color must not control the whole batch");

  entries.forEach((entry, index) => {
    const expected = new THREE.Color(entry.definition.display.color);
    assert.ok(Math.abs(colors.getX(index) - expected.r) < 1e-6);
    assert.ok(Math.abs(colors.getY(index) - expected.g) < 1e-6);
    assert.ok(Math.abs(colors.getZ(index) - expected.b) < 1e-6);
  });

  layer.dispose();
});

test("orbit base and selected highlight use body hue with depth testing", () => {
  const root = new THREE.Scene();
  const renderer = new OrbitRenderer(root);
  const marsColor = displayColor(MARS_ID);
  renderer.setPath(pathFor(MARS_ID, SUN_ID), marsColor);
  renderer.setSelected(MARS_ID);

  const group = root.getObjectByName(`Orbit ${MARS_ID}`);
  assert.ok(group instanceof THREE.Group);
  const baseLine = group.children[0];
  const highlightLine = group.children[1];
  assert.ok(baseLine instanceof THREE.LineLoop);
  assert.ok(highlightLine instanceof THREE.LineLoop);
  assert.ok(baseLine.material instanceof THREE.LineBasicMaterial);
  assert.ok(highlightLine.material instanceof THREE.ShaderMaterial);

  assert.equal(baseLine.material.color.getHex(), new THREE.Color(marsColor).getHex());
  assert.equal(baseLine.material.depthTest, true);
  assert.equal(baseLine.material.depthWrite, false);
  assert.equal(highlightLine.material.depthTest, true,
    "selected orbit highlights must be occluded by opaque body depth");
  assert.equal(highlightLine.material.depthWrite, false);
  const highlightColor = highlightLine.material.uniforms.uColor?.value;
  assert.ok(highlightColor instanceof THREE.Color);
  assert.equal(highlightColor.getHex(), new THREE.Color(marsColor).getHex());

  renderer.dispose();
});

test("selecting a direct moon keeps the parent planet orbit visible", () => {
  const root = new THREE.Scene();
  const visual = new SolarSystemScene(root, scenario());
  visual.update(SCENARIO_BODIES.map((body) => body.anchor));
  visual.setPath(pathFor(MARS_ID, SUN_ID));
  visual.setPath(pathFor(PHOBOS_ID, MARS_ID));
  visual.setSelected(PHOBOS_ID);
  visual.setFocusId(PHOBOS_ID);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.000001, 10_000);
  camera.position.set(0, -4, 2);
  camera.lookAt(0, 0, 0);
  visual.updatePresentation(camera, 900);

  const marsOrbit = root.getObjectByName(`Orbit ${MARS_ID}`);
  const phobosOrbit = root.getObjectByName(`Orbit ${PHOBOS_ID}`);
  assert.ok(marsOrbit instanceof THREE.Group);
  assert.ok(phobosOrbit instanceof THREE.Group);
  assert.equal(marsOrbit.visible, true);
  assert.equal(phobosOrbit.visible, true);
  assert.equal(visual.orbitGuideDiagnostics().find((orbit) => orbit.objectId === PHOBOS_ID)?.role, "selected");
  assert.equal(visual.selectedOrbitActive(), true);

  visual.dispose();
});
