import {
  ObjectType,
  PropagationModelKind,
  meters,
  metersPerSecond,
  objectId,
  propagationState,
  revisionId,
  type ObjectId,
  type ObjectRecord,
  type OrbitEngine,
  type PropagationState,
} from "orbit-engine";
import { j2000EclipticToIcrs } from "../coordinate-conventions.js";
import { ASTRONOMICAL_UNIT_METERS } from "../rendering/render-space.js";
import type { SolarSystemScenario } from "./load-solar-system.js";
import { SUN_ID } from "./scenario-data.js";

const FIRST_RUNTIME_OBJECT_ID = 9_000_000_000_000_000_000n;
const MAX_OBJECT_ID = 18_446_744_073_709_551_615n;
const MIN_SEMI_MAJOR_AXIS_AU = 2.1;
const MAX_SEMI_MAJOR_AXIS_AU = 3.3;
const MAX_INCLINATION_RADIANS = 15 * Math.PI / 180;
const MIN_RADIUS_METERS = 100;
const MAX_RADIUS_METERS = 20_000;

export interface RuntimeAsteroidDefinition {
  readonly id: ObjectId;
  readonly name: string;
  readonly anchor: PropagationState;
  readonly physicalRadiusMeters: number;
  readonly synthetic: true;
  readonly seed: number;
}

export interface RuntimeAsteroidEntry extends RuntimeAsteroidDefinition {
  readonly record: ObjectRecord;
}

export interface RuntimeAsteroidBatchOptions {
  readonly count: number;
  readonly seed: number;
}

export interface RuntimeAsteroidBatchResult {
  readonly requested: number;
  readonly created: number;
  readonly error?: unknown;
}

export interface RuntimeAsteroidRemovalResult {
  readonly requested: number;
  readonly removed: number;
  readonly errors: readonly unknown[];
}

function normalizedCount(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 10_000) {
    throw new RangeError("Runtime asteroid count must be a safe integer from 1 to 10000");
  }
  return value;
}

function normalizedSeed(value: number): number {
  if (!Number.isSafeInteger(value)) throw new RangeError("Runtime asteroid seed must be a safe integer");
  return value | 0;
}

/** Small deterministic PRNG suitable for reproducible demo fixtures, not cryptography. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4_294_967_296;
  };
}

function rotateOrbitalPlane(
  x: number,
  y: number,
  inclination: number,
  ascendingNode: number,
): { readonly x: number; readonly y: number; readonly z: number } {
  const cosNode = Math.cos(ascendingNode);
  const sinNode = Math.sin(ascendingNode);
  const cosInclination = Math.cos(inclination);
  const sinInclination = Math.sin(inclination);
  return Object.freeze({
    x: cosNode * x - sinNode * cosInclination * y,
    y: sinNode * x + cosNode * cosInclination * y,
    z: sinInclination * y,
  });
}

export function generateSyntheticAsteroidAnchors(
  options: RuntimeAsteroidBatchOptions,
  scenario: Pick<SolarSystemScenario, "epoch" | "sunCenteredFrame" | "bodyById">,
): readonly Omit<RuntimeAsteroidDefinition, "id" | "name">[] {
  const count = normalizedCount(options.count);
  const seed = normalizedSeed(options.seed);
  const random = mulberry32(seed);
  const sun = scenario.bodyById.get(SUN_ID);
  const mu = sun?.record.properties.mu;
  if (mu === undefined) throw new RangeError("Runtime asteroid generation requires the Sun gravitational parameter");

  const result: Omit<RuntimeAsteroidDefinition, "id" | "name">[] = [];
  for (let index = 0; index < count; index += 1) {
    const semiMajorAxis = (MIN_SEMI_MAJOR_AXIS_AU + random() * (MAX_SEMI_MAJOR_AXIS_AU - MIN_SEMI_MAJOR_AXIS_AU))
      * ASTRONOMICAL_UNIT_METERS;
    const phase = random() * Math.PI * 2;
    const inclination = (random() * 2 - 1) * MAX_INCLINATION_RADIANS;
    const ascendingNode = random() * Math.PI * 2;
    const orbitalSpeed = Math.sqrt(mu / semiMajorAxis);
    const inPlanePosition = rotateOrbitalPlane(
      semiMajorAxis * Math.cos(phase),
      semiMajorAxis * Math.sin(phase),
      inclination,
      ascendingNode,
    );
    const inPlaneVelocity = rotateOrbitalPlane(
      -orbitalSpeed * Math.sin(phase),
      orbitalSpeed * Math.cos(phase),
      inclination,
      ascendingNode,
    );
    const position = j2000EclipticToIcrs(inPlanePosition);
    const velocity = j2000EclipticToIcrs(inPlaneVelocity);
    const radiusLog = Math.log(MIN_RADIUS_METERS)
      + random() * (Math.log(MAX_RADIUS_METERS) - Math.log(MIN_RADIUS_METERS));
    const physicalRadiusMeters = Math.exp(radiusLog);
    result.push(Object.freeze({
      anchor: propagationState({
        position: {
          x: meters(position.x),
          y: meters(position.y),
          z: meters(position.z),
        },
        velocity: {
          x: metersPerSecond(velocity.x),
          y: metersPerSecond(velocity.y),
          z: metersPerSecond(velocity.z),
        },
        epoch: scenario.epoch,
        referenceFrame: scenario.sunCenteredFrame,
      }),
      physicalRadiusMeters,
      synthetic: true as const,
      seed,
    }));
  }
  return Object.freeze(result);
}

export class RuntimeObjectIdAllocator {
  #next = FIRST_RUNTIME_OBJECT_ID;
  readonly #reserved: Set<string>;

  constructor(existingIds: readonly ObjectId[]) {
    this.#reserved = new Set(existingIds);
    while (this.#reserved.has(this.#next.toString())) this.#next += 1n;
  }

  allocate(): ObjectId {
    if (this.#next > MAX_OBJECT_ID) throw new RangeError("Runtime ObjectId range is exhausted");
    const id = objectId(this.#next.toString());
    this.#reserved.add(id);
    this.#next += 1n;
    while (this.#next <= MAX_OBJECT_ID && this.#reserved.has(this.#next.toString())) this.#next += 1n;
    return id;
  }
}

export class RuntimeAsteroidSession {
  readonly #engine: OrbitEngine;
  readonly #scenario: SolarSystemScenario;
  readonly #allocator: RuntimeObjectIdAllocator;
  readonly #entries = new Map<ObjectId, RuntimeAsteroidEntry>();
  #configurationRevision = 1_000_000n;

  constructor(engine: OrbitEngine, scenario: SolarSystemScenario) {
    this.#engine = engine;
    this.#scenario = scenario;
    this.#allocator = new RuntimeObjectIdAllocator(scenario.objectIds);
  }

  entries(): readonly RuntimeAsteroidEntry[] {
    return Object.freeze([...this.#entries.values()]);
  }

  objectIds(): readonly ObjectId[] {
    return Object.freeze([...this.#entries.keys()]);
  }

  count(): number {
    return this.#entries.size;
  }

  addBatch(options: RuntimeAsteroidBatchOptions): RuntimeAsteroidBatchResult {
    const anchors = generateSyntheticAsteroidAnchors(options, this.#scenario);
    let created = 0;
    for (const generated of anchors) {
      try {
        const id = this.#allocator.allocate();
        const configurationRevision = revisionId((this.#configurationRevision++).toString());
        const sun = this.#scenario.bodyById.get(SUN_ID);
        if (sun === undefined || sun.record.properties.mu === undefined) {
          throw new RangeError("Runtime asteroid registration requires the registered Sun and its mu");
        }
        const record = this.#engine.registry().register({
          id,
          type: ObjectType.asteroid,
          properties: { physicalRadius: meters(generated.physicalRadiusMeters) },
          state: generated.anchor,
          motion: {
            modelKind: PropagationModelKind.twoBodyAnalytical,
            direction: "bidirectional",
            propagationFrame: this.#scenario.sunCenteredFrame,
            segmentStart: this.#scenario.validity.start,
            segmentEnd: this.#scenario.validity.end,
            configurationRevision,
            motionRevision: revisionId("1"),
          },
        });
        const model = this.#engine.twoBodyModel({
          anchor: generated.anchor,
          centralBody: SUN_ID,
          centralBodyRevision: sun.record.motion.motionRevision,
          mu: sun.record.properties.mu,
          muRevision: sun.record.propertyRevision,
          propagationFrame: this.#scenario.sunCenteredFrame,
          frameRevision: revisionId("1"),
          validity: this.#scenario.validity,
          configurationRevision,
        });
        this.#engine.bindMotionModel(id, model);
        const entry: RuntimeAsteroidEntry = Object.freeze({
          id,
          name: `Synthetic Asteroid ${id}`,
          anchor: generated.anchor,
          physicalRadiusMeters: generated.physicalRadiusMeters,
          synthetic: true,
          seed: generated.seed,
          record,
        });
        this.#entries.set(id, entry);
        created += 1;
      } catch (error) {
        return Object.freeze({ requested: anchors.length, created, error });
      }
    }
    return Object.freeze({ requested: anchors.length, created });
  }

  removeAll(): RuntimeAsteroidRemovalResult {
    const ids = [...this.#entries.keys()];
    const errors: unknown[] = [];
    let removed = 0;
    for (const id of ids) {
      try {
        this.#engine.registry().remove(id);
        this.#entries.delete(id);
        removed += 1;
      } catch (error) {
        errors.push(error);
      }
    }
    return Object.freeze({ requested: ids.length, removed, errors: Object.freeze(errors) });
  }
}
