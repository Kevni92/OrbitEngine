import assert from "node:assert/strict";
import test from "node:test";
import { isPointerClick } from "../src/rendering/pointer-selection.js";

test("pointer selection accepts a stationary click and rejects a camera drag", () => {
  const start = { clientX: 100, clientY: 80 };
  assert.equal(isPointerClick(start, { clientX: 103, clientY: 82 }), true);
  assert.equal(isPointerClick(start, { clientX: 104, clientY: 83 }), false);
});

test("pointer selection rejects invalid coordinates without selecting", () => {
  assert.equal(isPointerClick({ clientX: Number.NaN, clientY: 0 }, { clientX: 0, clientY: 0 }), false);
});
