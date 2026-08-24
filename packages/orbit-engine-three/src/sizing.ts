export type RadiusMode = "physical" | "adaptive";

export const ADAPTIVE_FEATURE_RADIUS_PIXELS = 2;
export const ADAPTIVE_REACH_RADIUS_PIXELS = 7;
export const ADAPTIVE_POWER = 0.5;
export const ADAPTIVE_SEPARATION_FRACTION = 0.3;
export const DEFAULT_ADAPTIVE_MARKER_SIZE_PIXELS = 7;

export interface ScreenPointPixels {
  readonly x: number;
  readonly y: number;
}

/** Camera-derived metrics supplied by the consumer; CSS pixels are semantic units. */
export interface BodyProjectionMetrics {
  readonly projectable: boolean;
  readonly cameraDepthSceneUnits: number;
  readonly verticalFieldOfViewRadians: number;
  readonly viewportHeightCssPixels: number;
  readonly centerScreenPixels?: ScreenPointPixels;
  readonly nearestLocalSeparationPixels?: number;
}

export interface AdaptiveSizingConfiguration {
  readonly featureRadiusPixels: number;
  readonly resolvedRadiusPixels: number;
  readonly power: number;
  readonly separationFraction: number;
  readonly markerSizePixels: number;
}

export interface BodySizingInput {
  readonly physicalRadiusMeters?: number;
  readonly physicalRadiusSceneUnits?: number;
  readonly metersPerSceneUnit: number;
  readonly radiusMode: RadiusMode;
  readonly projection: BodyProjectionMetrics;
  readonly configuration?: Partial<AdaptiveSizingConfiguration>;
}

export interface BodySizingResult {
  readonly projectable: boolean;
  readonly hasPhysicalRadius: boolean;
  readonly physicalRadiusSceneUnits: number;
  readonly physicalRadiusPixels: number;
  readonly physicalDiameterPixels: number;
  readonly presentedRadiusPixels: number;
  readonly presentedDiameterPixels: number;
  readonly presentedRadiusSceneUnits: number;
  readonly markerSizePixels: number;
  readonly nearestLocalSeparationPixels?: number;
}

const DEFAULT_CONFIGURATION: AdaptiveSizingConfiguration = Object.freeze({
  featureRadiusPixels: ADAPTIVE_FEATURE_RADIUS_PIXELS,
  resolvedRadiusPixels: ADAPTIVE_REACH_RADIUS_PIXELS,
  power: ADAPTIVE_POWER,
  separationFraction: ADAPTIVE_SEPARATION_FRACTION,
  markerSizePixels: DEFAULT_ADAPTIVE_MARKER_SIZE_PIXELS,
});

function finite(name: string, value: number): void {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
}

function positive(name: string, value: number): void {
  finite(name, value);
  if (value <= 0) throw new RangeError(`${name} must be greater than zero`);
}

function nonNegative(name: string, value: number): void {
  finite(name, value);
  if (value < 0) throw new RangeError(`${name} must be non-negative`);
}

export function createAdaptiveSizingConfiguration(input: Partial<AdaptiveSizingConfiguration> = {}): AdaptiveSizingConfiguration {
  const value = { ...DEFAULT_CONFIGURATION, ...input };
  positive("featureRadiusPixels", value.featureRadiusPixels);
  positive("resolvedRadiusPixels", value.resolvedRadiusPixels);
  if (value.resolvedRadiusPixels < value.featureRadiusPixels) throw new RangeError("resolvedRadiusPixels must be at least featureRadiusPixels");
  positive("power", value.power);
  if (value.power >= 1) throw new RangeError("power must be below one");
  positive("separationFraction", value.separationFraction);
  if (value.separationFraction > 1) throw new RangeError("separationFraction must be at most one");
  nonNegative("markerSizePixels", value.markerSizePixels);
  return Object.freeze(value);
}

/** Perspective projected physical radius in CSS pixels. */
export function projectedRadiusPixels(
  physicalRadiusSceneUnits: number,
  cameraDepthSceneUnits: number,
  verticalFieldOfViewRadians: number,
  viewportHeightCssPixels: number,
): number {
  positive("physicalRadiusSceneUnits", physicalRadiusSceneUnits);
  positive("cameraDepthSceneUnits", cameraDepthSceneUnits);
  positive("verticalFieldOfViewRadians", verticalFieldOfViewRadians);
  positive("viewportHeightCssPixels", viewportHeightCssPixels);
  const tangent = Math.tan(verticalFieldOfViewRadians / 2);
  positive("verticalFieldOfViewRadians tangent", tangent);
  return physicalRadiusSceneUnits * viewportHeightCssPixels / (2 * tangent * cameraDepthSceneUnits);
}

/** Monotonic adaptive radius mapping. The result is a radius, never a diameter. */
export function adaptiveRadiusPixels(
  physicalProjectedRadiusPixels: number,
  configuration: Partial<AdaptiveSizingConfiguration> = {},
): number {
  nonNegative("physicalProjectedRadiusPixels", physicalProjectedRadiusPixels);
  const config = createAdaptiveSizingConfiguration(configuration);
  if (physicalProjectedRadiusPixels >= config.resolvedRadiusPixels) return physicalProjectedRadiusPixels;
  if (physicalProjectedRadiusPixels === 0) return config.featureRadiusPixels;
  const normalized = physicalProjectedRadiusPixels / config.resolvedRadiusPixels;
  return Math.max(
    physicalProjectedRadiusPixels,
    config.featureRadiusPixels
      + (config.resolvedRadiusPixels - config.featureRadiusPixels) * normalized ** config.power,
  );
}

export function projectedPixelsToSceneRadius(
  radiusPixels: number,
  cameraDepthSceneUnits: number,
  verticalFieldOfViewRadians: number,
  viewportHeightCssPixels: number,
): number {
  nonNegative("radiusPixels", radiusPixels);
  positive("cameraDepthSceneUnits", cameraDepthSceneUnits);
  positive("verticalFieldOfViewRadians", verticalFieldOfViewRadians);
  positive("viewportHeightCssPixels", viewportHeightCssPixels);
  return radiusPixels * 2 * Math.tan(verticalFieldOfViewRadians / 2) * cameraDepthSceneUnits / viewportHeightCssPixels;
}

/** Caps adaptive enhancement in CSS pixels while never shrinking physical geometry. */
export function cappedAdaptiveRadiusPixels(
  adaptiveRadiusPixelsValue: number,
  physicalRadiusPixels: number,
  nearestLocalSeparationPixels: number | undefined,
  separationFraction = ADAPTIVE_SEPARATION_FRACTION,
): number {
  nonNegative("adaptiveRadiusPixels", adaptiveRadiusPixelsValue);
  nonNegative("physicalRadiusPixels", physicalRadiusPixels);
  if (nearestLocalSeparationPixels === undefined || !Number.isFinite(nearestLocalSeparationPixels)) {
    return Math.max(adaptiveRadiusPixelsValue, physicalRadiusPixels);
  }
  if (nearestLocalSeparationPixels === 0) return physicalRadiusPixels;
  positive("separationFraction", separationFraction);
  if (separationFraction > 1) throw new RangeError("separationFraction must be at most one");
  return Math.max(physicalRadiusPixels, Math.min(adaptiveRadiusPixelsValue, nearestLocalSeparationPixels * separationFraction));
}

export function resolveBodySizing(input: BodySizingInput): BodySizingResult {
  if (input.radiusMode !== "physical" && input.radiusMode !== "adaptive") throw new RangeError(`Unknown radius mode: ${String(input.radiusMode)}`);
  positive("metersPerSceneUnit", input.metersPerSceneUnit);
  const config = createAdaptiveSizingConfiguration(input.configuration);
  const projection = input.projection;
  if (typeof projection.projectable !== "boolean") throw new TypeError("projection.projectable must be boolean");
  positive("projection.verticalFieldOfViewRadians", projection.verticalFieldOfViewRadians);
  positive("projection.viewportHeightCssPixels", projection.viewportHeightCssPixels);
  finite("projection.cameraDepthSceneUnits", projection.cameraDepthSceneUnits);
  const radiusSceneUnits = input.physicalRadiusSceneUnits
    ?? (input.physicalRadiusMeters === undefined ? 0 : input.physicalRadiusMeters / input.metersPerSceneUnit);
  nonNegative("physicalRadiusSceneUnits", radiusSceneUnits);
  const hasPhysicalRadius = radiusSceneUnits > 0;
  const physicalRadiusPixels = projection.projectable && hasPhysicalRadius && projection.cameraDepthSceneUnits > 0
    ? projectedRadiusPixels(radiusSceneUnits, projection.cameraDepthSceneUnits, projection.verticalFieldOfViewRadians, projection.viewportHeightCssPixels)
    : 0;
  const adaptiveRadius = projection.projectable ? adaptiveRadiusPixels(physicalRadiusPixels, config) : 0;
  const presentedRadiusPixels = input.radiusMode === "physical"
    ? physicalRadiusPixels
    : cappedAdaptiveRadiusPixels(adaptiveRadius, physicalRadiusPixels, projection.nearestLocalSeparationPixels, config.separationFraction);
  const presentedRadiusSceneUnits = projection.projectable && projection.cameraDepthSceneUnits > 0 && hasPhysicalRadius
    ? projectedPixelsToSceneRadius(presentedRadiusPixels, projection.cameraDepthSceneUnits, projection.verticalFieldOfViewRadians, projection.viewportHeightCssPixels)
    : 0;
  const markerSizePixels = input.radiusMode === "physical"
    ? physicalRadiusPixels * 2
    : config.markerSizePixels;
  return Object.freeze({
    projectable: projection.projectable,
    hasPhysicalRadius,
    physicalRadiusSceneUnits: radiusSceneUnits,
    physicalRadiusPixels,
    physicalDiameterPixels: physicalRadiusPixels * 2,
    presentedRadiusPixels,
    presentedDiameterPixels: presentedRadiusPixels * 2,
    presentedRadiusSceneUnits,
    markerSizePixels,
    ...(projection.nearestLocalSeparationPixels === undefined ? {} : { nearestLocalSeparationPixels: projection.nearestLocalSeparationPixels }),
  });
}
