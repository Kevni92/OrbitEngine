import assert from "node:assert/strict";

import type { Backend } from "../../src/internal/backends/contract.js";
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
  assert.deepEqual(backend.roundTripPlanner(wire), wire);
}
