import assert from "node:assert/strict";

import type { Backend } from "../../src/internal/backends/contract.js";
import { ObjectType, type OrbitEngine } from "../../src/index.js";
import { encodeLambertGeometryWire } from "../../src/internal/planner-wire.js";
import { normalizeLambertGeometryRequest } from "../../src/planner.js";
import { duration } from "../../src/time.js";
import { objectId } from "../../src/objects.js";
import { referenceFrameId } from "../../src/frames.js";
import {
  createReferenceEphemerisModel,
  propagationState,
  propagationTimeInterval,
  PropagationDirection,
  PropagationModelKind,
  revisionId,
} from "../../src/propagation.js";
import { meters, metersPerSecond } from "../../src/units.js";
import { simulationInstant } from "../../src/time.js";

export function assertPlannerCodec(backend: Backend): void {
  const request = normalizeLambertGeometryRequest({
    centralBodyId: objectId("18446744073709551615"),
    planningFrameId: referenceFrameId("9007199254740993"),
    mu: 3.986004418e14,
    departurePosition: { x: 7_000_000, y: 0, z: 0 },
    arrivalPosition: { x: 0, y: 8_000_000, z: 100 },
    timeOfFlight: duration(86_400, 123),
    branch: { motionSense: "retrograde", path: "longWay", revolutions: 0, referenceNormal: { x: 0, y: 0, z: 9 } },
    provenanceDigest: revisionId("18446744073709551615"),
  });
  const wire = encodeLambertGeometryWire(request);
  const returned = backend.roundTripPlanner(wire);
  assert.deepEqual({ version: returned.version, words: returned.words }, { version: wire.version, words: wire.words });
}

export function assertLambertSolver(engine: OrbitEngine): void {
  const base = {
    centralBodyId: objectId("1"),
    planningFrameId: referenceFrameId("1"),
    mu: 3.986004418e14,
    departurePosition: { x: 7_000_000, y: 0, z: 0 },
    arrivalPosition: { x: 0, y: 7_000_000, z: 0 },
    timeOfFlight: duration(2914),
    referenceNormal: { x: 0, y: 0, z: 1 },
    branch: { motionSense: "prograde" as const, path: "shortWay" as const, revolutions: 0, referenceNormal: { x: 0, y: 0, z: 1 } },
  };
  const progradeShort = engine.planner.solveLambertGeometry({ ...base, branch: { motionSense: "prograde", path: "shortWay", revolutions: 0, referenceNormal: base.referenceNormal } });
  const retrogradeShort = engine.planner.solveLambertGeometry({ ...base, branch: { motionSense: "retrograde", path: "shortWay", revolutions: 0, referenceNormal: base.referenceNormal } });
  const progradeLong = engine.planner.solveLambertGeometry({ ...base, branch: { motionSense: "prograde", path: "longWay", revolutions: 0, referenceNormal: base.referenceNormal } });
  assert.equal(progradeShort.status, "success");
  assert.equal(retrogradeShort.status, "success");
  assert.equal(progradeLong.status, "success");
  if (progradeShort.status !== "success" || retrogradeShort.status !== "success" || progradeLong.status !== "success") return;
  assert.ok(progradeShort.solution.residual <= 1e-12);
  assert.ok(progradeShort.solution.transferDepartureVelocity.y > 0);
  assert.ok(retrogradeShort.solution.transferDepartureVelocity.y < 0);
  assert.ok(progradeLong.solution.transferDepartureVelocity.y < 0);
  assert.ok((progradeShort.solution.periapsisRadiusMeters ?? 0) > 0);

  const hyperbolic = engine.planner.solveLambertGeometry({
    centralBodyId: objectId("1"), planningFrameId: referenceFrameId("1"), mu: 398_600.44e9,
    departurePosition: { x: -1_461_900, y: 2_444_200, z: 6_524_200 }, arrivalPosition: { x: -1_043_500, y: 5_847_900, z: 3_774_100 },
    timeOfFlight: duration(600), branch: { motionSense: "prograde", path: "shortWay", revolutions: 0, referenceNormal: { x: 0, y: 0, z: 1 } },
  });
  assert.equal(hyperbolic.status, "success");
  if (hyperbolic.status !== "success") return;
  assert.ok(hyperbolic.solution.residual <= 1e-12);
  assert.ok((hyperbolic.solution.semiMajorAxisMeters ?? 0) < 0);
  assert.ok((hyperbolic.solution.eccentricity ?? 0) > 1);

  const unsupported = engine.planner.solveLambertGeometry({ ...base, branch: { motionSense: "prograde", path: "shortWay", revolutions: 1, referenceNormal: base.referenceNormal } });
  assert.equal(unsupported.status, "unsupportedRevolutionCount");
  const degenerate = engine.planner.solveLambertGeometry({ ...base, arrivalPosition: { x: 14_000_000, y: 0, z: 0 } });
  assert.equal(degenerate.status, "degenerateGeometry");
  const nonConvergent = engine.planner.solveLambertGeometry({ ...base, solverConfiguration: { maxIterations: 1 } });
  assert.equal(nonConvergent.status, "nonConvergent");
}

function movingState(
  position: { readonly x: number; readonly y: number; readonly z?: number },
  velocity: { readonly x: number; readonly y: number; readonly z?: number },
  epoch: ReturnType<typeof simulationInstant>,
  frame: ReturnType<typeof referenceFrameId>,
) {
  return propagationState({
    position: { x: meters(position.x), y: meters(position.y), z: meters(position.z ?? 0) },
    velocity: { x: metersPerSecond(velocity.x), y: metersPerSecond(velocity.y), z: metersPerSecond(velocity.z ?? 0) },
    epoch,
    referenceFrame: frame,
  });
}

export async function assertEngineBoundTransferPlanning(engine: OrbitEngine): Promise<void> {
  const frame = referenceFrameId("1");
  const centralBody = objectId("9101");
  const source = objectId("9102");
  const target = objectId("9103");
  const departure = simulationInstant(1);
  const arrival = simulationInstant(2_915);
  const validity = propagationTimeInterval(simulationInstant(0), simulationInstant(10_000));
  const revision = revisionId("1");
  const model = (
    evaluate: (targetEpoch: ReturnType<typeof simulationInstant>) => ReturnType<typeof movingState>,
  ) => createReferenceEphemerisModel({
    validity,
    direction: "bidirectional",
    propagationFrame: frame,
    sourceRevision: revision,
    dependencies: [],
    errorContract: {},
    evaluate,
  });

  engine.registry().register({
    id: centralBody,
    type: ObjectType.star,
    properties: { mu: 3.986004418e14, physicalRadius: 6.4e6 },
    state: movingState({ x: 0, y: 0 }, { x: 100, y: 0 }, simulationInstant(0), frame),
    motion: {
      modelKind: PropagationModelKind.referenceEphemeris,
      direction: PropagationDirection.bidirectional,
      propagationFrame: frame,
      segmentStart: simulationInstant(0),
      segmentEnd: simulationInstant(10_000),
      configurationRevision: revision,
      motionRevision: revision,
    },
  });
  engine.registry().register({
    id: source,
    type: ObjectType.spacecraft,
    state: movingState({ x: 7e6, y: 0 }, { x: 100, y: 7_500 }, simulationInstant(0), frame),
    motion: {
      modelKind: PropagationModelKind.referenceEphemeris,
      direction: PropagationDirection.bidirectional,
      propagationFrame: frame,
      segmentStart: simulationInstant(0),
      segmentEnd: simulationInstant(10_000),
      configurationRevision: revision,
      motionRevision: revision,
    },
  });
  engine.registry().register({
    id: target,
    type: ObjectType.planet,
    state: movingState({ x: 0, y: 7e6 }, { x: 100, y: 0 }, simulationInstant(0), frame),
    motion: {
      modelKind: PropagationModelKind.referenceEphemeris,
      direction: PropagationDirection.bidirectional,
      propagationFrame: frame,
      segmentStart: simulationInstant(0),
      segmentEnd: simulationInstant(10_000),
      configurationRevision: revision,
      motionRevision: revision,
    },
  });
  engine.bindMotionModel(centralBody, model((epoch) => movingState({ x: 100 * epoch.seconds, y: 0 }, { x: 100, y: 0 }, epoch, frame)));
  engine.bindMotionModel(source, model((epoch) => movingState({ x: 7e6 + 100 * epoch.seconds, y: 0 }, { x: 100, y: 7_500 }, epoch, frame)));
  engine.bindMotionModel(target, model((epoch) => movingState({ x: 100 * epoch.seconds, y: 7e6 }, { x: 100, y: 0 }, epoch, frame)));
  const sourceManeuver = engine.scheduleImpulse(source, {
    instant: departure,
    deltaVelocity: { x: 1, y: 0, z: 0 },
    frame,
  });

  const beforeClock = engine.currentTime;
  const beforeSource = engine.registry().get(source).state;
  const request = {
    sourceObjectId: source,
    targetObjectId: target,
    centralBodyId: centralBody,
    planningFrameId: frame,
    departure,
    arrival,
    branch: { motionSense: "prograde" as const, path: "shortWay" as const, revolutions: 0, referenceNormal: { x: 0, y: 0, z: 1 } },
    purpose: "intercept" as const,
  };

  const intercept = engine.planner.planTransfer(request);
  assert.equal(intercept.status, "success");
  if (intercept.status !== "success") return;
  const interceptLeg = intercept.plan.legs[0]!;
  assert.equal(interceptLeg.arrivalDeltaVelocity, undefined);
  assert.ok(Math.hypot(interceptLeg.arrivalRelativeVelocity.x, interceptLeg.arrivalRelativeVelocity.y, interceptLeg.arrivalRelativeVelocity.z) > 0);
  assert.deepEqual(intercept.plan.departureStateUsed?.position, { x: 7e6, y: 0, z: 0 });
  assert.deepEqual(intercept.plan.targetArrivalStateUsed?.position, { x: 0, y: 7e6, z: 0 });
  assert.ok(intercept.plan.dependencies.some((dependency) => dependency.kind === "ephemeris"));
  assert.ok(intercept.plan.dependencies.some((dependency) => dependency.kind === "property" && dependency.id === `${centralBody}:mu`));
  assert.ok(intercept.plan.dependencies.some((dependency) => dependency.kind === "maneuver" && dependency.id === sourceManeuver.id));

  const rendezvous = engine.planner.planTransfer({ ...request, purpose: "rendezvous" });
  assert.equal(rendezvous.status, "success");
  if (rendezvous.status !== "success") return;
  const rendezvousLeg = rendezvous.plan.legs[0]!;
  assert.deepEqual(rendezvousLeg.arrivalDeltaVelocity, {
    x: -rendezvousLeg.arrivalRelativeVelocity.x,
    y: -rendezvousLeg.arrivalRelativeVelocity.y,
    z: -rendezvousLeg.arrivalRelativeVelocity.z,
  });
  assert.ok(rendezvousLeg.totalDeltaV > interceptLeg.totalDeltaV);

  const flyby = engine.planner.planTransfer({ ...request, purpose: "flyby" });
  assert.equal(flyby.status, "success");
  if (flyby.status !== "success") return;
  assert.equal(flyby.plan.legs[0]!.arrivalDeltaVelocity, undefined);

  const rejected = engine.planner.planTransfer({
    ...request,
    constraints: { minimumCentralBodyClearanceMeters: 8e6 },
  });
  assert.equal(rejected.status, "constraintRejected");
  if (rejected.status === "constraintRejected") {
    assert.deepEqual(rejected.rejectedBy, ["minimumCentralBodyClearanceMeters"]);
    assert.equal(rejected.plan.constraintsEvaluation.feasible, false);
  }

  const invalidState = engine.planner.planTransfer({ ...request, arrival: simulationInstant(10_001) });
  assert.equal(invalidState.status, "stateUnavailable");
  assert.deepEqual(engine.currentTime, beforeClock);
  assert.deepEqual(engine.registry().get(source).state, beforeSource);
}

export async function lambertParitySnapshot(engine: OrbitEngine): Promise<Readonly<Record<string, unknown>>> {
  const result = engine.planner.solveLambertGeometry({
    centralBodyId: objectId("1"), planningFrameId: referenceFrameId("1"), mu: 3.986004418e14,
    departurePosition: { x: 7_000_000, y: 0, z: 0 }, arrivalPosition: { x: 0, y: 7_000_000, z: 0 }, timeOfFlight: duration(2914),
    branch: { motionSense: "prograde", path: "shortWay", revolutions: 0, referenceNormal: { x: 0, y: 0, z: 1 } },
  });
  if (result.status !== "success") throw new Error(`Lambert parity fixture failed with ${result.status}`);
  const hyperbolic = engine.planner.solveLambertGeometry({
    centralBodyId: objectId("1"), planningFrameId: referenceFrameId("1"), mu: 398_600.44e9,
    departurePosition: { x: -1_461_900, y: 2_444_200, z: 6_524_200 }, arrivalPosition: { x: -1_043_500, y: 5_847_900, z: 3_774_100 },
    timeOfFlight: duration(600), branch: { motionSense: "prograde", path: "shortWay", revolutions: 0, referenceNormal: { x: 0, y: 0, z: 1 } },
  });
  if (hyperbolic.status !== "success") throw new Error(`Lambert hyperbolic parity fixture failed with ${hyperbolic.status}`);
  return Object.freeze({
    circular: Object.freeze({
      status: result.status,
      iterations: result.solution.iterations,
      residual: result.solution.residual,
      departureVelocity: Object.freeze({ ...result.solution.transferDepartureVelocity }),
      arrivalVelocity: Object.freeze({ ...result.solution.transferArrivalVelocity }),
      periapsisRadiusMeters: result.solution.periapsisRadiusMeters,
    }),
    hyperbolic: Object.freeze({
      status: hyperbolic.status,
      iterations: hyperbolic.solution.iterations,
      residual: hyperbolic.solution.residual,
      departureVelocity: Object.freeze({ ...hyperbolic.solution.transferDepartureVelocity }),
      arrivalVelocity: Object.freeze({ ...hyperbolic.solution.transferArrivalVelocity }),
      semiMajorAxisMeters: hyperbolic.solution.semiMajorAxisMeters,
      eccentricity: hyperbolic.solution.eccentricity,
    }),
  });
}
