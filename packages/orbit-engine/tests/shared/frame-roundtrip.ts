import assert from "node:assert/strict";

import type { Backend } from "../../src/internal/backends/contract.js";
import {
  decodeFrameWire,
  encodeFrameWire,
  type FrameValue,
} from "../../src/internal/frame-wire.js";
import {
  quaternion,
  referenceFrameId,
  rigidStateTransform,
  vec3,
} from "../../src/frames.js";
import { simulationInstant } from "../../src/time.js";
import {
  meters,
  metersPerSecond,
  radiansPerSecond,
} from "../../src/units.js";

function frame(
  id: string,
  epoch: ReturnType<typeof simulationInstant>,
  translation: readonly [number, number, number],
  originVelocity: readonly [number, number, number],
  rotation: readonly [number, number, number, number],
  angularVelocity: readonly [number, number, number],
): FrameValue {
  return {
    referenceFrameId: referenceFrameId(id),
    transform: rigidStateTransform({
      translation: vec3(meters(translation[0]), meters(translation[1]), meters(translation[2])),
      originVelocity: vec3(
        metersPerSecond(originVelocity[0]),
        metersPerSecond(originVelocity[1]),
        metersPerSecond(originVelocity[2]),
      ),
      rotation: quaternion(rotation[0], rotation[1], rotation[2], rotation[3]),
      angularVelocity: vec3(
        radiansPerSecond(angularVelocity[0]),
        radiansPerSecond(angularVelocity[1]),
        radiansPerSecond(angularVelocity[2]),
      ),
      epoch,
    }),
  };
}

export const frameRoundTripCases: readonly FrameValue[] = [
  frame("1", simulationInstant(0), [0, 0, 0], [0, 0, 0], [1, 0, 0, 0], [0, 0, 0]),
  frame("4294967295", simulationInstant(-0.5), [Math.PI, -2, 3], [4, 5, -6], [2 ** -0.5, 0, 0, 2 ** -0.5], [0.1, 0.2, 0.3]),
  frame("4294967296", simulationInstant(4_294_967_296 + 123, 1), [1e12, -1e-9, 7], [8, -9, 10], [2 ** -0.5, 0, 2 ** -0.5, 0], [-0.5, 0.25, -0.125]),
  frame("9007199254740993", simulationInstant(Number.MAX_SAFE_INTEGER, 999_999_999), [11, 12, 13], [14, 15, 16], [1, 0, 0, 0], [0, 0, 0]),
  frame("18446744073709551615", simulationInstant(Number.MIN_SAFE_INTEGER, 1), [-17, 18, -19], [20, -21, 22], [0.5, 0.5, 0.5, 0.5], [1, 2, 3]),
];

export function assertFrameRoundTrip(backend: Backend): void {
  for (const expected of frameRoundTripCases) {
    const wire = encodeFrameWire(expected);
    const returnedWire = backend.roundTripFrame(wire);
    assert.deepEqual(returnedWire, wire);
    assert.deepEqual(decodeFrameWire(returnedWire), expected);
  }
}
