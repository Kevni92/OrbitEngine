import assert from "node:assert/strict";

import {
  FrameDynamicsAssumption,
  MotionAuthority,
  ObjectType,
  OrbitEngine,
  PropagationModelKind,
  propagationModelDeclaration,
  propagationState,
  revisionId,
  motionSegment,
  maneuverForceConfiguration,
  switchTolerance,
  ScheduledWorkSourceKind,
  type FidelityAuthorityCandidateInput,
  type OrbitEngineBackend,
  type OrbitEngine as OrbitEngineType,
  type PropagationModel,
} from "../../src/index.js";
import { objectId, type ObjectId } from "../../src/objects.js";
import { referenceFrameId } from "../../src/frames.js";
import { duration, simulationInstant, type SimulationInstant } from "../../src/time.js";
import { kilograms, meters, metersPerSecond, metersPerSecondSquared } from "../../src/units.js";
import { gravitationalParameter } from "../../src/properties.js";

const frame = referenceFrameId("1");
const tolerance = switchTolerance({
  positionAbsoluteMeters: 1e-7,
  positionRelative: 0,
  velocityAbsoluteMetersPerSecond: 1e-7,
  velocityRelative: 0,
});

function referenceModel(): PropagationModel {
  const declaration = propagationModelDeclaration({
    kind: PropagationModelKind.referenceEphemeris,
    validity: { start: simulationInstant(0) },
    direction: "bidirectional",
    propagationFrame: frame,
    supportedFrameDynamics: [FrameDynamicsAssumption.inertial],
    dependencies: [],
    requiredPhysicalProperties: [],
    configurationRevision: revisionId("1"),
    errorContract: {},
  });
  return Object.freeze({
    declaration,
    evaluate: (target: SimulationInstant) => propagationState({
      position: { x: meters(0), y: meters(0), z: meters(0) },
      velocity: { x: metersPerSecond(1), y: metersPerSecond(0), z: metersPerSecond(0) },
      epoch: target,
      referenceFrame: frame,
    }),
  });
}

function analyticalFactory(
  request: Parameters<NonNullable<FidelityAuthorityCandidateInput["candidateFactory"]>>[0],
  candidate: Parameters<NonNullable<FidelityAuthorityCandidateInput["candidateFactory"]>>[1],
): PropagationModel {
  const anchor = request.handoff;
  const declaration = propagationModelDeclaration({
    kind: PropagationModelKind.twoBodyAnalytical,
    validity: { start: anchor.epoch },
    direction: "forwardOnly",
    propagationFrame: frame,
    supportedFrameDynamics: [FrameDynamicsAssumption.inertial],
    dependencies: [],
    requiredPhysicalProperties: [],
    configurationRevision: candidate.configurationRevision,
    errorContract: {},
  });
  return Object.freeze({
    declaration,
    evaluate: (target: SimulationInstant) => {
      const seconds = target.seconds - anchor.epoch.seconds
        + (target.nanoseconds - anchor.epoch.nanoseconds) / 1_000_000_000;
      return propagationState({
        position: { x: meters(anchor.position.x + anchor.velocity.x * seconds), y: anchor.position.y, z: anchor.position.z },
        velocity: anchor.velocity,
        epoch: target,
        referenceFrame: frame,
      });
    },
  });
}

function stage(
  start: number,
  end: number,
  forceMagnitudeNewtons: number,
  massFlowKilogramsPerSecond: number,
) {
  return {
    start: simulationInstant(start),
    end: simulationInstant(end),
    forceMagnitudeNewtons,
    throttle: 1,
    direction: { kind: "referenceFrame" as const, frameId: frame, unitVector: { x: 1, y: 0, z: 0 } },
    massFlowSpecification: { kind: "directMassFlow" as const, massFlowKilogramsPerSecond },
  };
}

function numericalTemplate() {
  return {
    relativeTolerance: 1e-11,
    positionAbsoluteToleranceMeters: 1e-9,
    velocityAbsoluteToleranceMetersPerSecond: 1e-10,
    massAbsoluteToleranceKilograms: 1e-9,
    minStep: duration(0, 1),
    maxStep: duration(1),
    constantAcceleration: {
      x: metersPerSecondSquared(0),
      y: metersPerSecondSquared(0),
      z: metersPerSecondSquared(0),
    },
  } as const;
}

function candidates(engine: OrbitEngineType): readonly FidelityAuthorityCandidateInput[] {
  return [
    {
      id: "reference",
      authorityKind: PropagationModelKind.referenceEphemeris,
      configurationRevision: revisionId("1"),
      cost: 0,
      capabilities: {},
      model: referenceModel(),
      switchTolerance: tolerance,
    },
    {
      id: "analytical",
      authorityKind: PropagationModelKind.twoBodyAnalytical,
      configurationRevision: revisionId("2"),
      cost: 1,
      capabilities: { maxPositionErrorMeters: 100, maxVelocityErrorMetersPerSecond: 100 },
      switchTolerance: tolerance,
      candidateFactory: analyticalFactory,
    },
    {
      id: "numerical",
      authorityKind: PropagationModelKind.numerical,
      configurationRevision: revisionId("3"),
      cost: 5,
      capabilities: {
        maxPositionErrorMeters: 1,
        maxVelocityErrorMetersPerSecond: 1,
        supportsNumericalIntegration: true,
        supportsContinuousThrust: true,
      },
      switchTolerance: tolerance,
      candidateFactory: engine.numericalAuthorityCandidateFactory(numericalTemplate()),
    },
  ];
}

function bindReferenceSpacecraft(engine: OrbitEngineType, id: ObjectId): MotionAuthority {
  const reference = referenceModel();
  const authority = new MotionAuthority(id, motionSegment({
    start: simulationInstant(0),
    model: reference,
    motionRevision: revisionId("1"),
  }), "followingReference");
  engine.registry().register({
    id,
    type: ObjectType.spacecraft,
    properties: { mass: 10 },
    state: reference.evaluate(simulationInstant(0), { objectId: id, currentTime: simulationInstant(0) }),
    motion: {
      modelKind: reference.declaration.kind,
      direction: reference.declaration.direction,
      propagationFrame: frame,
      segmentStart: simulationInstant(0),
      configurationRevision: reference.declaration.configurationRevision,
      motionRevision: revisionId("1"),
    },
    referenceStatus: "followingReference",
  });
  engine.bindMotionModel(id, reference);
  engine.configureFidelityAuthorityCandidates(id, candidates(engine), {
    minimumDwell: duration(0),
    quietWindow: duration(0),
    demotionAcceptanceHorizon: [simulationInstant(20)],
  });
  engine.bindFidelityAuthority(id, authority, "reference", {
    minimumDwell: duration(0),
    quietWindow: duration(0),
    demotionAcceptanceHorizon: [simulationInstant(20)],
  });
  return authority;
}

function anchor(epoch: number, x = 0) {
  return propagationState({
    position: { x: meters(x), y: meters(0), z: meters(0) },
    velocity: { x: metersPerSecond(0), y: metersPerSecond(0), z: metersPerSecond(0) },
    epoch: simulationInstant(epoch),
    referenceFrame: frame,
  });
}

export async function assertManeuverRegressionMatrix(backend: OrbitEngineBackend): Promise<void> {
  const engine = await OrbitEngine.create({ backend });

  // Constant finite thrust without gravity, with exact end-state semantics.
  const constantBurn = engine.scheduleFiniteBurn(objectId("800"), {
    start: simulationInstant(1),
    end: simulationInstant(3),
    stages: [stage(1, 3, 10, 0)],
  });
  const constantMotion = engine.numericalMotion({
    ...numericalTemplate(),
    objectId: objectId("800"),
    anchor: anchor(1),
    configurationRevision: constantBurn.revision,
    motionRevision: revisionId("10"),
    mass: kilograms(10),
    maneuverForceConfiguration: maneuverForceConfiguration(constantBurn, 0),
  });
  const constantState = constantMotion.stateAt(simulationInstant(3));
  assert.ok(Math.abs(constantState.position.x - 2) < 1e-7);
  assert.ok(Math.abs(constantState.velocity.x - 2) < 1e-8);

  // Gravity remains active when thrust is composed into the same authority.
  const gravityBurn = engine.scheduleFiniteBurn(objectId("801"), {
    start: simulationInstant(1),
    end: simulationInstant(2),
    stages: [stage(1, 2, 10, 0)],
  });
  const gravityMotion = engine.numericalMotion({
    ...numericalTemplate(),
    objectId: objectId("801"),
    anchor: anchor(1, 10),
    configurationRevision: gravityBurn.revision,
    motionRevision: revisionId("11"),
    mass: kilograms(10),
    gravitySource: {
      objectId: objectId("802"),
      revision: revisionId("1"),
      position: { x: meters(0), y: meters(0), z: meters(0) },
      mu: gravitationalParameter(1),
    },
    maneuverForceConfiguration: maneuverForceConfiguration(gravityBurn, 0),
  });
  const gravityState = gravityMotion.stateAt(simulationInstant(2));
  assert.ok(gravityState.velocity.x > 0.98, "thrust must compose with central gravity");

  // All three physical mass-flow parameterizations use the same integrated mass authority.
  const variants = [
    { id: "810", expectedFlow: 1, specification: { kind: "directMassFlow" as const, massFlowKilogramsPerSecond: 1 } },
    { id: "811", expectedFlow: 0.5, specification: { kind: "exhaustVelocity" as const, exhaustVelocityMetersPerSecond: 20 } },
    { id: "812", expectedFlow: 10 / 9.80665, specification: { kind: "specificImpulse" as const, specificImpulseSeconds: 1 } },
  ];
  for (const variant of variants) {
    const burn = engine.scheduleFiniteBurn(objectId(variant.id), {
      start: simulationInstant(1),
      end: simulationInstant(2),
      stages: [{
        ...stage(1, 2, 10, 0),
        massFlowSpecification: variant.specification,
      }],
    });
    const motion = engine.numericalMotion({
      ...numericalTemplate(),
      objectId: objectId(variant.id),
      anchor: anchor(1),
      configurationRevision: burn.revision,
      motionRevision: revisionId("12"),
      mass: kilograms(10),
      maneuverForceConfiguration: maneuverForceConfiguration(burn, 0),
    });
    assert.ok(Math.abs((motion.massAt(simulationInstant(2)) ?? NaN) - (10 - variant.expectedFlow)) < 1e-7);
  }

  // Exact minimum-mass truncation never overshoots the physical minimum.
  const minimumBurn = engine.scheduleFiniteBurn(objectId("813"), {
    start: simulationInstant(1),
    end: simulationInstant(10),
    minimumMassKilograms: 8,
    stages: [stage(1, 10, 10, 1)],
  });
  const minimumMotion = engine.numericalMotion({
    ...numericalTemplate(),
    objectId: objectId("813"),
    anchor: anchor(1),
    configurationRevision: minimumBurn.revision,
    motionRevision: revisionId("13"),
    mass: kilograms(10),
    maneuverForceConfiguration: maneuverForceConfiguration(minimumBurn, 0),
  });
  assert.ok(Math.abs((minimumMotion.massAt(simulationInstant(3)) ?? NaN) - 8) < 1e-7);
  assert.ok((minimumMotion.massAt(simulationInstant(5)) ?? NaN) >= 8 - 1e-7);

  // Read-only diagnostics expose physical stage values only after a committed boundary.
  const diagnosticId = objectId("820");
  const authority = bindReferenceSpacecraft(engine, diagnosticId);
  const diagnosticBurn = engine.scheduleFiniteBurn(diagnosticId, {
    start: simulationInstant(2),
    end: simulationInstant(4),
    stages: [stage(2, 3, 4, 1), stage(3, 4, 8, 2)],
  });
  const before = engine.getManeuverStatus(diagnosticBurn.id);
  assert.equal(before?.effectiveThrustMagnitudeNewtons, undefined);
  assert.equal(engine.advanceTo(simulationInstant(2)).status, "reachedTarget");
  const active = engine.getManeuverStatus(diagnosticBurn.id);
  assert.equal(active?.currentStageIndex, 0);
  assert.deepEqual(active?.effectiveThrustVectorNewtons, { x: 4, y: 0, z: 0 });
  assert.equal(active?.massFlowRateKilogramsPerSecond, 1);
  assert.equal(active?.physicalMassKilograms, 10);
  assert.equal(active?.configurationRevision, engine.registry().get(diagnosticId).motion.configurationRevision);
  assert.equal(active?.resultingMotionRevision, engine.registry().get(diagnosticId).motion.motionRevision);
  assert.equal(active?.lastResult, "burnStarted");
  assert.equal(engine.advanceTo(simulationInstant(3)).status, "reachedTarget");
  const nextStage = engine.getManeuverStatus(diagnosticBurn.id);
  assert.equal(nextStage?.currentStageIndex, 1);
  assert.equal(nextStage?.effectiveThrustMagnitudeNewtons, 8);
  assert.equal(nextStage?.massFlowRateKilogramsPerSecond, 2);
  assert.ok(Math.abs((nextStage?.physicalMassKilograms ?? NaN) - 9) < 1e-7);
  assert.equal(engine.advanceTo(simulationInstant(4)).status, "reachedTarget");
  const completed = engine.getManeuverStatus(diagnosticBurn.id);
  assert.equal(completed?.lastResult, "burnCompleted");
  assert.equal(completed?.effectiveThrustMagnitudeNewtons, 0);
  assert.equal(completed?.massFlowRateKilogramsPerSecond, 0);
  assert.ok(Math.abs((completed?.physicalMassKilograms ?? NaN) - 7) < 1e-7);
  assert.equal(authority.referenceStatus(), "diverged");

  const minimumEngine = await OrbitEngine.create({ backend });
  const minimumId = objectId("821");
  const minimumAuthority = bindReferenceSpacecraft(minimumEngine, minimumId);
  const scheduledMinimum = minimumEngine.scheduleFiniteBurn(minimumId, {
    start: simulationInstant(2),
    end: simulationInstant(10),
    minimumMassKilograms: 8,
    stages: [stage(2, 10, 10, 1)],
  });
  const minimumAdvance = minimumEngine.advanceTo(simulationInstant(10));
  assert.equal(minimumAdvance.status, "reachedTarget");
  const minimumStatus = minimumEngine.getManeuverStatus(scheduledMinimum.id);
  assert.equal(minimumStatus?.lifecycle, "completed");
  assert.equal(minimumStatus?.lastResult, "minimumMassReached");
  assert.ok(Math.abs((minimumStatus?.physicalMassKilograms ?? NaN) - 8) < 1e-7);
  assert.equal(minimumAuthority.segments().at(-1)?.modelKind, PropagationModelKind.numerical);
  assert.deepEqual(minimumAuthority.segments().at(-1)?.start, simulationInstant(4));
  assert.equal(minimumEngine.listScheduledWorkDiagnostics().some((work) => work.sourceKind === ScheduledWorkSourceKind.maneuver), false);

  // Editing/cancellation retires old generations, and a large warp drains all exact events.
  const warpEngine = await OrbitEngine.create({ backend });
  const first = warpEngine.scheduleImpulse(objectId("830"), { instant: simulationInstant(2), deltaVelocity: { x: 1, y: 0, z: 0 }, frame });
  const cancelled = warpEngine.scheduleImpulse(objectId("830"), { instant: simulationInstant(4), deltaVelocity: { x: 1, y: 0, z: 0 }, frame });
  const retained = warpEngine.scheduleImpulse(objectId("830"), { instant: simulationInstant(6), deltaVelocity: { x: 1, y: 0, z: 0 }, frame });
  const edited = warpEngine.updateManeuver(first.id, { instant: simulationInstant(3), deltaVelocity: { x: 2, y: 0, z: 0 }, frame });
  warpEngine.cancelManeuver(cancelled.id);
  assert.equal(edited.revision, "2");
  const editedQueue = warpEngine.listScheduledWorkDiagnostics().filter((work) => work.sourceKind === ScheduledWorkSourceKind.maneuver);
  assert.equal(editedQueue.some((work) => work.instant.seconds === 2), false);
  assert.equal(editedQueue.some((work) => work.instant.seconds === 3), true);
  assert.equal(editedQueue.some((work) => work.instant.seconds === 4), false);
  const warp = warpEngine.advanceTo(simulationInstant(100));
  assert.equal(warp.status, "reachedTarget");
  assert.deepEqual(warpEngine.currentTime, simulationInstant(100));
  assert.equal(warpEngine.getManeuverStatus(edited.id)?.lifecycle, "completed");
  assert.equal(warpEngine.getManeuverStatus(cancelled.id)?.lifecycle, "cancelled");
  assert.equal(warpEngine.getManeuverStatus(retained.id)?.lifecycle, "completed");
}

export async function maneuverParitySnapshot(backend: OrbitEngineBackend) {
  const engine = await OrbitEngine.create({ backend });
  const burn = engine.scheduleFiniteBurn(objectId("840"), {
    start: simulationInstant(1),
    end: simulationInstant(3),
    stages: [stage(1, 3, 10, 1)],
  });
  const motion = engine.numericalMotion({
    ...numericalTemplate(),
    objectId: objectId("840"),
    anchor: anchor(1),
    configurationRevision: burn.revision,
    motionRevision: revisionId("14"),
    mass: kilograms(10),
    maneuverForceConfiguration: maneuverForceConfiguration(burn, 0),
  });
  const state = motion.stateAt(simulationInstant(2));
  const queued = engine.listScheduledWorkDiagnostics()
    .filter((work) => work.sourceKind === ScheduledWorkSourceKind.maneuver)
    .map((work) => [work.instant.seconds, work.instant.nanoseconds, work.generation, work.payload.kind]);
  const result = engine.advanceTo(simulationInstant(3));
  return {
    queued,
    result: { status: result.status, currentTime: result.currentTime },
    maneuver: engine.getManeuverStatus(burn.id),
    state: { position: state.position, velocity: state.velocity, mass: motion.massAt(simulationInstant(2)) },
  };
}
