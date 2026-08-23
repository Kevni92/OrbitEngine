import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  FrameDynamicsAssumption,
  ObjectType,
  OepError,
  OepErrorCode,
  OrbitEngine,
  PropagationDirection,
  PropagationError,
  PropagationErrorCode,
  PropagationModelKind,
  ReferenceStatus,
  ROOT_REFERENCE_FRAME_ID,
  StateQueryError,
  StateQueryErrorCode,
  evaluatePropagationModel,
  meters,
  metersPerSecond,
  objectId,
  propagationModelDeclaration,
  propagationState,
  referenceFrameId,
  revisionId,
  simulationInstant,
  type OepLoadInput,
  type PropagationModel,
} from "../../src/index.js";
import { corruptedSyntheticOepInput, syntheticOepInput } from "./oep-fixture.js";

function hash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function mutateShard(
  mutate: (bytes: Uint8Array, view: DataView) => Uint8Array | void,
): OepLoadInput {
  const base = syntheticOepInput();
  const bytes = new Uint8Array(base.shards[0]!.bytes);
  const result = mutate(bytes, new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  const finalBytes = result ?? bytes;
  return Object.freeze({
    ...base,
    manifest: Object.freeze({
      ...base.manifest,
      shards: Object.freeze([Object.freeze({ id: "system", sha256: hash(finalBytes) })]),
    }),
    shards: Object.freeze([Object.freeze({ id: "system", bytes: finalBytes })]),
  });
}

function withCenters(center1: number | undefined, center2: number | undefined): OepLoadInput {
  const base = syntheticOepInput();
  const first = base.manifest.sourceNodes[0]!;
  const second = base.manifest.sourceNodes[1]!;
  const third = base.manifest.sourceNodes[2]!;
  return Object.freeze({
    ...base,
    manifest: Object.freeze({
      ...base.manifest,
      sourceNodes: Object.freeze([
        Object.freeze({ ...first, ...(center1 === undefined ? { center: undefined } : { center: center1 }) }),
        Object.freeze({ ...second, ...(center2 === undefined ? { center: undefined } : { center: center2 }) }),
        third,
      ]),
    }),
  });
}

function assertVector(
  actual: { readonly x: number; readonly y: number; readonly z: number },
  expected: readonly [number, number, number],
  tolerance = 1e-12,
): void {
  assert.ok(Math.abs(actual.x - expected[0]) <= tolerance, `x ${actual.x} != ${expected[0]}`);
  assert.ok(Math.abs(actual.y - expected[1]) <= tolerance, `y ${actual.y} != ${expected[1]}`);
  assert.ok(Math.abs(actual.z - expected[2]) <= tolerance, `z ${actual.z} != ${expected[2]}`);
}

export interface OepParitySnapshot {
  readonly datasetRevision: string;
  readonly sourceRevisions: readonly string[];
  readonly sourceCenters: readonly (number | undefined)[];
  readonly sourceEffectiveStarts: readonly number[];
  readonly sourceEffectiveEnds: readonly number[];
  readonly relative2: readonly number[];
  readonly relative3: readonly number[];
  readonly root2: readonly number[];
  readonly root3: readonly number[];
}

export async function oepParitySnapshot(engine: OrbitEngine): Promise<OepParitySnapshot> {
  const dataset = await engine.loadEphemerisPack(syntheticOepInput());
  const frame = referenceFrameId("7001");
  const frameHandle = engine.registerEphemerisSourceFrame(dataset, frame, 1);
  const source2 = dataset.sourceInfo(2);
  const source3 = dataset.sourceInfo(3);
  const id2 = objectId("8002");
  const id3 = objectId("8003");
  const epoch = simulationInstant(0);

  const register = (id: ReturnType<typeof objectId>, source: typeof source2, x: number, y: number, z: number, revision: string) => {
    engine.registry().register({
      id,
      type: ObjectType.planet,
      state: propagationState({
        position: { x: meters(x), y: meters(y), z: meters(z) },
        velocity: { x: metersPerSecond(0), y: metersPerSecond(0), z: metersPerSecond(0) },
        epoch,
        referenceFrame: frame,
      }),
      motion: {
        modelKind: PropagationModelKind.referenceEphemeris,
        direction: PropagationDirection.bounded,
        propagationFrame: frame,
        segmentStart: source.effectiveValidity.start,
        segmentEnd: source.effectiveValidity.end,
        configurationRevision: source.sourceRevision,
        motionRevision: revisionId(revision),
      },
      referenceStatus: ReferenceStatus.followingReference,
    });
  };

  register(id2, source2, 10, 20, 30, "21");
  register(id3, source3, -10, -20, -30, "22");
  const handle2 = engine.bindReferenceEphemeris(id2, dataset, 2, frame);
  const handle3 = engine.bindReferenceEphemeris(id3, dataset, 3, frame);

  const relative2 = engine.stateAt(id2, epoch);
  const relative3 = engine.stateAt(id3, epoch);
  const roots = engine.statesAt([id2, id3], epoch, ROOT_REFERENCE_FRAME_ID);
  const root2 = roots[0]!;
  const root3 = roots[1]!;
  const sources = [dataset.sourceInfo(1), source2, source3];

  engine.registry().remove(id2);
  engine.registry().remove(id3);
  handle2.release();
  handle3.release();
  engine.frames().setObjectPropagationFrame(id2, ROOT_REFERENCE_FRAME_ID);
  engine.frames().setObjectPropagationFrame(id3, ROOT_REFERENCE_FRAME_ID);
  frameHandle.unregister();
  dataset.unload();

  return Object.freeze({
    datasetRevision: dataset.identity.datasetRevision,
    sourceRevisions: Object.freeze(sources.map((source) => source.sourceRevision)),
    sourceCenters: Object.freeze(sources.map((source) => source.centerSourceNodeId)),
    sourceEffectiveStarts: Object.freeze(sources.map((source) => source.effectiveValidity.start.seconds)),
    sourceEffectiveEnds: Object.freeze(sources.map((source) => source.effectiveValidity.end!.seconds)),
    relative2: Object.freeze([relative2.position.x, relative2.position.y, relative2.position.z, relative2.velocity.x, relative2.velocity.y, relative2.velocity.z]),
    relative3: Object.freeze([relative3.position.x, relative3.position.y, relative3.position.z, relative3.velocity.x, relative3.velocity.y, relative3.velocity.z]),
    root2: Object.freeze([root2.position.x, root2.position.y, root2.position.z, root2.velocity.x, root2.velocity.y, root2.velocity.z]),
    root3: Object.freeze([root3.position.x, root3.position.y, root3.position.z, root3.velocity.x, root3.velocity.y, root3.velocity.z]),
  });
}

export async function assertOepRuntime(engine: OrbitEngine): Promise<void> {
  const first = await engine.loadEphemerisPack(syntheticOepInput());
  const second = await engine.loadEphemerisPack(syntheticOepInput());
  assert.equal(first.identity.sourceCount, 3);
  assert.equal(first.identity.datasetRevision, second.identity.datasetRevision);
  assert.deepEqual(first.sourceInfo(2), second.sourceInfo(2));
  second.unload();

  const source1 = first.sourceInfo(1);
  const source2 = first.sourceInfo(2);
  const source3 = first.sourceInfo(3);
  assert.equal(source1.centerSourceNodeId, undefined);
  assert.equal(source2.centerSourceNodeId, 1);
  assert.equal(source3.centerSourceNodeId, 1);
  assert.equal(source2.effectiveValidity.start.seconds, -5);
  assert.equal(source2.effectiveValidity.end?.seconds, 5);

  const reference1 = first.referenceModel(1, ROOT_REFERENCE_FRAME_ID);
  const reference2 = first.referenceModel(2, referenceFrameId("7001"));
  const context = { currentTime: simulationInstant(0) };
  const centerAtZero = evaluatePropagationModel(reference1.model, simulationInstant(0), context);
  assertVector(centerAtZero.position, [100, 0, 0]);
  assertVector(centerAtZero.velocity, [2, 0, 0]);
  assert.equal(centerAtZero.epoch.seconds, 0);
  assert.equal(centerAtZero.referenceFrame, ROOT_REFERENCE_FRAME_ID);
  const centerBeforeJ2000 = evaluatePropagationModel(reference1.model, simulationInstant(-10), context);
  assertVector(centerBeforeJ2000.position, [80, 0, 0]);
  assertVector(centerBeforeJ2000.velocity, [2, 0, 0]);

  const childAtZero = evaluatePropagationModel(reference2.model, simulationInstant(0), context);
  assertVector(childAtZero.position, [10, 20, 30]);
  assertVector(childAtZero.velocity, [1, 2, 3]);
  assert.equal(childAtZero.referenceFrame, referenceFrameId("7001"));
  const childAtStart = evaluatePropagationModel(reference2.model, simulationInstant(-5), context);
  assertVector(childAtStart.position, [5, 20, 30]);
  assertVector(childAtStart.velocity, [0.5, 2, 3]);
  assert.throws(
    () => evaluatePropagationModel(reference2.model, simulationInstant(5), context),
    (error: unknown) => error instanceof PropagationError && error.code === PropagationErrorCode.targetOutsideValidity,
  );
  reference1.release();
  reference2.release();

  const frame = referenceFrameId("7001");
  const frameHandle = engine.registerEphemerisSourceFrame(first, frame, 1);
  const id2 = objectId("8002");
  const id3 = objectId("8003");
  const epoch = simulationInstant(0);
  const register = (id: ReturnType<typeof objectId>, source: typeof source2, position: readonly [number, number, number], motionRevision: string) => {
    engine.registry().register({
      id,
      type: ObjectType.planet,
      state: propagationState({
        position: { x: meters(position[0]), y: meters(position[1]), z: meters(position[2]) },
        velocity: { x: metersPerSecond(0), y: metersPerSecond(0), z: metersPerSecond(0) },
        epoch,
        referenceFrame: frame,
      }),
      motion: {
        modelKind: PropagationModelKind.referenceEphemeris,
        direction: PropagationDirection.bounded,
        propagationFrame: frame,
        segmentStart: source.effectiveValidity.start,
        segmentEnd: source.effectiveValidity.end,
        configurationRevision: source.sourceRevision,
        motionRevision: revisionId(motionRevision),
      },
      referenceStatus: ReferenceStatus.followingReference,
    });
  };
  register(id2, source2, [10, 20, 30], "31");
  register(id3, source3, [-10, -20, -30], "32");
  assert.equal(engine.registry().get(id2).structuralParent, undefined);
  assert.equal(engine.registry().get(id3).structuralParent, undefined);

  const bound2 = engine.bindReferenceEphemeris(id2, first, 2, frame);
  const bound3 = engine.bindReferenceEphemeris(id3, first, 3, frame);
  const relative = engine.stateAt(id2, epoch);
  assertVector(relative.position, [10, 20, 30]);
  assertVector(relative.velocity, [1, 2, 3]);
  const roots = engine.statesAt([id2, id3], epoch, ROOT_REFERENCE_FRAME_ID);
  const root2 = roots[0]!;
  const root3 = roots[1]!;
  assertVector(root2.position, [110, 20, 30]);
  assertVector(root2.velocity, [3, 2, 3]);
  assertVector(root3.position, [90, -20, -30]);
  assertVector(root3.velocity, [1, -2, -3]);
  assert.throws(
    () => first.unload(),
    (error: unknown) => error instanceof OepError && error.code === OepErrorCode.datasetInUse,
  );
  assert.throws(
    () => engine.stateAt(id2, simulationInstant(5)),
    (error: unknown) => error instanceof PropagationError && error.code === PropagationErrorCode.noActiveSegment,
  );

  const divergedState = propagationState({
    position: { x: meters(999), y: meters(20), z: meters(30) },
    velocity: { x: metersPerSecond(7), y: metersPerSecond(8), z: metersPerSecond(9) },
    epoch,
    referenceFrame: frame,
  });
  const analyticalDeclaration = propagationModelDeclaration({
    kind: PropagationModelKind.twoBodyAnalytical,
    validity: { start: epoch, end: simulationInstant(5) },
    direction: PropagationDirection.bounded,
    boundedDirection: "bidirectional",
    propagationFrame: frame,
    supportedFrameDynamics: [FrameDynamicsAssumption.inertial],
    dependencies: [],
    requiredPhysicalProperties: [],
    configurationRevision: revisionId("99"),
    errorContract: {},
  });
  engine.registry().diverge(id2, epoch, {
    state: divergedState,
    motion: {
      modelKind: PropagationModelKind.twoBodyAnalytical,
      direction: PropagationDirection.bounded,
      propagationFrame: frame,
      segmentStart: epoch,
      segmentEnd: simulationInstant(5),
      configurationRevision: revisionId("99"),
      motionRevision: revisionId("33"),
    },
  });
  assert.equal(engine.registry().get(id2).referenceStatus, ReferenceStatus.diverged);
  assert.throws(
    () => engine.stateAt(id2, simulationInstant(1)),
    (error: unknown) => error instanceof StateQueryError && error.code === StateQueryErrorCode.modelBindingMismatch,
  );
  const analytical: PropagationModel = Object.freeze({
    declaration: analyticalDeclaration,
    evaluate: (target: ReturnType<typeof simulationInstant>) => propagationState({ ...divergedState, epoch: target }),
  });
  engine.bindMotionModel(id2, analytical);
  const afterDivergence = engine.stateAt(id2, simulationInstant(1));
  assert.equal(afterDivergence.position.x, 999);
  assert.notEqual(afterDivergence.position.x, 111);

  bound2.release();
  engine.registry().remove(id2);
  engine.registry().remove(id3);
  bound3.release();
  engine.frames().setObjectPropagationFrame(id2, ROOT_REFERENCE_FRAME_ID);
  engine.frames().setObjectPropagationFrame(id3, ROOT_REFERENCE_FRAME_ID);
  frameHandle.unregister();
  first.unload();

  await assert.rejects(
    () => engine.loadEphemerisPack(corruptedSyntheticOepInput()),
    (error: unknown) => error instanceof OepError && error.code === OepErrorCode.checksumMismatch,
  );
  await assert.rejects(
    () => engine.loadEphemerisPack(mutateShard((bytes) => { bytes[0] = 0; })),
    (error: unknown) => error instanceof OepError && error.code === OepErrorCode.badMagic,
  );
  await assert.rejects(
    () => engine.loadEphemerisPack(mutateShard((_bytes, view) => { view.setUint16(4, 2, true); })),
    (error: unknown) => error instanceof OepError && error.code === OepErrorCode.unsupportedSchema,
  );
  await assert.rejects(
    () => engine.loadEphemerisPack(mutateShard((bytes) => bytes.slice(0, 10))),
    (error: unknown) => error instanceof OepError && error.code === OepErrorCode.truncated,
  );
  await assert.rejects(
    () => engine.loadEphemerisPack(mutateShard((_bytes, view) => { view.setUint32(76, 217, true); })),
    (error: unknown) => error instanceof OepError && error.code === OepErrorCode.outOfBounds,
  );
  await assert.rejects(
    () => engine.loadEphemerisPack(mutateShard((_bytes, view) => { view.setFloat64(216, Number.NaN, true); })),
    (error: unknown) => error instanceof OepError && error.code === OepErrorCode.nonFinite,
  );
  await assert.rejects(
    () => engine.loadEphemerisPack(withCenters(undefined, 99)),
    (error: unknown) => error instanceof OepError && error.code === OepErrorCode.missingCenter,
  );
  await assert.rejects(
    () => engine.loadEphemerisPack(withCenters(2, 1)),
    (error: unknown) => error instanceof OepError && error.code === OepErrorCode.dependencyCycle,
  );
  const missingShard = syntheticOepInput();
  await assert.rejects(
    () => engine.loadEphemerisPack(Object.freeze({ ...missingShard, shards: Object.freeze([]) })),
    (error: unknown) => error instanceof OepError && error.code === OepErrorCode.missingShard,
  );
  const duplicate = syntheticOepInput();
  await assert.rejects(
    () => engine.loadEphemerisPack(Object.freeze({
      ...duplicate,
      manifest: Object.freeze({
        ...duplicate.manifest,
        sourceNodes: Object.freeze([...duplicate.manifest.sourceNodes, duplicate.manifest.sourceNodes[0]!]),
      }),
    })),
    (error: unknown) => error instanceof RangeError,
  );
}
