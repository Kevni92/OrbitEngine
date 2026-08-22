import { MIN_ADAPTIVE_RADIUS_SCENE_UNITS } from "./render-space.js";

export const ADAPTIVE_FEATURE_RADIUS_PIXELS = 2;
export const ADAPTIVE_REACH_RADIUS_PIXELS = 7;
export const ADAPTIVE_POWER = 0.5;
export const ADAPTIVE_SEPARATION_FRACTION = 0.3;

function finitePositive(value: number, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be finite and greater than zero`);
  }
  return value;
}

/** Returns the projected physical radius in CSS pixels for a perspective camera. */
export function projectedRadiusPixels(
  physicalRadiusSceneUnits: number,
  distanceSceneUnits: number,
  verticalFieldOfViewRadians: number,
  viewportHeightPixels: number,
): number {
  finitePositive(physicalRadiusSceneUnits, "physical radius");
  finitePositive(distanceSceneUnits, "camera distance");
  finitePositive(verticalFieldOfViewRadians, "vertical field of view");
  finitePositive(viewportHeightPixels, "viewport height");
  return physicalRadiusSceneUnits * viewportHeightPixels
    / (2 * Math.tan(verticalFieldOfViewRadians / 2) * distanceSceneUnits);
}

/**
 * Maps a physical projected radius to a legible radius without changing the
 * physical value once it is already large enough. The result is a radius,
 * never a diameter, so selection and separation math share the same unit.
 */
export function adaptiveRadiusPixels(physicalProjectedRadiusPixels: number): number {
  if (typeof physicalProjectedRadiusPixels !== "number"
      || !Number.isFinite(physicalProjectedRadiusPixels)
      || physicalProjectedRadiusPixels < 0) {
    throw new RangeError("Physical projected radius must be finite and non-negative");
  }
  if (physicalProjectedRadiusPixels >= ADAPTIVE_REACH_RADIUS_PIXELS) return physicalProjectedRadiusPixels;
  if (physicalProjectedRadiusPixels === 0) return ADAPTIVE_FEATURE_RADIUS_PIXELS;
  const normalized = physicalProjectedRadiusPixels / ADAPTIVE_REACH_RADIUS_PIXELS;
  return Math.max(
    physicalProjectedRadiusPixels,
    ADAPTIVE_FEATURE_RADIUS_PIXELS
      + (ADAPTIVE_REACH_RADIUS_PIXELS - ADAPTIVE_FEATURE_RADIUS_PIXELS) * normalized ** ADAPTIVE_POWER,
  );
}

export function projectedPixelsToSceneRadius(
  radiusPixels: number,
  distanceSceneUnits: number,
  verticalFieldOfViewRadians: number,
  viewportHeightPixels: number,
): number {
  if (typeof radiusPixels !== "number" || !Number.isFinite(radiusPixels) || radiusPixels < 0) {
    throw new RangeError("Projected radius must be finite and non-negative");
  }
  finitePositive(distanceSceneUnits, "camera distance");
  finitePositive(verticalFieldOfViewRadians, "vertical field of view");
  finitePositive(viewportHeightPixels, "viewport height");
  return Math.max(
    MIN_ADAPTIVE_RADIUS_SCENE_UNITS,
    radiusPixels * 2 * Math.tan(verticalFieldOfViewRadians / 2) * distanceSceneUnits / viewportHeightPixels,
  );
}

/** Cap an adaptive radius to a local parent/sibling separation without shrinking physical scale. */
export function cappedAdaptiveRadiusSceneUnits(
  adaptiveRadiusSceneUnits: number,
  physicalRadiusSceneUnits: number,
  nearestLocalSeparationSceneUnits: number | undefined,
): number {
  if (nearestLocalSeparationSceneUnits === undefined) return Math.max(adaptiveRadiusSceneUnits, physicalRadiusSceneUnits);
  if (!Number.isFinite(nearestLocalSeparationSceneUnits) || nearestLocalSeparationSceneUnits <= 0) {
    return Math.max(adaptiveRadiusSceneUnits, physicalRadiusSceneUnits);
  }
  return Math.max(
    physicalRadiusSceneUnits,
    Math.min(adaptiveRadiusSceneUnits, nearestLocalSeparationSceneUnits * ADAPTIVE_SEPARATION_FRACTION),
  );
}
