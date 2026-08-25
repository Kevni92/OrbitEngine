import type { AtmosphereOptics } from "./atmosphere.js";

export interface AtmosphereTransportOptics {
  readonly rayleighScattering: { readonly r: number; readonly g: number; readonly b: number };
  readonly mieScattering: { readonly r: number; readonly g: number; readonly b: number };
  readonly absorption: { readonly r: number; readonly g: number; readonly b: number };
  readonly extinction: { readonly r: number; readonly g: number; readonly b: number };
  readonly referenceVerticalOpticalDepth: number;
  readonly mieAnisotropy: number;
  readonly source: AtmosphereOptics["source"];
  /** Common scale removed from the semantic RGB coefficients for transport. */
  readonly coefficientNormalization: number;
}

export interface AtmosphereSingleScatteringSampleInput {
  /** Density column represented by this fixed view sample in scale heights. */
  readonly sampleDensityColumnScaleHeights: number;
  readonly verticalDensityIntegral: number;
  readonly viewDensityPath: number;
  readonly lightDensityPath: number;
  readonly lightVisible: boolean;
  readonly rayleighPhase: number;
  readonly miePhase: number;
  readonly lightIntensity: number;
}

export interface AtmosphereRgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

const EPSILON = 1e-12;
const LINEAR_SRGB_LUMINANCE = Object.freeze({ r: 0.2126, g: 0.7152, b: 0.0722 });
const ZERO_RGB: AtmosphereRgb = Object.freeze({ r: 0, g: 0, b: 0 });

function scaleRgb(value: AtmosphereRgb, scale: number): AtmosphereRgb {
  return Object.freeze({ r: value.r * scale, g: value.g * scale, b: value.b * scale });
}

function addRgb(left: AtmosphereRgb, right: AtmosphereRgb): AtmosphereRgb {
  return Object.freeze({ r: left.r + right.r, g: left.g + right.g, b: left.b + right.b });
}

function multiplyRgb(left: AtmosphereRgb, right: AtmosphereRgb): AtmosphereRgb {
  return Object.freeze({ r: left.r * right.r, g: left.g * right.g, b: left.b * right.b });
}

function luminance(value: AtmosphereRgb): number {
  return value.r * LINEAR_SRGB_LUMINANCE.r
    + value.g * LINEAR_SRGB_LUMINANCE.g
    + value.b * LINEAR_SRGB_LUMINANCE.b;
}

function finiteNonNegative(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} must be finite and non-negative`);
}

function finite(name: string, value: number): void {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
}

/**
 * Converts renderer-neutral spectral coefficients into a transport shape.
 *
 * The appearance contract provides spectral coefficients and an independently
 * calibrated reference vertical optical depth. The coefficients therefore
 * preserve wavelength ratios, while the reference optical depth is the sole
 * scalar path-strength calibration. Applying one common normalization avoids
 * multiplying that strength into both the source sample weight and opacity.
 */
export function normalizeAtmosphereOpticsForTransport(optics: AtmosphereOptics): AtmosphereTransportOptics {
  const rayleigh = optics.rayleighScattering;
  const mie = optics.mieScattering;
  const absorption = optics.absorption;
  const rawExtinction = addRgb(
    addRgb(rayleigh, mie),
    absorption,
  );
  // Use the linear-sRGB luminance of the combined extinction as the common
  // scalar. This keeps reference optical depth as the calibrated overall
  // strength while retaining enough wavelength contrast for long tangent
  // paths to redden/amber naturally.
  const normalization = luminance(rawExtinction);
  const scale = normalization > EPSILON ? 1 / normalization : 0;
  const normalizedRayleigh = scaleRgb(rayleigh, scale);
  const normalizedMie = scaleRgb(mie, scale);
  const normalizedAbsorption = scaleRgb(absorption, scale);
  return Object.freeze({
    rayleighScattering: normalizedRayleigh,
    mieScattering: normalizedMie,
    absorption: normalizedAbsorption,
    extinction: addRgb(addRgb(normalizedRayleigh, normalizedMie), normalizedAbsorption),
    referenceVerticalOpticalDepth: optics.referenceVerticalOpticalDepth,
    mieAnisotropy: optics.mieAnisotropy,
    source: optics.source,
    coefficientNormalization: normalization > EPSILON ? normalization : 1,
  });
}

export function atmosphereOpticalDepth(
  optics: AtmosphereTransportOptics,
  densityPath: number,
): AtmosphereRgb {
  finiteNonNegative("density path", densityPath);
  return scaleRgb(optics.extinction, optics.referenceVerticalOpticalDepth * densityPath);
}

export function atmosphereTransmittance(
  optics: AtmosphereTransportOptics,
  densityPath: number,
): AtmosphereRgb {
  const opticalDepth = atmosphereOpticalDepth(optics, densityPath);
  return Object.freeze({
    r: Math.exp(-opticalDepth.r),
    g: Math.exp(-opticalDepth.g),
    b: Math.exp(-opticalDepth.b),
  });
}

/** The source weight is a density-column weight, not an additional optical depth. */
export function atmosphereSampleScatteringWeight(sampleDensityColumnScaleHeights: number, verticalDensityIntegral: number): number {
  finiteNonNegative("sample density column", sampleDensityColumnScaleHeights);
  finite("vertical density integral", verticalDensityIntegral);
  if (verticalDensityIntegral <= 0) throw new RangeError("vertical density integral must be positive");
  return sampleDensityColumnScaleHeights / verticalDensityIntegral;
}

/**
 * Reference implementation of one bounded shader sample. The GLSL shader in
 * view.ts mirrors this ordering; keeping the scalar/vector math here makes the
 * regression properties deterministic without relying on a particular GPU.
 */
export function atmosphereSingleScatteringSample(
  optics: AtmosphereTransportOptics,
  input: AtmosphereSingleScatteringSampleInput,
): AtmosphereRgb {
  finiteNonNegative("sample density column", input.sampleDensityColumnScaleHeights);
  finite("vertical density integral", input.verticalDensityIntegral);
  finiteNonNegative("view density path", input.viewDensityPath);
  finiteNonNegative("light density path", input.lightDensityPath);
  finite("rayleigh phase", input.rayleighPhase);
  finite("mie phase", input.miePhase);
  finiteNonNegative("light intensity", input.lightIntensity);
  if (!input.lightVisible || input.lightIntensity === 0) return ZERO_RGB;
  const source = addRgb(
    scaleRgb(optics.rayleighScattering, input.rayleighPhase),
    scaleRgb(optics.mieScattering, input.miePhase),
  );
  const transmittance = multiplyRgb(
    atmosphereTransmittance(optics, input.viewDensityPath),
    atmosphereTransmittance(optics, input.lightDensityPath),
  );
  return scaleRgb(
    multiplyRgb(source, transmittance),
    input.lightIntensity * atmosphereSampleScatteringWeight(input.sampleDensityColumnScaleHeights, input.verticalDensityIntegral),
  );
}

export function atmosphereCompositeAlpha(optics: AtmosphereTransportOptics, densityPath: number): number {
  return Math.min(0.94, Math.max(0, 1 - Math.exp(-optics.referenceVerticalOpticalDepth * densityPath)));
}

export function atmosphereCompositeRadiance(
  scattering: AtmosphereRgb,
  alpha: number,
  displayExposure: number,
  displayGain = 25,
): AtmosphereRgb {
  finiteNonNegative("alpha", alpha);
  finiteNonNegative("display exposure", displayExposure);
  finiteNonNegative("display gain", displayGain);
  return scaleRgb(scattering, displayGain * alpha * displayExposure);
}
