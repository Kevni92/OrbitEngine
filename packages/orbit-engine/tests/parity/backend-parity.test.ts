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
import { assertManeuverRegressionMatrix, maneuverParitySnapshot } from "../shared/maneuver-regressions.js";
import { assertLambertSolver, assertPlannerCodec, lambertParitySnapshot } from "../shared/planner.js";

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
  test(`planner geometry codec parity has exact semantics on ${name}`, async () => {
    assertPlannerCodec(await load());
  });
  test(`Lambert solver semantics have parity on ${name}`, async () => {
    assertLambertSolver(await OrbitEngine.create({ backend: name }));
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
  test(`maneuver regression matrix has parity on ${name}`, async () => {
    await assertManeuverRegressionMatrix(name);
  });
}

test("native and WASM maneuver fixtures agree on discrete outcomes and numerical tolerances", async () => {
  const native = await maneuverParitySnapshot("native");
  const wasm = await maneuverParitySnapshot("wasm");
  assert.deepEqual(native.queued, wasm.queued);
  assert.deepEqual(native.result, wasm.result);
  assert.deepEqual(native.maneuver, wasm.maneuver);
  for (const [left, right] of [
    [native.state.position.x, wasm.state.position.x],
    [native.state.position.y, wasm.state.position.y],
    [native.state.position.z, wasm.state.position.z],
    [native.state.velocity.x, wasm.state.velocity.x],
    [native.state.velocity.y, wasm.state.velocity.y],
    [native.state.velocity.z, wasm.state.velocity.z],
    [native.state.mass, wasm.state.mass],
  ] as const) {
    assert.ok(Math.abs((left ?? 0) - (right ?? 0)) <= 1e-8);
  }
});

test("native and WASM Lambert fixtures agree on branch and solver outputs", async () => {
  type Vector = Readonly<{ x: number; y: number; z: number }>;
  type Case = Readonly<{
    status: string;
    iterations: number;
    residual: number;
    departureVelocity: Vector;
    arrivalVelocity: Vector;
    periapsisRadiusMeters?: number;
    semiMajorAxisMeters?: number;
    eccentricity?: number;
  }>;
  type Snapshot = Readonly<{ circular: Case; hyperbolic: Case }>;
  const native = await lambertParitySnapshot(await OrbitEngine.create({ backend: "native" })) as Snapshot;
  const wasm = await lambertParitySnapshot(await OrbitEngine.create({ backend: "wasm" })) as Snapshot;
  const assertClose = (left: number | undefined, right: number | undefined, tolerance: number, name: string): void => {
    assert.equal(typeof left, typeof right, `${name} presence differs`);
    if (left !== undefined && right !== undefined) assert.ok(Math.abs(left - right) <= tolerance, `${name} differs: ${left} vs ${right}`);
  };
  for (const name of ["circular", "hyperbolic"] as const) {
    const left = native[name];
    const right = wasm[name];
    assert.equal(left.status, right.status);
    assert.equal(left.iterations, right.iterations);
    assertClose(left.residual, right.residual, 1e-12, `${name}.residual`);
    for (const component of ["x", "y", "z"] as const) {
      assertClose(left.departureVelocity[component], right.departureVelocity[component], 1e-8, `${name}.departureVelocity.${component}`);
      assertClose(left.arrivalVelocity[component], right.arrivalVelocity[component], 1e-8, `${name}.arrivalVelocity.${component}`);
    }
    assertClose(left.periapsisRadiusMeters, right.periapsisRadiusMeters, 1e-6, `${name}.periapsisRadiusMeters`);
    assertClose(left.semiMajorAxisMeters, right.semiMajorAxisMeters, 1e-6, `${name}.semiMajorAxisMeters`);
    assertClose(left.eccentricity, right.eccentricity, 1e-12, `${name}.eccentricity`);
  }
});
