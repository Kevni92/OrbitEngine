import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { revisionId, simulationInstant, type ObjectId } from "orbit-engine";
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
