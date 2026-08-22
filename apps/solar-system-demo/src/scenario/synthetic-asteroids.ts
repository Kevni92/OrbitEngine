import {
  meters,
  metersPerSecond,
  ObjectType,
  propagationState,
  PropagationDirection,
  PropagationModelKind,
  type ObjectId,
  type PropagationState,
  type ReferenceFrameId,
} from "orbit-engine";
import { j2000EclipticToIcrs } from "../coordinate-conventions.js";
import {
  SCENARIO_EPOCH,
  SUN_CENTERED_FRAME,
  SUN_ID,
  type ScenarioBodyDefinition,
} from "./scenario-data.js";
import type { CelestialBodyDefinition } from "./celestial-catalog.js";

export const MAX_RUNTIME_ASTEROIDS = 10_000;
export const SYNTHETIC_ASTEROID_AU_MIN = 2.1;
export const SYNTHETIC_ASTEROID_AU_MAX = 3.3;
const ASTRONOMICAL_UNIT_METERS = 149_597_870_700;
const MAX_UINT32 = 0xffff_ffff;

export interface SyntheticAsteroidSettings {
  readonly seed: string | number;
  readonly ids: readonly ObjectId[];
  readonly epoch?: typeof SCENARIO_EPOCH;
  readonly propagationFrame?: ReferenceFrameId;
}

export interface SyntheticAsteroid {
  readonly sequence: number;
  readonly definition: ScenarioBodyDefinition;
}

function normalizeSeed(seed: string | number): number {
  if (typeof seed === "number") {
    if (!Number.isFinite(seed)) throw new RangeError("Synthetic asteroid seed must be finite");
    return Math.trunc(seed) >>> 0;
  }
  let hash = 2_166_136_261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function nextRandom(state: { value: number }): number {
  state.value = (state.value + 0x6d2b79f5) >>> 0;
  let value = state.value;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / (MAX_UINT32 + 1);
}

function configRevision(seed: number, sequence: number): string {
  return String((Math.imul(seed, 1_664_525) + sequence + 1) >>> 0);
}

function stateFor(
  radiusAu: number,
  phase: number,
  inclination: number,
  centralMu: number,
  epoch: typeof SCENARIO_EPOCH,
  propagationFrame: ReferenceFrameId,
): PropagationState {
  const radius = radiusAu * ASTRONOMICAL_UNIT_METERS;
  const speed = Math.sqrt(centralMu / radius);
  const cosPhase = Math.cos(phase);
  const sinPhase = Math.sin(phase);
  const cosInclination = Math.cos(inclination);
  const sinInclination = Math.sin(inclination);
  const position = j2000EclipticToIcrs({
    x: radius * cosPhase,
    y: radius * sinPhase * cosInclination,
    z: radius * sinPhase * sinInclination,
  });
  const velocity = j2000EclipticToIcrs({
    x: -speed * sinPhase,
    y: speed * cosPhase * cosInclination,
    z: speed * cosPhase * sinInclination,
  });
  return propagationState({
    position: { x: meters(position.x), y: meters(position.y), z: meters(position.z) },
    velocity: { x: metersPerSecond(velocity.x), y: metersPerSecond(velocity.y), z: metersPerSecond(velocity.z) },
    epoch,
    referenceFrame: propagationFrame,
  });
}

function syntheticDefinition(
  id: ObjectId,
  sequence: number,
  seed: number,
  state: PropagationState,
): CelestialBodyDefinition {
  return Object.freeze({
    id,
    name: `Synthetic Asteroid ${sequence + 1}`,
    type: ObjectType.asteroid,
    centralBody: SUN_ID,
    properties: Object.freeze({ physicalRadius: 25_000 + (sequence % 10) * 5_000 }),
    anchor: state,
    propagation: Object.freeze({
      modelKind: PropagationModelKind.twoBodyAnalytical,
      direction: PropagationDirection.bidirectional,
      propagationFrame: state.referenceFrame,
      configurationRevision: configRevision(seed, sequence),
    }),
    display: Object.freeze({
      color: 0x9aa7b5,
      category: "asteroid",
      aliases: Object.freeze(["synthetic", "runtime", "asteroid"]),
      defaultVisible: true,
    }),
    provenance: Object.freeze({
      source: "OrbitEngine deterministic synthetic demo population",
      sourceUrl: "https://github.com/Kevni92/OrbitEngine",
      sourceIdentifier: `synthetic:${seed}:${sequence}`,
      retrievalDate: "2026-08-22",
      sourceEpoch: "J2000 TDB",
      sourceTimeScale: "TDB",
      sourceFrame: "J2000 ecliptic input transformed to ICRS/ICRF-aligned engine axes",
      normalization: "Deterministic SI circular-orbit fixture generated in the demo overlay",
      limitations: "Synthetic initial conditions for rendering stress tests; not an observed asteroid population.",
    }),
  });
}

export function createSyntheticAsteroids(settings: SyntheticAsteroidSettings, centralMu: number): readonly SyntheticAsteroid[] {
  if (settings.ids.length > MAX_RUNTIME_ASTEROIDS) throw new RangeError(`Synthetic asteroid count exceeds ${MAX_RUNTIME_ASTEROIDS}`);
  if (!Number.isFinite(centralMu) || centralMu <= 0) throw new RangeError("Synthetic asteroid central μ must be positive");
  const seed = normalizeSeed(settings.seed);
  const random = { value: seed };
  const epoch = settings.epoch ?? SCENARIO_EPOCH;
  const propagationFrame = settings.propagationFrame ?? SUN_CENTERED_FRAME;
  return Object.freeze(settings.ids.map((id, sequence) => {
    const radiusAu = SYNTHETIC_ASTEROID_AU_MIN
      + (SYNTHETIC_ASTEROID_AU_MAX - SYNTHETIC_ASTEROID_AU_MIN) * nextRandom(random);
    const phase = nextRandom(random) * Math.PI * 2;
    const inclination = (nextRandom(random) - 0.5) * (16 * Math.PI / 180);
    const state = stateFor(radiusAu, phase, inclination, centralMu, epoch, propagationFrame);
    return Object.freeze({ sequence, definition: syntheticDefinition(id, sequence, seed, state) });
  }));
}
