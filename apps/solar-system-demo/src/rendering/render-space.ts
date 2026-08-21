import type { Meters, Vec3 } from "orbit-engine";

export const ASTRONOMICAL_UNIT_METERS = 149_597_870_700;
export const SCENE_UNITS_PER_ASTRONOMICAL_UNIT = 100;
export const METERS_TO_SCENE_UNITS = SCENE_UNITS_PER_ASTRONOMICAL_UNIT / ASTRONOMICAL_UNIT_METERS;
export const VISIBLE_RADIUS_MULTIPLIER = 5;
export const MIN_VISIBLE_RADIUS_SCENE_UNITS = 0.15;
export const SCENE_UP_VECTOR = Object.freeze({ x: 0, y: 0, z: 1 });

export const IDENTITY_AXIS_MAPPING = Object.freeze({
  x: "x",
  y: "y",
  z: "z",
} as const);

export type RadiusMode = "physical" | "visible";

export interface RenderVector {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface RadiusPolicy {
  readonly mode: RadiusMode;
  readonly physicalRadiusMeters: Meters;
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
  return Object.freeze({
    x: metersToSceneUnits(relative.x),
    y: metersToSceneUnits(relative.y),
    z: metersToSceneUnits(relative.z),
  });
}

export function radiusToSceneUnits(policy: RadiusPolicy): number {
  const physical = metersToSceneUnits(policy.physicalRadiusMeters);
  if (policy.mode === "physical") return physical;
  if (policy.mode !== "visible") throw new RangeError(`Unknown radius mode: ${String(policy.mode)}`);
  return Math.max(physical * VISIBLE_RADIUS_MULTIPLIER, MIN_VISIBLE_RADIUS_SCENE_UNITS);
}
