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
import {
  AMALTHEA_ID,
  EARTH_ID,
  JUPITER_ID,
  SCENARIO_BODIES,
  SCENARIO_OBJECT_IDS,
  SCENARIO_ROOT_FRAME,
  SCENARIO_VALIDITY,
  SUN_ID,
} from "../src/scenario/scenario-data.js";
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

test("orbit visualization can be re-anchored at the current simulation instant", () => {
  const loaded = scenario();
  const cache = new PathCache(12);
  const anchor = simulationInstant(86_400);
  const path = createOrbitPath({
    scenario: loaded,
    body: loaded.bodyById.get(EARTH_ID)!,
    cache,
    anchorInstant: anchor,
    stateAt: (objectIdValue, centralBodyId, target, frame) => propagationState({
      position: { x: meters(target.seconds), y: meters(0), z: meters(0) },
      velocity: { x: metersPerSecond(1), y: metersPerSecond(0), z: metersPerSecond(0) },
      epoch: target,
      referenceFrame: frame,
    }),
  });
  assert.ok(path !== undefined);
  assert.deepEqual(path!.interval.start, anchor);
  assert.equal(path!.samples[0]?.state.epoch.seconds, anchor.seconds);
});

test("orbit visualization infers a bounded sampling period from parent state when metadata is absent", () => {
  const loaded = scenario();
  const body = loaded.bodyById.get(AMALTHEA_ID)!;
  const parent = loaded.bodyById.get(JUPITER_ID)!;
  const radius = 83_500_000;
  const speed = Math.sqrt(parent.record.properties.mu! / radius);
  const path = createOrbitPath({
    scenario: loaded,
    body,
    cache: new PathCache(12),
    stateAt: (objectIdValue, centralBodyId, target, frame) => {
      assert.equal(objectIdValue, AMALTHEA_ID);
      assert.equal(centralBodyId, JUPITER_ID);
      return propagationState({
        position: { x: meters(radius), y: meters(0), z: meters(0) },
        velocity: { x: metersPerSecond(0), y: metersPerSecond(speed), z: metersPerSecond(0) },
        epoch: target,
        referenceFrame: frame,
      });
    },
  });
  assert.ok(path !== undefined);
  assert.equal(path!.sampleCount, 128);
  assert.equal(path!.closedReferenceOrbit, true);
  assert.ok(path!.interval.end.seconds > path!.interval.start.seconds);
});
