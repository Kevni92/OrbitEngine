import assert from "node:assert/strict";
import test from "node:test";

import type { Backend } from "../../src/internal/backends/contract.js";
import { createNumericalMotion } from "../../src/numerical.js";
import {
  duration,
  kilograms,
  maneuverForceConfiguration,
  meters,
  metersPerSecond,
  metersPerSecondSquared,
  objectId,
  propagationState,
  referenceFrameId,
  revisionId,
  simulationInstant,
} from "../../src/index.js";

test("maneuver numerical propagation crosses the backend once per query, never per integrator stage", () => {
  const frame = referenceFrameId("1");
  const burn = {
    id: "1",
    revision: "1",
    objectId: objectId("850"),
    kind: "finiteBurn" as const,
    lifecycle: "active" as const,
    start: simulationInstant(1),
    end: simulationInstant(3),
    stages: [{
      start: simulationInstant(1),
      end: simulationInstant(3),
      forceMagnitudeNewtons: 10,
      throttle: 1,
      effectiveForceMagnitudeNewtons: 10,
      direction: { kind: "referenceFrame", frameId: frame, unitVector: { x: 1, y: 0, z: 0 } },
      massFlowSpecification: { kind: "direct", inputValue: 1, massFlowKilogramsPerSecond: 1 },
      effectiveMassFlowKilogramsPerSecond: 1,
    }],
  } as unknown as Parameters<typeof maneuverForceConfiguration>[0];
  const identity = <T>(value: T): T => value;
  let numericalCalls = 0;
  const instrumentedBackend: Backend = {
    kind: "native",
    health: () => ({ protocolVersion: 10, coreVersion: 1, healthCode: 42 }),
    roundTripTime: identity,
    roundTripDouble: identity,
    roundTripObject: identity,
    roundTripFrame: identity,
    roundTripPropagation: identity,
    roundTripRegistry: identity,
    roundTripFrameRegistry: identity,
    roundTripTwoBody: identity,
    roundTripNumerical: (value) => {
      numericalCalls += 1;
      return value;
    },
    roundTripCoupled: identity,
    roundTripScheduler: identity,
    roundTripPlanner: identity,
  };
  const motion = createNumericalMotion({
    objectId: objectId("850"),
    anchor: propagationState({
      position: { x: meters(0), y: meters(0), z: meters(0) },
      velocity: { x: metersPerSecond(0), y: metersPerSecond(0), z: metersPerSecond(0) },
      epoch: simulationInstant(1),
      referenceFrame: frame,
    }),
    configurationRevision: revisionId("1"),
    motionRevision: revisionId("2"),
    relativeTolerance: 1e-11,
    positionAbsoluteToleranceMeters: 1e-9,
    velocityAbsoluteToleranceMetersPerSecond: 1e-10,
    massAbsoluteToleranceKilograms: 1e-9,
    minStep: duration(0, 1),
    maxStep: duration(1),
    mass: kilograms(10),
    constantAcceleration: {
      x: metersPerSecondSquared(0),
      y: metersPerSecondSquared(0),
      z: metersPerSecondSquared(0),
    },
    maneuverForceConfiguration: maneuverForceConfiguration(burn, 0),
  }, instrumentedBackend);
  motion.stateAt(simulationInstant(3));
  assert.equal(numericalCalls, 1);
});
