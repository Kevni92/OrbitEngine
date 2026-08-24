import {
  displayExposureDiagnostics as resolvePresentationDisplayExposureDiagnostics,
  resolveStellarIllumination as resolvePresentationStellarIllumination,
  type CartesianPosition as PresentationCartesianPosition,
  type DisplayExposureDiagnostics as PresentationDisplayExposureDiagnostics,
  type StellarEmitter as PresentationStellarEmitter,
  type StellarIlluminationContribution as PresentationStellarIlluminationContribution,
  type StellarIlluminationSet as PresentationStellarIlluminationSet,
} from "orbit-engine-three/presentation";
import type { LinearRgb } from "orbit-engine-three/presentation";
import { icrsDirectionToRenderSpace } from "./render-space.js";

export {
  FALLBACK_VISUAL_ALBEDO,
  LINEAR_SRGB_LUMINANCE,
  MAX_DISPLAY_EXPOSURE,
  MIN_DISPLAY_EXPOSURE,
  REFERENCE_IRRADIANCE_WATTS_PER_SQUARE_METER,
  accentHexToLinearRgb,
  blackbodyTemperatureToLinearRgb,
  deriveSurfaceReflectance,
  displayExposureForIrradiance,
  linearRgbToSrgb,
  mapIrradianceToSceneIntensity,
  normalizeLinearReflectanceToAlbedo,
} from "orbit-engine-three/presentation";
export type {
  ResolvedSurfaceAppearance,
  SurfaceReflectanceResult,
  SurfaceReflectanceSource,
} from "orbit-engine-three/presentation";

export const DEFAULT_DISPLAY_EXPOSURE = 1;
export const DISPLAY_EXPOSURE_RESPONSE = 1;
export const DISPLAY_TONE_MAPPING_MODE = "ACESFilmic" as const;
/** Three.js Lambert conversion retained in the demo renderer adapter only. */
export const LAMBERT_RENDERER_IRRADIANCE_NORMALIZATION = Math.PI;

export interface DisplayExposureDiagnostics extends PresentationDisplayExposureDiagnostics {
  readonly toneMappingMode: typeof DISPLAY_TONE_MAPPING_MODE;
}

export type CartesianPosition = PresentationCartesianPosition;
export type StellarEmitter = PresentationStellarEmitter;

export interface StellarIlluminationContribution extends PresentationStellarIlluminationContribution {
  /** Renderer-world direction derived from the authoritative physical direction. */
  readonly renderDirectionToEmitter: CartesianPosition;
}

export interface StellarIlluminationSet extends Omit<PresentationStellarIlluminationSet, "contributions" | "allContributions"> {
  readonly contributions: readonly StellarIlluminationContribution[];
  readonly allContributions: readonly StellarIlluminationContribution[];
}

export function displayExposureDiagnostics(physicalIrradianceWattsPerSquareMeter: number | undefined): DisplayExposureDiagnostics {
  return Object.freeze({
    ...resolvePresentationDisplayExposureDiagnostics(physicalIrradianceWattsPerSquareMeter),
    toneMappingMode: DISPLAY_TONE_MAPPING_MODE,
  });
}

export function resolveStellarIllumination(
  bodyPosition: CartesianPosition,
  emitters: readonly StellarEmitter[],
): StellarIlluminationSet {
  const resolved = resolvePresentationStellarIllumination(bodyPosition, emitters);
  const adapt = (contribution: PresentationStellarIlluminationContribution): StellarIlluminationContribution => Object.freeze({
    ...contribution,
    renderDirectionToEmitter: icrsDirectionToRenderSpace(contribution.directionToEmitter),
  });
  return Object.freeze({
    ...resolved,
    contributions: Object.freeze(resolved.contributions.map(adapt)),
    allContributions: Object.freeze(resolved.allContributions.map(adapt)),
  });
}

export function mapSceneDiffuseContributionToLambertLightIntensity(sceneDiffuseContribution: number): number {
  if (!Number.isFinite(sceneDiffuseContribution) || sceneDiffuseContribution < 0) throw new RangeError("scene diffuse contribution must be finite and non-negative");
  return sceneDiffuseContribution * LAMBERT_RENDERER_IRRADIANCE_NORMALIZATION;
}

export function lambertDiffuseContribution(
  reflectance: LinearRgb,
  normal: CartesianPosition,
  illumination: StellarIlluminationSet,
): LinearRgb {
  const normalLength = Math.hypot(normal.x, normal.y, normal.z);
  if (!Number.isFinite(normalLength) || normalLength <= 0) throw new RangeError("surface normal must be finite and non-zero");
  const normalizedNormal = { x: normal.x / normalLength, y: normal.y / normalLength, z: normal.z / normalLength };
  return Object.freeze(illumination.contributions.reduce((sum, contribution) => {
    const cosine = Math.max(0, normalizedNormal.x * contribution.renderDirectionToEmitter.x
      + normalizedNormal.y * contribution.renderDirectionToEmitter.y
      + normalizedNormal.z * contribution.renderDirectionToEmitter.z);
    return {
      r: sum.r + reflectance.r * cosine * contribution.exposureMappedIrradiance * contribution.linearChromaticity.r,
      g: sum.g + reflectance.g * cosine * contribution.exposureMappedIrradiance * contribution.linearChromaticity.g,
      b: sum.b + reflectance.b * cosine * contribution.exposureMappedIrradiance * contribution.linearChromaticity.b,
    };
  }, { r: 0, g: 0, b: 0 }));
}
