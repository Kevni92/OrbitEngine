import assert from "node:assert/strict";
import test from "node:test";

import { OrbitEngine } from "../../src/index.js";
import { loadWasmBackend } from "../../src/internal/backends/wasm.js";
import { assertTimeRoundTrip } from "../shared/time-roundtrip.js";

test("real WASM backend initializes and reports the shared core health", async () => {
  const engine = await OrbitEngine.create({ backend: "wasm" });
  const health = engine.health();

  assert.equal(engine.backend, "wasm");
  assert.deepEqual(health, {
    backend: "wasm",
    protocolVersion: 2,
    coreVersion: 1,
    healthCode: 42,
  });

  assertTimeRoundTrip(await loadWasmBackend());
});
