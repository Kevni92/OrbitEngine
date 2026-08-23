import assert from "node:assert/strict";

import {
  CoupledMotion,
  ObjectType,
  duration,
  kilograms,
  meters,
  metersPerSecond,
  objectId,
  propagationState,
  referenceFrameId,
  revisionId,
  simulationInstant,
  vec3,
  type OrbitEngineBackend,
} from "../../src/index.js";
import { OrbitEngine } from "../../src/index.js";

export async function assertCoupledMotion(backend: OrbitEngineBackend): Promise<void> {
  const engine = await OrbitEngine.create({ backend });
  const frame = referenceFrameId("1");
  const epoch = simulationInstant(0);
  const member = (id: string, x: number) => ({
    objectId: objectId(id),
    anchor: propagationState({ position: vec3(meters(x), meters(0), meters(0)), velocity: vec3(metersPerSecond(0), metersPerSecond(0), metersPerSecond(0)), epoch, referenceFrame: frame }),
    motionRevision: revisionId("1"),
    mass: kilograms(1),
  });
  const configuration = {
    members: [member("1", -1), member("2", 0), member("3", 1)],
    configurationRevision: revisionId("7"),
    relativeTolerance: 1e-10,
    positionAbsoluteToleranceMeters: 1e-10,
    velocityAbsoluteToleranceMetersPerSecond: 1e-12,
    minStep: duration(0, 1),
    maxStep: duration(1),
  } as const;
  const motion: CoupledMotion = engine.coupledMotion(configuration);
  assert.notEqual(motion.status().authorityId, "0");
  const states = motion.stateBatchAt([objectId("3"), objectId("1"), objectId("2")], epoch);
  assert.equal(states.length, 3);
  assert.deepEqual(states.map((state) => state.position.x), [1, -1, 0]);
  assert.ok(motion.status().sharedEvaluationCount >= 1);
  const removed = motion.remove(objectId("1"), epoch);
  assert.equal(removed.position.x, -1);
  assert.deepEqual(motion.status().members, [objectId("2"), objectId("3")]);
  assert.equal(motion.status().active, true);

  const boundConfiguration = {
    ...configuration,
    members: [member("1", -1), member("2", 0), member("3", 1)],
  } as const;
  for (const item of boundConfiguration.members) {
    engine.registry().register({
      id: item.objectId,
      type: ObjectType.spacecraft,
      state: item.anchor,
      motion: {
        modelKind: "numerical",
        direction: "forwardOnly",
        propagationFrame: frame,
        segmentStart: epoch,
        configurationRevision: boundConfiguration.configurationRevision,
        motionRevision: item.motionRevision,
      },
    });
  }
  engine.bindCoupledMotion(boundConfiguration);
  const modelNeutralStates = engine.statesAt([objectId("3"), objectId("1"), objectId("2")], epoch);
  assert.deepEqual(modelNeutralStates.map((state) => state.position.x), [1, -1, 0]);
}
