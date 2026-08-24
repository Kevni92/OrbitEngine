import assert from "node:assert/strict";
import test from "node:test";

import { createNumericalMotion } from "../../src/numerical.js";
import { loadNativeBackend } from "../../src/internal/backends/native.js";
import {
  duration,
  kilograms,
  maneuverForceConfiguration,
  meters,
  metersPerSecond,
  metersPerSecondSquared,
  objectId,
  OrbitEngine,
  propagationState,
  referenceFrameId,
  revisionId,
  simulationInstant,
} from "../../src/index.js";

test("maneuver numerical propagation crosses the backend once per query, never per integrator stage", async () => {
  const engine = await OrbitEngine.create({ backend: "native" });
  const frame = referenceFrameId("1");
  const burn = engine.scheduleFiniteBurn(objectId("850"), {
    start: simulationInstant(1),
    end: simulationInstant(3),
    stages: [{
      start: simulationInstant(1),
      end: simulationInstant(3),
      forceMagnitudeNewtons: 10,
      throttle: 1,
      direction: { kind: "referenceFrame", frameId: frame, unitVector: { x: 1, y: 0, z: 0 } },
      massFlowSpecification: { kind: "directMassFlow", massFlowKilogramsPerSecond: 1 },
    }],
  });
  const backend = await loadNativeBackend();
  let numericalCalls = 0;
  const instrumentedBackend = {
    ...backend,
    roundTripNumerical: (value: Parameters<typeof backend.roundTripNumerical>[0]) => {
      numericalCalls += 1;
      return backend.roundTripNumerical(value);
    },
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
