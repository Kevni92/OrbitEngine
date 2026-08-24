import assert from "node:assert/strict";
import test from "node:test";

import { backendFromRawBinding } from "../../src/internal/backends/binding.js";
import { BINDING_PROTOCOL_VERSION } from "../../src/internal/backends/contract.js";
import { createTrajectoryPlan, checkTrajectoryPlanStaleness, normalizeLambertGeometryRequest, normalizeTrajectoryConstraints, normalizeTrajectoryTransferRequest, TrajectoryPlanner, type ImpulsiveLambertLeg, type TrajectoryTransferRequest } from "../../src/planner.js";
import { objectId, referenceFrameId, revisionId, simulationInstant, duration } from "../../src/index.js";
import { encodeLambertGeometryWire } from "../../src/internal/planner-wire.js";

const frame = referenceFrameId("1");
const instant = (seconds: number) => simulationInstant(seconds);

function branch() {
  return { motionSense: "prograde" as const, path: "shortWay" as const, revolutions: 0, referenceNormal: { x: 0, y: 0, z: 4 } };
}

function transfer(overrides: Partial<TrajectoryTransferRequest> = {}): TrajectoryTransferRequest {
  return {
    sourceObjectId: objectId("10"),
    targetObjectId: objectId("11"),
    centralBodyId: objectId("1"),
    planningFrameId: frame,
    departure: instant(100),
    arrival: instant(200),
    branch: branch(),
    purpose: "intercept",
    ...overrides,
  };
}

function leg(overrides: Partial<ImpulsiveLambertLeg> = {}): ImpulsiveLambertLeg {
  return {
    kind: "impulsiveLambert",
    departure: instant(100),
    arrival: instant(200),
    centralBodyId: objectId("1"),
    planningFrameId: frame,
    muUsed: 3.986004418e14,
    branch: branch(),
    revolutions: 0,
    transferDepartureVelocity: { x: 1, y: 2, z: 3 },
    transferArrivalVelocity: { x: 4, y: 5, z: 6 },
    departureDeltaVelocity: { x: 0.1, y: 0.2, z: 0.3 },
    arrivalRelativeVelocity: { x: 1, y: 1, z: 1 },
    totalDeltaV: 0.4,
    solverResidual: 1e-12,
    solverIterations: 8,
    ...overrides,
  };
}

test("planner normalizes explicit geometry, branch and solver inputs", () => {
  const result = normalizeLambertGeometryRequest({
    centralBodyId: objectId("1"),
    planningFrameId: frame,
    mu: 10,
    departurePosition: { x: 1, y: 2, z: 3 },
    arrivalPosition: { x: 4, y: 5, z: 6 },
    timeOfFlight: duration(10),
    branch: branch(),
  });

  assert.deepEqual(result.branch.referenceNormal, { x: 0, y: 0, z: 1 });
  assert.equal(result.solverConfiguration.maxIterations, 64);
  assert.equal(result.provenancePresent, false);
  assert.equal(Object.isFrozen(result), true);
});

test("planner rejects implicit or invalid physical assumptions", () => {
  assert.throws(() => normalizeLambertGeometryRequest({
    centralBodyId: objectId("1"), planningFrameId: frame, mu: 0,
    departurePosition: { x: 0, y: 0, z: 0 }, arrivalPosition: { x: 1, y: 0, z: 0 }, timeOfFlight: duration(1), branch: branch(),
  }), /mu must be positive/);
  assert.throws(() => normalizeLambertGeometryRequest({
    centralBodyId: objectId("1"), planningFrameId: frame, mu: 1,
    departurePosition: { x: 0, y: 0, z: 0 }, arrivalPosition: { x: 1, y: 0, z: 0 }, timeOfFlight: duration(1), branch: { ...branch(), revolutions: 1 },
  }), /revolutions/);
  assert.throws(() => normalizeTrajectoryTransferRequest(transfer({ arrival: instant(100) })), /strictly later/);
  assert.throws(() => normalizeTrajectoryTransferRequest(transfer({ centralBodyId: objectId("1"), constraints: { allowedPlanningFrameIds: [referenceFrameId("2")] } })), /not allowed/);
});

test("constraints and search-independent IDs normalize deterministically", () => {
  const constraints = normalizeTrajectoryConstraints({
    allowedCentralBodyIds: [objectId("12"), objectId("2")],
    allowedPlanningFrameIds: [referenceFrameId("4"), referenceFrameId("3")],
    minimumTimeOfFlight: duration(5),
    maximumTimeOfFlight: duration(10),
    maximumTotalDeltaV: 100,
  });
  assert.deepEqual(constraints.allowedCentralBodyIds, ["12", "2"]);
  assert.deepEqual(constraints.allowedPlanningFrameIds, ["3", "4"]);
  assert.equal(constraints.maximumTotalDeltaV, 100);
  assert.throws(() => normalizeTrajectoryConstraints({ minimumTimeOfFlight: duration(10), maximumTimeOfFlight: duration(5) }), /must not exceed/);
});

test("plan identity is immutable and independent of dependency input order", () => {
  const dependencies = [
    { kind: "motion" as const, id: "target:11", revision: revisionId("2") },
    { kind: "solver" as const, id: "lambert-v1", revision: revisionId("3") },
  ];
  const first = createTrajectoryPlan({ request: transfer({ purpose: "rendezvous" }), legs: [leg()], dependencies });
  const second = createTrajectoryPlan({ request: transfer({ purpose: "rendezvous" }), legs: [leg()], dependencies: [...dependencies].reverse() });
  assert.equal(first.digest, second.digest);
  assert.equal(first.dependencyDigest, second.dependencyDigest);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.request), true);
  assert.equal(Object.isFrozen(first.legs), true);
  assert.throws(() => (first as { purpose: string }).purpose = "flyby", TypeError);
});

test("staleness compares dependency identities without changing the plan", () => {
  const plan = createTrajectoryPlan({
    request: transfer(), legs: [leg()], dependencies: [{ kind: "motion", id: "target:11", revision: revisionId("2") }],
  });
  assert.equal(checkTrajectoryPlanStaleness(plan).status, "current");
  const stale = checkTrajectoryPlanStaleness(plan, [{ kind: "motion", id: "target:11", revision: revisionId("3") }]);
  assert.equal(stale.status, "stale");
  assert.deepEqual(stale.changedDependencies[0], {
    expected: { kind: "motion", id: "target:11", revision: "2" },
    actual: { kind: "motion", id: "target:11", revision: "3" },
  });
});

test("native and WASM binding adapters expose the same planner codec", async () => {
  const geometry = normalizeLambertGeometryRequest({
    centralBodyId: objectId("18446744073709551615"), planningFrameId: referenceFrameId("42"), mu: 1.5,
    departurePosition: { x: 1, y: -2, z: 3 }, arrivalPosition: { x: 4, y: 5, z: -6 }, timeOfFlight: duration(12, 34),
    branch: { ...branch(), path: "longWay" },
    provenanceDigest: revisionId("18446744073709551615"),
  });
  const wire = encodeLambertGeometryWire(geometry);
  const raw = {
    protocolVersion: BINDING_PROTOCOL_VERSION,
    initialize: () => ({ coreVersion: 1, healthCode: 42 }),
    roundTripTime: (value: unknown) => value,
    roundTripDouble: (value: unknown) => value,
    roundTripObject: (value: unknown) => value,
    roundTripFrame: (value: unknown) => value,
    roundTripPropagation: (value: unknown) => value,
    roundTripRegistry: (value: unknown) => value,
    roundTripFrameRegistry: (value: unknown) => value,
    roundTripTwoBody: (value: unknown) => value,
    roundTripNumerical: (value: unknown) => value,
    roundTripCoupled: (value: unknown) => value,
    roundTripScheduler: (value: unknown) => value,
  };
  const native = await backendFromRawBinding("native", raw);
  const wasm = await backendFromRawBinding("wasm", raw);
  assert.deepEqual(native.roundTripPlanner(wire), wasm.roundTripPlanner(wire));
  assert.deepEqual(native.roundTripPlanner(wire), wire);
});

test("read-only facade validates queries and does not allocate or mutate engine state", async () => {
  let codecCalls = 0;
  const planner = new TrajectoryPlanner({
    roundTripPlanner: (value) => { codecCalls += 1; return value; },
  });
  const geometry = normalizeLambertGeometryRequest({
    centralBodyId: objectId("1"), planningFrameId: frame, mu: 1,
    departurePosition: { x: 1, y: 0, z: 0 }, arrivalPosition: { x: 0, y: 1, z: 0 }, timeOfFlight: duration(1), branch: branch(),
  });
  const unsupported = planner.solveLambertGeometry(geometry);
  assert.equal(unsupported.status, "unsupported");
  assert.equal(codecCalls, 1);
  const planResult = planner.planTransfer(transfer());
  assert.equal(planResult.status, "unsupported");
  assert.equal(codecCalls, 1);
  assert.equal((await planner.searchTransfers({
    sourceObjectId: objectId("10"), targetObjectId: objectId("11"), centralBodyId: objectId("1"), planningFrameId: frame,
    departureWindow: { start: instant(1), end: instant(2) }, arrivalWindow: { start: instant(3), end: instant(4) }, branchSet: [branch()], purpose: "intercept",
  })).status, "unsupported");
});
