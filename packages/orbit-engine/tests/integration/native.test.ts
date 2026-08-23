import assert from "node:assert/strict";
import test from "node:test";

import { OrbitEngine } from "../../src/index.js";
import { loadNativeBackend } from "../../src/internal/backends/native.js";
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
import { assertFidelityManager } from "../shared/fidelity.js";
import { assertFidelityTransitions } from "../shared/fidelity-transitions.js";
import { assertRevisionInvalidation } from "../shared/invalidation.js";
import { assertEncounterPrimitives } from "../shared/encounter.js";
import { assertBroadPhasePrimitives } from "../shared/broad-phase.js";
import { assertClosestApproachSolvers } from "../shared/closest-approach.js";

test("real native backend initializes and reports the shared core health", async () => {
  const engine = await OrbitEngine.create({ backend: "native" });
  const health = engine.health();

  assert.equal(engine.backend, "native");
  assert.deepEqual(health, {
    backend: "native",
    protocolVersion: 10,
    coreVersion: 1,
    healthCode: 42,
  });

  const backend = await loadNativeBackend();
  assertTimeRoundTrip(backend);
  assertObjectRoundTrip(backend);
  assertFrameRoundTrip(backend);
  assertPropagationRoundTrip(backend);
  assertRegistryLifecycle(backend);
  await assertFrameGraph(backend);
  await assertTwoBodyModel(backend);
  await assertStateQueryIntegration(backend);
  await assertOepRuntime(engine);
  await assertNumericalMotion("native");
  await assertCoupledMotion("native");
  await assertScheduledWorkQueue(engine);
  await assertFidelityManager(await OrbitEngine.create({ backend: "native" }));
  await assertFidelityTransitions(await OrbitEngine.create({ backend: "native" }));
  await assertRevisionInvalidation(engine);
  await assertEncounterPrimitives(await OrbitEngine.create({ backend: "native" }));
  await assertBroadPhasePrimitives(await OrbitEngine.create({ backend: "native" }));
  await assertClosestApproachSolvers(await OrbitEngine.create({ backend: "native" }));
});
