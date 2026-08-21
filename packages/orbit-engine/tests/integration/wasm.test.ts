import assert from "node:assert/strict";
import test from "node:test";

import { OrbitEngine } from "../../src/index.js";
import { loadWasmBackend } from "../../src/internal/backends/wasm.js";
import { assertObjectRoundTrip } from "../shared/object-roundtrip.js";
import { assertFrameRoundTrip } from "../shared/frame-roundtrip.js";
import { assertPropagationRoundTrip } from "../shared/propagation-roundtrip.js";
import { assertTimeRoundTrip } from "../shared/time-roundtrip.js";

test("real WASM backend initializes and reports the shared core health", async () => {
  const engine = await OrbitEngine.create({ backend: "wasm" });
  const health = engine.health();

  assert.equal(engine.backend, "wasm");
  assert.deepEqual(health, {
    backend: "wasm",
    protocolVersion: 5,
    coreVersion: 1,
    healthCode: 42,
  });

  const backend = await loadWasmBackend();
  assertTimeRoundTrip(backend);
  assertObjectRoundTrip(backend);
  assertFrameRoundTrip(backend);
  assertPropagationRoundTrip(backend);
});
