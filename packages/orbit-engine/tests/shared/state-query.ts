import assert from "node:assert/strict";

import type { Backend } from "../../src/internal/backends/contract.js";
import {
  FrameProviderKind,
  OrbitEngine,
  ObjectType,
  PropagationDirection,
  PropagationError,
  PropagationErrorCode,
  PropagationModelKind,
  ReferenceStatus,
  StateQueryError,
  StateQueryErrorCode,
  createReferenceEphemerisModel,
  gravitationalParameter,
  objectId,
  propagationState,
  propagationTimeInterval,
  referenceFrameId,
  revisionId,
  simulationInstant,
  meters,
  metersPerSecond,
  type PropagationState,
} from "../../src/index.js";

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

export async function assertStateQueryIntegration(backend: Backend): Promise<void> {
  const engine = await OrbitEngine.create({ backend: backend.kind });
  const registry = engine.registry();
  const frames = engine.frames();
  const root = frames.root();
  const start = simulationInstant(0);
  const end = simulationInstant(20);
  const validity = propagationTimeInterval(start, end);

  const sunId = objectId("1001");
  const earthId = objectId("1002");
  const moonId = objectId("1003");
  const sunFrame = referenceFrameId("2001");
  const earthFrame = referenceFrameId("2002");

  registry.register({
    id: sunId,
    type: ObjectType.star,
    properties: { mu: 1 },
    state: state(0, 0, 0, 0, start, root),
    motion: {
      modelKind: PropagationModelKind.referenceEphemeris,
      direction: PropagationDirection.bidirectional,
      propagationFrame: root,
      segmentStart: start,
      segmentEnd: end,
      configurationRevision: revisionId("1"),
      motionRevision: revisionId("1"),
    },
    referenceStatus: ReferenceStatus.followingReference,
  });

  const sunModel = createReferenceEphemerisModel({
    validity,
    direction: "bidirectional",
    propagationFrame: root,
    sourceRevision: revisionId("1"),
    dependencies: [],
    errorContract: {},
    evaluate: (target) => state(0, 0, 0, 0, target, root),
  });
  engine.bindMotionModel(sunId, sunModel);

  frames.register({
    id: sunFrame,
    parent: root,
    provider: {
      kind: FrameProviderKind.objectCentered,
      source: engine.objectStateSource(sunId, root),
      revision: revisionId("1"),
    },
  });

  const earthAnchor = state(1, 0, 0, 1, start, sunFrame);
  registry.register({
    id: earthId,
    type: ObjectType.planet,
    properties: { mu: 1 },
    state: earthAnchor,
    motion: {
      modelKind: PropagationModelKind.twoBodyAnalytical,
      direction: PropagationDirection.bidirectional,
      propagationFrame: sunFrame,
      segmentStart: start,
      segmentEnd: end,
      configurationRevision: revisionId("2"),
      motionRevision: revisionId("1"),
    },
  });

  const mismatchedEarthModel = engine.twoBodyModel({
    anchor: earthAnchor,
    centralBody: sunId,
    centralBodyRevision: revisionId("1"),
    mu: gravitationalParameter(1),
    muRevision: registry.get(sunId).propertyRevision,
    propagationFrame: sunFrame,
    frameRevision: revisionId("1"),
    validity,
    configurationRevision: revisionId("9"),
  });
  assert.throws(
    () => engine.bindMotionModel(earthId, mismatchedEarthModel),
    (error: unknown) => error instanceof StateQueryError && error.code === StateQueryErrorCode.modelBindingMismatch,
  );

  const staleCentralBodyModel = engine.twoBodyModel({
    anchor: earthAnchor,
    centralBody: sunId,
    centralBodyRevision: revisionId("9"),
    mu: gravitationalParameter(1),
    muRevision: registry.get(sunId).propertyRevision,
    propagationFrame: sunFrame,
    frameRevision: revisionId("1"),
    validity,
    configurationRevision: revisionId("2"),
  });
  assert.throws(
    () => engine.bindMotionModel(earthId, staleCentralBodyModel),
    (error: unknown) => error instanceof StateQueryError
      && error.code === StateQueryErrorCode.dependencyRevisionMismatch,
  );

  const earthModel = engine.twoBodyModel({
    anchor: earthAnchor,
    centralBody: sunId,
    centralBodyRevision: revisionId("1"),
    mu: gravitationalParameter(1),
    muRevision: registry.get(sunId).propertyRevision,
    propagationFrame: sunFrame,
    frameRevision: revisionId("1"),
    validity,
    configurationRevision: revisionId("2"),
  });
  engine.bindMotionModel(earthId, earthModel);

  frames.register({
    id: earthFrame,
    parent: sunFrame,
    provider: {
      kind: FrameProviderKind.objectCentered,
      source: engine.objectStateSource(earthId, sunFrame),
      revision: revisionId("1"),
    },
  });

  const moonAnchor = state(0.25, 0, 0, 2, start, earthFrame);
  registry.register({
    id: moonId,
    type: ObjectType.moon,
    state: moonAnchor,
    motion: {
      modelKind: PropagationModelKind.twoBodyAnalytical,
      direction: PropagationDirection.bidirectional,
      propagationFrame: earthFrame,
      segmentStart: start,
      segmentEnd: end,
      configurationRevision: revisionId("3"),
      motionRevision: revisionId("1"),
    },
  });
  engine.bindMotionModel(moonId, engine.twoBodyModel({
    anchor: moonAnchor,
    centralBody: earthId,
    centralBodyRevision: revisionId("1"),
    mu: gravitationalParameter(1),
    muRevision: registry.get(earthId).propertyRevision,
    propagationFrame: earthFrame,
    frameRevision: revisionId("1"),
    validity,
    configurationRevision: revisionId("3"),
  }));

  const beforeClock = registry.currentTime();
  const earthAtStart = engine.stateAt(earthId, start, sunFrame);
  assert.deepEqual(earthAtStart.position, earthAnchor.position);
  assert.deepEqual(earthAtStart.velocity, earthAnchor.velocity);
  assert.deepEqual(registry.currentTime(), beforeClock);

  const sunCentered = engine.stateAt(sunId, start, sunFrame);
  assert.equal(sunCentered.position.x, 0);
  assert.equal(sunCentered.position.y, 0);

  const quarter = engine.stateAt(earthId, simulationInstant(1, 570_796_327), sunFrame);
  assert.ok(Math.abs(quarter.position.x) < 1e-8);
  assert.ok(Math.abs(quarter.position.y - 1) < 1e-8);
  assert.equal(quarter.referenceFrame, sunFrame);

  const moonAtOne = engine.stateAt(moonId, simulationInstant(1), root);
  assert.ok(Number.isFinite(moonAtOne.position.x));
  assert.ok(Number.isFinite(moonAtOne.position.y));
  assert.equal(moonAtOne.referenceFrame, root);
  assert.equal(moonAtOne.epoch.seconds, 1);

  const batch = engine.statesAt([sunId, earthId, moonId], simulationInstant(1), root);
  assert.equal(batch.length, 3);
  assert.equal(batch[0]?.position.x, 0);
  assert.ok(Math.abs((batch[1]?.position.x ?? 0) - engine.stateAt(earthId, simulationInstant(1), root).position.x) < 1e-12);
  assert.ok(Math.abs((batch[2]?.position.x ?? 0) - moonAtOne.position.x) < 1e-12);

  const earthRelativeToSun = engine.relativeStateAt(earthId, sunId, start, sunFrame);
  assert.equal(earthRelativeToSun.referenceFrame, sunFrame);
  assert.ok(Math.abs(earthRelativeToSun.position.x - 1) < 1e-12);
  assert.ok(Math.abs(earthRelativeToSun.position.y) < 1e-12);

  const unboundId = objectId("1098");
  registry.register({
    id: unboundId,
    type: ObjectType.debris,
    state: state(3, 0, 0, 0, start, root),
    motion: {
      modelKind: PropagationModelKind.referenceEphemeris,
      direction: PropagationDirection.bidirectional,
      propagationFrame: root,
      segmentStart: start,
      segmentEnd: end,
      configurationRevision: revisionId("11"),
      motionRevision: revisionId("1"),
    },
  });
  assert.throws(
    () => engine.stateAt(unboundId, start, root),
    (error: unknown) => error instanceof StateQueryError && error.code === StateQueryErrorCode.missingModelBinding,
  );

  registry.updateProperties(sunId, start, { mu: 2 });
  assert.throws(
    () => engine.stateAt(earthId, start, sunFrame),
    (error: unknown) => error instanceof StateQueryError
      && error.code === StateQueryErrorCode.dependencyRevisionMismatch,
  );

  const cycleA = objectId("1101");
  const cycleB = objectId("1102");
  const cycleAnchorA = state(1, 0, 0, 1, start, root);
  const cycleAnchorB = state(-1, 0, 0, -1, start, root);
  for (const [id, anchor, configurationRevision] of [
    [cycleA, cycleAnchorA, revisionId("20")],
    [cycleB, cycleAnchorB, revisionId("21")],
  ] as const) {
    registry.register({
      id,
      type: ObjectType.planet,
      properties: { mu: 1 },
      state: anchor,
      motion: {
        modelKind: PropagationModelKind.twoBodyAnalytical,
        direction: PropagationDirection.bidirectional,
        propagationFrame: root,
        segmentStart: start,
        segmentEnd: end,
        configurationRevision,
        motionRevision: revisionId("1"),
      },
    });
  }
  engine.bindMotionModel(cycleA, engine.twoBodyModel({
    anchor: cycleAnchorA,
    centralBody: cycleB,
    centralBodyRevision: revisionId("1"),
    mu: gravitationalParameter(1),
    muRevision: registry.get(cycleB).propertyRevision,
    propagationFrame: root,
    frameRevision: revisionId("0"),
    validity,
    configurationRevision: revisionId("20"),
  }));
  engine.bindMotionModel(cycleB, engine.twoBodyModel({
    anchor: cycleAnchorB,
    centralBody: cycleA,
    centralBodyRevision: revisionId("1"),
    mu: gravitationalParameter(1),
    muRevision: registry.get(cycleA).propertyRevision,
    propagationFrame: root,
    frameRevision: revisionId("0"),
    validity,
    configurationRevision: revisionId("21"),
  }));
  assert.throws(
    () => engine.stateAt(cycleA, simulationInstant(1), root),
    (error: unknown) => error instanceof PropagationError && error.code === PropagationErrorCode.dependencyCycle,
  );

  registry.diverge(sunId, start, {
    state: state(0, 0, 0, 0, start, root),
    motion: {
      modelKind: PropagationModelKind.twoBodyAnalytical,
      direction: PropagationDirection.bidirectional,
      propagationFrame: root,
      segmentStart: start,
      segmentEnd: end,
      configurationRevision: revisionId("4"),
      motionRevision: revisionId("2"),
    },
  });
  assert.throws(
    () => engine.stateAt(sunId, start, root),
    (error: unknown) => error instanceof StateQueryError && error.code === StateQueryErrorCode.modelBindingMismatch,
  );

  const retiredId = objectId("1099");
  registry.register({
    id: retiredId,
    type: ObjectType.debris,
    state: state(2, 0, 0, 0, start, root),
    motion: {
      modelKind: PropagationModelKind.referenceEphemeris,
      direction: PropagationDirection.bidirectional,
      propagationFrame: root,
      segmentStart: start,
      segmentEnd: end,
      configurationRevision: revisionId("10"),
      motionRevision: revisionId("1"),
    },
  });
  engine.bindMotionModel(retiredId, createReferenceEphemerisModel({
    validity,
    direction: "bidirectional",
    propagationFrame: root,
    sourceRevision: revisionId("10"),
    dependencies: [],
    errorContract: {},
    evaluate: (target) => state(2, 0, 0, 0, target, root),
  }));
  registry.remove(retiredId);
  assert.throws(() => engine.stateAt(retiredId, start, root));
}
