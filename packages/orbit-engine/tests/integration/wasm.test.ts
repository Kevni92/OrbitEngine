import assert from "node:assert/strict";
import test from "node:test";

import { OrbitEngine } from "../../src/index.js";
import { loadWasmBackend } from "../../src/internal/backends/wasm.js";
import { assertObjectRoundTrip } from "../shared/object-roundtrip.js";
import { assertFrameRoundTrip } from "../shared/frame-roundtrip.js";
import { assertPropagationRoundTrip } from "../shared/propagation-roundtrip.js";
import { assertRegistryLifecycle } from "../shared/registry-lifecycle.js";
import { assertFrameGraph } from "../shared/frame-graph.js";
import { assertOepRuntime } from "../shared/oep-runtime.js";
import { assertTwoBodyModel } from "../shared/two-body.js";
import { assertStateQueryIntegration } from "../shared/state-query.js";
import { assertTimeRoundTrip } from "../shared/time-roundtrip.js";
import { assertNumericalMotion } from "../shared/numerical.js";
import { assertCoupledMotion } from "../shared/coupled.js";
import { assertScheduledWorkQueue } from "../shared/scheduler.js";

test("real WASM backend initializes and reports the shared core health", async () => {
  const engine = await OrbitEngine.create({ backend: "wasm" });
  const health = engine.health();

  assert.equal(engine.backend, "wasm");
  assert.deepEqual(health, {
    backend: "wasm",
    protocolVersion: 10,
    coreVersion: 1,
    healthCode: 42,
  });

  const backend = await loadWasmBackend();
  assertTimeRoundTrip(backend);
  assertObjectRoundTrip(backend);
  assertFrameRoundTrip(backend);
  assertPropagationRoundTrip(backend);
  assertRegistryLifecycle(backend);
  await assertFrameGraph(backend);
  await assertTwoBodyModel(backend);
  await assertStateQueryIntegration(backend);
  await assertOepRuntime(engine);
  await assertNumericalMotion("wasm");
  await assertCoupledMotion("wasm");
  assertScheduledWorkQueue(engine);
});
