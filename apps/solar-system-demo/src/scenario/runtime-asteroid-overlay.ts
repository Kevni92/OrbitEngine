import type { ObjectId, OrbitEngine } from "orbit-engine";
import type { SolarSystemScenario, RegisteredScenarioBody } from "./load-solar-system.js";
import { registerScenarioChild } from "./load-solar-system.js";
import { RuntimeObjectIdAllocator } from "./object-id-allocator.js";
import { createSyntheticAsteroids, MAX_RUNTIME_ASTEROIDS } from "./synthetic-asteroids.js";

export interface RuntimeAsteroidBody extends RegisteredScenarioBody {
  readonly synthetic: true;
}

export class RuntimeAsteroidOverlay {
  readonly #engine: OrbitEngine;
  readonly #scenario: SolarSystemScenario;
  readonly #allocator: RuntimeObjectIdAllocator;
  readonly #bodies = new Map<ObjectId, RuntimeAsteroidBody>();
  #revision = 0;

  constructor(engine: OrbitEngine, scenario: SolarSystemScenario) {
    this.#engine = engine;
    this.#scenario = scenario;
    this.#allocator = new RuntimeObjectIdAllocator(scenario.objectIds);
  }

  get revision(): number {
    return this.#revision;
  }

  get count(): number {
    return this.#bodies.size;
  }

  entries(): readonly RuntimeAsteroidBody[] {
    return Object.freeze([...this.#bodies.values()]);
  }

  get(id: ObjectId): RuntimeAsteroidBody | undefined {
    return this.#bodies.get(id);
  }

  add(count: number, seed: string | number): readonly RuntimeAsteroidBody[] {
    if (!Number.isSafeInteger(count) || count < 1 || count > MAX_RUNTIME_ASTEROIDS) {
      throw new RangeError(`Synthetic asteroid count must be between 1 and ${MAX_RUNTIME_ASTEROIDS}`);
    }
    const central = this.#scenario.bodyById.get(this.#scenario.catalog.roots[0]!);
    if (central === undefined || central.record.properties.mu === undefined) {
      throw new RangeError("Synthetic asteroid population requires a root body with μ");
    }
    if (this.#bodies.size + count > MAX_RUNTIME_ASTEROIDS) {
      throw new RangeError(`Synthetic asteroid population cannot exceed ${MAX_RUNTIME_ASTEROIDS}`);
    }
    const ids = this.#allocator.allocateMany(count);
    const definitions = createSyntheticAsteroids({ ids, seed }, central.record.properties.mu);
    const registered: RuntimeAsteroidBody[] = [];
    try {
      for (const generated of definitions) {
        const registeredBody = registerScenarioChild(this.#engine, generated.definition, central);
        registered.push(Object.freeze({ ...registeredBody, synthetic: true }));
      }
    } catch (error) {
      for (const body of registered) this.#engine.registry().remove(body.definition.id);
      throw error;
    }
    for (const body of registered) this.#bodies.set(body.definition.id, body);
    this.#revision += 1;
    return Object.freeze(registered);
  }

  removeAll(): number {
    const bodies = [...this.#bodies.values()];
    for (const body of bodies) this.#engine.registry().remove(body.definition.id);
    this.#bodies.clear();
    if (bodies.length > 0) this.#revision += 1;
    return bodies.length;
  }

  allObjectIds(): readonly ObjectId[] {
    return Object.freeze([...this.#bodies.keys()]);
  }
}
