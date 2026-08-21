import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { positionToSceneUnits } from "../src/rendering/render-space.js";
import { SolarSystemScene } from "../src/rendering/solar-system-scene.js";
import { objectId, referenceFrameId, revisionId, simulationInstant } from "orbit-engine";
import type { OrbitPath } from "../src/simulation/path-sampling.js";
import { SCENARIO_BODIES, SCENARIO_OBJECT_IDS, SUN_ID } from "../src/scenario/scenario-data.js";
import type { SolarSystemScenario } from "../src/scenario/load-solar-system.js";

function scenario(): SolarSystemScenario {
  const bodies = SCENARIO_BODIES.map((definition) => ({
    definition,
    record: { properties: definition.properties } as SolarSystemScenario["bodies"][number]["record"],
  }));
  return {
    epoch: bodies[0]!.definition.anchor.epoch,
    validity: { start: bodies[0]!.definition.anchor.epoch },
    provenance: {} as SolarSystemScenario["provenance"],
    rootFrame: bodies[0]!.definition.propagationFrame,
    sunCenteredFrame: bodies[1]!.definition.propagationFrame,
    earthCenteredFrame: bodies[3]!.definition.propagationFrame,
    bodies,
    bodyById: new Map(bodies.map((body) => [body.definition.id, body])),
    objectIds: SCENARIO_OBJECT_IDS,
  };
}

test("scene keys meshes by stable ObjectId and consumes returned positions", () => {
  const root = new THREE.Scene();
  const visual = new SolarSystemScene(root, scenario());
  const states = SCENARIO_BODIES.map((body) => body.anchor);
  visual.update(states);

  const earth = SCENARIO_BODIES.find((body) => body.name === "Earth")!;
  const earthMesh = visual.meshFor(earth.id)!;
  assert.equal(earthMesh.userData.objectId, earth.id);
  const expected = positionToSceneUnits(earth.anchor.position);
  assert.deepEqual(earthMesh.position.toArray(), [expected.x, expected.y, expected.z]);

  visual.setSelected(SUN_ID);
  assert.equal(visual.selectedObjectId(), SUN_ID);
  visual.setRadiusMode("physical");
  assert.ok(visual.stateFor(SUN_ID) !== undefined);
  const path: OrbitPath = {
    objectId: SUN_ID,
    focusId: objectId("1000"),
    outputFrame: referenceFrameId("1"),
    interval: { start: simulationInstant(0), end: simulationInstant(10) },
    sampleCount: 2,
    motionRevision: revisionId("1"),
    configurationRevision: revisionId("1"),
    samples: [
      { instant: simulationInstant(0), state: SCENARIO_BODIES[0]!.anchor },
      { instant: simulationInstant(1), state: SCENARIO_BODIES[0]!.anchor },
    ],
  };
  visual.setPath(path);
  assert.equal(visual.pathCount(), 1);
  visual.clearPaths();
  assert.equal(visual.pathCount(), 0);
  visual.dispose();
  assert.equal(visual.meshFor(SUN_ID), undefined);
});
