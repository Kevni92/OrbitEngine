import assert from "node:assert/strict";
import test from "node:test";
import { objectId } from "orbit-engine";
import { RuntimeObjectIdAllocator, RUNTIME_OBJECT_ID_START } from "../src/scenario/object-id-allocator.js";
import { createSyntheticAsteroids } from "../src/scenario/synthetic-asteroids.js";
import { SUN_CENTERED_FRAME, SUN_ID } from "../src/scenario/scenario-data.js";

test("runtime ObjectIds are monotonic and never reused", () => {
  const allocator = new RuntimeObjectIdAllocator([objectId("1000")]);
  const first = allocator.allocate();
  const second = allocator.allocate();
  assert.equal(first, RUNTIME_OBJECT_ID_START.toString());
  assert.equal(second, (RUNTIME_OBJECT_ID_START + 1n).toString());
  assert.equal(allocator.hasBeenIssued(first), true);
  const batch = allocator.allocateMany(2);
  assert.deepEqual(batch, [(RUNTIME_OBJECT_ID_START + 2n).toString(), (RUNTIME_OBJECT_ID_START + 3n).toString()]);
});

test("synthetic asteroid generation is deterministic, seedable, and uses the engine frame", () => {
  const ids = [objectId("9000000000000000000"), objectId("9000000000000000001")];
  const first = createSyntheticAsteroids({ ids, seed: "demo-seed" }, 1.32712440018e20);
  const second = createSyntheticAsteroids({ ids, seed: "demo-seed" }, 1.32712440018e20);
  assert.deepEqual(first, second);
  assert.equal(first[0]!.definition.centralBody, SUN_ID);
  assert.equal(first[0]!.definition.anchor.referenceFrame, SUN_CENTERED_FRAME);
  assert.equal(first[0]!.definition.propagation.modelKind, "twoBodyAnalytical");
  assert.notDeepEqual(first[0]!.definition.anchor.position, createSyntheticAsteroids({ ids, seed: "other" }, 1.32712440018e20)[0]!.definition.anchor.position);
});
