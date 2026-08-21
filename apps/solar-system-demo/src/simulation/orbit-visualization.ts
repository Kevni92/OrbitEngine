import {
  compareSimulationInstants,
  simulationInstant,
  type ObjectId,
  type PropagationState,
  type ReferenceFrameId,
  type SimulationInstant,
} from "orbit-engine";
import type { SolarSystemScenario, RegisteredScenarioBody } from "../scenario/load-solar-system.js";
import type { OrbitVisualizationDefinition } from "../scenario/scenario-data.js";
import { PathCache, type OrbitPath } from "./path-sampling.js";

export const ORBIT_CACHE_ENTRIES = 12;

export type OrbitStateAt = (
  objectId: ObjectId,
  centralBodyId: ObjectId,
  target: SimulationInstant,
  outputFrame: ReferenceFrameId,
) => PropagationState;

export interface OrbitVisualizationRequest {
  readonly scenario: SolarSystemScenario;
  readonly body: RegisteredScenarioBody;
  readonly cache: PathCache;
  readonly stateAt: OrbitStateAt;
  /** Start the visual reference path at the current simulation instant. */
  readonly anchorInstant?: SimulationInstant;
}

export function orbitInterval(
  scenario: SolarSystemScenario,
  definition: OrbitVisualizationDefinition,
  anchorInstant: SimulationInstant = scenario.validity.start,
): { readonly start: SimulationInstant; readonly end: SimulationInstant } {
  if (!Number.isSafeInteger(definition.sampleSpanSeconds) || definition.sampleSpanSeconds <= 0) {
    throw new RangeError("Orbit visualization span must be a positive safe integer");
  }
  if (compareSimulationInstants(anchorInstant, scenario.validity.start) < 0
      || compareSimulationInstants(anchorInstant, scenario.validity.end!) >= 0) {
    throw new RangeError("Orbit visualization anchor is outside the supported scenario interval");
  }
  const start = anchorInstant;
  const candidateEnd = simulationInstant(start.seconds + definition.sampleSpanSeconds, start.nanoseconds);
  const end = compareSimulationInstants(candidateEnd, scenario.validity.end!) < 0
    ? candidateEnd
    : scenario.validity.end!;
  if (compareSimulationInstants(start, end) >= 0) throw new RangeError("Orbit visualization interval is empty");
  return { start, end };
}

export function createOrbitPath(request: OrbitVisualizationRequest): OrbitPath | undefined {
  const centralBodyId = request.body.definition.centralBody;
  const visualization = request.body.definition.propagation.orbitVisualization;
  if (centralBodyId === undefined || visualization === undefined) return undefined;
  const interval = orbitInterval(request.scenario, visualization, request.anchorInstant);
  return request.cache.getOrCreate({
    objectId: request.body.definition.id,
    focusId: centralBodyId,
    outputFrame: request.scenario.rootFrame,
    interval,
    sampleCount: visualization.sampleCount,
    motionRevision: request.body.record.motion.motionRevision,
    configurationRevision: request.body.record.motion.configurationRevision,
    closedReferenceOrbit: visualization.closedReferenceOrbit,
    stateAt: (objectId, target, outputFrame) => request.stateAt(objectId, centralBodyId, target, outputFrame),
  });
}
