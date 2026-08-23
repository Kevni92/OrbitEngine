import assert from "node:assert/strict";

import {
  objectId,
  ScheduledWorkPayloadKind,
  ScheduledWorkPhase,
  SchedulerError,
  type AdvanceResult,
  OrbitEngine,
  type OrbitEngine as OrbitEngineType,
} from "../../src/index.js";
import { duration, simulationInstant } from "../../src/time.js";

export async function assertScheduledWorkQueue(engine: OrbitEngineType): Promise<void> {
  assert.deepEqual(engine.clock(), { currentTime: simulationInstant(0), revision: "0", nextWorkId: "1" });
  const observation = engine.scheduleWork({ instant: simulationInstant(2), phase: ScheduledWorkPhase.observation, sourceKind: 2, sourceId: objectId("7"), payload: { kind: ScheduledWorkPayloadKind.marker } });
  const boundary = engine.scheduleWork({ instant: simulationInstant(2), phase: ScheduledWorkPhase.boundary, sourceKind: 2, sourceId: objectId("7"), payload: { kind: ScheduledWorkPayloadKind.marker } });
  assert.equal(observation.id, "1");
  assert.equal(boundary.id, "2");
  assert.deepEqual(engine.listScheduledWorkDiagnostics().map((item) => [item.id, item.phase]), [["2", "boundary"], ["1", "observation"]]);

  assert.throws(
    () => engine.scheduleWork({ instant: simulationInstant(0), phase: ScheduledWorkPhase.boundary, sourceKind: 2, sourceId: objectId("7"), payload: { kind: ScheduledWorkPayloadKind.marker } }),
    (error: unknown) => error instanceof SchedulerError && error.code === "sameTimeRejected",
  );
  assert.throws(
    () => engine.scheduleWork({ instant: simulationInstant(-1, 999_999_999), phase: ScheduledWorkPhase.boundary, sourceKind: 2, sourceId: objectId("7"), payload: { kind: ScheduledWorkPayloadKind.marker } }),
    (error: unknown) => error instanceof SchedulerError && error.code === "pastEvent",
  );

  const replacement = engine.replaceScheduledWork(observation.id, observation.generation, { instant: simulationInstant(3, 1), phase: ScheduledWorkPhase.physicalChange, sourceKind: 2, sourceId: objectId("7"), payload: { kind: ScheduledWorkPayloadKind.marker } });
  assert.equal(replacement.id, observation.id);
  assert.equal(replacement.generation, "2");
  assert.throws(() => engine.cancelScheduledWork(observation.id, observation.generation), (error: unknown) => error instanceof SchedulerError && error.code === "staleGeneration");
  engine.cancelScheduledWork(boundary.id, boundary.generation);
  assert.deepEqual(engine.listScheduledWorkDiagnostics().map((item) => item.id), ["1"]);

  const direct = await OrbitEngine.create({ backend: engine.backend });
  direct.scheduleWork({ instant: simulationInstant(2), phase: ScheduledWorkPhase.physicalChange, sourceKind: 2, sourceId: objectId("7"), payload: { kind: ScheduledWorkPayloadKind.marker } });
  direct.scheduleWork({ instant: simulationInstant(3), phase: ScheduledWorkPhase.physicalChange, sourceKind: 2, sourceId: objectId("7"), payload: { kind: ScheduledWorkPayloadKind.marker } });
  const directResult = direct.advanceTo(simulationInstant(4));
  assert.equal(directResult.status, "reachedTarget");
  assert.equal(directResult.processedTimestampCount, 2);

  const partitioned = await OrbitEngine.create({ backend: engine.backend });
  partitioned.scheduleWork({ instant: simulationInstant(2), phase: ScheduledWorkPhase.physicalChange, sourceKind: 2, sourceId: objectId("7"), payload: { kind: ScheduledWorkPayloadKind.marker } });
  partitioned.scheduleWork({ instant: simulationInstant(3), phase: ScheduledWorkPhase.physicalChange, sourceKind: 2, sourceId: objectId("7"), payload: { kind: ScheduledWorkPayloadKind.marker } });
  partitioned.advanceTo(simulationInstant(2));
  partitioned.advanceBy(duration(2));
  assert.deepEqual(partitioned.clock(), direct.clock());
  assert.deepEqual(partitioned.listScheduledWorkDiagnostics(), direct.listScheduledWorkDiagnostics());

  const sameTime = await OrbitEngine.create({ backend: engine.backend });
  sameTime.scheduleWork({ instant: simulationInstant(2), phase: ScheduledWorkPhase.physicalChange, sourceKind: 2, sourceId: objectId("7"), payload: { kind: ScheduledWorkPayloadKind.scheduleSameTime, value: 2 } });
  const sameTimeResult = sameTime.advanceTo(simulationInstant(2));
  assert.equal(sameTimeResult.processedWorkCount, 2);

  const failed = await OrbitEngine.create({ backend: engine.backend });
  failed.scheduleWork({ instant: simulationInstant(2), phase: ScheduledWorkPhase.physicalChange, sourceKind: 2, sourceId: objectId("7"), payload: { kind: ScheduledWorkPayloadKind.fail } });
  const failedResult: AdvanceResult = failed.advanceTo(simulationInstant(4));
  assert.equal(failedResult.status, "failed");
  assert.equal(failedResult.failure?.code, "payloadFailed");
  assert.deepEqual(failed.clock(), { currentTime: simulationInstant(0), revision: "0", nextWorkId: "2" });
  assert.equal(failed.listScheduledWorkDiagnostics().length, 1);

  const cycle = await OrbitEngine.create({ backend: engine.backend, scheduler: { maxWorkItemsPerTimestamp: 1 } });
  cycle.scheduleWork({ instant: simulationInstant(2), phase: ScheduledWorkPhase.physicalChange, sourceKind: 2, sourceId: objectId("7"), payload: { kind: ScheduledWorkPayloadKind.scheduleSameTime, value: 2 } });
  const cycleResult = cycle.advanceTo(simulationInstant(2));
  assert.equal(cycleResult.status, "failed");
  assert.equal(cycleResult.failure?.code, "timestampBudgetExceeded");
  assert.equal(cycle.clock().currentTime.seconds, 0);
  assert.equal(cycle.listScheduledWorkDiagnostics().length, 1);
}
