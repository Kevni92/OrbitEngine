import assert from "node:assert/strict";
import test from "node:test";
import { objectId, referenceFrameId, simulationInstant, type OrbitEngine } from "orbit-engine";
import { SolarSystemStateSource } from "../src/scenario/state-source.js";
import { SCENARIO_OBJECT_IDS, SCENARIO_ROOT_FRAME, SUN_ID } from "../src/scenario/scenario-data.js";
import type { SolarSystemScenario } from "../src/scenario/load-solar-system.js";

function scenario(): SolarSystemScenario {
  return {
    epoch: simulationInstant(0),
    validity: { start: simulationInstant(0), end: simulationInstant(10) },
    provenance: {} as SolarSystemScenario["provenance"],
    rootFrame: SCENARIO_ROOT_FRAME,
    sunCenteredFrame: referenceFrameId("100"),
    earthCenteredFrame: referenceFrameId("101"),
    bodies: [],
    bodyById: new Map(),
    objectIds: SCENARIO_OBJECT_IDS,
  };
}

test("state source uses a batch query for the Sun view and relative queries for focused views", () => {
  const batchCalls: unknown[][] = [];
  const relativeCalls: unknown[][] = [];
  const stateCalls: unknown[][] = [];
  const engine = {
    stateAt(objectId: unknown, target: unknown, frame: unknown) {
      stateCalls.push([objectId, target, frame]);
      return { position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, epoch: target, referenceFrame: frame };
    },
    statesAt(ids: readonly unknown[], target: unknown, frame: unknown) {
      batchCalls.push([ids, target, frame]);
      return ids.map(() => ({ position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, epoch: target, referenceFrame: frame }));
    },
    relativeStateAt(targetObject: unknown, observerObject: unknown, target: unknown, frame: unknown) {
      relativeCalls.push([targetObject, observerObject, target, frame]);
      return { position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, epoch: target, referenceFrame: frame };
    },
  } as unknown as OrbitEngine;
  const source = new SolarSystemStateSource(engine, scenario());
  const target = simulationInstant(42);

  source.query(SUN_ID, target);
  assert.equal(batchCalls.length, 1);
  assert.equal(relativeCalls.length, 0);

  const focus = objectId("1003");
  source.query(focus, target);
  assert.equal(batchCalls.length, 1);
  assert.equal(relativeCalls.length, SCENARIO_OBJECT_IDS.length);
  assert.ok(relativeCalls.every((call) => call[1] === focus));

  source.stateAt(focus, SUN_ID, target, SCENARIO_ROOT_FRAME);
  assert.equal(stateCalls.length, 1);
  source.stateAt(focus, focus, target, SCENARIO_ROOT_FRAME);
  assert.equal(relativeCalls.length, SCENARIO_OBJECT_IDS.length + 1);
});
