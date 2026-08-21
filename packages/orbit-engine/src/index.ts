import type { BackendHealth, BackendKind } from "./internal/backends/contract.js";
import { initializeBackend, type BackendPreference } from "./internal/backends/selection.js";

export * from "./time.js";
export * from "./units.js";
export * from "./objects.js";
export * from "./properties.js";
export * from "./frames.js";

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

  private constructor(backend: BackendKind, health: BackendHealth) {
    this.backend = backend;
    this.#health = health;
  }

  static async create(options: OrbitEngineCreateOptions = {}): Promise<OrbitEngine> {
    const preference = validateOptions(options);
    const backend = await initializeBackend(preference);
    return new OrbitEngine(backend.kind, backend.health());
  }

  health(): OrbitEngineHealth {
    return { backend: this.backend, ...this.#health };
  }
}
