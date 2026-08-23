import assert from "node:assert/strict";

import {
  objectId,
  ScheduledWorkPayloadKind,
  ScheduledWorkPhase,
  SchedulerError,
  type OrbitEngine,
} from "../../src/index.js";
import { simulationInstant } from "../../src/time.js";

export function assertScheduledWorkQueue(engine: OrbitEngine): void {
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
}
