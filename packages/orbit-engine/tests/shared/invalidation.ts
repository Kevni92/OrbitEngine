import assert from "node:assert/strict";

import {
  DependencyKind,
  OrbitEngine,
  ScheduledWorkPayloadKind,
  ScheduledWorkPhase,
  ScheduledWorkSourceKind,
  objectId,
  revisionId,
  type OrbitEngine as OrbitEngineType,
} from "../../src/index.js";
import { simulationInstant } from "../../src/time.js";

function work(instant: number, dependencyRevision: string, dependencyId = "7") {
  return {
    instant: simulationInstant(instant),
    phase: ScheduledWorkPhase.predictionMaintenance,
    sourceKind: ScheduledWorkSourceKind.motion,
    sourceId: objectId("7"),
    dependencies: [{ kind: DependencyKind.motion, id: dependencyId, revision: revisionId(dependencyRevision) }],
    payload: { kind: ScheduledWorkPayloadKind.marker },
  };
}

export async function assertRevisionInvalidation(engine: OrbitEngineType): Promise<void> {
  const working = await OrbitEngine.create({ backend: engine.backend });
  const first = working.scheduleWork(work(2, "1"));
  const preserved = working.scheduleWork(work(2, "1", "8"));
  const stale = working.scheduleWork(work(3, "1"));
  const report = working.invalidateDependency(
    { kind: DependencyKind.motion, id: "7", revision: revisionId("2") },
    simulationInstant(3),
  );
  assert.deepEqual(report.retiredWorkIds, [stale.id]);
  assert.equal(report.rebuildScheduledCount, 0);
  assert.deepEqual(working.listScheduledWorkDiagnostics().map((item) => item.id), [first.id, preserved.id]);

  const result = working.advanceTo(simulationInstant(1_000_000_000));
  assert.equal(result.status, "reachedTarget");
  assert.equal(result.processedWorkCount, 2);
  assert.equal(result.processedTimestampCount, 1);
  assert.equal(working.listScheduledWorkDiagnostics().length, 0);

  const replacementEngine = await OrbitEngine.create({ backend: engine.backend });
  const replaced = replacementEngine.scheduleWork(work(20, "1"));
  const replacement = replacementEngine.replaceScheduledWork(replaced.id, replaced.generation, work(21, "2"));
  const oldRevision = replacementEngine.invalidateDependency(
    { kind: DependencyKind.motion, id: "7", revision: revisionId("2") },
    simulationInstant(20),
  );
  assert.deepEqual(oldRevision.retiredWorkIds, []);
  const newRevision = replacementEngine.invalidateDependency(
    { kind: DependencyKind.motion, id: "7", revision: revisionId("3") },
    simulationInstant(21),
  );
  assert.deepEqual(newRevision.retiredWorkIds, [replacement.id]);
  assert.equal(replacementEngine.listInvalidationDiagnostics().length, 2);

  const rebuildEngine = await OrbitEngine.create({ backend: engine.backend });
  const original = rebuildEngine.scheduleWork(work(5, "1"));
  const rebuild = rebuildEngine.invalidateFrom(
    { kind: DependencyKind.property, id: "7:mu", revision: revisionId("2") },
    simulationInstant(5),
    {
      rebuild: {
        maxItems: 1,
        work: [
          { ...work(6, "2", "7"), dependencies: [{ kind: DependencyKind.property, id: "7:mu", revision: revisionId("2") }] },
          { ...work(7, "2", "7"), dependencies: [{ kind: DependencyKind.property, id: "7:mu", revision: revisionId("2") }] },
        ],
      },
    },
  );
  assert.deepEqual(rebuild.retiredWorkIds, []);
  assert.equal(rebuild.rebuildScheduledCount, 1);
  assert.equal(rebuild.rebuildDeferredCount, 1);
  assert.deepEqual(rebuildEngine.listScheduledWorkDiagnostics().map((item) => item.id), [original.id, "2"]);
  const rebuildResult = rebuildEngine.advanceTo(simulationInstant(8));
  assert.equal(rebuildResult.processedWorkCount, 2);

  const exactEngine = await OrbitEngine.create({ backend: engine.backend });
  const exact = exactEngine.scheduleWork(work(10, "1"));
  const before = exactEngine.scheduleWork(work(9, "1", "9"));
  const exactReport = exactEngine.invalidateDependency(
    { kind: DependencyKind.motion, id: "7", revision: revisionId("2") },
    simulationInstant(10),
  );
  assert.deepEqual(exactReport.retiredWorkIds, [exact.id]);
  assert.deepEqual(exactEngine.listScheduledWorkDiagnostics().map((item) => item.id), [before.id]);
}
