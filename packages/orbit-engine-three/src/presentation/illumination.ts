import type { ObjectId } from "orbit-engine";
import { blackbodyTemperatureToLinearRgb, mapIrradianceToSceneIntensity } from "./optics.js";
import type { LinearRgb } from "./appearance.js";

export const MIN_STELLAR_DISTANCE_METERS = 1;
export const DEFAULT_MAX_STELLAR_CONTRIBUTORS = 4;

export interface CartesianPosition {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface StellarEmitter {
  readonly objectId: ObjectId;
  /** Authoritative SI snapshot position. Render-space positions are not accepted. */
  readonly position: CartesianPosition;
  readonly effectiveTemperatureKelvin: number;
  readonly luminosityWatts: number;
}

export interface StellarIlluminationContribution {
  readonly emitterId: ObjectId;
  /** Normalized body-to-emitter direction in authoritative state axes. */
  readonly directionToEmitter: CartesianPosition;
  readonly distanceMeters: number;
  readonly irradianceWattsPerSquareMeter: number;
  readonly linearChromaticity: LinearRgb;
  readonly exposureMappedIrradiance: number;
}

export interface StellarIlluminationDiagnostics {
  readonly configuredEmitterCount: number;
  readonly selectedEmitterCount: number;
  readonly maxStellarContributors: number;
  readonly truncatedEmitterIds: readonly ObjectId[];
}

export interface StellarIllumination {
  /** Highest-irradiance contributors kept for a bounded presentation pass. */
  readonly contributions: readonly StellarIlluminationContribution[];
  /** All physically resolved contributors, before the presentation cap. */
  readonly allContributions: readonly StellarIlluminationContribution[];
  /** Sum of all configured emitters, independent of the presentation cap. */
  readonly totalIrradianceWattsPerSquareMeter: number;
  /** Additive linear light from all configured emitters. */
  readonly additiveLinearLight: LinearRgb;
  readonly diagnostics: StellarIlluminationDiagnostics;
}

export type StellarIlluminationSet = StellarIllumination;

export interface StellarIlluminationOptions {
  readonly maxStellarContributors?: number;
}

function finite(name: string, value: number): void {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
}

function finitePosition(name: string, position: CartesianPosition): void {
  finite(`${name}.x`, position.x);
  finite(`${name}.y`, position.y);
  finite(`${name}.z`, position.z);
}

function distanceBetween(left: CartesianPosition, right: CartesianPosition): number {
  return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
}

function unitDirection(from: CartesianPosition, to: CartesianPosition, distance: number): CartesianPosition {
  return Object.freeze({ x: (to.x - from.x) / distance, y: (to.y - from.y) / distance, z: (to.z - from.z) / distance });
}

function compareEmitterId(left: ObjectId, right: ObjectId): number {
  const leftNumber = BigInt(left);
  const rightNumber = BigInt(right);
  return leftNumber < rightNumber ? -1 : leftNumber > rightNumber ? 1 : 0;
}

function sumLinearLight(contributions: readonly StellarIlluminationContribution[]): LinearRgb {
  return Object.freeze(contributions.reduce((sum, contribution) => ({
    r: sum.r + contribution.linearChromaticity.r * contribution.exposureMappedIrradiance,
    g: sum.g + contribution.linearChromaticity.g * contribution.exposureMappedIrradiance,
    b: sum.b + contribution.linearChromaticity.b * contribution.exposureMappedIrradiance,
  }), { r: 0, g: 0, b: 0 }));
}

export function resolveStellarIllumination(
  bodyPosition: CartesianPosition,
  emitters: readonly StellarEmitter[],
  options: StellarIlluminationOptions = {},
): StellarIllumination {
  finitePosition("body position", bodyPosition);
  const maxStellarContributors = options.maxStellarContributors ?? DEFAULT_MAX_STELLAR_CONTRIBUTORS;
  if (!Number.isSafeInteger(maxStellarContributors) || maxStellarContributors < 1) throw new RangeError("max stellar contributors must be a positive safe integer");
  const allContributions = emitters.map((emitter) => {
    finitePosition(`emitter ${emitter.objectId} position`, emitter.position);
    finite(`emitter ${emitter.objectId} temperature`, emitter.effectiveTemperatureKelvin);
    finite(`emitter ${emitter.objectId} luminosity`, emitter.luminosityWatts);
    if (emitter.luminosityWatts < 0) throw new RangeError(`emitter ${emitter.objectId} luminosity must be non-negative`);
    const distance = distanceBetween(bodyPosition, emitter.position);
    if (!Number.isFinite(distance) || distance < MIN_STELLAR_DISTANCE_METERS) throw new RangeError(`emitter ${emitter.objectId} distance is invalid or below the finite guard`);
    const irradiance = emitter.luminosityWatts / (4 * Math.PI * distance ** 2);
    return Object.freeze({
      emitterId: emitter.objectId,
      directionToEmitter: unitDirection(bodyPosition, emitter.position, distance),
      distanceMeters: distance,
      irradianceWattsPerSquareMeter: irradiance,
      linearChromaticity: blackbodyTemperatureToLinearRgb(emitter.effectiveTemperatureKelvin),
      exposureMappedIrradiance: mapIrradianceToSceneIntensity(irradiance),
    });
  });
  const ranked = [...allContributions].sort((left, right) => right.irradianceWattsPerSquareMeter - left.irradianceWattsPerSquareMeter || compareEmitterId(left.emitterId, right.emitterId));
  const contributions = ranked.slice(0, maxStellarContributors);
  const truncatedEmitterIds = ranked.slice(maxStellarContributors).map((contribution) => contribution.emitterId).sort(compareEmitterId);
  return Object.freeze({
    contributions: Object.freeze(contributions),
    allContributions: Object.freeze(allContributions),
    totalIrradianceWattsPerSquareMeter: allContributions.reduce((sum, contribution) => sum + contribution.irradianceWattsPerSquareMeter, 0),
    additiveLinearLight: sumLinearLight(allContributions),
    diagnostics: Object.freeze({
      configuredEmitterCount: emitters.length,
      selectedEmitterCount: contributions.length,
      maxStellarContributors,
      truncatedEmitterIds: Object.freeze(truncatedEmitterIds),
    }),
  });
}
