import assert from "node:assert/strict";

import {
  OrbitEngine,
  ScheduledWorkPayloadKind,
  ScheduledWorkPhase,
  ScheduledWorkSourceKind,
  type OrbitEngine as OrbitEngineType,
} from "../../src/index.js";
import {
  ManeuverError,
  STANDARD_GRAVITY_METERS_PER_SECOND_SQUARED,
  type FiniteBurnManeuver,
  type ImpulseManeuver,
} from "../../src/maneuver.js";
import { objectId } from "../../src/objects.js";
import { simulationInstant } from "../../src/time.js";

const object = objectId("9007199254740993");

function referenceDirection() {
  return { kind: "referenceFrame" as const, frameId: "1", unitVector: { x: 3, y: 0, z: 0 } };
}

function bodyDirection() {
  return {
    kind: "bodyFrame" as const,
    unitVectorBody: { x: 0, y: 2, z: 0 },
    attitudeSourceId: "attitude-source",
    attitudeRevision: "7",
  };
}

function directStage(start: number, end: number, force = 100) {
  return {
    start: simulationInstant(start, 11),
    end: simulationInstant(end, 22),
    forceMagnitudeNewtons: force,
    throttle: 0.5,
    direction: referenceDirection(),
    massFlowSpecification: { kind: "directMassFlow" as const, massFlowKilogramsPerSecond: 4 },
  };
}

export async function assertManeuverLifecycle(engine: OrbitEngineType): Promise<void> {
  const first = engine.scheduleImpulse(object, {
    instant: simulationInstant(5, 1),
    deltaVelocity: { x: 3, y: 0, z: 0 },
    frame: "1",
  });
  assert.equal(first.id, "1");
  assert.equal(first.revision, "1");
  assert.equal(first.lifecycle, "scheduled");
  assert.equal(first.deltaVelocity.x, 3);
  assert.equal(first.orderingKey, first.id);

  const second = engine.scheduleImpulse(object, {
    instant: simulationInstant(5, 1),
    deltaVelocity: { x: 0, y: 4, z: 0 },
    referenceFrame: "1",
  });
  assert.equal(second.id, "2");
  assert.deepEqual(engine.listManeuvers({ objectId: object }).map((value) => value.id), ["1", "2"]);

  const finite = engine.scheduleFiniteBurn(object, {
    start: simulationInstant(10, 11),
    end: simulationInstant(30, 22),
    stages: [directStage(10, 20), {
      ...directStage(20, 30, 50),
      start: simulationInstant(20, 22),
      throttle: 1,
      direction: bodyDirection(),
      massFlowSpecification: { kind: "exhaustVelocity", exhaustVelocityMetersPerSecond: 25 },
    }],
    minimumMassKilograms: 2,
  });
  assert.equal(finite.id, "3");
  assert.equal(finite.stages.length, 2);
  assert.equal(finite.stages[0]?.start.nanoseconds, 11);
  assert.equal(finite.stages[0]?.effectiveForceMagnitudeNewtons, 50);
  assert.equal(finite.stages[0]?.effectiveMassFlowKilogramsPerSecond, 2);
  assert.equal(finite.stages[1]?.direction.kind, "bodyFrame");
  assert.equal(finite.stages[1]?.massFlowSpecification.massFlowKilogramsPerSecond, 2);
  assert.equal(finite.minimumMassKilograms, 2);

  assert.deepEqual(
    engine.listScheduledWorkDiagnostics()
      .filter((work) => work.sourceKind === ScheduledWorkSourceKind.maneuver)
      .map((work) => [work.instant.seconds, work.payload.kind]),
    [
      [5, ScheduledWorkPayloadKind.maneuverImpulse],
      [5, ScheduledWorkPayloadKind.maneuverImpulse],
      [10, ScheduledWorkPayloadKind.maneuverBurnStart],
      [20, ScheduledWorkPayloadKind.maneuverStageBoundary],
      [30, ScheduledWorkPayloadKind.maneuverBurnEnd],
    ],
  );

  const specificImpulse = engine.scheduleFiniteBurn(objectId("4"), {
    start: simulationInstant(40),
    end: simulationInstant(41),
    stages: [{
      start: simulationInstant(40),
      end: simulationInstant(41),
      forceMagnitudeNewtons: STANDARD_GRAVITY_METERS_PER_SECOND_SQUARED,
      throttle: 1,
      direction: referenceDirection(),
      massFlowSpecification: { kind: "specificImpulse", specificImpulseSeconds: 2 },
    }],
  });
  assert.equal(specificImpulse.stages[0]?.massFlowSpecification.exhaustVelocityMetersPerSecond, 2 * STANDARD_GRAVITY_METERS_PER_SECOND_SQUARED);
  assert.equal(specificImpulse.stages[0]?.massFlowSpecification.massFlowKilogramsPerSecond, 0.5);

  assert.deepEqual(engine.maneuvers().roundTrip(finite), finite);
  assert.deepEqual(engine.maneuvers().roundTrip(first), first);
  assert.equal(engine.getManeuverStatus(finite.id)?.dependencyRevisionDigest, "0");

  assert.throws(
    () => engine.scheduleFiniteBurn(object, {
      start: simulationInstant(15, 11),
      end: simulationInstant(35, 22),
      stages: [directStage(15, 35)],
    }),
    (error: unknown) => error instanceof ManeuverError && error.code === "burnOverlap",
  );
  assert.throws(
    () => engine.scheduleFiniteBurn(object, {
      start: simulationInstant(50),
      end: simulationInstant(60, 22),
      stages: [directStage(50, 55), directStage(54, 60)],
    }),
    (error: unknown) => error instanceof ManeuverError && error.code === "stageOverlap",
  );
  assert.throws(
    () => engine.scheduleFiniteBurn(object, {
      start: simulationInstant(70),
      end: simulationInstant(80),
      stages: new Array(65).fill(undefined).map((_, index) => directStage(70 + index / 100, 70 + (index + 1) / 100)),
    }),
    (error: unknown) => error instanceof ManeuverError && error.code === "stageCount",
  );
  assert.throws(
    () => engine.scheduleImpulse(object, { instant: simulationInstant(0), deltaVelocity: { x: 1, y: 0, z: 0 }, frame: "1" }),
    (error: unknown) => error instanceof ManeuverError && error.code === "notFuture",
  );
  assert.throws(
    () => engine.scheduleFiniteBurn(object, {
      start: simulationInstant(90),
      end: simulationInstant(91),
      stages: [{ ...directStage(90, 91), throttle: 1.1 }],
    }),
    (error: unknown) => error instanceof ManeuverError && error.code === "invalidStage",
  );
  const afterRejectedInsertions = engine.scheduleImpulse(object, {
    instant: simulationInstant(100),
    deltaVelocity: { x: 1, y: 0, z: 0 },
    frame: "1",
  });
  assert.equal(afterRejectedInsertions.id, "5");

  const updated = engine.updateManeuver(first.id, {
    instant: simulationInstant(6, 2),
    deltaVelocity: { x: 0, y: 0, z: 5 },
    frame: "1",
  }) as ImpulseManeuver;
  assert.equal(updated.id, first.id);
  assert.equal(updated.revision, "2");
  assert.equal(updated.deltaVelocity.z, 5);
  assert.deepEqual(
    engine.listScheduledWorkDiagnostics()
      .filter((work) => work.sourceKind === ScheduledWorkSourceKind.maneuver)
      .map((work) => [work.instant.seconds, work.payload.kind]),
    [
      [5, ScheduledWorkPayloadKind.maneuverImpulse],
      [6, ScheduledWorkPayloadKind.maneuverImpulse],
      [10, ScheduledWorkPayloadKind.maneuverBurnStart],
      [20, ScheduledWorkPayloadKind.maneuverStageBoundary],
      [30, ScheduledWorkPayloadKind.maneuverBurnEnd],
      [40, ScheduledWorkPayloadKind.maneuverBurnStart],
      [41, ScheduledWorkPayloadKind.maneuverBurnEnd],
      [100, ScheduledWorkPayloadKind.maneuverImpulse],
    ],
  );

  const cancelled = engine.cancelManeuver(second.id);
  assert.equal(cancelled.lifecycle, "cancelled");
  assert.equal(cancelled.revision, "2");
  assert.equal(engine.getManeuverStatus(second.id)?.lifecycle, "cancelled");
  assert.equal(engine.listManeuvers({ lifecycle: "cancelled" }).length, 1);

  assert.equal(engine.advanceTo(simulationInstant(7)).status, "reachedTarget");
  assert.equal(engine.getManeuverStatus(updated.id)?.lifecycle, "completed");
  assert.throws(
    () => engine.updateManeuver(updated.id, {
      instant: simulationInstant(7),
      deltaVelocity: { x: 1, y: 0, z: 0 },
      frame: "1",
    }),
    (error: unknown) => error instanceof ManeuverError && error.code === "notFuture",
  );

  const eventEngine = await OrbitEngine.create({ backend: engine.backend });
  const eventManeuver = eventEngine.scheduleFiniteBurn(objectId("8"), {
    start: simulationInstant(2),
    end: simulationInstant(6),
    stages: [
      { ...directStage(2, 4), start: simulationInstant(2), end: simulationInstant(4) },
      { ...directStage(4, 6), start: simulationInstant(4), end: simulationInstant(6) },
    ],
  });
  assert.equal(eventEngine.advanceTo(simulationInstant(2)).status, "reachedTarget");
  assert.equal(eventEngine.getManeuverStatus(eventManeuver.id)?.lifecycle, "active");
  assert.equal(eventEngine.getManeuverStatus(eventManeuver.id)?.currentStageIndex, 0);
  assert.equal(eventEngine.advanceTo(simulationInstant(4)).status, "reachedTarget");
  assert.equal(eventEngine.getManeuverStatus(eventManeuver.id)?.currentStageIndex, 1);
  assert.equal(eventEngine.advanceTo(simulationInstant(6)).status, "reachedTarget");
  assert.equal(eventEngine.getManeuverStatus(eventManeuver.id)?.lifecycle, "completed");

  const rollbackEngine = await OrbitEngine.create({ backend: engine.backend });
  const rollbackManeuver = rollbackEngine.scheduleImpulse(objectId("9"), {
    instant: simulationInstant(2),
    deltaVelocity: { x: 1, y: 0, z: 0 },
    frame: "1",
  });
  rollbackEngine.scheduleWork({
    instant: simulationInstant(2),
    phase: ScheduledWorkPhase.physicalChange,
    sourceKind: ScheduledWorkSourceKind.test,
    sourceId: objectId("99"),
    payload: { kind: ScheduledWorkPayloadKind.fail },
  });
  const rollback = rollbackEngine.advanceTo(simulationInstant(2));
  assert.equal(rollback.status, "failed");
  assert.equal(rollback.failure?.code, "payloadFailed");
  assert.equal(rollbackEngine.getManeuverStatus(rollbackManeuver.id)?.lifecycle, "scheduled");
  assert.equal(rollbackEngine.listScheduledWorkDiagnostics().filter((work) => work.sourceKind === ScheduledWorkSourceKind.maneuver).length, 1);
}

export function assertManeuverValueTypeParity(left: ImpulseManeuver | FiniteBurnManeuver, right: ImpulseManeuver | FiniteBurnManeuver): void {
  assert.deepEqual(left, right);
}
