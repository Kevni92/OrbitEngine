import {
  compareSimulationInstants,
  simulationInstant,
  type SimulationInstant,
} from "orbit-engine";

export interface StateQueryRequest {
  readonly target: SimulationInstant;
  readonly contextKey: string;
}

export interface StateQuerySource<T> {
  query(request: StateQueryRequest): Promise<T> | T;
}

export interface StateSnapshot<T> {
  readonly target: SimulationInstant;
  readonly contextKey: string;
  readonly value: T;
  readonly generation: number;
}

export interface StateQueryCoordinatorOptions<T> {
  readonly source: StateQuerySource<T>;
  readonly onSnapshot?: (snapshot: StateSnapshot<T>) => void;
  readonly onError?: (error: unknown, request: StateQueryRequest) => void;
}

interface GenerationRequest extends StateQueryRequest {
  readonly generation: number;
}

function normalizedRequest(target: SimulationInstant, contextKey: string): StateQueryRequest {
  if (typeof contextKey !== "string") {
    throw new TypeError("state query contextKey must be a string");
  }
  return Object.freeze({
    target: simulationInstant(target.seconds, target.nanoseconds),
    contextKey,
  });
}

function sameRequest(left: StateQueryRequest, right: StateQueryRequest): boolean {
  return left.contextKey === right.contextKey && compareSimulationInstants(left.target, right.target) === 0;
}

export class StateQueryCoordinator<T> {
  readonly #source: StateQuerySource<T>;
  readonly #onSnapshot?: (snapshot: StateSnapshot<T>) => void;
  readonly #onError?: (error: unknown, request: StateQueryRequest) => void;
  #generation = 0;
  #active?: GenerationRequest;
  #pending?: GenerationRequest;
  #snapshot?: StateSnapshot<T>;
  #error?: unknown;

  constructor(options: StateQueryCoordinatorOptions<T>) {
    this.#source = options.source;
    this.#onSnapshot = options.onSnapshot;
    this.#onError = options.onError;
  }

  latestSnapshot(): StateSnapshot<T> | undefined {
    return this.#snapshot;
  }

  latestError(): unknown {
    return this.#error;
  }

  isPending(): boolean {
    return this.#active !== undefined || this.#pending !== undefined;
  }

  pendingTarget(): SimulationInstant | undefined {
    return this.#pending?.target ?? this.#active?.target;
  }

  request(target: SimulationInstant, contextKey = "default"): void {
    const request = normalizedRequest(target, contextKey);
    if (this.#active !== undefined && sameRequest(this.#active, request)) return;
    if (this.#pending !== undefined && sameRequest(this.#pending, request)) return;
    if (this.#active === undefined && this.#snapshot !== undefined && sameRequest(this.#snapshot, request)) return;

    const next: GenerationRequest = Object.freeze({
      ...request,
      generation: ++this.#generation,
    });
    if (this.#active !== undefined) {
      this.#pending = next;
      return;
    }
    void this.#run(next);
  }

  async #run(request: GenerationRequest): Promise<void> {
    this.#active = request;
    try {
      const value = await this.#source.query(request);
      if (request.generation === this.#generation) {
        const snapshot: StateSnapshot<T> = Object.freeze({
          target: request.target,
          contextKey: request.contextKey,
          value,
          generation: request.generation,
        });
        this.#snapshot = snapshot;
        this.#error = undefined;
        this.#onSnapshot?.(snapshot);
      }
    } catch (error) {
      if (request.generation === this.#generation) {
        this.#error = error;
        this.#onError?.(error, request);
      }
    } finally {
      if (this.#active === request) this.#active = undefined;
      const pending = this.#pending;
      this.#pending = undefined;
      if (pending !== undefined) void this.#run(pending);
    }
  }
}
