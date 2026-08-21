import assert from "node:assert/strict";
import test from "node:test";

import {
  composeRigidStateTransforms,
  identityRigidStateTransform,
  inverseRigidStateTransform,
  multiplyQuaternions,
  normalizeQuaternion,
  quaternion,
  quaternionEquivalent,
  referenceFrameId,
  ROOT_REFERENCE_FRAME_ID,
  rotateVector,
  rigidStateTransform,
  transformCartesianState,
  vec3,
  type Vec3,
  type ReferenceFrameId,
} from "../../src/index.js";
import { objectId, type ObjectId } from "../../src/objects.js";
import { simulationInstant } from "../../src/time.js";
import {
  meters as metersUnit,
  metersPerSecond,
  radiansPerSecond,
  type Meters,
  type MetersPerSecond,
  type RadiansPerSecond,
} from "../../src/units.js";

const epoch = simulationInstant(12, 345);

function meters(x: number, y: number, z: number): Vec3<Meters> {
  return vec3(metersUnit(x), metersUnit(y), metersUnit(z));
}

function velocity(x: number, y: number, z: number): Vec3<MetersPerSecond> {
  return vec3(metersPerSecond(x), metersPerSecond(y), metersPerSecond(z));
}

function angularVelocity(x: number, y: number, z: number): Vec3<RadiansPerSecond> {
  return vec3(radiansPerSecond(x), radiansPerSecond(y), radiansPerSecond(z));
}

test("ReferenceFrameId is canonical, exact, and nominally distinct from ObjectId", () => {
  assert.equal(ROOT_REFERENCE_FRAME_ID, "1");
  for (const value of ["1", "4294967295", "4294967296", "9007199254740993", "18446744073709551615"]) {
    assert.equal(referenceFrameId(value), value);
  }
  for (const value of ["", "0", "01", "+1", "-1", " 1", "1 ", "18446744073709551616", "abc"]) {
    assert.throws(() => referenceFrameId(value));
  }

  const frame: ReferenceFrameId = referenceFrameId("1");
  const object: ObjectId = objectId("1");
  assert.equal(frame, object);
  void frame;
  void object;
  // @ts-expect-error ObjectId and ReferenceFrameId must remain separate nominal types.
  const mustNotAssignObjectId: ReferenceFrameId = object;
  void mustNotAssignObjectId;
});

test("quaternions use scalar-first active Hamilton semantics", () => {
  const identity = quaternion(1, 0, 0, 0);
  const quarterTurnZ = quaternion(2 ** -0.5, 0, 0, 2 ** -0.5);
  const rotated = rotateVector(quarterTurnZ, meters(1, 0, 0));
  assert.ok(Math.abs(rotated.x) < 1e-12);
  assert.ok(Math.abs(rotated.y - 1) < 1e-12);
  assert.ok(Math.abs(rotated.z) < 1e-12);
  assert.deepEqual(multiplyQuaternions(identity, quarterTurnZ), quarterTurnZ);
  assert.equal(quaternionEquivalent(quarterTurnZ, { w: -quarterTurnZ.w, x: -quarterTurnZ.x, y: -quarterTurnZ.y, z: -quarterTurnZ.z }), true);
  assert.deepEqual(normalizeQuaternion({ w: 1 + 5e-13, x: 0, y: 0, z: 0 }), identity);
  assert.throws(() => quaternion(0, 0, 0, 0));
  assert.throws(() => quaternion(Number.NaN, 0, 0, 0));
  assert.throws(() => quaternion(1.1, 0, 0, 0));
});

test("rigid transforms preserve exact epochs and include rotating-frame velocity", () => {
  const transform = rigidStateTransform({
    translation: meters(10, 20, 30),
    originVelocity: velocity(2, 3, 4),
    rotation: quaternion(1, 0, 0, 0),
    angularVelocity: angularVelocity(0, 0, 1),
    epoch,
  });
  const state = {
    position: meters(1, 0, 0),
    velocity: velocity(0, 5, 0),
    epoch,
  };
  const result = transformCartesianState(transform, state);
  assert.deepEqual(result.position, meters(11, 20, 30));
  assert.deepEqual(result.velocity, velocity(2, 9, 4));
  assert.deepEqual(result.epoch, epoch);
  assert.throws(() => transformCartesianState(transform, { ...state, epoch: simulationInstant(13) }));
});

test("composition and inversion match identity", () => {
  const first = rigidStateTransform({
    translation: meters(3, -2, 1),
    originVelocity: velocity(4, 5, 6),
    rotation: quaternion(2 ** -0.5, 0, 0, 2 ** -0.5),
    angularVelocity: angularVelocity(0, 0, 0.5),
    epoch,
  });
  const second = rigidStateTransform({
    translation: meters(7, 1, -4),
    originVelocity: velocity(-1, 2, 3),
    rotation: quaternion(2 ** -0.5, 0, 2 ** -0.5, 0),
    angularVelocity: angularVelocity(0.25, 0, 0),
    epoch,
  });
  const composed = composeRigidStateTransforms(first, second);
  const recovered = composeRigidStateTransforms(composed, inverseRigidStateTransform(second));
  assert.ok(Math.abs(recovered.translation.x - first.translation.x) < 1e-12);
  assert.ok(Math.abs(recovered.translation.y - first.translation.y) < 1e-12);
  assert.ok(Math.abs(recovered.translation.z - first.translation.z) < 1e-12);
  assert.ok(Math.abs(recovered.originVelocity.x - first.originVelocity.x) < 1e-12);
  assert.ok(Math.abs(recovered.originVelocity.y - first.originVelocity.y) < 1e-12);
  assert.ok(Math.abs(recovered.originVelocity.z - first.originVelocity.z) < 1e-12);
  assert.equal(quaternionEquivalent(recovered.rotation, first.rotation), true);
  assert.deepEqual(recovered.epoch, epoch);
  assert.deepEqual(identityRigidStateTransform(epoch).translation, meters(0, 0, 0));
  assert.throws(() => composeRigidStateTransforms(first, rigidStateTransform({
    translation: meters(0, 0, 0),
    originVelocity: velocity(0, 0, 0),
    rotation: quaternion(1, 0, 0, 0),
    angularVelocity: angularVelocity(0, 0, 0),
    epoch: simulationInstant(13),
  })));
});
