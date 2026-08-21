import type { SimulationInstant } from "./time.js";
import { compareSimulationInstants, simulationInstant } from "./time.js";
import type { Meters, MetersPerSecond, RadiansPerSecond } from "./units.js";

const UINT64_MAX_DECIMAL = "18446744073709551615";

declare const referenceFrameIdBrand: unique symbol;
declare const unitQuaternionBrand: unique symbol;

export type ReferenceFrameId = string & {
  readonly [referenceFrameIdBrand]: "ReferenceFrameId";
  readonly __orbitEngineReferenceFrameId: never;
};

export const ROOT_REFERENCE_FRAME_ID = "1" as ReferenceFrameId;
export const ROOT_FRAME_ID = ROOT_REFERENCE_FRAME_ID;

function isCanonicalReferenceFrameId(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > UINT64_MAX_DECIMAL.length) {
    return false;
  }
  if (value.length > 1 && value.charCodeAt(0) === 48) {
    return false;
  }
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 48 || code > 57) {
      return false;
    }
  }
  if (value.length === UINT64_MAX_DECIMAL.length && value > UINT64_MAX_DECIMAL) {
    return false;
  }
  return value !== "0";
}

export function isReferenceFrameId(value: unknown): value is ReferenceFrameId {
  return isCanonicalReferenceFrameId(value);
}

export function referenceFrameId(value: string): ReferenceFrameId {
  if (typeof value !== "string") {
    throw new TypeError("ReferenceFrameId must be a string");
  }
  if (!isCanonicalReferenceFrameId(value)) {
    throw new RangeError("ReferenceFrameId must be canonical decimal text in the range 1..uint64_max");
  }
  return value as ReferenceFrameId;
}

export interface Vec3<T extends number = number> {
  readonly x: T;
  readonly y: T;
  readonly z: T;
}

function assertFinite(value: number, name: string): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number`);
  }
}

function validateVec3(value: unknown, name: string): asserts value is Vec3 {
  if (typeof value !== "object" || value === null) {
    throw new TypeError(`${name} must be a vector`);
  }
  const candidate = value as Record<string, unknown>;
  assertFinite(candidate.x as number, `${name}.x`);
  assertFinite(candidate.y as number, `${name}.y`);
  assertFinite(candidate.z as number, `${name}.z`);
}

export function vec3<T extends number>(x: T, y: T, z: T): Vec3<T> {
  assertFinite(x, "vector.x");
  assertFinite(y, "vector.y");
  assertFinite(z, "vector.z");
  return Object.freeze({ x, y, z });
}

export interface Quaternion {
  readonly w: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export type UnitQuaternion = Quaternion & {
  readonly [unitQuaternionBrand]: "UnitQuaternion";
};

export const QUATERNION_UNIT_TOLERANCE = 1e-12;

function validateQuaternion(value: unknown, name: string): asserts value is Quaternion {
  if (typeof value !== "object" || value === null) {
    throw new TypeError(`${name} must be a quaternion`);
  }
  const candidate = value as Record<string, unknown>;
  assertFinite(candidate.w as number, `${name}.w`);
  assertFinite(candidate.x as number, `${name}.x`);
  assertFinite(candidate.y as number, `${name}.y`);
  assertFinite(candidate.z as number, `${name}.z`);
}

export function normalizeQuaternion(value: Quaternion): UnitQuaternion {
  validateQuaternion(value, "quaternion");
  const norm = Math.hypot(value.w, value.x, value.y, value.z);
  if (norm === 0 || Math.abs(norm - 1) > QUATERNION_UNIT_TOLERANCE) {
    throw new RangeError("quaternion must be unit length within the configured tolerance");
  }
  return Object.freeze({
    w: value.w / norm,
    x: value.x / norm,
    y: value.y / norm,
    z: value.z / norm,
  }) as UnitQuaternion;
}

export function quaternion(w: number, x: number, y: number, z: number): UnitQuaternion {
  return normalizeQuaternion({ w, x, y, z });
}

export function quaternionEquivalent(left: Quaternion, right: Quaternion, tolerance = 1e-12): boolean {
  assertFinite(tolerance, "quaternion equivalence tolerance");
  if (tolerance < 0) {
    throw new RangeError("quaternion equivalence tolerance must be non-negative");
  }
  const a = normalizeQuaternion(left);
  const b = normalizeQuaternion(right);
  const dot = Math.abs(a.w * b.w + a.x * b.x + a.y * b.y + a.z * b.z);
  return 1 - dot <= tolerance;
}

function add(left: Vec3, right: Vec3): Vec3 {
  return vec3(left.x + right.x, left.y + right.y, left.z + right.z);
}

function subtract(left: Vec3, right: Vec3): Vec3 {
  return vec3(left.x - right.x, left.y - right.y, left.z - right.z);
}

function negate(value: Vec3): Vec3 {
  return vec3(-value.x, -value.y, -value.z);
}

function cross(left: Vec3, right: Vec3): Vec3 {
  return vec3(
    left.y * right.z - left.z * right.y,
    left.z * right.x - left.x * right.z,
    left.x * right.y - left.y * right.x,
  );
}

function multiplyUnitQuaternions(left: Quaternion, right: Quaternion): UnitQuaternion {
  return normalizeQuaternion({
    w: left.w * right.w - left.x * right.x - left.y * right.y - left.z * right.z,
    x: left.w * right.x + left.x * right.w + left.y * right.z - left.z * right.y,
    y: left.w * right.y - left.x * right.z + left.y * right.w + left.z * right.x,
    z: left.w * right.z + left.x * right.y - left.y * right.x + left.z * right.w,
  });
}

export function multiplyQuaternions(left: Quaternion, right: Quaternion): UnitQuaternion {
  return multiplyUnitQuaternions(normalizeQuaternion(left), normalizeQuaternion(right));
}

function conjugate(value: Quaternion): UnitQuaternion {
  return quaternion(value.w, -value.x, -value.y, -value.z);
}

function rotate(value: Quaternion, vector: Vec3): Vec3 {
  const qVector = { w: 0, x: vector.x, y: vector.y, z: vector.z };
  const first = {
    w: value.w * qVector.w - value.x * qVector.x - value.y * qVector.y - value.z * qVector.z,
    x: value.w * qVector.x + value.x * qVector.w + value.y * qVector.z - value.z * qVector.y,
    y: value.w * qVector.y - value.x * qVector.z + value.y * qVector.w + value.z * qVector.x,
    z: value.w * qVector.z + value.x * qVector.y - value.y * qVector.x + value.z * qVector.w,
  };
  const inverse = conjugate(value);
  return vec3(
    first.w * inverse.x + first.x * inverse.w + first.y * inverse.z - first.z * inverse.y,
    first.w * inverse.y - first.x * inverse.z + first.y * inverse.w + first.z * inverse.x,
    first.w * inverse.z + first.x * inverse.y - first.y * inverse.x + first.z * inverse.w,
  );
}

export function rotateVector(value: Quaternion, vector: Vec3): Vec3 {
  validateVec3(vector, "vector");
  return rotate(normalizeQuaternion(value), vector);
}

export interface RigidStateTransform {
  readonly translation: Vec3<Meters>;
  readonly originVelocity: Vec3<MetersPerSecond>;
  readonly rotation: UnitQuaternion;
  readonly angularVelocity: Vec3<RadiansPerSecond>;
  readonly epoch: SimulationInstant;
}

export interface RigidStateTransformInput {
  readonly translation: Vec3<Meters>;
  readonly originVelocity: Vec3<MetersPerSecond>;
  readonly rotation: Quaternion;
  readonly angularVelocity: Vec3<RadiansPerSecond>;
  readonly epoch: SimulationInstant;
}

function validateRigidStateTransform(value: RigidStateTransformInput): void {
  if (typeof value !== "object" || value === null) {
    throw new TypeError("rigid state transform must be an object");
  }
  validateVec3(value.translation, "translation");
  validateVec3(value.originVelocity, "originVelocity");
  validateQuaternion(value.rotation, "rotation");
  validateVec3(value.angularVelocity, "angularVelocity");
  if (typeof value.epoch !== "object" || value.epoch === null) {
    throw new TypeError("epoch must be a SimulationInstant");
  }
}

function normalizeEpoch(value: SimulationInstant): SimulationInstant {
  if (typeof value !== "object" || value === null) {
    throw new TypeError("epoch must be a SimulationInstant");
  }
  return simulationInstant(value.seconds, value.nanoseconds);
}

export function rigidStateTransform(value: RigidStateTransformInput): RigidStateTransform {
  validateRigidStateTransform(value);
  return Object.freeze({
    translation: vec3(value.translation.x, value.translation.y, value.translation.z) as Vec3<Meters>,
    originVelocity: vec3(value.originVelocity.x, value.originVelocity.y, value.originVelocity.z) as Vec3<MetersPerSecond>,
    rotation: normalizeQuaternion(value.rotation),
    angularVelocity: vec3(value.angularVelocity.x, value.angularVelocity.y, value.angularVelocity.z) as Vec3<RadiansPerSecond>,
    epoch: normalizeEpoch(value.epoch),
  });
}

export function identityRigidStateTransform(epoch: SimulationInstant): RigidStateTransform {
  return rigidStateTransform({
    translation: vec3(0, 0, 0) as Vec3<Meters>,
    originVelocity: vec3(0, 0, 0) as Vec3<MetersPerSecond>,
    rotation: quaternion(1, 0, 0, 0),
    angularVelocity: vec3(0, 0, 0) as Vec3<RadiansPerSecond>,
    epoch,
  });
}

function assertSameEpoch(left: SimulationInstant, right: SimulationInstant): void {
  if (compareSimulationInstants(left, right) !== 0) {
    throw new RangeError("rigid transforms must have the same exact epoch");
  }
}

export function composeRigidStateTransforms(
  parentFromMiddle: RigidStateTransform,
  middleFromChild: RigidStateTransform,
): RigidStateTransform {
  const left = rigidStateTransform(parentFromMiddle);
  const right = rigidStateTransform(middleFromChild);
  assertSameEpoch(left.epoch, right.epoch);
  const rotatedTranslation = rotate(left.rotation, right.translation);
  return rigidStateTransform({
    translation: add(left.translation, rotatedTranslation) as Vec3<Meters>,
    originVelocity: add(
      add(left.originVelocity, rotate(left.rotation, right.originVelocity)),
      cross(left.angularVelocity, rotatedTranslation),
    ) as Vec3<MetersPerSecond>,
    rotation: multiplyUnitQuaternions(left.rotation, right.rotation),
    angularVelocity: add(left.angularVelocity, rotate(left.rotation, right.angularVelocity)) as Vec3<RadiansPerSecond>,
    epoch: left.epoch,
  });
}

export function inverseRigidStateTransform(value: RigidStateTransform): RigidStateTransform {
  const transform = rigidStateTransform(value);
  const inverseRotation = conjugate(transform.rotation);
  const inverseTranslation = negate(rotate(inverseRotation, transform.translation));
  const inverseVelocity = rotate(
    inverseRotation,
    add(negate(transform.originVelocity), cross(transform.angularVelocity, transform.translation)),
  );
  return rigidStateTransform({
    translation: inverseTranslation as Vec3<Meters>,
    originVelocity: inverseVelocity as Vec3<MetersPerSecond>,
    rotation: inverseRotation,
    angularVelocity: negate(rotate(inverseRotation, transform.angularVelocity)) as Vec3<RadiansPerSecond>,
    epoch: transform.epoch,
  });
}

export interface CartesianState {
  readonly position: Vec3<Meters>;
  readonly velocity: Vec3<MetersPerSecond>;
  readonly epoch: SimulationInstant;
}

export function transformCartesianState(
  transform: RigidStateTransform,
  state: CartesianState,
): CartesianState {
  const rigid = rigidStateTransform(transform);
  validateVec3(state.position, "state.position");
  validateVec3(state.velocity, "state.velocity");
  const stateEpoch = normalizeEpoch(state.epoch);
  assertSameEpoch(rigid.epoch, stateEpoch);
  const rotatedPosition = rotate(rigid.rotation, state.position);
  return Object.freeze({
    position: add(rigid.translation, rotatedPosition) as Vec3<Meters>,
    velocity: add(
      add(rigid.originVelocity, rotate(rigid.rotation, state.velocity)),
      cross(rigid.angularVelocity, rotatedPosition),
    ) as Vec3<MetersPerSecond>,
    epoch: stateEpoch,
  });
}

export const transformState = transformCartesianState;
export const composeRigidTransforms = composeRigidStateTransforms;
export const invertRigidStateTransform = inverseRigidStateTransform;
