import type { ObjectId, OrbitEngine, PropagationState, ReferenceFrameId, SimulationInstant } from "orbit-engine";
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

  stateAt(objectId: ObjectId, focusId: ObjectId, target: SimulationInstant, outputFrame: ReferenceFrameId): PropagationState {
    if (focusId === SUN_ID) return this.#engine.stateAt(objectId, target, outputFrame);
    return this.#engine.relativeStateAt(objectId, focusId, target, outputFrame);
  }

  query(focusId: ObjectId, target: SimulationInstant): ScenarioStateFrame {
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
