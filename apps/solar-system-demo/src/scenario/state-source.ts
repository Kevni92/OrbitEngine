import type { ObjectId, OrbitEngine, PropagationState, ReferenceFrameId, SimulationInstant } from "orbit-engine";
import type { SolarSystemScenario } from "./load-solar-system.js";
import { SUN_ID } from "./scenario-data.js";

export interface ScenarioStateFrame {
  readonly focusId: ObjectId;
  readonly objectIds: readonly ObjectId[];
  readonly states: readonly PropagationState[];
  readonly queryDurationMs: number;
}

export interface ScenarioObjectSetProvider {
  objectIds(): readonly ObjectId[];
}

function nowMilliseconds(): number {
  return globalThis.performance?.now() ?? Date.now();
}

export class SolarSystemStateSource {
  readonly #engine: OrbitEngine;
  readonly #scenario: SolarSystemScenario;
  readonly #objectSet?: ScenarioObjectSetProvider;

  constructor(engine: OrbitEngine, scenario: SolarSystemScenario, objectSet?: ScenarioObjectSetProvider) {
    this.#engine = engine;
    this.#scenario = scenario;
    this.#objectSet = objectSet;
  }

  stateAt(objectId: ObjectId, focusId: ObjectId, target: SimulationInstant, outputFrame: ReferenceFrameId): PropagationState {
    if (focusId === SUN_ID) return this.#engine.stateAt(objectId, target, outputFrame);
    return this.#engine.relativeStateAt(objectId, focusId, target, outputFrame);
  }

  relativeStateAt(
    objectId: ObjectId,
    centralBodyId: ObjectId,
    target: SimulationInstant,
    outputFrame: ReferenceFrameId,
  ): PropagationState {
    return this.#engine.relativeStateAt(objectId, centralBodyId, target, outputFrame);
  }

  query(focusId: ObjectId, target: SimulationInstant): ScenarioStateFrame {
    const objectIds = Object.freeze([...(this.#objectSet?.objectIds() ?? this.#scenario.objectIds)]);
    const started = nowMilliseconds();
    const states = focusId === SUN_ID
      ? this.#engine.statesAt(objectIds, target, this.#scenario.rootFrame)
      : Object.freeze(objectIds.map((id) =>
        this.#engine.relativeStateAt(id, focusId, target, this.#scenario.rootFrame)));
    return Object.freeze({
      focusId,
      objectIds,
      states,
      queryDurationMs: Math.max(0, nowMilliseconds() - started),
    });
  }
}
