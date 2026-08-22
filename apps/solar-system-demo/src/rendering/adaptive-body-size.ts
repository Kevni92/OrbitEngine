export interface AdaptiveBodySizePolicy {
  readonly unresolvedFloorRadiusCssPx: number;
  readonly resolvedRadiusCssPx: number;
  readonly compressionExponent: number;
  readonly separationFraction: number;
}

export const DEFAULT_ADAPTIVE_BODY_SIZE_POLICY: AdaptiveBodySizePolicy = Object.freeze({
  unresolvedFloorRadiusCssPx: 2,
  resolvedRadiusCssPx: 6,
  compressionExponent: 0.45,
  separationFraction: 0.3,
});

function finitePositive(value: number, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be finite and greater than zero`);
  }
  return value;
}

export function physicalProjectedRadiusCssPixels(
  sceneRadius: number,
  cameraSpaceDepth: number,
  verticalFovRadians: number,
  viewportHeightCssPx: number,
): number {
  const radius = finitePositive(sceneRadius, "scene radius");
  const depth = finitePositive(cameraSpaceDepth, "camera-space depth");
  const fov = finitePositive(verticalFovRadians, "vertical field of view");
  const height = finitePositive(viewportHeightCssPx, "viewport CSS height");
  if (fov >= Math.PI) throw new RangeError("vertical field of view must be less than pi radians");
  return radius * height / (2 * depth * Math.tan(fov / 2));
}

export function adaptiveProjectedRadiusCssPixels(
  physicalRadiusCssPx: number,
  policy: AdaptiveBodySizePolicy = DEFAULT_ADAPTIVE_BODY_SIZE_POLICY,
): number {
  if (typeof physicalRadiusCssPx !== "number" || !Number.isFinite(physicalRadiusCssPx) || physicalRadiusCssPx < 0) {
    throw new RangeError("physical projected radius must be finite and non-negative");
  }
  const floor = finitePositive(policy.unresolvedFloorRadiusCssPx, "adaptive unresolved floor");
  const resolved = finitePositive(policy.resolvedRadiusCssPx, "adaptive resolved radius");
  const exponent = finitePositive(policy.compressionExponent, "adaptive compression exponent");
  if (floor >= resolved) throw new RangeError("adaptive unresolved floor must be below resolved radius");
  if (exponent >= 1) throw new RangeError("adaptive compression exponent must be below one");
  if (physicalRadiusCssPx >= resolved) return physicalRadiusCssPx;
  return floor + (resolved - floor) * Math.pow(physicalRadiusCssPx / resolved, exponent);
}

export function separationBoundedProjectedRadiusCssPixels(
  physicalRadiusCssPx: number,
  adaptiveRadiusCssPx: number,
  nearestNeighborCenterDistanceCssPx: number | undefined,
  separationFraction = DEFAULT_ADAPTIVE_BODY_SIZE_POLICY.separationFraction,
): number {
  if (nearestNeighborCenterDistanceCssPx === undefined) return adaptiveRadiusCssPx;
  if (!Number.isFinite(nearestNeighborCenterDistanceCssPx) || nearestNeighborCenterDistanceCssPx < 0) {
    throw new RangeError("nearest-neighbor projected distance must be finite and non-negative");
  }
  if (!Number.isFinite(separationFraction) || separationFraction <= 0 || separationFraction >= 0.5) {
    throw new RangeError("separation fraction must be between zero and one half");
  }
  const cap = nearestNeighborCenterDistanceCssPx * separationFraction;
  return Math.max(physicalRadiusCssPx, Math.min(adaptiveRadiusCssPx, cap));
}

export function sceneRadiusForProjectedCssPixels(
  projectedRadiusCssPx: number,
  cameraSpaceDepth: number,
  verticalFovRadians: number,
  viewportHeightCssPx: number,
): number {
  const projected = finitePositive(projectedRadiusCssPx, "projected CSS radius");
  const depth = finitePositive(cameraSpaceDepth, "camera-space depth");
  const fov = finitePositive(verticalFovRadians, "vertical field of view");
  const height = finitePositive(viewportHeightCssPx, "viewport CSS height");
  if (fov >= Math.PI) throw new RangeError("vertical field of view must be less than pi radians");
  return projected * 2 * depth * Math.tan(fov / 2) / height;
}
