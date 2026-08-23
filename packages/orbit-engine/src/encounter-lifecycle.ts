import {
  EncounterRecordLifecycle,
  createEncounterRecord,
  transitionEncounterRecordLifecycle,
  type EncounterId,
  type EncounterRecord,
  type EncounterRecordInput,
  type EncounterRecordQuality,
} from "./encounter.js";
import type { EncounterBroadPhaseDiagnostics } from "./broad-phase.js";
import {
  dependencyKey,
  dependencyRevisionIdentity,
  normalizeDependencyRevisions,
  type DependencyInvalidationTarget,
  type DependencyRevision,
} from "./dependency.js";
import { objectId, type ObjectId } from "./objects.js";
import { revisionId, type RevisionId } from "./propagation.js";
import {
  compareSimulationInstants,
  simulationInstant,
  type SimulationInstant,
} from "./time.js";
import type { EncounterSchedulingStatus } from "./encounter-scheduling.js";

export interface EncounterRegistrationInput {
  readonly record: EncounterRecordInput | EncounterRecord;
  readonly dependencyRevisions?: readonly DependencyRevision[];
}

export interface EncounterUpcomingQuery {
  readonly objectId?: ObjectId;
  readonly from: SimulationInstant;
  readonly to: SimulationInstant;
  readonly quality?: EncounterRecordQuality;
}

export interface EncounterCoverageQuery {
  readonly profileId?: string;
  readonly domainId?: string;
  readonly from?: SimulationInstant;
  readonly to?: SimulationInstant;
}

export interface EncounterCoverage {
  readonly profileId?: string;
  readonly domainId?: string;
  readonly from?: SimulationInstant;
  readonly to?: SimulationInstant;
  readonly activeEncounterIds: readonly EncounterId[];
  readonly staleEncounterIds: readonly EncounterId[];
  readonly activeRecordCount: number;
  readonly staleRecordCount: number;
  readonly coveredUntil?: SimulationInstant;
  readonly complete: boolean;
  readonly pendingRebuildCount: number;
  readonly scheduledMaintenanceWorkCount: number;
  readonly scheduledRefinementWorkCount: number;
  readonly incompleteHorizon: boolean;
}

export interface EncounterRecordDiagnostic {
  readonly encounterId: EncounterId;
  readonly generation: RevisionId;
  readonly lifecycle: EncounterRecordLifecycle;
  readonly quality: EncounterRecordQuality;
  readonly predictionInterval: EncounterRecord["predictionInterval"];
  readonly closestApproachInstant: SimulationInstant;
  readonly dependencyRevisionDigest?: RevisionId;
  readonly scheduledRefinementWorkId?: string;
  readonly scheduledFidelityWorkId?: string;
  readonly invalidationCount: number;
  readonly lastInvalidation?: {
    readonly dependency: DependencyRevision;
    readonly effectiveFrom: SimulationInstant;
  };
}

export interface EncounterInvalidationResult {
  readonly dependency: DependencyRevision;
  readonly effectiveFrom: SimulationInstant;
  readonly staleEncounterIds: readonly EncounterId[];
}

export interface EncounterRebuildResult {
  readonly processedCount: number;
  readonly deferredCount: number;
  readonly rebuiltEncounterIds: readonly EncounterId[];
}

export interface EncounterPerformanceDiagnostics {
  readonly indexedObjects: number;
  readonly indexedBounds: number;
  readonly indexedDomains: number;
  readonly indexedShards: number;
  readonly overlapTests: number;
  readonly candidatePairs: number;
  readonly coarseRejects: number;
  readonly refinementIntervals: number;
  readonly solverEvaluations: number;
  readonly activeRecords: number;
  readonly staleRecords: number;
  readonly invalidationCount: number;
  readonly rebuildPendingCount: number;
  readonly rebuildProcessedCount: number;
  readonly rebuildDeferredCount: number;
  readonly scheduledMaintenanceWork: number;
  readonly scheduledRefinementWork: number;
  readonly incompleteHorizonWorkBudgetEvents: number;
}

interface StoredEncounter {
  record: EncounterRecord;
  readonly dependencies: readonly DependencyRevision[];
  invalidationCount: number;
  lastInvalidation?: {
    readonly dependency: DependencyRevision;
    readonly effectiveFrom: SimulationInstant;
  };
}

interface CurrentRevision {
  readonly revision: RevisionId;
  readonly effectiveFrom: SimulationInstant;
}

interface RebuildEntry {
  readonly key: string;
  readonly input: EncounterRegistrationInput;
}

interface EncounterLifecycleHost {
  readonly currentTime: () => SimulationInstant;
  readonly schedulingStatus?: () => EncounterSchedulingStatus;
}

function compareText(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function compareObjectIds(left: ObjectId, right: ObjectId): number {
  const a = BigInt(left);
  const b = BigInt(right);
  return a === b ? 0 : a < b ? -1 : 1;
}

function compareRevisions(left: RevisionId, right: RevisionId): number {
  const a = BigInt(left);
  const b = BigInt(right);
  return a === b ? 0 : a < b ? -1 : 1;
}

function normalizedInstant(value: SimulationInstant, name: string): SimulationInstant {
  return simulationInstant(value.seconds, value.nanoseconds);
}

function intervalIntersects(
  interval: EncounterRecord["predictionInterval"],
  from: SimulationInstant,
  to: SimulationInstant,
): boolean {
  const end = interval.end;
  return compareSimulationInstants(interval.start, to) < 0
    && (end === undefined || compareSimulationInstants(from, end) < 0);
}

function futureCoverage(interval: EncounterRecord["predictionInterval"], instant: SimulationInstant): boolean {
  return interval.end === undefined || compareSimulationInstants(interval.end, instant) > 0;
}

function recordSort(left: EncounterRecord, right: EncounterRecord): number {
  return compareSimulationInstants(left.closestApproachInstant, right.closestApproachInstant)
    || compareObjectIds(left.objectA, right.objectA)
    || compareObjectIds(left.objectB, right.objectB)
    || compareRevisions(left.generation, right.generation)
    || compareText(left.encounterId, right.encounterId);
}

function recordKey(id: EncounterId, generation: RevisionId): string {
  return `${id}:${generation}`;
}

function sourceRecord(value: EncounterRecordInput | EncounterRecord): EncounterRecordInput {
  return value as EncounterRecordInput;
}

function registrationRecord(input: EncounterRegistrationInput): { readonly record: EncounterRecord; readonly dependencies: readonly DependencyRevision[] } {
  const source = sourceRecord(input.record);
  const embedded = "dependencyRevisions" in source
    ? (source as EncounterRecordInput).dependencyRevisions
    : undefined;
  const dependencies = normalizeDependencyRevisions(input.dependencyRevisions ?? embedded);
  const record = dependencies.length === 0
    ? createEncounterRecord(source)
    : createEncounterRecord({ ...source, dependencyRevisions: dependencies });
  return Object.freeze({ record, dependencies });
}

function hasDifferentDependency(
  dependencies: readonly DependencyRevision[],
  target: DependencyRevision,
): boolean {
  return dependencies.some((value) => dependencyKey(value) === dependencyKey(target) && value.revision !== target.revision);
}

function cloneRecordDiagnostic(value: EncounterRecordDiagnostic): EncounterRecordDiagnostic {
  return Object.freeze({
    ...value,
    predictionInterval: Object.freeze({
      start: simulationInstant(value.predictionInterval.start.seconds, value.predictionInterval.start.nanoseconds),
      ...(value.predictionInterval.end === undefined ? {} : {
        end: simulationInstant(value.predictionInterval.end.seconds, value.predictionInterval.end.nanoseconds),
      }),
    }),
    closestApproachInstant: simulationInstant(value.closestApproachInstant.seconds, value.closestApproachInstant.nanoseconds),
    ...(value.lastInvalidation === undefined ? {} : {
      lastInvalidation: Object.freeze({
        dependency: Object.freeze({ ...value.lastInvalidation.dependency }),
        effectiveFrom: simulationInstant(value.lastInvalidation.effectiveFrom.seconds, value.lastInvalidation.effectiveFrom.nanoseconds),
      }),
    }),
  });
}

export class EncounterLifecycleManager {
  readonly #host: EncounterLifecycleHost;
  readonly #records = new Map<EncounterId, StoredEncounter>();
  readonly #dependencyIndex = new Map<string, Set<EncounterId>>();
  readonly #currentRevisions = new Map<string, CurrentRevision>();
  readonly #rebuildQueue: RebuildEntry[] = [];
  readonly #rebuildKeys = new Set<string>();
  #invalidationCount = 0;
  #rebuildProcessedCount = 0;
  #rebuildDeferredCount = 0;
  #coarseRejects = 0;
  #refinementIntervals = 0;
  #solverEvaluations = 0;
  #incompleteHorizonWorkBudgetEvents = 0;

  constructor(host: EncounterLifecycleHost) {
    this.#host = host;
  }

  #removeDependencyIndexes(id: EncounterId, dependencies: readonly DependencyRevision[]): void {
    for (const dependency of dependencies) {
      const index = this.#dependencyIndex.get(dependencyKey(dependency));
      index?.delete(id);
      if (index !== undefined && index.size === 0) this.#dependencyIndex.delete(dependencyKey(dependency));
    }
  }

  #addDependencyIndexes(id: EncounterId, dependencies: readonly DependencyRevision[]): void {
    for (const dependency of dependencies) {
      const key = dependencyKey(dependency);
      const index = this.#dependencyIndex.get(key) ?? new Set<EncounterId>();
      index.add(id);
      this.#dependencyIndex.set(key, index);
    }
  }

  #isImmediatelyStale(record: EncounterRecord, dependencies: readonly DependencyRevision[]): CurrentRevision | undefined {
    for (const dependency of dependencies) {
      const current = this.#currentRevisions.get(dependencyKey(dependency));
      if (current !== undefined
        && current.revision !== dependency.revision
        && futureCoverage(record.predictionInterval, current.effectiveFrom)) return current;
    }
    return undefined;
  }

  register(input: EncounterRegistrationInput): EncounterRecord {
    const normalized = registrationRecord(input);
    const currentStaleRevision = this.#isImmediatelyStale(normalized.record, normalized.dependencies);
    let record = normalized.record;
    if (currentStaleRevision !== undefined && record.lifecycle === EncounterRecordLifecycle.active) {
      record = transitionEncounterRecordLifecycle(record, EncounterRecordLifecycle.stale);
    }
    const existing = this.#records.get(record.encounterId);
    if (existing !== undefined && compareRevisions(existing.record.generation, record.generation) > 0) {
      throw new RangeError("Encounter generation cannot move backwards");
    }
    if (existing !== undefined) this.#removeDependencyIndexes(existing.record.encounterId, existing.dependencies);
    const stored: StoredEncounter = {
      record,
      dependencies: normalized.dependencies,
      invalidationCount: existing?.invalidationCount ?? 0,
      lastInvalidation: existing?.lastInvalidation,
    };
    this.#records.set(record.encounterId, stored);
    this.#addDependencyIndexes(record.encounterId, normalized.dependencies);
    return record;
  }

  get(id: EncounterId | string): EncounterRecord | undefined {
    const encounterId = typeof id === "string" ? id as EncounterId : id;
    return this.#records.get(encounterId)?.record;
  }

  listUpcoming(input: EncounterUpcomingQuery): readonly EncounterRecord[] {
    const from = normalizedInstant(input.from, "from");
    const to = normalizedInstant(input.to, "to");
    if (compareSimulationInstants(from, to) >= 0) throw new RangeError("Upcoming encounter query requires to after from");
    const object = input.objectId === undefined ? undefined : objectId(input.objectId);
    const result = [...this.#records.values()]
      .map((value) => value.record)
      .filter((record) => record.lifecycle === EncounterRecordLifecycle.active)
      .filter((record) => input.quality === undefined || record.quality === input.quality)
      .filter((record) => object === undefined || record.objectA === object || record.objectB === object)
      .filter((record) => intervalIntersects(record.predictionInterval, from, to))
      .sort(recordSort);
    return Object.freeze(result);
  }

  getCoverage(input: EncounterCoverageQuery = {}): EncounterCoverage {
    const from = input.from === undefined ? undefined : normalizedInstant(input.from, "from");
    const to = input.to === undefined ? undefined : normalizedInstant(input.to, "to");
    if (from !== undefined && to !== undefined && compareSimulationInstants(from, to) >= 0) {
      throw new RangeError("Encounter coverage query requires to after from");
    }
    const scheduling = this.#host.schedulingStatus?.();
    const matching = [...this.#records.values()].filter((value) => {
      const record = value.record;
      if (input.profileId !== undefined && record.profileId !== input.profileId) return false;
      if (input.domainId !== undefined && record.domain.domainId !== input.domainId) return false;
      if (from !== undefined && to !== undefined && !intervalIntersects(record.predictionInterval, from, to)) return false;
      return true;
    });
    const active = matching.filter((value) => value.record.lifecycle === EncounterRecordLifecycle.active);
    const stale = matching.filter((value) => value.record.lifecycle === EncounterRecordLifecycle.stale);
    let coveredUntil: SimulationInstant | undefined;
    for (const value of active) {
      const end = value.record.predictionInterval.end;
      if (end !== undefined && (coveredUntil === undefined || compareSimulationInstants(end, coveredUntil) > 0)) coveredUntil = end;
    }
    const pendingRebuildCount = this.#rebuildQueue.length;
    const scheduledMaintenanceWorkCount = scheduling?.maintenanceCoverage.length ?? 0;
    const scheduledRefinementWorkCount = scheduling?.fidelitySchedules.filter((value) => value.refinementWorkId !== undefined).length ?? 0;
    const incompleteHorizon = pendingRebuildCount > 0
      || (scheduling?.diagnostics.some((value) => value.code === "incompleteHorizon" || value.code === "overload") ?? false);
    const complete = !incompleteHorizon && (matching.length === 0 || stale.length === 0);
    return Object.freeze({
      ...(input.profileId === undefined ? {} : { profileId: input.profileId }),
      ...(input.domainId === undefined ? {} : { domainId: input.domainId }),
      ...(from === undefined ? {} : { from }),
      ...(to === undefined ? {} : { to }),
      activeEncounterIds: Object.freeze(active.map((value) => value.record.encounterId).sort(compareText)),
      staleEncounterIds: Object.freeze(stale.map((value) => value.record.encounterId).sort(compareText)),
      activeRecordCount: active.length,
      staleRecordCount: stale.length,
      ...(coveredUntil === undefined ? {} : { coveredUntil: simulationInstant(coveredUntil.seconds, coveredUntil.nanoseconds) }),
      complete,
      pendingRebuildCount,
      scheduledMaintenanceWorkCount,
      scheduledRefinementWorkCount,
      incompleteHorizon,
    });
  }

  getDiagnostics(id: EncounterId | string): EncounterRecordDiagnostic | undefined {
    const stored = this.#records.get(typeof id === "string" ? id as EncounterId : id);
    if (stored === undefined) return undefined;
    return cloneRecordDiagnostic({
      encounterId: stored.record.encounterId,
      generation: stored.record.generation,
      lifecycle: stored.record.lifecycle,
      quality: stored.record.quality,
      predictionInterval: stored.record.predictionInterval,
      closestApproachInstant: stored.record.closestApproachInstant,
      ...(stored.record.dependencyRevisionDigest === undefined ? {} : { dependencyRevisionDigest: stored.record.dependencyRevisionDigest }),
      ...(stored.record.scheduledRefinementWorkId === undefined ? {} : { scheduledRefinementWorkId: stored.record.scheduledRefinementWorkId }),
      ...(stored.record.scheduledFidelityWorkId === undefined ? {} : { scheduledFidelityWorkId: stored.record.scheduledFidelityWorkId }),
      invalidationCount: stored.invalidationCount,
      ...(stored.lastInvalidation === undefined ? {} : { lastInvalidation: stored.lastInvalidation }),
    });
  }

  invalidate(target: DependencyInvalidationTarget, effectiveFrom: SimulationInstant): EncounterInvalidationResult {
    const dependency = dependencyRevisionIdentity(target);
    const instant = normalizedInstant(effectiveFrom, "effectiveFrom");
    this.#currentRevisions.set(dependencyKey(dependency), { revision: dependency.revision, effectiveFrom: instant });
    const candidates = [...(this.#dependencyIndex.get(dependencyKey(dependency)) ?? [])]
      .map((id) => this.#records.get(id))
      .filter((value): value is StoredEncounter => value !== undefined)
      .sort((left, right) => recordSort(left.record, right.record));
    const staleEncounterIds: EncounterId[] = [];
    for (const stored of candidates) {
      if (stored.record.lifecycle !== EncounterRecordLifecycle.active
        || !futureCoverage(stored.record.predictionInterval, instant)
        || !hasDifferentDependency(stored.dependencies, dependency)) continue;
      stored.record = transitionEncounterRecordLifecycle(stored.record, EncounterRecordLifecycle.stale);
      stored.invalidationCount += 1;
      stored.lastInvalidation = Object.freeze({ dependency, effectiveFrom: instant });
      this.#removeDependencyIndexes(stored.record.encounterId, stored.dependencies);
      staleEncounterIds.push(stored.record.encounterId);
    }
    this.#invalidationCount += staleEncounterIds.length;
    return Object.freeze({ dependency, effectiveFrom: instant, staleEncounterIds: Object.freeze(staleEncounterIds) });
  }

  enqueueRebuild(inputs: readonly EncounterRegistrationInput[]): number {
    let enqueued = 0;
    for (const input of inputs) {
      const normalized = registrationRecord(input);
      const key = recordKey(normalized.record.encounterId, normalized.record.generation);
      if (this.#rebuildKeys.has(key)) continue;
      this.#rebuildKeys.add(key);
      this.#rebuildQueue.push({ key, input });
      enqueued += 1;
    }
    return enqueued;
  }

  rebuild(maxItems = 64): EncounterRebuildResult {
    if (!Number.isSafeInteger(maxItems) || maxItems < 0) throw new RangeError("maxItems must be a non-negative safe integer");
    const batch = this.#rebuildQueue.splice(0, maxItems);
    const rebuiltEncounterIds: EncounterId[] = [];
    for (const entry of batch) {
      this.#rebuildKeys.delete(entry.key);
      const record = this.register(entry.input);
      rebuiltEncounterIds.push(record.encounterId);
    }
    this.#rebuildProcessedCount += batch.length;
    this.#rebuildDeferredCount += this.#rebuildQueue.length;
    return Object.freeze({
      processedCount: batch.length,
      deferredCount: this.#rebuildQueue.length,
      rebuiltEncounterIds: Object.freeze(rebuiltEncounterIds),
    });
  }

  recordCoarseResult(decision: "reject" | "refine", sampleCount: number): void {
    if (!Number.isSafeInteger(sampleCount) || sampleCount < 0) throw new RangeError("coarse sampleCount must be a non-negative safe integer");
    if (decision === "reject") this.#coarseRejects += 1;
  }

  recordRefinementResult(evaluatedIntervals: number, iterations: number): void {
    if (!Number.isSafeInteger(evaluatedIntervals) || evaluatedIntervals < 0) throw new RangeError("evaluatedIntervals must be a non-negative safe integer");
    if (!Number.isSafeInteger(iterations) || iterations < 0) throw new RangeError("iterations must be a non-negative safe integer");
    this.#refinementIntervals += evaluatedIntervals;
    this.#solverEvaluations += iterations;
  }

  performanceDiagnostics(
    broadPhase?: EncounterBroadPhaseDiagnostics,
    scheduling?: EncounterSchedulingStatus,
  ): EncounterPerformanceDiagnostics {
    const activeRecords = [...this.#records.values()].filter((value) => value.record.lifecycle === EncounterRecordLifecycle.active).length;
    const staleRecords = [...this.#records.values()].filter((value) => value.record.lifecycle === EncounterRecordLifecycle.stale).length;
    return Object.freeze({
      indexedObjects: broadPhase?.indexedBounds ?? 0,
      indexedBounds: broadPhase?.indexedBounds ?? 0,
      indexedDomains: broadPhase?.indexedDomains ?? 0,
      indexedShards: broadPhase?.indexedShards ?? 0,
      overlapTests: broadPhase?.overlapTests ?? 0,
      candidatePairs: broadPhase?.candidatePairs ?? 0,
      coarseRejects: this.#coarseRejects,
      refinementIntervals: this.#refinementIntervals,
      solverEvaluations: this.#solverEvaluations,
      activeRecords,
      staleRecords,
      invalidationCount: this.#invalidationCount,
      rebuildPendingCount: this.#rebuildQueue.length,
      rebuildProcessedCount: this.#rebuildProcessedCount,
      rebuildDeferredCount: this.#rebuildDeferredCount,
      scheduledMaintenanceWork: scheduling?.maintenanceCoverage.length ?? 0,
      scheduledRefinementWork: scheduling?.fidelitySchedules.filter((value) => value.refinementWorkId !== undefined).length ?? 0,
      incompleteHorizonWorkBudgetEvents: this.#incompleteHorizonWorkBudgetEvents
        + (scheduling?.diagnostics.filter((value) => value.code === "incompleteHorizon" || value.code === "overload").length ?? 0),
    });
  }
}
