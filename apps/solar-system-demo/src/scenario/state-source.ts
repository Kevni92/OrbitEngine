import type { ObjectId, OrbitEngine, PropagationState } from "orbit-engine";
import type { SolarSystemScenario } from "./load-solar-system.js";
import { SUN_ID } from "./scenario-data.js";

export interface ScenarioStateFrame {
  readonly focusId: ObjectId;
  readonly states: readonly PropagationState[];
}

export class SolarSystemStateSource {
  readonly #engine: OrbitEngine;
  readonly #scenario: SolarSystemScenario;

  constructor(engine: OrbitEngine, scenario: SolarSystemScenario) {
    this.#engine = engine;
    this.#scenario = scenario;
  }

  query(focusId: ObjectId, target: Parameters<OrbitEngine["stateAt"]>[1]): ScenarioStateFrame {
    if (focusId === SUN_ID) {
      return Object.freeze({
        focusId,
        states: this.#engine.statesAt(this.#scenario.objectIds, target, this.#scenario.rootFrame),
      });
    }
    return Object.freeze({
      focusId,
      states: Object.freeze(this.#scenario.objectIds.map((id) =>
        this.#engine.relativeStateAt(id, focusId, target, this.#scenario.rootFrame))),
    });
  }
}
