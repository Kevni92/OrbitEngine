import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { revisionId, simulationInstant } from "orbit-engine";
import { SolarSystemScene } from "../src/rendering/solar-system-scene.js";
import {
  EARTH_ID,
  EUROPA_ID,
  JUPITER_ID,
  SCENARIO_BODIES,
  SCENARIO_OBJECT_IDS,
  SUN_CENTERED_FRAME,
  SUN_ID,
} from "../src/scenario/scenario-data.js";
import type { SolarSystemScenario } from "../src/scenario/load-solar-system.js";
import type { OrbitPath } from "../src/simulation/path-sampling.js";

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

function pathFor(objectId: typeof EARTH_ID | typeof EUROPA_ID, focusId: typeof SUN_ID | typeof JUPITER_ID): OrbitPath {
  const body = SCENARIO_BODIES.find((candidate) => candidate.id === objectId)!;
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

test("major planet orbits stay visible when planet bodies demote to markers", () => {
  const root = new THREE.Scene();
  const visual = new SolarSystemScene(root, scenario());
  visual.update(SCENARIO_BODIES.map((body) => body.anchor));
  visual.setPath(pathFor(EARTH_ID, SUN_ID));
  visual.setPath(pathFor(EUROPA_ID, JUPITER_ID));
  visual.setSelected(SUN_ID);
  visual.setFocusId(SUN_ID);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.0001, 10_000);
  camera.position.set(0, -900, 540);
  camera.lookAt(0, 0, 0);
  visual.updatePresentation(camera, 900);
  visual.updatePresentation(camera, 900);

  assert.equal(visual.representationFor(EARTH_ID), "marker");
  assert.equal(visual.representationFor(EUROPA_ID), "hidden");

  const earthOrbit = root.getObjectByName(`Orbit ${EARTH_ID}`);
  const europaOrbit = root.getObjectByName(`Orbit ${EUROPA_ID}`);
  assert.ok(earthOrbit instanceof THREE.Group);
  assert.ok(europaOrbit instanceof THREE.Group);
  assert.equal(earthOrbit.visible, true);
  assert.equal(europaOrbit.visible, false);

  const earthDiagnostics = visual.renderDiagnosticsFor(EARTH_ID, camera);
  assert.equal(earthDiagnostics?.orbitVisible, true);

  visual.setOrbitsVisible(false);
  assert.equal(earthOrbit.visible, true, "entry visibility remains eligible while the root orbit layer is disabled");
  assert.equal(visual.renderDiagnosticsFor(EARTH_ID, camera)?.orbitVisible, false);

  visual.dispose();
});
