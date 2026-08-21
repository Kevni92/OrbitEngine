import assert from "node:assert/strict";

import type { Backend } from "../../src/internal/backends/contract.js";
import {
  decodePropagationWire,
  encodePropagationWire,
  propagationWireIdentity,
  type PropagationWire,
} from "../../src/internal/propagation-wire.js";
import { encodeSimulationInstant } from "../../src/internal/time-wire.js";
import { simulationInstant } from "../../src/time.js";

export const propagationRoundTripCases: readonly PropagationWire[] = [
  {
    objectIdHigh: 4_294_967_295,
    objectIdLow: 4_294_967_295,
    modelKindCode: 2,
    directionCode: 3,
    boundedDirectionCode: 1,
    propagationFrameHigh: 0,
    propagationFrameLow: 1,
    configurationRevisionHigh: 2_097_152,
    configurationRevisionLow: 1,
    motionRevisionHigh: 1,
    motionRevisionLow: 0,
    segmentStartSecondsHigh: encodeSimulationInstant(simulationInstant(-4_294_967_296 - 10)).secondsHigh,
    segmentStartSecondsLow: encodeSimulationInstant(simulationInstant(-4_294_967_296 - 10)).secondsLow,
    segmentStartNanoseconds: 1,
    segmentEndPresent: true,
    segmentEndSecondsHigh: 0,
    segmentEndSecondsLow: 100,
    segmentEndNanoseconds: 2,
    targetSecondsHigh: 0,
    targetSecondsLow: 0,
    targetNanoseconds: 3,
    outcomeCode: 1,
    resultFrameHigh: 4_294_967_295,
    resultFrameLow: 4_294_967_295,
    positionX: Math.PI,
    positionY: -2,
    positionZ: 3,
    velocityX: -4,
    velocityY: 5,
    velocityZ: 6,
    positionAbsoluteMeters: 0.01,
    positionRelative: 1e-9,
    velocityAbsoluteMetersPerSecond: 0.02,
    velocityRelative: 2e-9,
  },
  {
    ...({
      objectIdHigh: 4_294_967_295,
      objectIdLow: 4_294_967_295,
      modelKindCode: 4,
      directionCode: 2,
      boundedDirectionCode: 0,
      propagationFrameHigh: 0,
      propagationFrameLow: 1,
      configurationRevisionHigh: 0,
      configurationRevisionLow: 7,
      motionRevisionHigh: 0,
      motionRevisionLow: 8,
      segmentStartSecondsHigh: 0,
      segmentStartSecondsLow: 0,
      segmentStartNanoseconds: 0,
      segmentEndPresent: false,
      segmentEndSecondsHigh: 0,
      segmentEndSecondsLow: 0,
      segmentEndNanoseconds: 0,
      targetSecondsHigh: 0,
      targetSecondsLow: 0,
      targetNanoseconds: 0,
      outcomeCode: 2,
      resultFrameHigh: 0,
      resultFrameLow: 1,
      positionX: 0,
      positionY: 0,
      positionZ: 0,
      velocityX: 0,
      velocityY: 0,
      velocityZ: 0,
      positionAbsoluteMeters: 0,
      positionRelative: 0,
      velocityAbsoluteMetersPerSecond: 0,
      velocityRelative: 0,
    } satisfies PropagationWire),
  },
];

export function assertPropagationRoundTrip(backend: Backend): void {
  for (const expected of propagationRoundTripCases) {
    const wire = encodePropagationWire(expected);
    const returned = backend.roundTripPropagation(wire);
    assert.deepEqual(returned, wire);
    assert.deepEqual(decodePropagationWire(returned), wire);
    const identity = propagationWireIdentity(returned);
    assert.equal(identity.objectId, "18446744073709551615");
    assert.equal(identity.propagationFrame, "1");
    if (wire.modelKindCode === 2) {
      assert.equal(identity.configurationRevision, "9007199254740993");
      assert.equal(identity.motionRevision, "4294967296");
    } else {
      assert.equal(identity.configurationRevision, "7");
      assert.equal(identity.motionRevision, "8");
    }
  }
}
