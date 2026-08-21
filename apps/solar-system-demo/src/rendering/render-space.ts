import type { Meters, Vec3 } from "orbit-engine";

export const ASTRONOMICAL_UNIT_METERS = 149_597_870_700;
export const SCENE_UNITS_PER_ASTRONOMICAL_UNIT = 100;
export const METERS_TO_SCENE_UNITS = SCENE_UNITS_PER_ASTRONOMICAL_UNIT / ASTRONOMICAL_UNIT_METERS;
export const VISIBLE_RADIUS_MULTIPLIER = 5;
export const MIN_VISIBLE_RADIUS_SCENE_UNITS = 0.15;
export const SCENE_UP_VECTOR = Object.freeze({ x: 0, y: 0, z: 1 });

// Must remain identical to the J2000 ecliptic obliquity used by the committed
// scenario normalization. The renderer applies the inverse rotation only for
// presentation; canonical engine/scenario states remain ICRS/ICRF-aligned.
export const J2000_ECLIPTIC_OBLIQUITY_RADIANS = 23.43928 * Math.PI / 180;
const J2000_ECLIPTIC_COSINE = Math.cos(J2000_ECLIPTIC_OBLIQUITY_RADIANS);
const J2000_ECLIPTIC_SINE = Math.sin(J2000_ECLIPTIC_OBLIQUITY_RADIANS);

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

/** Rotate an ICRS/ICRF-aligned vector into the demo's J2000-ecliptic presentation axes. */
export function icrsToJ2000Ecliptic(vector: Vec3<number>): RenderVector {
  const x = finite(vector.x, "ICRS vector.x");
  const y = finite(vector.y, "ICRS vector.y");
  const z = finite(vector.z, "ICRS vector.z");
  return Object.freeze({
    x,
    y: J2000_ECLIPTIC_COSINE * y + J2000_ECLIPTIC_SINE * z,
    z: -J2000_ECLIPTIC_SINE * y + J2000_ECLIPTIC_COSINE * z,
  });
}

/** Inverse of icrsToJ2000Ecliptic; useful for deterministic convention tests. */
export function j2000EclipticToIcrs(vector: Vec3<number>): RenderVector {
  const x = finite(vector.x, "ecliptic vector.x");
  const y = finite(vector.y, "ecliptic vector.y");
  const z = finite(vector.z, "ecliptic vector.z");
  return Object.freeze({
    x,
    y: J2000_ECLIPTIC_COSINE * y - J2000_ECLIPTIC_SINE * z,
    z: J2000_ECLIPTIC_SINE * y + J2000_ECLIPTIC_COSINE * z,
  });
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
  if (policy.mode !== "visible") throw new RangeError(`Unknown radius mode: ${String(policy.mode)}`);
  return Math.max(physical * VISIBLE_RADIUS_MULTIPLIER, MIN_VISIBLE_RADIUS_SCENE_UNITS);
}
