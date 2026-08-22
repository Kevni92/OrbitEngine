import {
  opticalMaterial,
  type CelestialAppearance,
  type LinearRgb,
} from "../scenario/celestial-appearance.js";
import type { ObjectId } from "orbit-engine";

export const LINEAR_SRGB_LUMINANCE = Object.freeze({ r: 0.2126, g: 0.7152, b: 0.0722 });
export const FALLBACK_VISUAL_ALBEDO = 0.32;
export const REFERENCE_IRRADIANCE_WATTS_PER_SQUARE_METER = 1_361;
export const MIN_STELLAR_DISTANCE_METERS = 1;

export type SurfaceReflectanceSource = "calibratedReflectance" | "composition" | "fallbackAccent";

export interface SurfaceReflectanceResult {
  readonly linearReflectance: LinearRgb;
  readonly source: SurfaceReflectanceSource;
  readonly visualAlbedoApplied: number | undefined;
  readonly opticalLibraryVersion: string | undefined;
}

export interface CartesianPosition {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface StellarEmitter {
  readonly objectId: ObjectId;
  readonly position: CartesianPosition;
  readonly effectiveTemperatureKelvin: number;
  readonly luminosityWatts: number;
}

export interface StellarIlluminationContribution {
  readonly emitterId: ObjectId;
  readonly directionToEmitter: CartesianPosition;
  readonly distanceMeters: number;
  readonly irradianceWattsPerSquareMeter: number;
  readonly linearChromaticity: LinearRgb;
  readonly exposureMappedIrradiance: number;
}

export interface StellarIlluminationSet {
  readonly contributions: readonly StellarIlluminationContribution[];
  readonly totalIrradianceWattsPerSquareMeter: number;
  readonly additiveLinearLight: LinearRgb;
}

function finite(name: string, value: number): void {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
}

function finitePosition(name: string, position: CartesianPosition): void {
  finite(`${name}.x`, position.x);
  finite(`${name}.y`, position.y);
  finite(`${name}.z`, position.z);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function srgbChannelToLinear(value: number): number {
  const normalized = clamp01(value);
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function linearChannelToSrgb(value: number): number {
  const normalized = clamp01(value);
  return normalized <= 0.0031308
    ? normalized * 12.92
    : 1.055 * normalized ** (1 / 2.4) - 0.055;
}

export function accentHexToLinearRgb(accentColor: number): LinearRgb {
  if (!Number.isSafeInteger(accentColor) || accentColor < 0 || accentColor > 0xffffff) {
    throw new RangeError("accent color must be a 24-bit integer");
  }
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
  if (recognizedFraction <= 0) return undefined;
  return Object.freeze({ r: result.r, g: result.g, b: result.b });
}

function luminance(value: LinearRgb): number {
  return value.r * LINEAR_SRGB_LUMINANCE.r
    + value.g * LINEAR_SRGB_LUMINANCE.g
    + value.b * LINEAR_SRGB_LUMINANCE.b;
}

export function normalizeLinearReflectanceToAlbedo(value: LinearRgb, visualAlbedo: number): LinearRgb {
  finite("visual albedo", visualAlbedo);
  if (visualAlbedo < 0 || visualAlbedo > 1) throw new RangeError("visual albedo must be within [0, 1]");
  const currentLuminance = luminance(value);
  if (visualAlbedo === 0 || currentLuminance === 0) return Object.freeze({ r: 0, g: 0, b: 0 });
  const scale = visualAlbedo / currentLuminance;
  return Object.freeze({ r: value.r * scale, g: value.g * scale, b: value.b * scale });
}

export function deriveSurfaceReflectance(appearance: CelestialAppearance | undefined, accentColor: number): SurfaceReflectanceResult {
  const calibrated = appearance?.visibleLayer?.calibratedReflectance;
  const composition = calibrated === undefined ? weightedCompositionReflectance(appearance) : undefined;
  const fallback = accentHexToLinearRgb(accentColor);
  const base = calibrated ?? composition ?? fallback;
  const source: SurfaceReflectanceSource = calibrated !== undefined
    ? "calibratedReflectance"
    : composition !== undefined
      ? "composition"
      : "fallbackAccent";
  const visualAlbedo = appearance?.visibleLayer?.visualAlbedo;
  const linearReflectance = visualAlbedo === undefined
    ? base
    : normalizeLinearReflectanceToAlbedo(base, visualAlbedo);
  return Object.freeze({
    linearReflectance,
    source,
    visualAlbedoApplied: visualAlbedo,
    opticalLibraryVersion: composition === undefined ? undefined : "demo-optics-1",
  });
}

function normalizeChromaticity(value: LinearRgb): LinearRgb {
  const maximum = Math.max(value.r, value.g, value.b, Number.EPSILON);
  return Object.freeze({ r: value.r / maximum, g: value.g / maximum, b: value.b / maximum });
}

/** Deterministic blackbody approximation; output is linear RGB chromaticity. */
export function blackbodyTemperatureToLinearRgb(temperatureKelvin: number): LinearRgb {
  finite("effective temperature", temperatureKelvin);
  if (temperatureKelvin < 1_000 || temperatureKelvin > 50_000) {
    throw new RangeError("effective temperature is outside the supported approximation range");
  }
  const temperature = temperatureKelvin / 100;
  const red = temperature <= 66
    ? 255
    : 329.698727446 * (temperature - 60) ** -0.1332047592;
  const green = temperature <= 66
    ? 99.4708025861 * Math.log(temperature) - 161.1195681661
    : 288.1221695283 * (temperature - 60) ** -0.0755148492;
  const blue = temperature >= 66
    ? 255
    : temperature <= 19
      ? 0
      : 138.5177312231 * Math.log(temperature - 10) - 305.0447927307;
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

function distanceBetween(left: CartesianPosition, right: CartesianPosition): number {
  return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
}

function unitDirection(from: CartesianPosition, to: CartesianPosition, distance: number): CartesianPosition {
  return Object.freeze({
    x: (to.x - from.x) / distance,
    y: (to.y - from.y) / distance,
    z: (to.z - from.z) / distance,
  });
}

export function resolveStellarIllumination(
  bodyPosition: CartesianPosition,
  emitters: readonly StellarEmitter[],
): StellarIlluminationSet {
  finitePosition("body position", bodyPosition);
  const contributions = emitters.map((emitter) => {
    finitePosition(`emitter ${emitter.objectId} position`, emitter.position);
    finite(`emitter ${emitter.objectId} temperature`, emitter.effectiveTemperatureKelvin);
    finite(`emitter ${emitter.objectId} luminosity`, emitter.luminosityWatts);
    if (emitter.luminosityWatts < 0) throw new RangeError(`emitter ${emitter.objectId} luminosity must be non-negative`);
    const distance = distanceBetween(bodyPosition, emitter.position);
    if (!Number.isFinite(distance) || distance < MIN_STELLAR_DISTANCE_METERS) {
      throw new RangeError(`emitter ${emitter.objectId} distance is invalid or below the finite guard`);
    }
    const irradiance = emitter.luminosityWatts / (4 * Math.PI * distance ** 2);
    const chromaticity = blackbodyTemperatureToLinearRgb(emitter.effectiveTemperatureKelvin);
    return Object.freeze({
      emitterId: emitter.objectId,
      directionToEmitter: unitDirection(bodyPosition, emitter.position, distance),
      distanceMeters: distance,
      irradianceWattsPerSquareMeter: irradiance,
      linearChromaticity: chromaticity,
      exposureMappedIrradiance: mapIrradianceToSceneIntensity(irradiance),
    });
  });
  const totalIrradiance = contributions.reduce((sum, contribution) => sum + contribution.irradianceWattsPerSquareMeter, 0);
  const additiveLinearLight = contributions.reduce((sum, contribution) => ({
    r: sum.r + contribution.linearChromaticity.r * contribution.exposureMappedIrradiance,
    g: sum.g + contribution.linearChromaticity.g * contribution.exposureMappedIrradiance,
    b: sum.b + contribution.linearChromaticity.b * contribution.exposureMappedIrradiance,
  }), { r: 0, g: 0, b: 0 });
  return Object.freeze({
    contributions: Object.freeze(contributions),
    totalIrradianceWattsPerSquareMeter: totalIrradiance,
    additiveLinearLight: Object.freeze(additiveLinearLight),
  });
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
    const cosine = Math.max(0, normalizedNormal.x * contribution.directionToEmitter.x
      + normalizedNormal.y * contribution.directionToEmitter.y
      + normalizedNormal.z * contribution.directionToEmitter.z);
    return {
      r: sum.r + reflectance.r * cosine * contribution.exposureMappedIrradiance * contribution.linearChromaticity.r,
      g: sum.g + reflectance.g * cosine * contribution.exposureMappedIrradiance * contribution.linearChromaticity.g,
      b: sum.b + reflectance.b * cosine * contribution.exposureMappedIrradiance * contribution.linearChromaticity.b,
    };
  }, { r: 0, g: 0, b: 0 }));
}

export function linearRgbToSrgb(value: LinearRgb): LinearRgb {
  return Object.freeze({ r: linearChannelToSrgb(value.r), g: linearChannelToSrgb(value.g), b: linearChannelToSrgb(value.b) });
}
