import {
  OPTICAL_LIBRARY_VERSION,
  opticalMaterial,
  type CelestialAppearance,
  type LinearRgb,
} from "./appearance.js";

export const LINEAR_SRGB_LUMINANCE = Object.freeze({ r: 0.2126, g: 0.7152, b: 0.0722 });
export const FALLBACK_VISUAL_ALBEDO = 0.32;
export const REFERENCE_IRRADIANCE_WATTS_PER_SQUARE_METER = 1_361;
export const MIN_DISPLAY_EXPOSURE = 0.18;
export const MAX_DISPLAY_EXPOSURE = 512;
export const DISPLAY_EXPOSURE_RESPONSE = 1;
export const DEFAULT_DISPLAY_EXPOSURE = 1;

export type SurfaceReflectanceSource = "calibratedReflectance" | "composition" | "fallbackAccent";

export interface ResolvedSurfaceAppearance {
  readonly linearReflectance: LinearRgb;
  readonly source: SurfaceReflectanceSource;
  readonly visualAlbedoApplied: number | undefined;
  readonly opticalLibraryVersion: string | undefined;
}

export type SurfaceReflectanceResult = ResolvedSurfaceAppearance;

export interface DisplayExposureDiagnostics {
  readonly physicalIrradianceWattsPerSquareMeter: number | undefined;
  readonly preExposureMappedIrradiance: number;
  readonly displayExposure: number;
}

function finite(name: string, value: number): void {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function srgbChannelToLinear(value: number): number {
  const normalized = clamp01(value);
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

function linearChannelToSrgb(value: number): number {
  const normalized = clamp01(value);
  return normalized <= 0.0031308 ? normalized * 12.92 : 1.055 * normalized ** (1 / 2.4) - 0.055;
}

export function accentHexToLinearRgb(accentColor: number): LinearRgb {
  if (!Number.isSafeInteger(accentColor) || accentColor < 0 || accentColor > 0xffffff) throw new RangeError("accent color must be a 24-bit integer");
  return Object.freeze({
    r: srgbChannelToLinear((accentColor >> 16 & 0xff) / 255),
    g: srgbChannelToLinear((accentColor >> 8 & 0xff) / 255),
    b: srgbChannelToLinear((accentColor & 0xff) / 255),
  });
}

function weightedCompositionReflectance(appearance: CelestialAppearance | undefined): LinearRgb | undefined {
  const composition = appearance?.visibleLayer?.composition ?? [];
  if (composition.length === 0) return undefined;
  const result = { r: 0, g: 0, b: 0 };
  let recognizedFraction = 0;
  for (const component of composition) {
    const material = opticalMaterial(component.materialId);
    if (material === undefined) continue;
    result.r += material.linearReflectance.r * component.fraction;
    result.g += material.linearReflectance.g * component.fraction;
    result.b += material.linearReflectance.b * component.fraction;
    recognizedFraction += component.fraction;
  }
  return recognizedFraction <= 0 ? undefined : Object.freeze(result);
}

function luminance(value: LinearRgb): number {
  return value.r * LINEAR_SRGB_LUMINANCE.r + value.g * LINEAR_SRGB_LUMINANCE.g + value.b * LINEAR_SRGB_LUMINANCE.b;
}

export function normalizeLinearReflectanceToAlbedo(value: LinearRgb, visualAlbedo: number): LinearRgb {
  finite("visual albedo", visualAlbedo);
  if (visualAlbedo < 0 || visualAlbedo > 1) throw new RangeError("visual albedo must be within [0, 1]");
  const currentLuminance = luminance(value);
  if (visualAlbedo === 0 || currentLuminance === 0) return Object.freeze({ r: 0, g: 0, b: 0 });
  const scale = visualAlbedo / currentLuminance;
  return Object.freeze({ r: value.r * scale, g: value.g * scale, b: value.b * scale });
}

export function deriveSurfaceReflectance(appearance: CelestialAppearance | undefined, accentColor: number): ResolvedSurfaceAppearance {
  const calibrated = appearance?.visibleLayer?.calibratedReflectance;
  const composition = calibrated === undefined ? weightedCompositionReflectance(appearance) : undefined;
  const fallback = accentHexToLinearRgb(accentColor);
  const base = calibrated ?? composition ?? fallback;
  const source: SurfaceReflectanceSource = calibrated !== undefined ? "calibratedReflectance" : composition !== undefined ? "composition" : "fallbackAccent";
  const visualAlbedo = appearance?.visibleLayer?.visualAlbedo;
  return Object.freeze({
    linearReflectance: visualAlbedo === undefined ? base : normalizeLinearReflectanceToAlbedo(base, visualAlbedo),
    source,
    visualAlbedoApplied: visualAlbedo,
    opticalLibraryVersion: composition === undefined ? undefined : OPTICAL_LIBRARY_VERSION,
  });
}

export const resolveSurfaceAppearance = deriveSurfaceReflectance;

function normalizeChromaticity(value: LinearRgb): LinearRgb {
  const maximum = Math.max(value.r, value.g, value.b, Number.EPSILON);
  return Object.freeze({ r: value.r / maximum, g: value.g / maximum, b: value.b / maximum });
}

/** Deterministic blackbody approximation; output is linear RGB chromaticity. */
export function blackbodyTemperatureToLinearRgb(temperatureKelvin: number): LinearRgb {
  finite("effective temperature", temperatureKelvin);
  if (temperatureKelvin < 1_000 || temperatureKelvin > 50_000) throw new RangeError("effective temperature is outside the supported approximation range");
  const temperature = temperatureKelvin / 100;
  const red = temperature <= 66 ? 255 : 329.698727446 * (temperature - 60) ** -0.1332047592;
  const green = temperature <= 66 ? 99.4708025861 * Math.log(temperature) - 161.1195681661 : 288.1221695283 * (temperature - 60) ** -0.0755148492;
  const blue = temperature >= 66 ? 255 : temperature <= 19 ? 0 : 138.5177312231 * Math.log(temperature - 10) - 305.0447927307;
  return normalizeChromaticity({
    r: srgbChannelToLinear(clamp01(red / 255)),
    g: srgbChannelToLinear(clamp01(green / 255)),
    b: srgbChannelToLinear(clamp01(blue / 255)),
  });
}

export function mapIrradianceToSceneIntensity(irradianceWattsPerSquareMeter: number): number {
  finite("irradiance", irradianceWattsPerSquareMeter);
  if (irradianceWattsPerSquareMeter < 0) throw new RangeError("irradiance must be non-negative");
  return irradianceWattsPerSquareMeter / REFERENCE_IRRADIANCE_WATTS_PER_SQUARE_METER;
}

/** Maps physical irradiance to a bounded final-display exposure only. */
export function displayExposureForIrradiance(irradianceWattsPerSquareMeter: number): number {
  finite("irradiance", irradianceWattsPerSquareMeter);
  if (irradianceWattsPerSquareMeter < 0) throw new RangeError("irradiance must be non-negative");
  if (irradianceWattsPerSquareMeter === 0) return MAX_DISPLAY_EXPOSURE;
  const relativeExposure = REFERENCE_IRRADIANCE_WATTS_PER_SQUARE_METER / irradianceWattsPerSquareMeter;
  return Math.min(MAX_DISPLAY_EXPOSURE, Math.max(MIN_DISPLAY_EXPOSURE, relativeExposure ** DISPLAY_EXPOSURE_RESPONSE));
}

export function displayExposureDiagnostics(physicalIrradianceWattsPerSquareMeter: number | undefined): DisplayExposureDiagnostics {
  const preExposureMappedIrradiance = physicalIrradianceWattsPerSquareMeter === undefined ? 0 : mapIrradianceToSceneIntensity(physicalIrradianceWattsPerSquareMeter);
  return Object.freeze({
    physicalIrradianceWattsPerSquareMeter,
    preExposureMappedIrradiance,
    displayExposure: physicalIrradianceWattsPerSquareMeter === undefined ? DEFAULT_DISPLAY_EXPOSURE : displayExposureForIrradiance(physicalIrradianceWattsPerSquareMeter),
  });
}

export function linearRgbToSrgb(value: LinearRgb): LinearRgb {
  return Object.freeze({ r: linearChannelToSrgb(value.r), g: linearChannelToSrgb(value.g), b: linearChannelToSrgb(value.b) });
}
