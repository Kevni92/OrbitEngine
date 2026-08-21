import assert from "node:assert/strict";
import test from "node:test";
import {
  meters,
  metersPerSecond,
  propagationState,
  referenceFrameId,
  revisionId,
  simulationInstant,
  objectId,
  type ObjectId,
} from "orbit-engine";
import { SCENARIO_BODIES, SCENARIO_OBJECT_IDS, SCENARIO_ROOT_FRAME, SCENARIO_VALIDITY, SUN_ID, EARTH_ID } from "../src/scenario/scenario-data.js";
import type { SolarSystemScenario } from "../src/scenario/load-solar-system.js";
import { PathCache } from "../src/simulation/path-sampling.js";
import { createOrbitPath } from "../src/simulation/orbit-visualization.js";

function scenario(): SolarSystemScenario {
  const bodies = SCENARIO_BODIES.map((definition) => ({
    definition,
    record: {
      motion: { motionRevision: revisionId("1"), configurationRevision: revisionId("1") },
      properties: definition.properties,
    } as SolarSystemScenario["bodies"][number]["record"],
  }));
  return {
    epoch: simulationInstant(0),
    validity: SCENARIO_VALIDITY,
    provenance: {} as SolarSystemScenario["provenance"],
    catalog: {} as SolarSystemScenario["catalog"],
    centeredFrames: [],
    rootFrame: SCENARIO_ROOT_FRAME,
    sunCenteredFrame: referenceFrameId("100"),
    earthCenteredFrame: referenceFrameId("101"),
    bodies,
    bodyById: new Map(bodies.map((body) => [body.definition.id, body])),
    objectIds: SCENARIO_OBJECT_IDS,
  };
}

test("orbit visualization omits Sun and uses bounded body-specific relative sampling", () => {
  const loaded = scenario();
  const calls: Array<[ObjectId, ObjectId, number]> = [];
  const cache = new PathCache(12);
  const stateAt = (objectId: ObjectId, centralBodyId: ObjectId, target: ReturnType<typeof simulationInstant>, frame: ReturnType<typeof referenceFrameId>) => {
    calls.push([objectId, centralBodyId, target.seconds]);
    return propagationState({
      position: { x: meters(target.seconds), y: meters(0), z: meters(0) },
      velocity: { x: metersPerSecond(1), y: metersPerSecond(0), z: metersPerSecond(0) },
      epoch: target,
      referenceFrame: frame,
    });
  };
  assert.equal(createOrbitPath({ scenario: loaded, body: loaded.bodyById.get(SUN_ID)!, cache, stateAt }), undefined);
  const earthPath = createOrbitPath({ scenario: loaded, body: loaded.bodyById.get(EARTH_ID)!, cache, stateAt });
  assert.ok(earthPath !== undefined);
  assert.equal(earthPath!.sampleCount, 128);
  assert.equal(earthPath!.closedReferenceOrbit, true);
  assert.equal(earthPath!.interval.end.seconds, 31_557_600);
  assert.ok(calls.every((call) => call[1] === SUN_ID));
  const callCount = calls.length;
  assert.strictEqual(createOrbitPath({ scenario: loaded, body: loaded.bodyById.get(EARTH_ID)!, cache, stateAt }), earthPath);
  assert.equal(calls.length, callCount);
  const moonPath = createOrbitPath({ scenario: loaded, body: loaded.bodyById.get(objectId("1004"))!, cache, stateAt });
  assert.ok(moonPath !== undefined);
  assert.ok(calls.slice(callCount).every((call) => call[1] === EARTH_ID));
});
