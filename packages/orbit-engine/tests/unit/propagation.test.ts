import assert from "node:assert/strict";
import test from "node:test";

import {
  containsMotionSegment,
  containsPropagationTime,
  createAttachedModel,
  createNumericalModel,
  createReferenceEphemerisModel,
  evaluateOrderedForceProviders,
  evaluatePropagationModel,
  evaluateStateAt,
  FrameDynamicsAssumption,
  MotionAuthority,
  motionSegment,
  PropagationDirection,
  PropagationError,
  PropagationErrorCode,
  PropagationModelKind,
  propagationDirectionCode,
  propagationDirectionFromCode,
  propagationEvaluationContext,
  propagationModelDeclaration,
  propagationModelKindCode,
  propagationModelKindFromCode,
  propagationState,
  propagationTimeInterval,
  PropagationCache,
  revisionId,
  selectActiveMotionSegment,
  switchTolerance,
  validateAcyclicPropagationDependencies,
  type NumericalForceProvider,
  type PropagationModel,
} from "../../src/propagation.js";
import { objectId } from "../../src/objects.js";
import { kilograms, meters, metersPerSecond, metersPerSecondSquared, radiansPerSecond } from "../../src/units.js";
import { referenceFrameId, rigidStateTransform } from "../../src/frames.js";
import { simulationInstant } from "../../src/time.js";

const root = referenceFrameId("1");
const object = objectId("9007199254740993");
const tolerance = switchTolerance({
  positionAbsoluteMeters: 0.01,
  positionRelative: 1e-9,
  velocityAbsoluteMetersPerSecond: 0.01,
  velocityRelative: 1e-9,
});

function state(epoch: ReturnType<typeof simulationInstant>, frame = root, offset = 0) {
  return propagationState({
    position: { x: meters(10 + offset), y: meters(20), z: meters(30) },
    velocity: { x: metersPerSecond(1 + offset), y: metersPerSecond(2), z: metersPerSecond(3) },
    epoch,
    referenceFrame: frame,
  });
}

function model(
  kind: PropagationModelKind,
  start: ReturnType<typeof simulationInstant>,
  end: ReturnType<typeof simulationInstant> | undefined,
  evaluate: (target: ReturnType<typeof simulationInstant>) => ReturnType<typeof state>,
  frame = root,
): PropagationModel {
  const declaration = propagationModelDeclaration({
    kind,
    validity: propagationTimeInterval(start, end),
    direction: "bidirectional",
    propagationFrame: frame,
    supportedFrameDynamics: [FrameDynamicsAssumption.inertial],
    dependencies: [],
    requiredPhysicalProperties: [],
    configurationRevision: revisionId("1"),
    errorContract: {},
  });
  return { declaration, evaluate: (target) => evaluate(target) };
}

const context = propagationEvaluationContext({ currentTime: simulationInstant(-5), objectId: object });

test("model taxonomy, direction codes, and exact validity are closed", () => {
  assert.deepEqual(
    [1, 2, 3, 4].map(propagationModelKindFromCode),
    ["referenceEphemeris", "twoBodyAnalytical", "numerical", "attached"],
  );
  assert.equal(propagationModelKindCode(PropagationModelKind.numerical), 3);
  assert.equal(propagationDirectionCode(PropagationDirection.bounded), 3);
  assert.equal(propagationDirectionFromCode(2), PropagationDirection.bidirectional);
  assert.throws(() => propagationModelKindFromCode(0));
  assert.throws(() => propagationDirectionFromCode(0));
  const interval = propagationTimeInterval(simulationInstant(-1, 1), simulationInstant(1));
  assert.equal(containsPropagationTime(interval, simulationInstant(-1, 1)), true);
  assert.equal(containsPropagationTime(interval, simulationInstant(1)), false);
});

test("state evaluation is pure and validates exact target/frame invariants", () => {
  const currentTime = context.currentTime;
  const source = model(PropagationModelKind.referenceEphemeris, simulationInstant(-10), simulationInstant(10), state);
  const target = simulationInstant(-0.5);
  assert.deepEqual(evaluatePropagationModel(source, target, context), state(target));
  assert.deepEqual(context.currentTime, currentTime);
  const invalid = model(PropagationModelKind.attached, simulationInstant(-10), simulationInstant(10), (value) => state(simulationInstant(value.seconds + 1, value.nanoseconds)));
  assert.throws(
    () => evaluatePropagationModel(invalid, target, context),
    (error: unknown) => error instanceof PropagationError && error.code === PropagationErrorCode.invalidCanonicalState,
  );
  const forwardDeclaration = propagationModelDeclaration({
    ...source.declaration,
    direction: PropagationDirection.forwardOnly,
  });
  assert.throws(
    () => evaluatePropagationModel({ declaration: forwardDeclaration, evaluate: source.evaluate }, simulationInstant(-11), context),
    (error: unknown) => error instanceof PropagationError && error.code === PropagationErrorCode.unsupportedTemporalDirection,
  );
});

test("motion segments are half-open and switching is atomic at the exact boundary", () => {
  const oldModel = model(PropagationModelKind.referenceEphemeris, simulationInstant(-10), simulationInstant(10), state);
  const candidateModel = model(PropagationModelKind.twoBodyAnalytical, simulationInstant(0), simulationInstant(10), state);
  const authority = new MotionAuthority(object, motionSegment({
    start: simulationInstant(-10),
    model: oldModel,
    motionRevision: revisionId("1"),
  }));
  const before = authority.snapshot();
  const result = authority.switchModel(candidateModel, simulationInstant(0), { tolerance, context });
  assert.equal(result.ok, true);
  assert.equal(authority.referenceStatus(), "diverged");
  assert.equal(authority.segments().length, 2);
  assert.equal(authority.segments()[0]?.end?.seconds, 0);
  assert.equal(authority.segments()[1]?.start.seconds, 0);
  assert.equal(containsMotionSegment(authority.segments()[0]!, simulationInstant(0)), false);
  assert.equal(selectActiveMotionSegment(authority.segments(), simulationInstant(0)).modelKind, PropagationModelKind.twoBodyAnalytical);
  const failing = model(PropagationModelKind.numerical, simulationInstant(0), simulationInstant(10), (target) => state(target, root, 100));
  const unchanged = authority.snapshot();
  const failed = authority.switchModel(failing, simulationInstant(1), { tolerance, context });
  assert.equal(failed.ok, false);
  assert.deepEqual(authority.snapshot(), unchanged);
  assert.deepEqual(before.segments[0]?.start, simulationInstant(-10));
});

test("cross-frame switches transform at the same exact epoch before comparing tolerance", () => {
  const secondFrame = referenceFrameId("2");
  const oldModel = model(PropagationModelKind.referenceEphemeris, simulationInstant(0), simulationInstant(10), state);
  const candidateModel = model(
    PropagationModelKind.attached,
    simulationInstant(0),
    simulationInstant(10),
    (target) => propagationState({
      position: { x: meters(15), y: meters(20), z: meters(30) },
      velocity: { x: metersPerSecond(1), y: metersPerSecond(2), z: metersPerSecond(3) },
      epoch: target,
      referenceFrame: secondFrame,
    }),
    secondFrame,
  );
  const resolver = {
    resolveTransform: (from: typeof root, to: typeof secondFrame, epoch: ReturnType<typeof simulationInstant>) => {
      assert.equal(from, root);
      assert.equal(to, secondFrame);
      return rigidStateTransform({
        translation: { x: meters(5), y: meters(0), z: meters(0) },
        originVelocity: { x: metersPerSecond(0), y: metersPerSecond(0), z: metersPerSecond(0) },
        rotation: { w: 1, x: 0, y: 0, z: 0 },
        angularVelocity: { x: radiansPerSecond(0), y: radiansPerSecond(0), z: radiansPerSecond(0) },
        epoch,
      });
    },
  };
  const authority = new MotionAuthority(object, motionSegment({ start: simulationInstant(0), model: oldModel, motionRevision: revisionId("1") }));
  const result = authority.switchModel(candidateModel, simulationInstant(1), { tolerance, context, frameResolver: resolver });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.handoff.referenceFrame, secondFrame);
});

test("authority transition drafts do not mutate until commit", () => {
  const oldModel = model(PropagationModelKind.referenceEphemeris, simulationInstant(0), simulationInstant(10), state);
  const candidateModel = model(PropagationModelKind.numerical, simulationInstant(0), simulationInstant(10), state);
  const authority = new MotionAuthority(object, motionSegment({ start: simulationInstant(0), model: oldModel, motionRevision: revisionId("1") }));
  const before = authority.snapshot();
  const draft = authority.prepareSwitchModel(candidateModel, simulationInstant(1), { tolerance, context });
  assert.deepEqual(authority.snapshot(), before);
  authority.commitTransition(draft);
  assert.equal(authority.segments().at(-1)?.modelKind, PropagationModelKind.numerical);
  assert.equal(authority.referenceStatus(), "diverged");
});

test("force providers execute in declared order and distinguish absent/zero mass", () => {
  const declaration = (id: string, order: number, requiresMass: boolean) => ({
    id: revisionId(id), order, validity: propagationTimeInterval(simulationInstant(-1), simulationInstant(2)),
    dependencies: [], propagationFrame: root, supportedFrameDynamics: [FrameDynamicsAssumption.inertial], requiresMass,
  });
  const calls: number[] = [];
  const providers: NumericalForceProvider[] = [
    { declaration: declaration("2", 2, false), evaluate: () => { calls.push(2); return { x: metersPerSecondSquared(2), y: metersPerSecondSquared(0), z: metersPerSecondSquared(0) }; } },
    { declaration: declaration("1", 1, false), evaluate: () => { calls.push(1); return { x: metersPerSecondSquared(1), y: metersPerSecondSquared(0), z: metersPerSecondSquared(0) }; } },
  ];
  const acceleration = evaluateOrderedForceProviders(providers, { target: simulationInstant(0), objectId: object, state: state(simulationInstant(0)) });
  assert.deepEqual(calls, [1, 2]);
  assert.equal(acceleration.x, 3);
  const massProvider = { declaration: declaration("3", 3, true), evaluate: () => ({ x: metersPerSecondSquared(1), y: metersPerSecondSquared(0), z: metersPerSecondSquared(0) }) };
  assert.throws(() => evaluateOrderedForceProviders([massProvider], { target: simulationInstant(0), objectId: object, state: state(simulationInstant(0)) }), /requires non-zero mass/);
  assert.throws(() => evaluateOrderedForceProviders([massProvider], { target: simulationInstant(0), objectId: object, state: state(simulationInstant(0)) }, { revision: revisionId("1"), massAt: () => kilograms(0) }), /requires non-zero mass/);
});

test("cache invalidation starts at the exact state-change time", () => {
  const cache = new PropagationCache(2);
  const makeKey = (seconds: number) => ({ objectId: object, segmentRevision: revisionId("1"), modelConfigurationRevision: revisionId("1"), dependencyRevisions: [], target: simulationInstant(seconds) });
  cache.set(makeKey(-1), state(simulationInstant(-1)));
  cache.set(makeKey(0), state(simulationInstant(0)));
  cache.set(makeKey(1), state(simulationInstant(1)));
  assert.equal(cache.get(makeKey(-1)) !== undefined, false);
  cache.invalidateFrom(simulationInstant(0));
  assert.equal(cache.get(makeKey(0)), undefined);
  assert.equal(cache.get(makeKey(1)), undefined);
  assert.throws(
    () => validateAcyclicPropagationDependencies(new Map([["a", ["b"]], ["b", ["a"]]])),
    (error: unknown) => error instanceof PropagationError && error.code === PropagationErrorCode.dependencyCycle,
  );
});

test("reference and attached/numerical contracts remain normalized without production integrators", () => {
  const source = {
    validity: propagationTimeInterval(simulationInstant(0), simulationInstant(2)),
    direction: "bidirectional" as const,
    propagationFrame: root,
    sourceRevision: revisionId("7"),
    dependencies: [],
    errorContract: {},
    evaluate: (target: ReturnType<typeof simulationInstant>) => state(target),
  };
  assert.equal(createReferenceEphemerisModel(source).declaration.kind, PropagationModelKind.referenceEphemeris);
  const attached = createAttachedModel({
    validity: source.validity,
    propagationFrame: root,
    attachmentFrame: root,
    localState: state(simulationInstant(0)),
    configurationRevision: revisionId("8"),
    dependencies: [],
  }, { resolve: (_frame, localState, target) => propagationState({ ...localState, epoch: target, referenceFrame: root }) });
  assert.equal(evaluateStateAt(attached, simulationInstant(1), context).referenceFrame, root);
  const numerical = createNumericalModel({
    validity: source.validity,
    direction: PropagationDirection.bidirectional,
    propagationFrame: root,
    supportedFrameDynamics: [FrameDynamicsAssumption.inertial],
    dependencies: [], requiredPhysicalProperties: [], configurationRevision: revisionId("9"), providers: [],
  });
  assert.throws(() => evaluatePropagationModel(numerical, simulationInstant(1), context), /No numerical integrator/);
});
