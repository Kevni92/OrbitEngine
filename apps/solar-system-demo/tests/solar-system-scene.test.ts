import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { positionToSceneUnits } from "../src/rendering/render-space.js";
import {
  MAX_FOCUS_DISTANCE_SCENE_UNITS,
  MIN_FOCUS_DISTANCE_SCENE_UNITS,
  SolarSystemScene,
} from "../src/rendering/solar-system-scene.js";
import { referenceFrameId, revisionId, simulationInstant } from "orbit-engine";
import type { OrbitPath } from "../src/simulation/path-sampling.js";
import {
  EARTH_ID,
  SCENARIO_BODIES,
  SCENARIO_OBJECT_IDS,
  SUN_CENTERED_FRAME,
  SUN_ID,
} from "../src/scenario/scenario-data.js";
import type { SolarSystemScenario } from "../src/scenario/load-solar-system.js";

const FLOAT32_SCENE_POSITION_TOLERANCE = 1e-4;

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

test("scene keys meshes by stable ObjectId and consumes returned positions", () => {
  const root = new THREE.Scene();
  const visual = new SolarSystemScene(root, scenario());
  const states = SCENARIO_BODIES.map((body) => body.anchor);
  const earth = SCENARIO_BODIES.find((body) => body.id === EARTH_ID)!;
  const rawEarthPosition = { ...earth.anchor.position };
  visual.update(states);

  const earthMesh = visual.meshFor(earth.id)!;
  assert.equal(earthMesh.userData.objectId, earth.id);
  const expected = positionToSceneUnits(earth.anchor.position);
  assert.deepEqual(earthMesh.position.toArray(), [expected.x, expected.y, expected.z]);
  assert.deepEqual(earth.anchor.position, rawEarthPosition);

  visual.setSelected(SUN_ID);
  assert.equal(visual.selectedObjectId(), SUN_ID);
  visual.setRadiusMode("physical");
  assert.ok(visual.stateFor(SUN_ID) !== undefined);
  const focusDistance = visual.focusDistanceFor(EARTH_ID);
  assert.ok(focusDistance >= MIN_FOCUS_DISTANCE_SCENE_UNITS);
  assert.ok(focusDistance <= MAX_FOCUS_DISTANCE_SCENE_UNITS);
  assert.throws(() => visual.focusDistanceFor("999999" as typeof SUN_ID), /Unknown scenario body/);

  const path: OrbitPath = {
    objectId: EARTH_ID,
    focusId: SUN_ID,
    outputFrame: SUN_CENTERED_FRAME,
    interval: { start: simulationInstant(0), end: simulationInstant(10) },
    sampleCount: 2,
    motionRevision: revisionId("1"),
    configurationRevision: revisionId("1"),
    samples: [
      { instant: simulationInstant(0), state: earth.anchor },
      { instant: simulationInstant(1), state: earth.anchor },
    ],
  };
  visual.setPath(path);
  assert.equal(visual.pathCount(), 1);

  const orbitGroup = root.getObjectByName(`Orbit ${EARTH_ID}`);
  assert.ok(orbitGroup instanceof THREE.Group);
  const orbitLine = orbitGroup.children[0];
  assert.ok(orbitLine instanceof THREE.LineLoop);
  const positions = orbitLine.geometry.getAttribute("position");
  const firstOrbitPoint = new THREE.Vector3(
    positions.getX(0),
    positions.getY(0),
    positions.getZ(0),
  ).add(orbitGroup.position);
  // BufferGeometry position attributes are Float32, while body mesh positions
  // retain JavaScript double precision. They must coincide within GPU geometry precision.
  assert.ok(firstOrbitPoint.distanceTo(earthMesh.position) < FLOAT32_SCENE_POSITION_TOLERANCE);

  visual.clearPaths();
  assert.equal(visual.pathCount(), 0);
  visual.dispose();
  assert.equal(visual.meshFor(SUN_ID), undefined);
});

test("scene accepts paths in arbitrary declared output frames", () => {
  const root = new THREE.Scene();
  const visual = new SolarSystemScene(root, scenario());
  const sun = SCENARIO_BODIES.find((body) => body.id === SUN_ID)!;
  const path: OrbitPath = {
    objectId: SUN_ID,
    focusId: SUN_ID,
    outputFrame: referenceFrameId("1"),
    interval: { start: simulationInstant(0), end: simulationInstant(1) },
    sampleCount: 2,
    motionRevision: revisionId("1"),
    configurationRevision: revisionId("1"),
    samples: [
      { instant: simulationInstant(0), state: sun.anchor },
      { instant: simulationInstant(1), state: sun.anchor },
    ],
  };
  visual.setPath(path);
  assert.equal(visual.pathCount(), 1);
  visual.dispose();
});
