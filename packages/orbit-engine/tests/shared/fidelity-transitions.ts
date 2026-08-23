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
  switchTolerance,
  motionSegment,
  type FidelityAuthorityCandidateInput,
  type PropagationModel,
  type OrbitEngine as OrbitEngineType,
} from "../../src/index.js";
import { objectId } from "../../src/objects.js";
import { referenceFrameId } from "../../src/frames.js";
import { meters, metersPerSecond } from "../../src/units.js";
import { duration, simulationInstant } from "../../src/time.js";

const root = referenceFrameId("1");
const tolerance = switchTolerance({
  positionAbsoluteMeters: 1e-6,
  positionRelative: 0,
  velocityAbsoluteMetersPerSecond: 1e-6,
  velocityRelative: 0,
});

function model(
  kind: PropagationModelKind,
  valueAt: (seconds: number) => number,
): PropagationModel {
  const declaration = propagationModelDeclaration({
    kind,
    validity: propagationTimeInterval(simulationInstant(0), simulationInstant(200)),
    direction: "bidirectional",
    propagationFrame: root,
    supportedFrameDynamics: [FrameDynamicsAssumption.inertial],
    dependencies: [],
    requiredPhysicalProperties: [],
    configurationRevision: revisionId("1"),
    errorContract: { positionAbsoluteMeters: 1e-6, velocityAbsoluteMetersPerSecond: 1e-6 },
  });
  return {
    declaration,
    evaluate: (target) => propagationState({
      position: { x: meters(valueAt(target.seconds)), y: meters(0), z: meters(0) },
      velocity: { x: metersPerSecond(1), y: metersPerSecond(0), z: metersPerSecond(0) },
      epoch: target,
      referenceFrame: root,
    }),
  };
}

function candidates(cheap: PropagationModel, high: PropagationModel, coupled: PropagationModel): readonly FidelityAuthorityCandidateInput[] {
  return [
    {
      id: "cheap",
      authorityKind: "twoBodyAnalytical",
      configurationRevision: revisionId("1"),
      cost: 1,
      capabilities: { maxPositionErrorMeters: 10, maxVelocityErrorMetersPerSecond: 1 },
      model: cheap,
      switchTolerance: tolerance,
    },
    {
      id: "high",
      authorityKind: "numerical",
      configurationRevision: revisionId("2"),
      cost: 5,
      capabilities: { maxPositionErrorMeters: 1, maxVelocityErrorMetersPerSecond: 0.1, supportsNumericalIntegration: true },
      model: high,
      switchTolerance: tolerance,
    },
    {
      id: "coupled",
      authorityKind: "coupledNumerical",
      configurationRevision: revisionId("3"),
      cost: 8,
      capabilities: { maxPositionErrorMeters: 1, maxVelocityErrorMetersPerSecond: 0.1, supportsNumericalIntegration: true, supportsMutualCoupling: true },
      model: coupled,
      switchTolerance: tolerance,
    },
  ];
}

const policy = {
  minimumDwell: duration(60),
  quietWindow: duration(10),
  demotionAcceptanceHorizon: [simulationInstant(80)],
  retryBackoff: duration(1),
  maximumRetryBackoff: duration(8),
};

export async function assertFidelityTransitions(engine: OrbitEngineType): Promise<void> {
  const id = objectId("501");
  const cheap = model(PropagationModelKind.twoBodyAnalytical, () => 0);
  const high = model(PropagationModelKind.numerical, () => 0);
  const coupled = model(PropagationModelKind.numerical, () => 0);
  const authority = new MotionAuthority(id, motionSegment({ start: simulationInstant(0), model: cheap, motionRevision: revisionId("1") }));
  engine.configureFidelityAuthorityCandidates(id, candidates(cheap, high, coupled), policy);
  engine.bindFidelityAuthority(id, authority, "cheap", policy);

  const promoted = engine.setMinimumFidelityRequirement(id, { requiresNumericalIntegration: true });
  assert.equal(promoted.currentCandidateId, "high");
  assert.equal(promoted.lastTransitionResult?.code, FidelityTransitionCode.selected);
  assert.equal(authority.referenceStatus(), "none");
  assert.equal(authority.segments().at(-1)?.modelKind, PropagationModelKind.numerical);

  await engine.advanceTo(simulationInstant(60));
  const blocked = engine.setMinimumFidelityRequirement(id, null);
  assert.equal(blocked.currentCandidateId, "high");
  assert.equal(blocked.lastTransitionResult?.code, FidelityTransitionCode.quietWindowBlocked);
  assert.deepEqual(blocked.nextReevaluation, simulationInstant(70));

  await engine.advanceTo(simulationInstant(70));
  const demoted = engine.transitionFidelityAuthority(id);
  assert.equal(demoted.currentCandidateId, "cheap");
  assert.equal(demoted.lastTransitionResult?.code, FidelityTransitionCode.selected);

  const failedId = objectId("502");
  const failedAuthority = new MotionAuthority(failedId, motionSegment({ start: simulationInstant(0), model: cheap, motionRevision: revisionId("1") }));
  const failedPolicy = { ...policy, demotionAcceptanceHorizon: [simulationInstant(150)] };
  const divergingCheap = model(PropagationModelKind.twoBodyAnalytical, (seconds) => seconds >= 150 ? 100 : 0);
  engine.configureFidelityAuthorityCandidates(failedId, [
    ...candidates(divergingCheap, high, coupled),
  ], failedPolicy);
  engine.bindFidelityAuthority(failedId, failedAuthority, "high", failedPolicy);
  await engine.advanceTo(simulationInstant(130));
  engine.setMinimumFidelityRequirement(failedId, null);
  await engine.advanceTo(simulationInstant(140));
  const failedDemotion = engine.transitionFidelityAuthority(failedId);
  assert.equal(failedDemotion.currentCandidateId, "high");
  assert.equal(failedDemotion.lastTransitionResult?.code, FidelityTransitionCode.demotionRejected);
  assert.deepEqual(failedDemotion.nextReevaluation, simulationInstant(141));

  const failedPromotionId = objectId("503");
  const failedPromotionAuthority = new MotionAuthority(failedPromotionId, motionSegment({ start: simulationInstant(0), model: cheap, motionRevision: revisionId("1") }));
  const badHigh = model(PropagationModelKind.numerical, () => 100);
  engine.configureFidelityAuthorityCandidates(failedPromotionId, candidates(cheap, badHigh, coupled), policy);
  engine.bindFidelityAuthority(failedPromotionId, failedPromotionAuthority, "cheap", policy);
  const failedPromotion = engine.setMinimumFidelityRequirement(failedPromotionId, { requiresNumericalIntegration: true });
  assert.equal(failedPromotion.currentCandidateId, "cheap");
  assert.equal(failedPromotion.lastTransitionResult?.code, FidelityTransitionCode.switchFailed);
  assert.equal(failedPromotionAuthority.segments().length, 1);

  const coupledStatus = engine.setFidelitySignal(id, "mutual-response", { requiresMutualCoupling: true });
  assert.equal(coupledStatus.currentCandidateId, "coupled");
  assert.equal(coupledStatus.currentAuthorityKind, "coupledNumerical");
  assert.equal(authority.referenceStatus(), "none");
}
