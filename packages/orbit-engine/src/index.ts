import type { Backend, BackendHealth, BackendKind } from "./internal/backends/contract.js";
import { initializeBackend, type BackendPreference } from "./internal/backends/selection.js";
import { ObjectRegistry } from "./registry.js";
import { FrameRegistry, type ObjectFrameStateSource } from "./frame-registry.js";
import { type ReferenceFrameId } from "./frames.js";
import { type ObjectId } from "./objects.js";
import { type PropagationModel, type PropagationState } from "./propagation.js";
import { ObjectStateQueries } from "./state-query.js";
import { type SimulationInstant } from "./time.js";
import {
  createTwoBodyAnalyticalModel,
  type TwoBodyAnalyticalModelConfiguration,
} from "./two-body.js";

export * from "./time.js";
export * from "./units.js";
export * from "./objects.js";
export * from "./properties.js";
export * from "./frames.js";
export * from "./propagation.js";
export * from "./registry.js";
export * from "./frame-registry.js";
export * from "./state-query.js";
export { TWO_BODY_DEFAULT_ERROR_CONTRACT } from "./two-body.js";
export type { TwoBodyAnalyticalModelConfiguration } from "./two-body.js";

export type OrbitEngineBackend = BackendKind;
export type OrbitEngineBackendPreference = BackendPreference;

export interface OrbitEngineCreateOptions {
  readonly backend?: OrbitEngineBackendPreference;
}

export interface OrbitEngineHealth extends BackendHealth {
  readonly backend: OrbitEngineBackend;
}

function validateOptions(options: OrbitEngineCreateOptions): OrbitEngineBackendPreference {
  if (typeof options !== "object" || options === null) {
    throw new TypeError("OrbitEngine.create options must be an object");
  }

  const backend = options.backend ?? "auto";
  if (backend !== "auto" && backend !== "native" && backend !== "wasm") {
    throw new TypeError(`Unsupported OrbitEngine backend: ${String(backend)}`);
  }

  return backend;
}

export class OrbitEngine {
  readonly backend: OrbitEngineBackend;
  readonly #health: BackendHealth;
  readonly #backend: Backend;
  #registry?: ObjectRegistry;
  #frames?: FrameRegistry;
  #stateQueries?: ObjectStateQueries;

  private constructor(backend: Backend, health: BackendHealth) {
    this.backend = backend.kind;
    this.#backend = backend;
    this.#health = health;
  }

  static async create(options: OrbitEngineCreateOptions = {}): Promise<OrbitEngine> {
    const preference = validateOptions(options);
    const backend = await initializeBackend(preference);
    return new OrbitEngine(backend, backend.health());
  }

  health(): OrbitEngineHealth {
    return { backend: this.backend, ...this.#health };
  }

  registry(): ObjectRegistry {
    this.#registry ??= new ObjectRegistry(this.#backend);
    return this.#registry;
  }

  frames(): FrameRegistry {
    this.#frames ??= new FrameRegistry(this.#backend);
    return this.#frames;
  }

  stateQueries(): ObjectStateQueries {
    this.#stateQueries ??= new ObjectStateQueries(this.registry(), this.frames());
    return this.#stateQueries;
  }

  bindMotionModel(id: ObjectId, model: PropagationModel): void {
    this.stateQueries().bindMotionModel(id, model);
  }

  stateAt(id: ObjectId, target: SimulationInstant, outputFrame?: ReferenceFrameId): PropagationState {
    return this.stateQueries().stateAt(id, target, outputFrame);
  }

  statesAt(
    ids: readonly ObjectId[],
    target: SimulationInstant,
    outputFrame?: ReferenceFrameId,
  ): readonly PropagationState[] {
    return this.stateQueries().statesAt(ids, target, outputFrame);
  }

  relativeStateAt(
    targetObject: ObjectId,
    observerObject: ObjectId,
    target: SimulationInstant,
    outputFrame?: ReferenceFrameId,
  ): PropagationState {
    return this.stateQueries().relativeStateAt(targetObject, observerObject, target, outputFrame);
  }

  objectStateSource(id: ObjectId, outputFrame: ReferenceFrameId): ObjectFrameStateSource {
    return this.stateQueries().objectStateSource(id, outputFrame);
  }

  twoBodyModel(configuration: TwoBodyAnalyticalModelConfiguration) {
    return createTwoBodyAnalyticalModel(configuration, {
      evaluate: (value) => this.#backend.roundTripTwoBody(value),
    });
  }
}
