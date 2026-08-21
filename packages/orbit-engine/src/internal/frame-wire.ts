import {
  decodeSimulationInstant,
  encodeSimulationInstant,
  validateTimeWire,
} from "./time-wire.js";
import {
  ROOT_REFERENCE_FRAME_ID,
  referenceFrameId,
  type ReferenceFrameId,
  quaternion,
  rigidStateTransform,
  type RigidStateTransform,
  vec3,
} from "../frames.js";
import { simulationInstant } from "../time.js";
import type { Meters, MetersPerSecond, RadiansPerSecond } from "../units.js";

const TWO_TO_32 = 4_294_967_296;
const UINT32_MAX = 4_294_967_295;

export interface FrameWire {
  readonly referenceFrameIdHigh: number;
  readonly referenceFrameIdLow: number;
  readonly epochSecondsHigh: number;
  readonly epochSecondsLow: number;
  readonly epochNanoseconds: number;
  readonly translationX: number;
  readonly translationY: number;
  readonly translationZ: number;
  readonly originVelocityX: number;
  readonly originVelocityY: number;
  readonly originVelocityZ: number;
  readonly rotationW: number;
  readonly rotationX: number;
  readonly rotationY: number;
  readonly rotationZ: number;
  readonly angularVelocityX: number;
  readonly angularVelocityY: number;
  readonly angularVelocityZ: number;
}

export interface FrameValue {
  readonly referenceFrameId: ReferenceFrameId;
  readonly transform: RigidStateTransform;
}

function assertInteger(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new TypeError(`${name} must be an integer`);
  }
  return value;
}

function assertUnsigned(value: unknown, maximum: number, name: string): number {
  const integer = assertInteger(value, name);
  if (integer < 0 || integer > maximum) {
    throw new RangeError(`${name} is outside its unsigned range`);
  }
  return integer;
}

function assertFinite(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number`);
  }
  return value;
}

export function validateFrameWire(value: unknown): FrameWire {
  if (typeof value !== "object" || value === null) {
    throw new TypeError("frame wire value must be an object");
  }
  const candidate = value as Record<string, unknown>;
  const referenceFrameIdHigh = assertUnsigned(candidate.referenceFrameIdHigh, UINT32_MAX, "frame wire referenceFrameIdHigh");
  const referenceFrameIdLow = assertUnsigned(candidate.referenceFrameIdLow, UINT32_MAX, "frame wire referenceFrameIdLow");
  if (referenceFrameIdHigh === 0 && referenceFrameIdLow === 0) {
    throw new RangeError("frame wire ReferenceFrameId must be non-zero");
  }

  const epochSecondsHigh = assertInteger(candidate.epochSecondsHigh, "frame wire epochSecondsHigh");
  if (epochSecondsHigh < -2_147_483_648 || epochSecondsHigh > 2_147_483_647) {
    throw new RangeError("frame wire epochSecondsHigh is outside signed 32-bit range");
  }
  const epochSecondsLow = assertUnsigned(candidate.epochSecondsLow, UINT32_MAX, "frame wire epochSecondsLow");
  const epochNanoseconds = assertUnsigned(candidate.epochNanoseconds, 999_999_999, "frame wire epochNanoseconds");
  validateTimeWire({
    secondsHigh: epochSecondsHigh,
    secondsLow: epochSecondsLow,
    nanoseconds: epochNanoseconds,
  });

  const continuousNames = [
    "translationX", "translationY", "translationZ",
    "originVelocityX", "originVelocityY", "originVelocityZ",
    "rotationW", "rotationX", "rotationY", "rotationZ",
    "angularVelocityX", "angularVelocityY", "angularVelocityZ",
  ] as const;
  const continuous = Object.fromEntries(
    continuousNames.map((name) => [name, assertFinite(candidate[name], `frame wire ${name}`)]),
  ) as Pick<FrameWire, (typeof continuousNames)[number]>;
  const norm = Math.hypot(continuous.rotationW, continuous.rotationX, continuous.rotationY, continuous.rotationZ);
  if (norm === 0 || Math.abs(norm - 1) > 1e-12) {
    throw new RangeError("frame wire rotation must be unit length within the configured tolerance");
  }
  rigidStateTransform({
    translation: vec3(continuous.translationX, continuous.translationY, continuous.translationZ) as Vec3Meters,
    originVelocity: vec3(continuous.originVelocityX, continuous.originVelocityY, continuous.originVelocityZ) as Vec3MetersPerSecond,
    rotation: {
      w: continuous.rotationW,
      x: continuous.rotationX,
      y: continuous.rotationY,
      z: continuous.rotationZ,
    },
    angularVelocity: vec3(continuous.angularVelocityX, continuous.angularVelocityY, continuous.angularVelocityZ) as Vec3RadiansPerSecond,
    epoch: decodeSimulationInstant({
      secondsHigh: epochSecondsHigh,
      secondsLow: epochSecondsLow,
      nanoseconds: epochNanoseconds,
    }),
  });

  return Object.freeze({
    referenceFrameIdHigh,
    referenceFrameIdLow,
    epochSecondsHigh,
    epochSecondsLow,
    epochNanoseconds,
    ...continuous,
  });
}

type Vec3Meters = { readonly x: Meters; readonly y: Meters; readonly z: Meters };
type Vec3MetersPerSecond = { readonly x: MetersPerSecond; readonly y: MetersPerSecond; readonly z: MetersPerSecond };
type Vec3RadiansPerSecond = { readonly x: RadiansPerSecond; readonly y: RadiansPerSecond; readonly z: RadiansPerSecond };

function idToWire(value: ReferenceFrameId): { readonly referenceFrameIdHigh: number; readonly referenceFrameIdLow: number } {
  const canonical = referenceFrameId(value);
  let high = 0;
  let low = 0;
  for (let index = 0; index < canonical.length; index += 1) {
    const digit = canonical.charCodeAt(index) - 48;
    const lowProduct = low * 10 + digit;
    low = lowProduct % TWO_TO_32;
    high = high * 10 + Math.floor(lowProduct / TWO_TO_32);
    if (high >= TWO_TO_32) {
      throw new RangeError("ReferenceFrameId exceeds uint64 range");
    }
  }
  return { referenceFrameIdHigh: high, referenceFrameIdLow: low };
}

function idFromWire(high: number, low: number): ReferenceFrameId {
  let currentHigh = assertUnsigned(high, UINT32_MAX, "referenceFrameIdHigh");
  let currentLow = assertUnsigned(low, UINT32_MAX, "referenceFrameIdLow");
  if (currentHigh === 0 && currentLow === 0) {
    throw new RangeError("ReferenceFrameId wire value must be non-zero");
  }
  let digits = "";
  while (currentHigh !== 0 || currentLow !== 0) {
    const highRemainder = currentHigh % 10;
    currentHigh = Math.floor(currentHigh / 10);
    const combined = highRemainder * TWO_TO_32 + currentLow;
    currentLow = Math.floor(combined / 10);
    digits = String(combined % 10) + digits;
  }
  return referenceFrameId(digits);
}

export function encodeFrameWire(value: FrameValue): FrameWire {
  const transform = rigidStateTransform(value.transform);
  const id = idToWire(value.referenceFrameId);
  const epoch = encodeSimulationInstant(transform.epoch);
  return validateFrameWire({
    ...id,
    epochSecondsHigh: Math.floor(epoch.secondsHigh),
    epochSecondsLow: epoch.secondsLow,
    epochNanoseconds: epoch.nanoseconds,
    translationX: transform.translation.x,
    translationY: transform.translation.y,
    translationZ: transform.translation.z,
    originVelocityX: transform.originVelocity.x,
    originVelocityY: transform.originVelocity.y,
    originVelocityZ: transform.originVelocity.z,
    rotationW: transform.rotation.w,
    rotationX: transform.rotation.x,
    rotationY: transform.rotation.y,
    rotationZ: transform.rotation.z,
    angularVelocityX: transform.angularVelocity.x,
    angularVelocityY: transform.angularVelocity.y,
    angularVelocityZ: transform.angularVelocity.z,
  });
}

export function decodeFrameWire(value: unknown): FrameValue {
  const wire = validateFrameWire(value);
  const epoch = decodeSimulationInstant({
    secondsHigh: wire.epochSecondsHigh,
    secondsLow: wire.epochSecondsLow,
    nanoseconds: wire.epochNanoseconds,
  });
  return Object.freeze({
    referenceFrameId: idFromWire(wire.referenceFrameIdHigh, wire.referenceFrameIdLow),
    transform: rigidStateTransform({
      translation: vec3(wire.translationX, wire.translationY, wire.translationZ) as Vec3Meters,
      originVelocity: vec3(wire.originVelocityX, wire.originVelocityY, wire.originVelocityZ) as Vec3MetersPerSecond,
      rotation: {
        w: wire.rotationW,
        x: wire.rotationX,
        y: wire.rotationY,
        z: wire.rotationZ,
      },
      angularVelocity: vec3(wire.angularVelocityX, wire.angularVelocityY, wire.angularVelocityZ) as Vec3RadiansPerSecond,
      epoch,
    }),
  });
}

export const ROOT_FRAME_WIRE = encodeFrameWire({
  referenceFrameId: ROOT_REFERENCE_FRAME_ID,
  transform: {
    translation: vec3(0, 0, 0) as Vec3Meters,
    originVelocity: vec3(0, 0, 0) as Vec3MetersPerSecond,
    rotation: quaternion(1, 0, 0, 0),
    angularVelocity: vec3(0, 0, 0) as Vec3RadiansPerSecond,
    epoch: simulationInstant(0),
  },
});
