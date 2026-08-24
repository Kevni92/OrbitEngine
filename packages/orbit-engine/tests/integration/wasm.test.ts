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
import { assertFidelityManager } from "../shared/fidelity.js";
import { assertFidelityTransitions } from "../shared/fidelity-transitions.js";
import { assertRevisionInvalidation } from "../shared/invalidation.js";
import { assertEncounterPrimitives } from "../shared/encounter.js";
import { assertBroadPhasePrimitives } from "../shared/broad-phase.js";
import { assertClosestApproachSolvers } from "../shared/closest-approach.js";
import { assertEncounterScheduling } from "../shared/encounter-scheduling.js";
import { assertEncounterLifecycle } from "../shared/encounter-lifecycle.js";
import { assertCollisionPrimitives } from "../shared/collision.js";
import { assertCollisionDetection } from "../shared/collision-detection.js";
import { assertCollisionResponse } from "../shared/collision-response.js";
import { assertCollisionLifecycle } from "../shared/collision-lifecycle.js";
import { assertCollisionStress } from "../shared/collision-stress.js";
import { assertManeuverLifecycle } from "../shared/maneuver.js";
import { assertManeuverAuthorityHandoff } from "../shared/maneuver-authority.js";
import { assertManeuverRegressionMatrix } from "../shared/maneuver-regressions.js";

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
  await assertScheduledWorkQueue(engine);
  await assertFidelityManager(await OrbitEngine.create({ backend: "wasm" }));
  await assertFidelityTransitions(await OrbitEngine.create({ backend: "wasm" }));
  await assertRevisionInvalidation(engine);
  await assertEncounterPrimitives(await OrbitEngine.create({ backend: "wasm" }));
  await assertBroadPhasePrimitives(await OrbitEngine.create({ backend: "wasm" }));
  await assertClosestApproachSolvers(await OrbitEngine.create({ backend: "wasm" }));
  await assertEncounterScheduling(await OrbitEngine.create({ backend: "wasm" }));
  await assertEncounterLifecycle(await OrbitEngine.create({ backend: "wasm" }));
  await assertCollisionPrimitives(await OrbitEngine.create({ backend: "wasm" }));
  await assertCollisionDetection(await OrbitEngine.create({ backend: "wasm" }));
  await assertCollisionResponse(await OrbitEngine.create({ backend: "wasm" }));
  await assertCollisionLifecycle(await OrbitEngine.create({ backend: "wasm" }));
  await assertCollisionStress(await OrbitEngine.create({ backend: "wasm" }));
  await assertManeuverLifecycle(await OrbitEngine.create({ backend: "wasm" }));
  await assertManeuverAuthorityHandoff(await OrbitEngine.create({ backend: "wasm" }));
  await assertManeuverRegressionMatrix("wasm");
});
