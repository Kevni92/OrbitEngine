import assert from "node:assert/strict";
import test from "node:test";

import { OrbitEngine, type OrbitEngineBackend } from "../../src/index.js";
import { loadNativeBackend } from "../../src/internal/backends/native.js";
import { loadWasmBackend } from "../../src/internal/backends/wasm.js";
import { assertObjectRoundTrip } from "../shared/object-roundtrip.js";
import { assertFrameRoundTrip } from "../shared/frame-roundtrip.js";
import { assertPropagationRoundTrip } from "../shared/propagation-roundtrip.js";
import { assertRegistryLifecycle } from "../shared/registry-lifecycle.js";
import { assertFrameGraph } from "../shared/frame-graph.js";
import { assertTwoBodyModel } from "../shared/two-body.js";
import { assertStateQueryIntegration } from "../shared/state-query.js";
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

for (const backend of ["native", "wasm"] as const satisfies readonly OrbitEngineBackend[]) {
  test(`shared health scenario has equivalent semantics on ${backend}`, async () => {
    const engine = await OrbitEngine.create({ backend });
    const health = engine.health();

    assert.equal(health.backend, backend);
    assert.equal(health.protocolVersion, 10);
    assert.equal(health.coreVersion, 1);
    assert.equal(health.healthCode, 42);
  });
}

for (const [name, load] of [["native", loadNativeBackend], ["wasm", loadWasmBackend]] as const) {
  test(`object identity and property wire parity has exact semantics on ${name}`, async () => {
    assertObjectRoundTrip(await load());
  });
  test(`reference frame wire parity has exact semantics on ${name}`, async () => {
    assertFrameRoundTrip(await load());
  });
  test(`propagation contract wire parity has exact semantics on ${name}`, async () => {
    assertPropagationRoundTrip(await load());
  });
  test(`object registry lifecycle parity has exact semantics on ${name}`, async () => {
    assertRegistryLifecycle(await load());
  });
  test(`frame graph lifecycle and exact-state semantics have parity on ${name}`, async () => {
    await assertFrameGraph(await load());
  });
  test(`two-body analytical propagation has parity on ${name}`, async () => {
    await assertTwoBodyModel(await load());
  });
  test(`integrated object state-at-time queries have parity on ${name}`, async () => {
    await assertStateQueryIntegration(await load());
  });
  test(`numerical motion has parity on ${name}`, async () => {
    await assertNumericalMotion(name);
  });
  test(`coupled numerical batch and removal have parity on ${name}`, async () => {
    await assertCoupledMotion(name);
  });
  test(`exact clock and scheduled work queue have parity on ${name}`, async () => {
    await assertScheduledWorkQueue(await OrbitEngine.create({ backend: name }));
  });
  test(`semantic fidelity requirements and selection have parity on ${name}`, async () => {
    await assertFidelityManager(await OrbitEngine.create({ backend: name }));
  });
  test(`fidelity authority transitions have parity on ${name}`, async () => {
    await assertFidelityTransitions(await OrbitEngine.create({ backend: name }));
  });
  test(`revision invalidation and bounded rebuild have parity on ${name}`, async () => {
    await assertRevisionInvalidation(await OrbitEngine.create({ backend: name }));
  });
  test(`encounter policy and record primitives have parity on ${name}`, async () => {
    await assertEncounterPrimitives(await OrbitEngine.create({ backend: name }));
  });
  test(`encounter broad phase primitives have parity on ${name}`, async () => {
    await assertBroadPhasePrimitives(await OrbitEngine.create({ backend: name }));
  });
  test(`closest-approach solver primitives have parity on ${name}`, async () => {
    await assertClosestApproachSolvers(await OrbitEngine.create({ backend: name }));
  });
  test(`encounter scheduling and coupling have parity on ${name}`, async () => {
    await assertEncounterScheduling(await OrbitEngine.create({ backend: name }));
  });
  test(`encounter lifecycle, invalidation and scaling have parity on ${name}`, async () => {
    await assertEncounterLifecycle(await OrbitEngine.create({ backend: name }));
  });
  test(`collision policy, shape and contact primitives have parity on ${name}`, async () => {
    await assertCollisionPrimitives(await OrbitEngine.create({ backend: name }));
  });
  test(`continuous collision detection has parity on ${name}`, async () => {
    await assertCollisionDetection(await OrbitEngine.create({ backend: name }));
  });
  test(`collision response and atomic handoff have parity on ${name}`, async () => {
    await assertCollisionResponse(await OrbitEngine.create({ backend: name }));
  });
  test(`collision lifecycle, same-time groups and invalidation have parity on ${name}`, async () => {
    await assertCollisionLifecycle(await OrbitEngine.create({ backend: name }));
  });
  test(`collision broad-phase quiet/dense stress has parity on ${name}`, async () => {
    await assertCollisionStress(await OrbitEngine.create({ backend: name }));
  });
  test(`maneuver value types and lifecycle have parity on ${name}`, async () => {
    await assertManeuverLifecycle(await OrbitEngine.create({ backend: name }));
  });
  test(`maneuver authority handoff has parity on ${name}`, async () => {
    await assertManeuverAuthorityHandoff(await OrbitEngine.create({ backend: name }));
  });
}
