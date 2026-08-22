import type { ObjectId, OrbitEngine, PropagationState, ReferenceFrameId, SimulationInstant } from "orbit-engine";
import type { RegisteredScenarioBody, SolarSystemScenario } from "./load-solar-system.js";
import type { RuntimeAsteroidOverlay } from "./runtime-asteroid-overlay.js";
import { SUN_ID } from "./scenario-data.js";

export interface ScenarioStateFrame {
  readonly focusId: ObjectId;
  readonly objectIds: readonly ObjectId[];
  readonly states: readonly PropagationState[];
}

export class SolarSystemStateSource {
  readonly #engine: OrbitEngine;
  readonly #scenario: SolarSystemScenario;
  readonly #overlay?: RuntimeAsteroidOverlay;

  constructor(engine: OrbitEngine, scenario: SolarSystemScenario, overlay?: RuntimeAsteroidOverlay) {
    this.#engine = engine;
    this.#scenario = scenario;
    this.#overlay = overlay;
  }

  currentBodies(): readonly RegisteredScenarioBody[] {
    return Object.freeze([...this.#scenario.bodies, ...(this.#overlay?.entries() ?? [])]);
  }

  currentObjectIds(): readonly ObjectId[] {
    return Object.freeze([...this.#scenario.objectIds, ...(this.#overlay?.allObjectIds() ?? [])]);
  }

  bodyFor(objectId: ObjectId): RegisteredScenarioBody | undefined {
    return this.#scenario.bodyById.get(objectId) ?? this.#overlay?.get(objectId);
  }

  contextKey(focusId: ObjectId): string {
    return `view-center:${focusId}:objects:${this.#overlay?.revision ?? 0}`;
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
    const objectIds = this.currentObjectIds();
    if (focusId === SUN_ID) {
      return Object.freeze({
        focusId,
        objectIds,
        states: this.#engine.statesAt(objectIds, target, this.#scenario.rootFrame),
      });
    }
    return Object.freeze({
      focusId,
      objectIds,
      states: Object.freeze(objectIds.map((id) =>
        this.#engine.relativeStateAt(id, focusId, target, this.#scenario.rootFrame))),
    });
  }
}
