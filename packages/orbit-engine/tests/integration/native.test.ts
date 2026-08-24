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
import { assertPlannerCodec } from "../shared/planner.js";

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
  assertPlannerCodec(backend);
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
  await assertEncounterScheduling(await OrbitEngine.create({ backend: "native" }));
  await assertEncounterLifecycle(await OrbitEngine.create({ backend: "native" }));
  await assertCollisionPrimitives(await OrbitEngine.create({ backend: "native" }));
  await assertCollisionDetection(await OrbitEngine.create({ backend: "native" }));
  await assertCollisionResponse(await OrbitEngine.create({ backend: "native" }));
  await assertCollisionLifecycle(await OrbitEngine.create({ backend: "native" }));
  await assertCollisionStress(await OrbitEngine.create({ backend: "native" }));
  await assertManeuverLifecycle(await OrbitEngine.create({ backend: "native" }));
  await assertManeuverAuthorityHandoff(await OrbitEngine.create({ backend: "native" }));
  await assertManeuverRegressionMatrix("native");
});
