import assert from "node:assert/strict";

import {
  FidelityTransitionCode,
  FrameDynamicsAssumption,
  MotionAuthority,
  OrbitEngine,
  PropagationModelKind,
  propagationModelDeclaration,
  propagationState,
  propagationTimeInterval,
  revisionId,
  motionSegment,
  switchTolerance,
  ScheduledWorkSourceKind,
  type FidelityAuthorityCandidateInput,
  type PropagationModel,
  type PropagationState,
  type OrbitEngine as OrbitEngineType,
} from "../../src/index.js";
import { objectId } from "../../src/objects.js";
import { referenceFrameId } from "../../src/frames.js";
import { meters, metersPerSecond, metersPerSecondSquared } from "../../src/units.js";
import { duration, simulationInstant, type SimulationInstant } from "../../src/time.js";

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

function analyticalFactory(request: Parameters<NonNullable<FidelityAuthorityCandidateInput["candidateFactory"]>>[0], candidate: Parameters<NonNullable<FidelityAuthorityCandidateInput["candidateFactory"]>>[1]): PropagationModel {
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

function candidates(engine: OrbitEngineType, object: string): readonly FidelityAuthorityCandidateInput[] {
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
      candidateFactory: engine.numericalAuthorityCandidateFactory({
        relativeTolerance: 1e-11,
        positionAbsoluteToleranceMeters: 1e-8,
        velocityAbsoluteToleranceMetersPerSecond: 1e-9,
        massAbsoluteToleranceKilograms: 1e-9,
        minStep: duration(0, 1),
        maxStep: duration(2),
        constantAcceleration: {
          x: metersPerSecondSquared(0),
          y: metersPerSecondSquared(0),
          z: metersPerSecondSquared(0),
        },
      }),
    },
  ];
}

const policy = {
  minimumDwell: duration(0),
  quietWindow: duration(0),
  demotionAcceptanceHorizon: [simulationInstant(11)],
};

function registerAndBind(engine: OrbitEngineType, id: ReturnType<typeof objectId>): MotionAuthority {
  const reference = referenceModel();
  const authority = new MotionAuthority(id, motionSegment({
    start: simulationInstant(0),
    model: reference,
    motionRevision: revisionId("1"),
  }), "followingReference");
  engine.registry().register({
    id,
    type: "spacecraft",
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
  engine.configureFidelityAuthorityCandidates(id, candidates(engine, id), policy);
  engine.bindFidelityAuthority(id, authority, "reference", policy);
  return authority;
}

function stage(start: number, end: number, force: number, flow: number) {
  return {
    start: simulationInstant(start),
    end: simulationInstant(end),
    forceMagnitudeNewtons: force,
    throttle: 1,
    direction: { kind: "referenceFrame" as const, frameId: frame, unitVector: { x: 1, y: 0, z: 0 } },
    massFlowSpecification: { kind: "directMassFlow" as const, massFlowKilogramsPerSecond: flow },
  };
}

export async function assertManeuverAuthorityHandoff(engine: OrbitEngineType): Promise<void> {
  const id = objectId("700");
  const authority = registerAndBind(engine, id);
  const burn = engine.scheduleFiniteBurn(id, {
    start: simulationInstant(5),
    end: simulationInstant(10),
    stages: [stage(5, 7, 10, 1), stage(7, 10, 20, 2)],
  });

  const future = engine.getFidelityStatus(id);
  assert.equal(future.currentCandidateId, "reference");
  assert.equal(future.effectiveRequirement.requiresNumericalIntegration, false);
  assert.equal(future.futureRequirements.length, 1);
  assert.deepEqual(future.nextReevaluation, simulationInstant(5));
  assert.equal(authority.referenceStatus(), "followingReference");

  const startAdvance = engine.advanceTo(simulationInstant(5));
  assert.equal(startAdvance.status, "reachedTarget", JSON.stringify(startAdvance));
  assert.equal(authority.referenceStatus(), "diverged");
  assert.equal(authority.segments().at(-1)?.modelKind, PropagationModelKind.numerical);
  assert.equal(engine.getFidelityStatus(id).currentCandidateId, "numerical");
  assert.equal(engine.getFidelityStatus(id).effectiveRequirement.requiresContinuousThrust, true);
  assert.deepEqual(authority.segments().at(-1)?.start, simulationInstant(5));
  assert.equal(engine.registry().get(id).referenceStatus, "diverged");
  assert.equal(engine.registry().get(id).motion.configurationRevision, authority.segments().at(-1)?.modelConfigurationRevision);
  assert.deepEqual(engine.stateQueries().stateAt(id, simulationInstant(5)).epoch, simulationInstant(5));

  assert.equal(engine.advanceTo(simulationInstant(7)).status, "reachedTarget");
  assert.equal(authority.segments().at(-1)?.modelKind, PropagationModelKind.numerical);
  assert.deepEqual(authority.segments().at(-1)?.start, simulationInstant(7));
  assert.notEqual(authority.segments().at(-1)?.modelConfigurationRevision, authority.segments().at(-2)?.modelConfigurationRevision);
  assert.ok((authority.massAt(simulationInstant(7)) ?? 0) > 7.9);
  assert.ok(Math.abs((engine.registry().get(id).properties.mass ?? 0) - 8) < 1e-8);

  assert.equal(engine.advanceTo(simulationInstant(10)).status, "reachedTarget");
  assert.equal(authority.segments().at(-1)?.modelKind, PropagationModelKind.numerical);
  assert.ok(Math.abs((authority.massAt(simulationInstant(10)) ?? 0) - 2) < 1e-8);
  assert.ok(Math.abs((engine.registry().get(id).properties.mass ?? 0) - 2) < 1e-8);
  assert.equal(engine.getManeuverStatus(burn.id)?.lifecycle, "completed");
  assert.equal(engine.getFidelityStatus(id).futureRequirements.length, 0);
  assert.equal(engine.getFidelityStatus(id).effectiveRequirement.requiresContinuousThrust, false);
  assert.equal(engine.transitionFidelityAuthority(id).currentCandidateId, "analytical");
  assert.equal(engine.getFidelityStatus(id).lastTransitionResult?.code, FidelityTransitionCode.selected);

  const impulseEngine = await OrbitEngine.create({ backend: engine.backend });
  const impulseId = objectId("701");
  const impulseAuthority = registerAndBind(impulseEngine, impulseId);
  impulseEngine.scheduleImpulse(impulseId, { instant: simulationInstant(4), deltaVelocity: { x: 1, y: 0, z: 0 }, frame: frame });
  impulseEngine.scheduleImpulse(impulseId, { instant: simulationInstant(4), deltaVelocity: { x: 0, y: 2, z: 0 }, frame: frame });
  assert.equal(impulseEngine.advanceTo(simulationInstant(4)).status, "reachedTarget");
  assert.equal(impulseAuthority.referenceStatus(), "diverged");
  const impulseState = impulseEngine.stateQueries().stateAt(impulseId, simulationInstant(4));
  assert.deepEqual(impulseState.velocity, { x: 2, y: 2, z: 0 });

  const failedEngine = await OrbitEngine.create({ backend: engine.backend });
  const failedId = objectId("702");
  const failedAuthority = registerAndBind(failedEngine, failedId);
  failedEngine.configureFidelityAuthorityCandidates(failedId, candidates(failedEngine, failedId).map((candidate) =>
    candidate.id === "numerical" ? { ...candidate, candidateFactory: () => { throw new Error("candidate construction failed"); } } : candidate), policy);
  const failedImpulse = failedEngine.scheduleImpulse(failedId, { instant: simulationInstant(3), deltaVelocity: { x: 1, y: 0, z: 0 }, frame });
  const failed = failedEngine.advanceTo(simulationInstant(3));
  assert.equal(failed.status, "failed");
  assert.deepEqual(failedEngine.currentTime, simulationInstant(0));
  assert.equal(failedAuthority.segments().length, 1);
  assert.equal(failedEngine.registry().get(failedId).referenceStatus, "followingReference");
  assert.equal(failedEngine.getManeuverStatus(failedImpulse.id)?.lifecycle, "scheduled");
  assert.equal(failedEngine.listScheduledWorkDiagnostics().filter((work) => work.sourceKind === ScheduledWorkSourceKind.maneuver).length, 1);
}
