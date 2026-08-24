import assert from "node:assert/strict";

import type { Backend } from "../../src/internal/backends/contract.js";
import type { OrbitEngine } from "../../src/index.js";
import { encodeLambertGeometryWire } from "../../src/internal/planner-wire.js";
import { normalizeLambertGeometryRequest } from "../../src/planner.js";
import { duration } from "../../src/time.js";
import { objectId } from "../../src/objects.js";
import { referenceFrameId } from "../../src/frames.js";
import { revisionId } from "../../src/propagation.js";

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
