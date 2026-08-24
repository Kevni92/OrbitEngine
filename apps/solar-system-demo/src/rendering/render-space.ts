import type { Meters, Vec3 } from "orbit-engine";
import { icrsToJ2000Ecliptic } from "../coordinate-conventions.js";

export {
  J2000_ECLIPTIC_OBLIQUITY_RADIANS,
  icrsToJ2000Ecliptic,
  j2000EclipticToIcrs,
} from "../coordinate-conventions.js";

export const ASTRONOMICAL_UNIT_METERS = 149_597_870_700;
export const SCENE_UNITS_PER_ASTRONOMICAL_UNIT = 100;
export const METERS_TO_SCENE_UNITS = SCENE_UNITS_PER_ASTRONOMICAL_UNIT / ASTRONOMICAL_UNIT_METERS;
export const METERS_PER_SCENE_UNIT = ASTRONOMICAL_UNIT_METERS / SCENE_UNITS_PER_ASTRONOMICAL_UNIT;
/** Retained as a named policy bound for compatibility; adaptive sizing is camera/pixel based. */
export const MIN_ADAPTIVE_RADIUS_SCENE_UNITS = 0;
export const SCENE_UP_VECTOR = Object.freeze({ x: 0, y: 0, z: 1 });

export type RadiusMode = "physical" | "adaptive";

export interface RenderVector {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * Converts a direction from the authoritative ICRS-aligned axes to the
 * Three.js render-world axes. Directions receive the presentation rotation
 * only; focus rebasing and metre-to-scene scaling must not enter them.
 */
export function icrsDirectionToRenderSpace(direction: Vec3<number>): RenderVector {
  const rotated = icrsToJ2000Ecliptic({
    x: finite(direction.x, "direction.x"),
    y: finite(direction.y, "direction.y"),
    z: finite(direction.z, "direction.z"),
  });
  const length = Math.hypot(rotated.x, rotated.y, rotated.z);
  if (!Number.isFinite(length) || length <= Number.EPSILON) {
    throw new RangeError("direction must be finite and non-zero");
  }
  return Object.freeze({
    x: rotated.x / length,
    y: rotated.y / length,
    z: rotated.z / length,
  });
}

export interface RadiusPolicy {
  readonly mode: RadiusMode;
  readonly physicalRadiusMeters: Meters;
  /** Adaptive mode supplies the camera-aware result in scene units. */
  readonly adaptiveRadiusSceneUnits?: number;
}

function finite(value: number, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be finite`);
  }
  return value;
}

export function focusRelativePosition(position: Vec3<number>, focus: Vec3<number>): RenderVector {
  return Object.freeze({
    x: finite(position.x - focus.x, "relative position.x"),
    y: finite(position.y - focus.y, "relative position.y"),
    z: finite(position.z - focus.z, "relative position.z"),
  });
}

export function metersToSceneUnits(value: number): number {
  return finite(value, "meters") * METERS_TO_SCENE_UNITS;
}

export function positionToSceneUnits(position: Vec3<number>, focus: Vec3<number> = { x: 0, y: 0, z: 0 }): RenderVector {
  const relative = focusRelativePosition(position, focus);
  const presentation = icrsToJ2000Ecliptic(relative);
  return Object.freeze({
    x: metersToSceneUnits(presentation.x),
    y: metersToSceneUnits(presentation.y),
    z: metersToSceneUnits(presentation.z),
  });
}

export function radiusToSceneUnits(policy: RadiusPolicy): number {
  const physical = metersToSceneUnits(policy.physicalRadiusMeters);
  if (policy.mode === "physical") return physical;
  if (policy.mode !== "adaptive") throw new RangeError(`Unknown radius mode: ${String(policy.mode)}`);
  if (policy.adaptiveRadiusSceneUnits === undefined) {
    throw new RangeError("Adaptive radius requires a camera-aware scene-unit value");
  }
  return Math.max(physical, policy.adaptiveRadiusSceneUnits, MIN_ADAPTIVE_RADIUS_SCENE_UNITS);
}
