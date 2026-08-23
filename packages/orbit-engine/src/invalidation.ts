import {
  dependencyKey,
  dependencyRevisionDigest,
  dependencyRevisionIdentity,
  normalizeDependencyRevisions,
  type DependencyInvalidationTarget,
  type DependencyRevision,
} from "./dependency.js";
import {
  ScheduledWorkQueue,
  SchedulerError,
  SchedulerErrorCode,
  type ScheduledWorkId,
  type ScheduledWorkInput,
  type ScheduledWorkRecord,
} from "./scheduler.js";
import { compareSimulationInstants, simulationInstant, type SimulationInstant } from "./time.js";
import { revisionId, type RevisionId } from "./propagation.js";

export type { DependencyInvalidationTarget, DependencyKind, DependencyRevision } from "./dependency.js";

export interface RebuildOptions {
  readonly work: readonly ScheduledWorkInput[];
  readonly maxItems?: number;
}

export interface DependencyInvalidationOptions {
  readonly rebuild?: RebuildOptions;
}

export interface InvalidationReport {
  readonly sequence: RevisionId;
  readonly dependency: DependencyRevision;
  readonly effectiveFrom: SimulationInstant;
  readonly retiredWorkIds: readonly ScheduledWorkId[];
  readonly rebuildScheduledCount: number;
  readonly rebuildDeferredCount: number;
}

interface TrackedWork {
  record: ScheduledWorkRecord;
  readonly dependencies: readonly DependencyRevision[];
}

interface CurrentRevision {
  readonly revision: RevisionId;
  readonly effectiveFrom: SimulationInstant;
}

function sameDependency(left: DependencyRevision, right: DependencyRevision): boolean {
  return left.kind === right.kind && left.id === right.id;
}

function normalizedWorkDependencies(input: ScheduledWorkInput): readonly DependencyRevision[] {
  const dependencies = normalizeDependencyRevisions(input.dependencies);
  const digest = dependencyRevisionDigest(dependencies);
  if (input.dependencyRevisionDigest !== undefined && digest !== undefined && revisionId(input.dependencyRevisionDigest) !== digest) {
    throw new RangeError("Explicit dependencyRevisionDigest does not match dependencies");
  }
  return dependencies;
}

function boundedCount(value: number | undefined, fallback: number, name: string): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 0) throw new RangeError(`${name} must be a non-negative safe integer`);
  return result;
}

export class RevisionInvalidationManager {
  readonly #queue: ScheduledWorkQueue;
  readonly #works = new Map<ScheduledWorkId, TrackedWork>();
  readonly #dependencyIndex = new Map<string, Set<ScheduledWorkId>>();
  readonly #currentRevisions = new Map<string, CurrentRevision>();
  readonly #reports: InvalidationReport[] = [];
  #sequence = 0n;

  constructor(queue: ScheduledWorkQueue) {
    this.#queue = queue;
  }

  #nextSequence(): RevisionId {
    this.#sequence += 1n;
    return revisionId(this.#sequence.toString());
  }

  #remove(id: ScheduledWorkId): void {
    const tracked = this.#works.get(id);
    if (tracked === undefined) return;
    this.#works.delete(id);
    for (const dependency of tracked.dependencies) {
      const index = this.#dependencyIndex.get(dependencyKey(dependency));
      index?.delete(id);
      if (index !== undefined && index.size === 0) this.#dependencyIndex.delete(dependencyKey(dependency));
    }
  }

  #track(record: ScheduledWorkRecord, input: ScheduledWorkInput): void {
    this.#remove(record.id);
    const dependencies = normalizedWorkDependencies(input);
    this.#works.set(record.id, { record, dependencies });
    for (const dependency of dependencies) {
      const key = dependencyKey(dependency);
      const index = this.#dependencyIndex.get(key) ?? new Set<ScheduledWorkId>();
      index.add(record.id);
      this.#dependencyIndex.set(key, index);
    }
  }

  track(record: ScheduledWorkRecord, input: ScheduledWorkInput): void {
    this.#track(record, input);
  }

  replace(record: ScheduledWorkRecord, input: ScheduledWorkInput): void {
    this.#track(record, input);
  }

  untrack(id: ScheduledWorkId): void {
    this.#remove(id);
  }

  #retire(id: ScheduledWorkId, retired: ScheduledWorkId[]): void {
    const tracked = this.#works.get(id);
    if (tracked === undefined) return;
    try {
      this.#queue.cancel(tracked.record.id, tracked.record.generation);
    } catch (error) {
      if (!(error instanceof SchedulerError)
        || (error.code !== SchedulerErrorCode.notFound && error.code !== SchedulerErrorCode.staleGeneration)) {
        throw error;
      }
    }
    retired.push(id);
    this.#remove(id);
  }

  invalidate(
    target: DependencyInvalidationTarget,
    effectiveFrom: SimulationInstant,
    options: DependencyInvalidationOptions = {},
  ): InvalidationReport {
    const dependency = dependencyRevisionIdentity(target);
    const instant = simulationInstant(effectiveFrom.seconds, effectiveFrom.nanoseconds);
    const key = dependencyKey(dependency);
    this.#currentRevisions.set(key, { revision: dependency.revision, effectiveFrom: instant });
    const retired: ScheduledWorkId[] = [];
    const indexed = [...(this.#dependencyIndex.get(key) ?? [])];
    for (const id of indexed) {
      const tracked = this.#works.get(id);
      if (tracked === undefined || compareSimulationInstants(tracked.record.instant, instant) < 0) continue;
      const dependencyUse = tracked.dependencies.find((value) => sameDependency(value, dependency));
      if (dependencyUse === undefined || dependencyUse.revision === dependency.revision) continue;
      this.#retire(id, retired);
    }

    const rebuild = options.rebuild;
    const maxItems = boundedCount(rebuild?.maxItems, 64, "rebuild.maxItems");
    let rebuildScheduledCount = 0;
    if (rebuild !== undefined) {
      for (const input of rebuild.work.slice(0, maxItems)) {
        const record = this.#queue.schedule(input);
        this.#track(record, input);
        rebuildScheduledCount += 1;
      }
    }
    const rebuildDeferredCount = rebuild === undefined ? 0 : Math.max(0, rebuild.work.length - rebuildScheduledCount);
    const report = Object.freeze({
      sequence: this.#nextSequence(),
      dependency,
      effectiveFrom: instant,
      retiredWorkIds: Object.freeze([...retired]),
      rebuildScheduledCount,
      rebuildDeferredCount,
    });
    this.#reports.push(report);
    if (this.#reports.length > 64) this.#reports.shift();
    return report;
  }

  prepareAdvance(currentTime: SimulationInstant): void {
    const now = simulationInstant(currentTime.seconds, currentTime.nanoseconds);
    const retired: ScheduledWorkId[] = [];
    for (const [key, revision] of this.#currentRevisions) {
      const indexed = [...(this.#dependencyIndex.get(key) ?? [])];
      for (const id of indexed) {
        const tracked = this.#works.get(id);
        if (tracked === undefined || compareSimulationInstants(tracked.record.instant, now) < 0) continue;
        const dependency = tracked.dependencies.find((value) => dependencyKey(value) === key);
        if (dependency !== undefined
          && dependency.revision !== revision.revision
          && compareSimulationInstants(tracked.record.instant, revision.effectiveFrom) >= 0) {
          this.#retire(id, retired);
        }
      }
    }
  }

  afterAdvance(currentTime: SimulationInstant): void {
    const now = simulationInstant(currentTime.seconds, currentTime.nanoseconds);
    for (const [id, tracked] of this.#works) {
      if (compareSimulationInstants(tracked.record.instant, now) < 0) this.#remove(id);
    }
  }

  diagnostics(limit = 64): readonly InvalidationReport[] {
    if (!Number.isSafeInteger(limit) || limit < 0 || limit > 64) throw new RangeError("Invalidation diagnostics limit is invalid");
    return Object.freeze(this.#reports.slice(Math.max(0, this.#reports.length - limit)).map((report) => Object.freeze({
      ...report,
      dependency: Object.freeze({ ...report.dependency }),
      effectiveFrom: simulationInstant(report.effectiveFrom.seconds, report.effectiveFrom.nanoseconds),
      retiredWorkIds: Object.freeze([...report.retiredWorkIds]),
    })));
  }
}
