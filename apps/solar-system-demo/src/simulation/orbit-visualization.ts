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
export const DEFAULT_ORBIT_SAMPLE_COUNT = 128;
export const DEFAULT_ORBIT_SPAN_SECONDS = 31_557_600;

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

function estimateBoundOrbitPeriodSeconds(
  state: PropagationState,
  centralMu: number,
): number | undefined {
  const radius = Math.hypot(state.position.x, state.position.y, state.position.z);
  const speedSquared = state.velocity.x ** 2 + state.velocity.y ** 2 + state.velocity.z ** 2;
  if (!Number.isFinite(radius) || radius <= 0 || !Number.isFinite(speedSquared) || centralMu <= 0) return undefined;
  const specificEnergy = speedSquared / 2 - centralMu / radius;
  if (!Number.isFinite(specificEnergy) || specificEnergy >= 0) return undefined;
  const semiMajorAxis = -centralMu / (2 * specificEnergy);
  const period = 2 * Math.PI * Math.sqrt(semiMajorAxis ** 3 / centralMu);
  if (!Number.isFinite(period) || period < 1 || period > Number.MAX_SAFE_INTEGER) return undefined;
  return Math.max(1, Math.round(period));
}

function fallbackOrbitVisualization(request: OrbitVisualizationRequest, centralBodyId: ObjectId): OrbitVisualizationDefinition {
  const centralBody = request.scenario.bodyById.get(centralBodyId);
  const centralMu = centralBody?.record.properties.mu;
  if (centralMu !== undefined) {
    const anchorInstant = request.anchorInstant ?? request.scenario.validity.start;
    const state = request.stateAt(
      request.body.definition.id,
      centralBodyId,
      anchorInstant,
      request.scenario.rootFrame,
    );
    const period = estimateBoundOrbitPeriodSeconds(state, centralMu);
    if (period !== undefined) {
      return Object.freeze({
        sampleSpanSeconds: period,
        sampleCount: DEFAULT_ORBIT_SAMPLE_COUNT,
        closedReferenceOrbit: true,
      });
    }
  }
  return Object.freeze({
    sampleSpanSeconds: DEFAULT_ORBIT_SPAN_SECONDS,
    sampleCount: DEFAULT_ORBIT_SAMPLE_COUNT,
    closedReferenceOrbit: false,
  });
}

export function createOrbitPath(request: OrbitVisualizationRequest): OrbitPath | undefined {
  const centralBodyId = request.body.definition.centralBody;
  if (centralBodyId === undefined) return undefined;
  const visualization = request.body.definition.propagation.orbitVisualization
    ?? fallbackOrbitVisualization(request, centralBodyId);
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
