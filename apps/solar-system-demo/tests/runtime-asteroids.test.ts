import assert from "node:assert/strict";
import test from "node:test";
import {
  ObjectType,
  gravitationalParameter,
  objectId,
  referenceFrameId,
  revisionId,
  simulationInstant,
  type ObjectId,
  type ObjectRecord,
  type OrbitEngine,
} from "orbit-engine";
import type { SolarSystemScenario } from "../src/scenario/load-solar-system.js";
import {
  RuntimeAsteroidSession,
  RuntimeObjectIdAllocator,
  generateSyntheticAsteroidAnchors,
} from "../src/scenario/runtime-asteroids.js";
import { SUN_ID } from "../src/scenario/scenario-data.js";

function scenario(): SolarSystemScenario {
  const epoch = simulationInstant(0);
  const sunCenteredFrame = referenceFrameId("100");
  const sun = {
    definition: { id: SUN_ID } as SolarSystemScenario["bodies"][number]["definition"],
    record: {
      id: SUN_ID,
      properties: { mu: gravitationalParameter(1.32712440018e20) },
      propertyRevision: revisionId("1"),
      motion: { motionRevision: revisionId("1") },
    } as ObjectRecord,
  };
  return {
    epoch,
    validity: { start: epoch, end: simulationInstant(100000) },
    provenance: {} as SolarSystemScenario["provenance"],
    catalog: {} as SolarSystemScenario["catalog"],
    centeredFrames: [],
    rootFrame: referenceFrameId("1"),
    sunCenteredFrame,
    earthCenteredFrame: referenceFrameId("101"),
    bodies: [sun] as SolarSystemScenario["bodies"],
    bodyById: new Map([[SUN_ID, sun]]) as SolarSystemScenario["bodyById"],
    objectIds: [SUN_ID],
  };
}

test("synthetic asteroid initial conditions are deterministic and finite", () => {
  const fixture = scenario();
  const first = generateSyntheticAsteroidAnchors({ count: 8, seed: 42 }, fixture);
  const again = generateSyntheticAsteroidAnchors({ count: 8, seed: 42 }, fixture);
  const different = generateSyntheticAsteroidAnchors({ count: 8, seed: 43 }, fixture);
  assert.deepEqual(first, again);
  assert.notDeepEqual(first, different);
  for (const asteroid of first) {
    assert.equal(asteroid.synthetic, true);
    assert.ok(asteroid.physicalRadiusMeters >= 100);
    assert.ok(asteroid.physicalRadiusMeters <= 20_000);
    assert.equal(asteroid.anchor.referenceFrame, fixture.sunCenteredFrame);
    assert.ok(Number.isFinite(asteroid.anchor.position.x));
    assert.ok(Number.isFinite(asteroid.anchor.velocity.y));
  }
});

test("runtime ObjectIds are canonical, unique, and never reused", () => {
  const allocator = new RuntimeObjectIdAllocator([SUN_ID]);
  const first = allocator.allocate();
  const second = allocator.allocate();
  const third = allocator.allocate();
  assert.notEqual(first, second);
  assert.notEqual(second, third);
  assert.ok(BigInt(second) > BigInt(first));
  assert.ok(BigInt(third) > BigInt(second));
  assert.equal(objectId(first), first);
});

test("runtime session registers, binds, removes, and does not reuse retired IDs", () => {
  const fixture = scenario();
  const registrations: unknown[] = [];
  const bindings: ObjectId[] = [];
  const removals: ObjectId[] = [];
  const models: unknown[] = [];
  const fakeEngine = {
    registry() {
      return {
        register(input: any) {
          registrations.push(input);
          return {
            id: input.id,
            type: input.type,
            properties: input.properties,
            state: input.state,
            motion: input.motion,
            referenceStatus: "none",
            propertyRevision: revisionId("1"),
          } as ObjectRecord;
        },
        remove(id: ObjectId) {
          removals.push(id);
        },
      };
    },
    twoBodyModel(configuration: unknown) {
      models.push(configuration);
      return { declaration: {}, evaluate() { throw new Error("not evaluated in this integration mock"); } };
    },
    bindMotionModel(id: ObjectId) {
      bindings.push(id);
    },
  } as unknown as OrbitEngine;

  const session = new RuntimeAsteroidSession(fakeEngine, fixture);
  const result = session.addBatch({ count: 3, seed: 7 });
  assert.equal(result.error, undefined);
  assert.equal(result.created, 3);
  assert.equal(session.count(), 3);
  assert.equal(registrations.length, 3);
  assert.equal(models.length, 3);
  assert.equal(bindings.length, 3);
  assert.ok((registrations as any[]).every((entry) => entry.type === ObjectType.asteroid));
  const firstIds = session.objectIds();

  const removed = session.removeAll();
  assert.equal(removed.removed, 3);
  assert.equal(removals.length, 3);
  assert.equal(session.count(), 0);

  session.addBatch({ count: 1, seed: 7 });
  assert.equal(session.count(), 1);
  assert.ok(BigInt(session.objectIds()[0]!) > BigInt(firstIds.at(-1)!));
});
