import { opticalGas, type CelestialAppearance, type LinearRgb } from "./appearance.js";

export interface AtmosphereOptics {
  readonly rayleighScattering: LinearRgb;
  readonly mieScattering: LinearRgb;
  readonly absorption: LinearRgb;
  readonly referenceVerticalOpticalDepth: number;
  readonly mieAnisotropy: number;
  readonly source: "explicit" | "gas-library" | "zero-fallback";
}

export type ResolvedAtmosphereOptics = AtmosphereOptics;

const ZERO_RGB: LinearRgb = Object.freeze({ r: 0, g: 0, b: 0 });

function addRgb(left: LinearRgb, right: LinearRgb): LinearRgb {
  return { r: left.r + right.r, g: left.g + right.g, b: left.b + right.b };
}

function scaleRgb(value: LinearRgb, scale: number): LinearRgb {
  return { r: value.r * scale, g: value.g * scale, b: value.b * scale };
}

function nonNegativeRgb(value: LinearRgb): LinearRgb {
  return { r: Math.max(0, value.r), g: Math.max(0, value.g), b: Math.max(0, value.b) };
}

/** Resolves calibrated optics first, then known-gas and explicit zero fallbacks. */
export function resolveAtmosphereOptics(appearance: CelestialAppearance | undefined): AtmosphereOptics | undefined {
  const atmosphere = appearance?.atmosphere;
  if (atmosphere === undefined) return undefined;
  if (atmosphere.optics !== undefined) {
    const haze = atmosphere.haze;
    const mieScattering = haze?.calibratedScattering === undefined ? atmosphere.optics.mieScattering : addRgb(atmosphere.optics.mieScattering, haze.calibratedScattering);
    const absorption = haze?.calibratedAbsorption === undefined ? atmosphere.optics.absorption : addRgb(atmosphere.optics.absorption, haze.calibratedAbsorption);
    return Object.freeze({
      rayleighScattering: atmosphere.optics.rayleighScattering,
      mieScattering: nonNegativeRgb(mieScattering),
      absorption: nonNegativeRgb(absorption),
      referenceVerticalOpticalDepth: atmosphere.optics.referenceVerticalOpticalDepth + (haze?.opticalDepthContribution ?? 0),
      mieAnisotropy: haze?.mieAnisotropy ?? atmosphere.optics.mieAnisotropy,
      source: "explicit",
    });
  }

  let rayleigh = ZERO_RGB;
  let recognizedGasFraction = 0;
  for (const gas of atmosphere.gases) {
    const optical = opticalGas(gas.gasId);
    if (optical === undefined) continue;
    rayleigh = addRgb(rayleigh, scaleRgb(optical.rayleighScattering, gas.mixingRatio));
    recognizedGasFraction += gas.mixingRatio;
  }
  const haze = atmosphere.haze;
  const mie = haze?.calibratedScattering ?? ZERO_RGB;
  const absorption = haze?.calibratedAbsorption ?? ZERO_RGB;
  const hasOpticalInput = recognizedGasFraction > 0 || haze?.calibratedScattering !== undefined || haze?.calibratedAbsorption !== undefined;
  return Object.freeze({
    rayleighScattering: rayleigh,
    mieScattering: mie,
    absorption,
    referenceVerticalOpticalDepth: Math.max(0, haze?.opticalDepthContribution ?? 0),
    mieAnisotropy: haze?.mieAnisotropy ?? -0.05,
    source: hasOpticalInput ? "gas-library" : "zero-fallback",
  });
}
