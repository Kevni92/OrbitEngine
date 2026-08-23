import type { Backend, BackendHealth, BackendKind } from "./internal/backends/contract.js";
import { initializeBackend, type BackendPreference } from "./internal/backends/selection.js";
import { ObjectRegistry } from "./registry.js";
import { FrameRegistry, type FrameNode, type ObjectFrameStateSource } from "./frame-registry.js";
import { referenceFrameId, type ReferenceFrameId } from "./frames.js";
import { objectId, type ObjectId } from "./objects.js";
import { type PropagationModel, type PropagationState } from "./propagation.js";
import { ObjectStateQueries } from "./state-query.js";
import { type SimulationInstant } from "./time.js";
import {
  loadOepDataset,
  type EphemerisSourceNodeId,
  type OepDataset,
  type OepFrameProviderHandle,
  type OepLoadInput,
  type OepReferenceModelHandle,
} from "./ephemeris.js";
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
export * from "./ephemeris.js";
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

export interface RegisteredEphemerisFrameHandle extends OepFrameProviderHandle {
  readonly frame: FrameNode;
  unregister(): void;
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

  async loadEphemerisPack(input: OepLoadInput): Promise<OepDataset> {
    return loadOepDataset(this.backend, input);
  }

  registerEphemerisSourceFrame(
    dataset: OepDataset,
    frameId: ReferenceFrameId,
    sourceNodeId: EphemerisSourceNodeId | number,
  ): RegisteredEphemerisFrameHandle {
    const id = referenceFrameId(frameId);
    const handle = dataset.sourceCenterProvider(sourceNodeId);
    let registered = false;
    try {
      const frame = this.frames().register({ id, parent: this.frames().root(), provider: handle.provider });
      registered = true;
      let closed = false;
      return Object.freeze({
        identity: handle.identity,
        provider: handle.provider,
        frame,
        release: handle.release,
        unregister: () => {
          if (closed) return;
          this.frames().remove(id);
          handle.release();
          closed = true;
        },
      });
    } catch (error) {
      if (!registered) handle.release();
      throw error;
    }
  }

  bindReferenceEphemeris(
    id: ObjectId,
    dataset: OepDataset,
    sourceNodeId: EphemerisSourceNodeId | number,
    propagationFrame: ReferenceFrameId,
  ): OepReferenceModelHandle {
    const object = objectId(id);
    const handle = dataset.referenceModel(sourceNodeId, referenceFrameId(propagationFrame), object);
    try {
      this.bindMotionModel(object, handle.model);
      return handle;
    } catch (error) {
      handle.release();
      throw error;
    }
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
