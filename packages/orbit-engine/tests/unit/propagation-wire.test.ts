import assert from "node:assert/strict";
import test from "node:test";

import {
  decodePropagationWire,
  propagationWireIdentity,
  validatePropagationWire,
} from "../../src/internal/propagation-wire.js";
import { propagationRoundTripCases } from "../shared/propagation-roundtrip.js";

test("propagation wire keeps exact model, segment, revision, state, and tolerance fields", () => {
  const wire = propagationRoundTripCases[0]!;
  assert.deepEqual(validatePropagationWire(wire), wire);
  assert.deepEqual(decodePropagationWire(wire), wire);
  assert.deepEqual(propagationWireIdentity(wire), {
    objectId: "18446744073709551615",
    propagationFrame: "1",
    configurationRevision: "9007199254740993",
    motionRevision: "4294967296",
    modelKind: "twoBodyAnalytical",
    direction: "bounded",
  });
});

test("propagation wire rejects unknown taxonomy, invalid segment boundaries, and negative tolerances", () => {
  const wire = propagationRoundTripCases[0]!;
  assert.throws(() => validatePropagationWire({ ...wire, modelKindCode: 0 }));
  assert.throws(() => validatePropagationWire({ ...wire, segmentEndSecondsHigh: -3, segmentEndSecondsLow: 0 }));
  assert.throws(() => validatePropagationWire({ ...wire, positionRelative: -1 }));
});
