import assert from "node:assert/strict";
import test from "node:test";

import { OrbitEngine } from "../../src/index.js";
import { oepParitySnapshot } from "../shared/oep-runtime.js";

function assertFloatingParity(left: readonly number[], right: readonly number[], tolerance = 1e-12): void {
  assert.equal(left.length, right.length);
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index]!;
    const b = right[index]!;
    assert.ok(Number.isFinite(a) && Number.isFinite(b));
    assert.ok(Math.abs(a - b) <= tolerance, `OEP parity mismatch at ${index}: ${a} vs ${b}`);
  }
}

test("native and WASM OEP runtime agree on identities, source graph, times and states", async () => {
  const native = await oepParitySnapshot(await OrbitEngine.create({ backend: "native" }));
  const wasm = await oepParitySnapshot(await OrbitEngine.create({ backend: "wasm" }));

  assert.equal(native.datasetRevision, wasm.datasetRevision);
  assert.deepEqual(native.sourceRevisions, wasm.sourceRevisions);
  assert.deepEqual(native.sourceCenters, wasm.sourceCenters);
  assert.deepEqual(native.sourceEffectiveStarts, wasm.sourceEffectiveStarts);
  assert.deepEqual(native.sourceEffectiveEnds, wasm.sourceEffectiveEnds);
  assertFloatingParity(native.relative2, wasm.relative2);
  assertFloatingParity(native.relative3, wasm.relative3);
  assertFloatingParity(native.root2, wasm.root2);
  assertFloatingParity(native.root3, wasm.root3);
});
