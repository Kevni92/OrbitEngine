import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { meters, revisionId, simulationInstant } from "orbit-engine";
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

test("resolved child orbits keep their parent anchor while presentation radius changes", () => {
  const root = new THREE.Scene();
  const visual = new SolarSystemScene(root, scenario());
  const states = SCENARIO_BODIES.map((body) => body.anchor);
  visual.update(states);
  visual.setPath(pathFor(EUROPA_ID, JUPITER_ID));
  visual.setFocusId(JUPITER_ID);
  visual.setSelected(EUROPA_ID);

  const jupiterPosition = visual.positionFor(JUPITER_ID)!;
  const camera = new THREE.PerspectiveCamera(45, 1, 0.0001, 10_000);
  camera.position.copy(jupiterPosition).add(new THREE.Vector3(0, -1.6, 0.96));
  camera.lookAt(jupiterPosition);
  visual.updatePresentation(camera, 900);

  const orbitGroup = root.getObjectByName(`Orbit ${EUROPA_ID}`);
  assert.ok(orbitGroup instanceof THREE.Group);
  assert.equal(orbitGroup.visible, true);
  assert.deepEqual(orbitGroup.position.toArray(), [0, 0, 0]);
  const orbitLine = orbitGroup.children[0] as THREE.LineLoop;
  const originalGeometry = Array.from((orbitLine.geometry.getAttribute("position") as THREE.BufferAttribute).array);
  const selected = visual.orbitGuideDiagnostics().find((orbit) => orbit.objectId === EUROPA_ID)!;
  assert.equal(selected.kind, "child");
  assert.equal(selected.opacity, 1);

  visual.setRadiusMode("physical");
  visual.updatePresentation(camera, 900);
  assert.deepEqual(
    Array.from((orbitLine.geometry.getAttribute("position") as THREE.BufferAttribute).array),
    originalGeometry,
  );

  const translatedStates = states.map((state, index) => index === SCENARIO_BODIES.findIndex((body) => body.id === JUPITER_ID)
    ? {
        ...state,
        position: {
          x: meters(state.position.x + 10_000_000),
          y: meters(state.position.y - 20_000_000),
          z: meters(state.position.z + 30_000_000),
        },
      }
    : state);
  visual.update(translatedStates);
  const movedJupiterPosition = visual.positionFor(JUPITER_ID)!;
  assert.deepEqual(orbitGroup.position.toArray(), [0, 0, 0]);
  const movedGeometry = Array.from((orbitLine.geometry.getAttribute("position") as THREE.BufferAttribute).array);
  const delta = movedJupiterPosition.clone().sub(jupiterPosition);
  const originalPoint = new THREE.Vector3(originalGeometry[0]!, originalGeometry[1]!, originalGeometry[2]!);
  const movedPoint = new THREE.Vector3(movedGeometry[0]!, movedGeometry[1]!, movedGeometry[2]!);
  assert.ok(movedPoint.distanceTo(originalPoint.add(delta)) < 1e-4);

  visual.setSelected(undefined);
  assert.equal(visual.orbitGuideDiagnostics().find((orbit) => orbit.objectId === EUROPA_ID)?.opacity, 0.3);
  visual.dispose();
});
