import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeFrameWire,
  encodeFrameWire,
  type FrameValue,
  validateFrameWire,
} from "../../src/internal/frame-wire.js";
import { referenceFrameId, rigidStateTransform, vec3, quaternion, type Vec3 } from "../../src/frames.js";
import { simulationInstant } from "../../src/time.js";
import {
  meters,
  metersPerSecond,
  radiansPerSecond,
  type Meters,
  type MetersPerSecond,
  type RadiansPerSecond,
} from "../../src/units.js";

test("frame wire preserves uint64 IDs, exact epochs, and binary64 fields", () => {
  const expected: FrameValue = {
    referenceFrameId: referenceFrameId("18446744073709551615"),
    transform: rigidStateTransform({
      translation: vec3(meters(Math.PI), meters(-2), meters(3)) as Vec3<Meters>,
      originVelocity: vec3(metersPerSecond(4), metersPerSecond(5), metersPerSecond(-6)) as Vec3<MetersPerSecond>,
      rotation: quaternion(2 ** -0.5, 0, 0, 2 ** -0.5),
      angularVelocity: vec3(radiansPerSecond(0.1), radiansPerSecond(0.2), radiansPerSecond(0.3)) as Vec3<RadiansPerSecond>,
      epoch: simulationInstant(-4_294_967_296 - 123, 999_999_999),
    }),
  };
  const wire = encodeFrameWire(expected);
  assert.equal(wire.referenceFrameIdHigh, 4_294_967_295);
  assert.equal(wire.referenceFrameIdLow, 4_294_967_295);
  assert.equal(wire.translationX, Math.PI);
  assert.deepEqual(decodeFrameWire(wire), expected);
  assert.deepEqual(validateFrameWire(wire), wire);
});

test("frame wire rejects zero IDs, invalid epochs, and non-unit quaternions", () => {
  const valid = encodeFrameWire({
    referenceFrameId: referenceFrameId("1"),
    transform: rigidStateTransform({
      translation: vec3(meters(0), meters(0), meters(0)) as Vec3<Meters>,
      originVelocity: vec3(metersPerSecond(0), metersPerSecond(0), metersPerSecond(0)) as Vec3<MetersPerSecond>,
      rotation: quaternion(1, 0, 0, 0),
      angularVelocity: vec3(radiansPerSecond(0), radiansPerSecond(0), radiansPerSecond(0)) as Vec3<RadiansPerSecond>,
      epoch: simulationInstant(0),
    }),
  });
  assert.throws(() => validateFrameWire({ ...valid, referenceFrameIdHigh: 0, referenceFrameIdLow: 0 }));
  assert.throws(() => validateFrameWire({ ...valid, epochNanoseconds: 1_000_000_000 }));
  assert.throws(() => validateFrameWire({ ...valid, rotationW: 1.1 }));
});
