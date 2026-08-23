import assert from "node:assert/strict";

import {
  duration,
  meters,
  metersPerSecond,
  metersPerSecondSquared,
  kilograms,
  objectId,
  propagationState,
  referenceFrameId,
  revisionId,
  simulationInstant,
  vec3,
  type OrbitEngineBackend,
} from "../../src/index.js";
import { OrbitEngine } from "../../src/index.js";
import { gravitationalParameter } from "../../src/properties.js";

export async function assertNumericalMotion(backend: OrbitEngineBackend): Promise<void> {
  const engine = await OrbitEngine.create({ backend });
  const motion = engine.numericalMotion({
    objectId: objectId("42"),
    anchor: propagationState({
      position: vec3(meters(1), meters(0), meters(0)),
      velocity: vec3(metersPerSecond(3), metersPerSecond(0), metersPerSecond(0)),
      epoch: simulationInstant(0),
      referenceFrame: referenceFrameId("1"),
    }),
    configurationRevision: revisionId("1"),
    motionRevision: revisionId("2"),
    relativeTolerance: 1e-12,
    positionAbsoluteToleranceMeters: 1e-10,
    velocityAbsoluteToleranceMetersPerSecond: 1e-12,
    minStep: duration(0, 1),
    maxStep: duration(1),
    mass: kilograms(4),
    constantAcceleration: vec3(
      metersPerSecondSquared(2),
      metersPerSecondSquared(0),
      metersPerSecondSquared(0),
    ),
  });

  const state = motion.stateAt(simulationInstant(2));
  assert.equal(state.epoch.seconds, 2);
  assert.ok(Math.abs(state.position.x - 11) < 1e-8);
  assert.ok(Math.abs(state.velocity.x - 7) < 1e-9);
  assert.equal(motion.massAt(simulationInstant(2)), kilograms(4));
  assert.equal(motion.status().backend, backend);
  assert.equal(motion.declaration().kind, "numerical");

  const gravityMotion = engine.numericalMotion({
    objectId: objectId("43"),
    anchor: propagationState({
      position: vec3(meters(1), meters(0), meters(0)),
      velocity: vec3(metersPerSecond(0), metersPerSecond(0), metersPerSecond(0)),
      epoch: simulationInstant(0),
      referenceFrame: referenceFrameId("1"),
    }),
    configurationRevision: revisionId("3"),
    motionRevision: revisionId("4"),
    relativeTolerance: 1e-10,
    positionAbsoluteToleranceMeters: 1e-10,
    velocityAbsoluteToleranceMetersPerSecond: 1e-12,
    minStep: duration(0, 1),
    maxStep: duration(1),
    gravitySource: {
      objectId: objectId("99"),
      revision: revisionId("1"),
      position: vec3(meters(0), meters(0), meters(0)),
      mu: gravitationalParameter(1),
    },
  });
  const gravityState = gravityMotion.stateAt(simulationInstant(0, 100_000_000));
  assert.ok(gravityState.position.x < 1);
  assert.ok(gravityState.velocity.x < 0);

  assert.throws(
    () => motion.stateAt(simulationInstant(-1)),
    (error: unknown) => error instanceof Error && error.message.includes("backward"),
  );
}
