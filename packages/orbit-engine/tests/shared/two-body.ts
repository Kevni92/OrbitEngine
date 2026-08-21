import assert from "node:assert/strict";

import type { Backend } from "../../src/internal/backends/contract.js";
import { OrbitEngine } from "../../src/index.js";
import { objectId } from "../../src/objects.js";
import { gravitationalParameter } from "../../src/properties.js";
import {
  createReferenceEphemerisModel,
  evaluatePropagationModel,
  motionSegment,
  propagationState,
  propagationTimeInterval,
  PropagationError,
  PropagationErrorCode,
  MotionAuthority,
  revisionId,
  type PropagationState,
} from "../../src/propagation.js";
import { referenceFrameId } from "../../src/frames.js";
import { simulationInstant } from "../../src/time.js";
import { meters, metersPerSecond } from "../../src/units.js";

function state(
  x: number,
  y: number,
  vx: number,
  vy: number,
  epoch: ReturnType<typeof simulationInstant>,
  frame: ReturnType<typeof referenceFrameId>,
): PropagationState {
  return propagationState({
    position: { x: meters(x), y: meters(y), z: meters(0) },
    velocity: { x: metersPerSecond(vx), y: metersPerSecond(vy), z: metersPerSecond(0) },
    epoch,
    referenceFrame: frame,
  });
}

function energy(value: PropagationState, mu: number): number {
  const radius = Math.hypot(value.position.x, value.position.y, value.position.z);
  const speedSquared = value.velocity.x ** 2 + value.velocity.y ** 2 + value.velocity.z ** 2;
  return speedSquared / 2 - mu / radius;
}

export async function assertTwoBodyModel(backend: Backend): Promise<void> {
  const engine = await OrbitEngine.create({ backend: backend.kind });
  const frame = referenceFrameId("1");
  const centralBody = objectId("2");
  const validity = propagationTimeInterval(simulationInstant(-100), simulationInstant(100));
  const context = {
    currentTime: simulationInstant(0),
    resolveDependencyState: (_dependency: { readonly id: string }, target: ReturnType<typeof simulationInstant>) =>
      state(0, 0, 0, 0, target, frame),
  };
  const anchor = state(1, 0, 0, 1, simulationInstant(0), frame);
  const model = engine.twoBodyModel({
    anchor,
    centralBody,
    centralBodyRevision: revisionId("1"),
    mu: gravitationalParameter(1),
    muRevision: revisionId("1"),
    propagationFrame: frame,
    frameRevision: revisionId("1"),
    validity,
    configurationRevision: revisionId("1"),
  });

  const atAnchor = evaluatePropagationModel(model, simulationInstant(0), context);
  assert.deepEqual(atAnchor.position, anchor.position);
  assert.deepEqual(atAnchor.velocity, anchor.velocity);
  const quarter = evaluatePropagationModel(model, simulationInstant(1, 570_796_327), context);
  assert.ok(Math.abs(quarter.position.x) < 1e-8);
  assert.ok(Math.abs(quarter.position.y - 1) < 1e-8);
  assert.ok(Math.abs(quarter.velocity.x + 1) < 1e-8);
  assert.ok(Math.abs(quarter.velocity.y) < 1e-8);
  assert.equal(quarter.epoch.seconds, 1);
  assert.equal(quarter.epoch.nanoseconds, 570_796_327);
  assert.equal(quarter.referenceFrame, frame);
  const backward = evaluatePropagationModel(model, simulationInstant(-1), context);
  assert.equal(backward.epoch.seconds, -1);
  assert.ok(Math.abs(energy(backward, 1) - energy(anchor, 1)) < 1e-10);

  for (const velocity of [Math.sqrt(2), 2]) {
    const boundaryModel = engine.twoBodyModel({
      anchor: state(1, 0, 0, velocity, simulationInstant(0), frame),
      centralBody,
      centralBodyRevision: revisionId("1"),
      mu: gravitationalParameter(1),
      muRevision: revisionId("1"),
      propagationFrame: frame,
      frameRevision: revisionId("1"),
      validity,
      configurationRevision: revisionId("2"),
    });
    const result = evaluatePropagationModel(boundaryModel, simulationInstant(1), context);
    assert.ok(Number.isFinite(result.position.x) && Number.isFinite(result.velocity.y));
  }

  assert.throws(
    () => engine.twoBodyModel({
      ...model.declaration,
      anchor,
      centralBody,
      centralBodyRevision: revisionId("1"),
      mu: gravitationalParameter(0),
      muRevision: revisionId("1"),
      propagationFrame: frame,
      frameRevision: revisionId("1"),
      validity,
      configurationRevision: revisionId("3"),
    }),
    (error: unknown) => error instanceof PropagationError && error.code === PropagationErrorCode.missingPhysicalProperty,
  );
  assert.throws(
    () => evaluatePropagationModel(model, simulationInstant(1), { currentTime: simulationInstant(0) }),
    (error: unknown) => error instanceof PropagationError && error.code === PropagationErrorCode.missingDependency,
  );

  const reference = createReferenceEphemerisModel({
    validity,
    direction: "bidirectional",
    propagationFrame: frame,
    sourceRevision: revisionId("1"),
    dependencies: [],
    errorContract: {},
    evaluate: (_target, _context) => anchor,
  });
  const authority = new MotionAuthority(
    objectId("7"),
    motionSegment({ start: simulationInstant(0), model: reference, motionRevision: revisionId("1") }),
  );
  const switched = authority.switchModel(model, simulationInstant(0), {
    context,
    tolerance: {
      positionAbsoluteMeters: 1e-8,
      positionRelative: 1e-12,
      velocityAbsoluteMetersPerSecond: 1e-8,
      velocityRelative: 1e-12,
    },
  });
  assert.equal(switched.ok, true);
  assert.equal(authority.segments().at(-1)?.modelKind, "twoBodyAnalytical");
}
