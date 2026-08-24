import type { Backend, BackendHealth, BackendKind } from "./internal/backends/contract.js";
import { initializeBackend, type BackendPreference } from "./internal/backends/selection.js";
import { ObjectRegistry } from "./registry.js";
import { FrameRegistry, type FrameNode, type ObjectFrameStateSource } from "./frame-registry.js";
import { referenceFrameId, type ReferenceFrameId } from "./frames.js";
import { objectId, type ObjectId } from "./objects.js";
import { revisionId, type PropagationModel, type PropagationState, type RevisionId } from "./propagation.js";
import { ObjectStateQueries } from "./state-query.js";
import {
  addDurationToInstant,
  compareDurations,
  compareSimulationInstants,
  duration,
  simulationInstant,
  type Duration,
  type SimulationInstant,
} from "./time.js";
import {
  ScheduledWorkQueue,
  ScheduledWorkPayloadKind,
  ScheduledWorkPhase,
  ScheduledWorkSourceKind,
  SchedulerError,
  SchedulerErrorCode,
  type ScheduledWorkInput,
  type ScheduledWorkRecord,
  type ScheduledWorkId,
  type ScheduledWorkQueueConfiguration,
  type SimulationClockStatus,
  type AdvanceResult,
} from "./scheduler.js";
import {
  loadOepDataset,
  type EphemerisSourceNodeId,
  type OepDataset,
  type OepFrameProviderHandle,
  type OepLoadInput,
  type OepReferenceModelHandle,
} from "./ephemeris.js";
import {
  createTwoBodyAnalyticalModel,
  type TwoBodyAnalyticalModelConfiguration,
} from "./two-body.js";
import {
  createNumericalMotion,
  type NumericalMotion,
  type NumericalMotionConfiguration,
} from "./numerical.js";
import {
  createCoupledMotion,
  type CoupledMotion,
  type CoupledMotionConfiguration,
} from "./coupled.js";
import {
  FidelityManager,
  type FidelityAuthorityCandidateInput,
  type FidelityAuthorityTransitionPolicy,
  type FidelityCandidateInput,
  type FidelityRequirementInput,
  type FidelityStatus,
} from "./fidelity.js";
import type { MotionAuthority } from "./propagation.js";
import {
  EncounterPolicyManager,
  type EncounterPair,
  type EncounterPairFactsInput,
  type EncounterPolicy,
  type EncounterPolicyInput,
  type EncounterPolicyResolution,
} from "./encounter.js";
import {
  EncounterBroadPhaseIndex,
  EncounterDomainRegistry,
} from "./broad-phase.js";
import {
  refineClosestApproach,
  solveCoarseClosestApproach,
  type CoarseClosestApproachInput,
  type CoarseClosestApproachResult,
  type RefinedClosestApproachInput,
  type RefinedClosestApproachResult,
} from "./closest-approach.js";
import {
  EncounterSchedulingManager,
  type EncounterCouplingAssessmentInput,
  type EncounterCouplingAssessment,
  type EncounterCouplingWindowInput,
  type EncounterCoupledGroupPlan,
  type EncounterFidelitySchedule,
  type EncounterFidelitySchedulingInput,
  type EncounterMaintenanceCoverage,
  type EncounterMaintenanceInput,
  type EncounterSchedulingStatus,
  assessEncounterMutualCoupling,
  mergeEncounterCouplingWindows,
} from "./encounter-scheduling.js";
import {
  EncounterLifecycleManager,
  type EncounterCoverage,
  type EncounterCoverageQuery,
  type EncounterPerformanceDiagnostics,
  type EncounterRecordDiagnostic,
  type EncounterRegistrationInput,
  type EncounterRebuildResult,
  type EncounterUpcomingQuery,
} from "./encounter-lifecycle.js";
import {
  CollisionPolicyManager,
  type CollisionPair,
  type CollisionPairFactsInput,
  type CollisionPolicy,
  type CollisionPolicyInput,
  type CollisionPolicyResolution,
  type CollisionProfile,
  type CollisionProfileInput,
} from "./collision.js";
import {
  buildCollisionSweptBound,
  predictCollisionContact,
  type CollisionContactPredictionInput,
  type CollisionContactPredictionResult,
  type CollisionSweptBoundBuildInput,
} from "./collision-detection.js";
import {
  applyCollisionResponseAtomically,
  CollisionContactSuppressionManager,
  resolveCollisionVelocityResponse,
  type CollisionAtomicHandoffInput,
  type CollisionAtomicHandoffResult,
  type CollisionVelocityResponseInput,
  type CollisionVelocityResponseOutcome,
} from "./collision-response.js";
import {
  CollisionContactLifecycleManager,
  groupCollisionContactsByInstant,
  resolveSimultaneousCollisionContacts,
  validateCollisionRemovalDependencies,
  type CollisionContactDiagnostic,
  type CollisionContactInvalidationResult,
  type CollisionContactQuery,
  type CollisionContactRegistrationInput,
  type CollisionRemovalDependency,
  type CollisionRemovalDependencyCheck,
  type CollisionSimultaneousContactInput,
  type CollisionSimultaneousContactResult,
} from "./collision-lifecycle.js";
import {
  RevisionInvalidationManager,
  type DependencyInvalidationOptions,
  type DependencyInvalidationTarget,
  type InvalidationReport,
} from "./invalidation.js";
import {
  ManeuverManager,
  type FiniteBurnManeuver,
  type FiniteBurnManeuverInput,
  type ImpulseManeuver,
  type ImpulseManeuverInput,
  type Maneuver,
  type ManeuverQuery,
  type ManeuverReplacement,
  type ManeuverStatus,
  type ManeuverId,
  ManeuverScheduledEventKind,
  type ManeuverScheduledEvent,
  type ManeuverEventApplication,
} from "./maneuver.js";

export * from "./time.js";
export * from "./units.js";
export * from "./objects.js";
export * from "./properties.js";
export * from "./frames.js";
export * from "./propagation.js";
export * from "./registry.js";
export * from "./frame-registry.js";
export * from "./state-query.js";
export * from "./ephemeris.js";
export * from "./scheduler.js";
export * from "./fidelity.js";
export * from "./dependency.js";
export * from "./invalidation.js";
export * from "./encounter.js";
export * from "./broad-phase.js";
export * from "./closest-approach.js";
export * from "./encounter-scheduling.js";
export * from "./encounter-lifecycle.js";
export * from "./collision.js";
export * from "./collision-detection.js";
export * from "./collision-response.js";
export * from "./collision-lifecycle.js";
export * from "./maneuver.js";
export { TWO_BODY_DEFAULT_ERROR_CONTRACT } from "./two-body.js";
export type { TwoBodyAnalyticalModelConfiguration } from "./two-body.js";
export {
  NumericalMotion,
  NumericalResultCode,
} from "./numerical.js";
export type {
  NumericalGravitySource,
  NumericalMotionConfiguration,
  NumericalMotionStatus,
} from "./numerical.js";
export {
  CoupledMotion,
} from "./coupled.js";
export type {
  CoupledMemberConfiguration,
  CoupledMotionConfiguration,
  CoupledMotionStatus,
} from "./coupled.js";

export type OrbitEngineBackend = BackendKind;
export type OrbitEngineBackendPreference = BackendPreference;

export interface OrbitEngineCreateOptions {
  readonly backend?: OrbitEngineBackendPreference;
  readonly scheduler?: ScheduledWorkQueueConfiguration;
}

export interface OrbitEngineHealth extends BackendHealth {
  readonly backend: OrbitEngineBackend;
}

export interface RegisteredEphemerisFrameHandle extends OepFrameProviderHandle {
  readonly frame: FrameNode;
  unregister(): void;
}

function validateOptions(options: OrbitEngineCreateOptions): OrbitEngineBackendPreference {
  if (typeof options !== "object" || options === null) {
    throw new TypeError("OrbitEngine.create options must be an object");
  }

  const backend = options.backend ?? "auto";
  if (backend !== "auto" && backend !== "native" && backend !== "wasm") {
    throw new TypeError(`Unsupported OrbitEngine backend: ${String(backend)}`);
  }

  return backend;
}

function maneuverStart(value: Maneuver): SimulationInstant {
  return value.kind === "impulse" ? value.instant : value.start;
}

function maneuverEventPhase(kind: ManeuverScheduledEventKind): ScheduledWorkPhase {
  return kind === "impulse" ? ScheduledWorkPhase.physicalChange : ScheduledWorkPhase.boundary;
}

function maneuverPayloadKind(kind: ManeuverScheduledEventKind): number {
  switch (kind) {
    case "impulse": return ScheduledWorkPayloadKind.maneuverImpulse;
    case "burnStart": return ScheduledWorkPayloadKind.maneuverBurnStart;
    case "stageBoundary": return ScheduledWorkPayloadKind.maneuverStageBoundary;
    case "burnEnd": return ScheduledWorkPayloadKind.maneuverBurnEnd;
    case "minimumMassTermination": return ScheduledWorkPayloadKind.maneuverMinimumMassTermination;
  }
}

function compareScheduledWork(left: ScheduledWorkRecord, right: ScheduledWorkRecord): number {
  const instant = compareSimulationInstants(left.instant, right.instant);
  if (instant !== 0) return instant;
  const phase = [
    ScheduledWorkPhase.boundary,
    ScheduledWorkPhase.physicalChange,
    ScheduledWorkPhase.authorityTransition,
    ScheduledWorkPhase.predictionMaintenance,
    ScheduledWorkPhase.observation,
  ].indexOf(left.phase) - [
    ScheduledWorkPhase.boundary,
    ScheduledWorkPhase.physicalChange,
    ScheduledWorkPhase.authorityTransition,
    ScheduledWorkPhase.predictionMaintenance,
    ScheduledWorkPhase.observation,
  ].indexOf(right.phase);
  if (phase !== 0) return phase;
  if (left.sourceKind !== right.sourceKind) return left.sourceKind < right.sourceKind ? -1 : 1;
  const source = BigInt(left.sourceId) - BigInt(right.sourceId);
  if (source !== 0n) return source < 0n ? -1 : 1;
  const ordinal = BigInt(left.sourceOrdinal) - BigInt(right.sourceOrdinal);
  if (ordinal !== 0n) return ordinal < 0n ? -1 : 1;
  const id = BigInt(left.id) - BigInt(right.id);
  return id === 0n ? 0 : id < 0n ? -1 : 1;
}

export class OrbitEngine {
  readonly backend: OrbitEngineBackend;
  readonly #health: BackendHealth;
  readonly #backend: Backend;
  #registry?: ObjectRegistry;
  #frames?: FrameRegistry;
  #stateQueries?: ObjectStateQueries;
  readonly #scheduledWorkQueue: ScheduledWorkQueue;
  readonly #fidelityManager: FidelityManager;
  readonly #invalidationManager: RevisionInvalidationManager;
  readonly #encounterPolicyManager: EncounterPolicyManager;
  readonly #encounterDomainRegistry: EncounterDomainRegistry;
  readonly #encounterBroadPhaseIndex: EncounterBroadPhaseIndex;
  readonly #encounterSchedulingManager: EncounterSchedulingManager;
  readonly #encounterLifecycleManager: EncounterLifecycleManager;
  readonly #collisionPolicyManager: CollisionPolicyManager;
  readonly #collisionSuppressionManager: CollisionContactSuppressionManager;
  readonly #collisionContactLifecycleManager: CollisionContactLifecycleManager;
  readonly #maneuverManager: ManeuverManager;
  readonly #maneuverActions = new Map<ScheduledWorkId, { readonly work: ScheduledWorkRecord; readonly event: ManeuverScheduledEvent }>();
  readonly #maneuverWorkById = new Map<ManeuverId, Set<ScheduledWorkId>>();

  private constructor(backend: Backend, health: BackendHealth, scheduler?: ScheduledWorkQueueConfiguration) {
    this.backend = backend.kind;
    this.#backend = backend;
    this.#health = health;
    this.#scheduledWorkQueue = new ScheduledWorkQueue(backend, scheduler);
    this.#fidelityManager = new FidelityManager();
    this.#invalidationManager = new RevisionInvalidationManager(this.#scheduledWorkQueue);
    this.#collisionSuppressionManager = new CollisionContactSuppressionManager();
    this.#collisionContactLifecycleManager = new CollisionContactLifecycleManager({
      currentTime: () => this.currentTime,
    });
    this.#maneuverManager = new ManeuverManager({
      currentTime: () => this.currentTime,
      onMutation: (previous, next) => this.#onManeuverMutation(previous, next),
    });
    this.#encounterPolicyManager = new EncounterPolicyManager(undefined, (_previous, next) => {
      const dependency = { kind: "interactionPolicy" as const, id: "encounter-policy", revision: next.revision };
      this.#invalidationManager.invalidate(dependency, this.currentTime);
      this.#encounterSchedulingManager.invalidateDependency(dependency, this.currentTime);
      this.#encounterLifecycleManager.invalidate(dependency, this.currentTime);
    });
    this.#collisionPolicyManager = new CollisionPolicyManager(undefined, (_previous, next) => {
      const dependency = { kind: "interactionPolicy" as const, id: "collision-policy", revision: next.revision };
      this.#invalidationManager.invalidate(dependency, this.currentTime);
      this.#collisionContactLifecycleManager.invalidate(dependency, this.currentTime);
      this.#collisionSuppressionManager.clear();
    });
    this.#encounterDomainRegistry = new EncounterDomainRegistry();
    this.#encounterBroadPhaseIndex = new EncounterBroadPhaseIndex();
    this.#encounterSchedulingManager = new EncounterSchedulingManager({
      currentTime: () => this.currentTime,
      scheduleWork: (input) => this.scheduleWork(input),
      cancelScheduledWork: (id, generation) => this.cancelScheduledWork(id, generation),
      setFidelitySignal: (id, signalId, requirement) => this.#fidelityManager.setSignal(id, signalId, requirement, this.currentTime),
    });
    this.#encounterLifecycleManager = new EncounterLifecycleManager({
      currentTime: () => this.currentTime,
      schedulingStatus: () => this.#encounterSchedulingManager.status(),
    });
  }

  static async create(options: OrbitEngineCreateOptions = {}): Promise<OrbitEngine> {
    const preference = validateOptions(options);
    const backend = await initializeBackend(preference);
    return new OrbitEngine(backend, backend.health(), options.scheduler);
  }

  health(): OrbitEngineHealth {
    return { backend: this.backend, ...this.#health };
  }

  get currentTime(): SimulationInstant {
    return this.#scheduledWorkQueue.status().currentTime;
  }

  clock(): SimulationClockStatus {
    return this.#scheduledWorkQueue.status();
  }

  #eventInput(
    maneuver: Maneuver,
    kind: ManeuverScheduledEventKind,
    instant: SimulationInstant,
    stageIndex?: number,
  ): ScheduledWorkInput {
    const event: ManeuverScheduledEvent = Object.freeze({
      maneuverId: maneuver.id,
      revision: maneuver.revision,
      kind,
      ...(stageIndex === undefined ? {} : { stageIndex }),
    });
    return {
      instant,
      phase: maneuverEventPhase(kind),
      sourceKind: ScheduledWorkSourceKind.maneuver,
      sourceId: maneuver.objectId,
      sourceOrdinal: revisionId(maneuver.id),
      dependencies: [{ kind: "maneuver", id: maneuver.id, revision: maneuver.revision }],
      payload: {
        kind: maneuverPayloadKind(kind),
        objectId: maneuver.objectId,
        value: stageIndex ?? 0,
      },
    };
  }

  #eventDefinitions(maneuver: Maneuver): readonly { readonly kind: ManeuverScheduledEventKind; readonly instant: SimulationInstant; readonly stageIndex?: number }[] {
    if (maneuver.kind === "impulse") {
      return [{ kind: ManeuverScheduledEventKind.impulse, instant: maneuver.instant }];
    }
    const definitions: { kind: ManeuverScheduledEventKind; instant: SimulationInstant; stageIndex?: number }[] = [];
    const activeAtStart = maneuver.stages.findIndex((stage) =>
      compareSimulationInstants(stage.start, maneuver.start) <= 0
      && compareSimulationInstants(maneuver.start, stage.end) < 0);
    definitions.push({
      kind: ManeuverScheduledEventKind.burnStart,
      instant: maneuver.start,
      ...(activeAtStart < 0 ? {} : { stageIndex: activeAtStart }),
    });
    for (let index = 1; index < maneuver.stages.length; index += 1) {
      const previous = maneuver.stages[index - 1]!;
      const stage = maneuver.stages[index]!;
      if (compareSimulationInstants(previous.end, stage.start) < 0) {
        definitions.push({ kind: ManeuverScheduledEventKind.stageBoundary, instant: previous.end });
      }
      definitions.push({ kind: ManeuverScheduledEventKind.stageBoundary, instant: stage.start, stageIndex: index });
    }
    definitions.push({ kind: ManeuverScheduledEventKind.burnEnd, instant: maneuver.end });
    return definitions;
  }

  #scheduleManeuverEvents(maneuver: Maneuver): void {
    const created: { readonly work: ScheduledWorkRecord; readonly event: ManeuverScheduledEvent }[] = [];
    try {
      for (const definition of this.#eventDefinitions(maneuver)) {
        const input = this.#eventInput(maneuver, definition.kind, definition.instant, definition.stageIndex);
        const work = this.scheduleWork(input);
        const event = Object.freeze({
          maneuverId: maneuver.id,
          revision: maneuver.revision,
          kind: definition.kind,
          ...(definition.stageIndex === undefined ? {} : { stageIndex: definition.stageIndex }),
        });
        const action = Object.freeze({ work, event });
        this.#maneuverActions.set(work.id, action);
        created.push(action);
      }
      const ids = this.#maneuverWorkById.get(maneuver.id) ?? new Set<ScheduledWorkId>();
      for (const action of created) ids.add(action.work.id);
      this.#maneuverWorkById.set(maneuver.id, ids);
    } catch (error) {
      for (const action of created) {
        this.#maneuverActions.delete(action.work.id);
        try {
          this.cancelScheduledWork(action.work.id, action.work.generation);
        } catch (cleanupError) {
          if (!(cleanupError instanceof SchedulerError)
            || (cleanupError.code !== SchedulerErrorCode.notFound && cleanupError.code !== SchedulerErrorCode.staleGeneration)) {
            // Preserve the original scheduling failure; the queue is still
            // authoritative for any cleanup that succeeded.
          }
        }
      }
      throw error;
    }
  }

  #removeManeuverEvents(maneuverId: ManeuverId, revision?: RevisionId): void {
    const ids = this.#maneuverWorkById.get(maneuverId);
    if (ids === undefined) return;
    for (const id of [...ids]) {
      const action = this.#maneuverActions.get(id);
      if (action === undefined || (revision !== undefined && action.event.revision !== revision)) continue;
      this.#maneuverActions.delete(id);
      ids.delete(id);
      try {
        this.cancelScheduledWork(action.work.id, action.work.generation);
      } catch (error) {
        if (!(error instanceof SchedulerError)
          || (error.code !== SchedulerErrorCode.notFound && error.code !== SchedulerErrorCode.staleGeneration)) throw error;
      }
    }
    if (ids.size === 0) this.#maneuverWorkById.delete(maneuverId);
  }

  #onManeuverMutation(previous: Maneuver | undefined, next: Maneuver): void {
    const effectiveFrom = previous === undefined
      ? maneuverStart(next)
      : compareSimulationInstants(maneuverStart(previous), maneuverStart(next)) <= 0
        ? maneuverStart(previous)
        : maneuverStart(next);

    if (previous !== undefined && next.lifecycle === "scheduled") {
      // Schedule the replacement before retiring the old generation. If the
      // replacement cannot be represented, the manager rolls back while the
      // old queue generation remains intact.
      this.#scheduleManeuverEvents(next);
    }
    this.invalidateDependency(
      { kind: "maneuver", id: next.id, revision: next.revision },
      effectiveFrom,
    );
    if (previous !== undefined) this.#removeManeuverEvents(previous.id, previous.revision);
    if (previous === undefined && next.lifecycle === "scheduled") this.#scheduleManeuverEvents(next);
  }

  #applyManeuverEventsAt(instant: SimulationInstant): void {
    const due = [...this.#maneuverActions.values()]
      .filter((action) => compareSimulationInstants(action.work.instant, instant) === 0)
      .sort((left, right) => compareScheduledWork(left.work, right.work));
    for (const action of due) {
      this.#maneuverActions.delete(action.work.id);
      this.#maneuverWorkById.get(action.event.maneuverId)?.delete(action.work.id);
      const result: ManeuverEventApplication = this.#maneuverManager.applyScheduledEvent(action.event);
      if (result === "stale") continue;
    }
    for (const [id, actions] of this.#maneuverWorkById) if (actions.size === 0) this.#maneuverWorkById.delete(id);
  }

  #nextScheduledWorkInstant(current: SimulationInstant): SimulationInstant | undefined {
    const first = this.#scheduledWorkQueue.list(1)[0];
    if (first === undefined || compareSimulationInstants(first.instant, current) <= 0) return undefined;
    return first.instant;
  }

  scheduleWork(input: ScheduledWorkInput, options?: { readonly allowCurrentTime?: boolean }): ScheduledWorkRecord {
    const record = this.#scheduledWorkQueue.schedule(input, options);
    this.#invalidationManager.track(record, input);
    return record;
  }

  cancelScheduledWork(id: ScheduledWorkId, generation: RevisionId): ScheduledWorkRecord {
    const record = this.#scheduledWorkQueue.cancel(id, generation);
    this.#invalidationManager.untrack(id);
    return record;
  }

  replaceScheduledWork(id: ScheduledWorkId, generation: RevisionId, input: ScheduledWorkInput, options?: { readonly allowCurrentTime?: boolean }): ScheduledWorkRecord {
    const record = this.#scheduledWorkQueue.replace(id, generation, input, options);
    this.#invalidationManager.replace(record, input);
    return record;
  }

  listScheduledWorkDiagnostics(limit = 64, offset = 0): readonly ScheduledWorkRecord[] {
    return this.#scheduledWorkQueue.list(limit, offset);
  }

  advanceTo(target: SimulationInstant): AdvanceResult {
    const normalizedTarget = simulationInstant(target.seconds, target.nanoseconds);
    let current = this.currentTime;
    let processedTimestampCount = 0;
    let processedWorkCount = 0;
    for (;;) {
      const nextEncounterInstant = this.#encounterSchedulingManager.nextScheduledInstant();
      const nextWorkInstant = this.#nextScheduledWorkInstant(current);
      if (compareSimulationInstants(current, normalizedTarget) < 0
        && nextEncounterInstant !== undefined
        && compareSimulationInstants(nextEncounterInstant, current) <= 0) {
        this.#encounterSchedulingManager.applyDue(current);
        current = this.currentTime;
        continue;
      }
      let stepTarget = normalizedTarget;
      for (const candidate of [nextEncounterInstant, nextWorkInstant]) {
        if (candidate !== undefined
          && compareSimulationInstants(candidate, current) > 0
          && compareSimulationInstants(candidate, stepTarget) < 0) {
          stepTarget = candidate;
        }
      }
      this.#invalidationManager.prepareAdvance(current);
      const result = this.#scheduledWorkQueue.advanceTo(stepTarget);
      this.#invalidationManager.afterAdvance(result.currentTime);
      processedTimestampCount += result.processedTimestampCount;
      processedWorkCount += result.processedWorkCount;
      current = result.currentTime;
      if (result.status === "failed") {
        return {
          status: "failed",
          reachedTarget: false,
          currentTime: current,
          targetTime: normalizedTarget,
          processedTimestampCount,
          processedWorkCount,
          failure: result.failure,
        };
      }
      if (compareSimulationInstants(current, stepTarget) === 0) {
        this.#applyManeuverEventsAt(current);
        this.#encounterSchedulingManager.applyDue(current);
      }
      if (compareSimulationInstants(current, normalizedTarget) === 0) {
        return {
          status: "reachedTarget",
          reachedTarget: true,
          currentTime: current,
          targetTime: normalizedTarget,
          processedTimestampCount,
          processedWorkCount,
        };
      }
      if (compareSimulationInstants(current, normalizedTarget) > 0) {
        return {
          status: "failed",
          reachedTarget: false,
          currentTime: current,
          targetTime: normalizedTarget,
          processedTimestampCount,
          processedWorkCount,
        };
      }
    }
  }

  advanceBy(value: Duration): AdvanceResult {
    try {
      const normalized = duration(value.seconds, value.nanoseconds);
      if (compareDurations(normalized, duration(0)) >= 0) {
        return this.advanceTo(addDurationToInstant(this.currentTime, normalized));
      }
    } catch {
      // Preserve the scheduler's deterministic invalid-duration result below.
    }
    this.#invalidationManager.prepareAdvance(this.currentTime);
    const result = this.#scheduledWorkQueue.advanceBy(value);
    this.#invalidationManager.afterAdvance(result.currentTime);
    return result;
  }

  invalidateDependency(
    dependency: DependencyInvalidationTarget,
    effectiveFrom: SimulationInstant,
    options?: DependencyInvalidationOptions,
  ): InvalidationReport {
    const report = this.#invalidationManager.invalidate(dependency, effectiveFrom, options);
    this.#encounterSchedulingManager.invalidateDependency(dependency, effectiveFrom);
    this.#encounterLifecycleManager.invalidate(dependency, effectiveFrom);
    this.#collisionContactLifecycleManager.invalidate(dependency, effectiveFrom);
    return report;
  }

  invalidateFrom(
    dependency: DependencyInvalidationTarget,
    effectiveFrom: SimulationInstant,
    options?: DependencyInvalidationOptions,
  ): InvalidationReport {
    return this.invalidateDependency(dependency, effectiveFrom, options);
  }

  listInvalidationDiagnostics(limit = 64): readonly InvalidationReport[] {
    return this.#invalidationManager.diagnostics(limit);
  }

  getEncounterPolicy(): EncounterPolicy {
    return this.#encounterPolicyManager.policy;
  }

  configureEncounterPolicy(input: EncounterPolicyInput): EncounterPolicy {
    return this.#encounterPolicyManager.setPolicy(input);
  }

  resolveEncounterPolicy(
    pair: EncounterPair,
    facts?: EncounterPairFactsInput,
  ): EncounterPolicyResolution {
    return this.#encounterPolicyManager.resolve(pair.objectA, pair.objectB, facts);
  }

  getCollisionPolicy(): CollisionPolicy {
    return this.#collisionPolicyManager.policy;
  }

  configureCollisionPolicy(input: CollisionPolicyInput): CollisionPolicy {
    return this.#collisionPolicyManager.setPolicy(input);
  }

  setCollisionPolicy(input: CollisionPolicyInput): CollisionPolicy {
    return this.configureCollisionPolicy(input);
  }

  getCollisionProfile(profileId: string): CollisionProfile | undefined {
    return this.#collisionPolicyManager.getProfile(profileId);
  }

  listCollisionProfiles(): readonly CollisionProfile[] {
    return this.#collisionPolicyManager.listProfiles();
  }

  setCollisionProfile(input: CollisionProfileInput): CollisionPolicy {
    return this.#collisionPolicyManager.setProfile(input);
  }

  configureCollisionProfile(input: CollisionProfileInput): CollisionPolicy {
    return this.setCollisionProfile(input);
  }

  resolveCollisionPolicy(
    pair: CollisionPair,
    facts?: CollisionPairFactsInput,
  ): CollisionPolicyResolution {
    return this.#collisionPolicyManager.resolve(pair.objectA, pair.objectB, facts);
  }

  buildCollisionSweptBound(input: CollisionSweptBoundBuildInput) {
    return buildCollisionSweptBound(input);
  }

  predictCollisionContact(input: CollisionContactPredictionInput): CollisionContactPredictionResult {
    return predictCollisionContact(input);
  }

  resolveCollisionVelocityResponse(input: CollisionVelocityResponseInput): CollisionVelocityResponseOutcome {
    return resolveCollisionVelocityResponse(input);
  }

  applyCollisionResponseAtomically(input: CollisionAtomicHandoffInput): CollisionAtomicHandoffResult {
    return applyCollisionResponseAtomically(input);
  }

  collisionContactSuppression(): CollisionContactSuppressionManager {
    return this.#collisionSuppressionManager;
  }

  registerCollisionContact(input: CollisionContactRegistrationInput): ReturnType<CollisionContactLifecycleManager["register"]> {
    return this.#collisionContactLifecycleManager.register(input);
  }

  getCollisionContact(contactId: string): ReturnType<CollisionContactLifecycleManager["get"]> {
    return this.#collisionContactLifecycleManager.get(contactId);
  }

  listCollisionContacts(input: CollisionContactQuery): ReturnType<CollisionContactLifecycleManager["list"]> {
    return this.#collisionContactLifecycleManager.list(input);
  }

  getCollisionDiagnostics(contactId: string): CollisionContactDiagnostic | undefined {
    return this.#collisionContactLifecycleManager.diagnostics(contactId);
  }

  invalidateCollisionDependency(
    dependency: DependencyInvalidationTarget,
    effectiveFrom: SimulationInstant,
  ): CollisionContactInvalidationResult {
    return this.#collisionContactLifecycleManager.invalidate(dependency, effectiveFrom);
  }

  groupCollisionContactsByInstant(
    records: Parameters<typeof groupCollisionContactsByInstant>[0],
  ): ReturnType<typeof groupCollisionContactsByInstant> {
    return groupCollisionContactsByInstant(records);
  }

  resolveSimultaneousCollisionContacts(
    input: readonly CollisionSimultaneousContactInput[],
  ): CollisionSimultaneousContactResult {
    return resolveSimultaneousCollisionContacts(input);
  }

  executeSimultaneousCollisionContacts(
    input: readonly CollisionSimultaneousContactInput[],
  ): CollisionSimultaneousContactResult {
    return this.#collisionContactLifecycleManager.executeSimultaneous(input);
  }

  isCollisionContactGenerationCurrent(
    contact: Parameters<CollisionContactLifecycleManager["isCurrentGeneration"]>[0],
  ): boolean {
    return this.#collisionContactLifecycleManager.isCurrentGeneration(contact);
  }

  validateCollisionRemovalDependencies(
    input: Parameters<typeof validateCollisionRemovalDependencies>[0],
  ): ReturnType<typeof validateCollisionRemovalDependencies> {
    return validateCollisionRemovalDependencies(input);
  }

  checkCollisionRemovalDependencies(
    objectId: ObjectId,
    dependencies?: readonly CollisionRemovalDependency[],
  ): CollisionRemovalDependencyCheck {
    return this.#collisionContactLifecycleManager.checkRemovalDependencies(objectId, dependencies);
  }

  scheduleImpulse(objectIdValue: ObjectId, definition: ImpulseManeuverInput): ImpulseManeuver {
    return this.#maneuverManager.scheduleImpulse(objectIdValue, definition);
  }

  scheduleFiniteBurn(objectIdValue: ObjectId, definition: FiniteBurnManeuverInput): FiniteBurnManeuver {
    return this.#maneuverManager.scheduleFiniteBurn(objectIdValue, definition);
  }

  updateManeuver(maneuverId: ManeuverId | string, replacement: ManeuverReplacement): Maneuver {
    return this.#maneuverManager.updateManeuver(maneuverId, replacement);
  }

  cancelManeuver(maneuverId: ManeuverId | string): Maneuver {
    return this.#maneuverManager.cancelManeuver(maneuverId);
  }

  getManeuver(maneuverId: ManeuverId | string): Maneuver | undefined {
    return this.#maneuverManager.getManeuver(maneuverId);
  }

  listManeuvers(query: ManeuverQuery = {}): readonly Maneuver[] {
    return this.#maneuverManager.listManeuvers(query);
  }

  getManeuverStatus(maneuverId: ManeuverId | string): ManeuverStatus | undefined {
    return this.#maneuverManager.getManeuverStatus(maneuverId);
  }

  maneuvers(): ManeuverManager {
    return this.#maneuverManager;
  }

  encounterDomains(): EncounterDomainRegistry {
    return this.#encounterDomainRegistry;
  }

  encounterBroadPhase(): EncounterBroadPhaseIndex {
    return this.#encounterBroadPhaseIndex;
  }

  encounterScheduling(): EncounterSchedulingManager {
    return this.#encounterSchedulingManager;
  }

  scheduleEncounterMaintenance(input: EncounterMaintenanceInput): EncounterMaintenanceCoverage {
    return this.#encounterSchedulingManager.scheduleMaintenance(input);
  }

  scheduleEncounterFidelity(input: EncounterFidelitySchedulingInput): EncounterFidelitySchedule {
    return this.#encounterSchedulingManager.scheduleEncounterFidelity(input);
  }

  encounterSchedulingStatus(): EncounterSchedulingStatus {
    return this.#encounterSchedulingManager.status();
  }

  registerEncounter(input: EncounterRegistrationInput): ReturnType<EncounterLifecycleManager["register"]> {
    return this.#encounterLifecycleManager.register(input);
  }

  getEncounter(id: string): ReturnType<EncounterLifecycleManager["get"]> {
    return this.#encounterLifecycleManager.get(id);
  }

  listUpcomingEncounters(input: EncounterUpcomingQuery): ReturnType<EncounterLifecycleManager["listUpcoming"]> {
    return this.#encounterLifecycleManager.listUpcoming(input);
  }

  getEncounterCoverage(input: EncounterCoverageQuery = {}): EncounterCoverage {
    return this.#encounterLifecycleManager.getCoverage(input);
  }

  getEncounterDiagnostics(id: string): EncounterRecordDiagnostic | undefined {
    return this.#encounterLifecycleManager.getDiagnostics(id);
  }

  enqueueEncounterRebuild(inputs: readonly EncounterRegistrationInput[]): number {
    return this.#encounterLifecycleManager.enqueueRebuild(inputs);
  }

  rebuildEncounters(maxItems = 64): EncounterRebuildResult {
    return this.#encounterLifecycleManager.rebuild(maxItems);
  }

  encounterPerformanceDiagnostics(): EncounterPerformanceDiagnostics {
    return this.#encounterLifecycleManager.performanceDiagnostics(
      this.#encounterBroadPhaseIndex.diagnostics(),
      this.#encounterSchedulingManager.status(),
    );
  }

  assessEncounterMutualCoupling(input: EncounterCouplingAssessmentInput): EncounterCouplingAssessment {
    return assessEncounterMutualCoupling(input);
  }

  mergeEncounterCouplingWindows(
    values: readonly EncounterCouplingWindowInput[],
    groupLimit?: number,
  ): readonly EncounterCoupledGroupPlan[] {
    return mergeEncounterCouplingWindows(values, groupLimit);
  }

  coarseClosestApproach(input: CoarseClosestApproachInput): CoarseClosestApproachResult {
    const result = solveCoarseClosestApproach(input);
    this.#encounterLifecycleManager.recordCoarseResult(result.decision, result.samples.length);
    return result;
  }

  refineClosestApproach(input: RefinedClosestApproachInput): RefinedClosestApproachResult {
    const result = refineClosestApproach(input);
    this.#encounterLifecycleManager.recordRefinementResult(result.evaluatedIntervals, result.iterations);
    return result;
  }

  getFidelityStatus(id: ObjectId): FidelityStatus {
    return this.#fidelityManager.getStatus(id);
  }

  setMinimumFidelityRequirement(
    id: ObjectId,
    requirement: FidelityRequirementInput | null,
  ): FidelityStatus {
    return this.#fidelityManager.setMinimumRequirement(id, requirement, this.currentTime);
  }

  configureFidelityCandidates(id: ObjectId, candidates: readonly FidelityCandidateInput[]): FidelityStatus {
    return this.#fidelityManager.configureCandidates(id, candidates);
  }

  configureFidelityAuthorityCandidates(
    id: ObjectId,
    candidates: readonly FidelityAuthorityCandidateInput[],
    policy?: FidelityAuthorityTransitionPolicy,
  ): FidelityStatus {
    return this.#fidelityManager.configureAuthorityCandidates(id, candidates, policy);
  }

  bindFidelityAuthority(
    id: ObjectId,
    authority: MotionAuthority,
    currentCandidateId: string,
    policy?: FidelityAuthorityTransitionPolicy,
  ): FidelityStatus {
    return this.#fidelityManager.bindAuthority(id, authority, currentCandidateId, this.currentTime, policy);
  }

  transitionFidelityAuthority(id: ObjectId): FidelityStatus {
    return this.#fidelityManager.transitionAuthority(id, this.currentTime);
  }

  setFidelitySignal(
    id: ObjectId,
    signalId: string,
    requirement: FidelityRequirementInput | null,
  ): FidelityStatus {
    return this.#fidelityManager.setSignal(id, signalId, requirement, this.currentTime);
  }

  registry(): ObjectRegistry {
    this.#registry ??= new ObjectRegistry(this.#backend);
    return this.#registry;
  }

  frames(): FrameRegistry {
    this.#frames ??= new FrameRegistry(this.#backend);
    return this.#frames;
  }

  stateQueries(): ObjectStateQueries {
    this.#stateQueries ??= new ObjectStateQueries(this.registry(), this.frames());
    return this.#stateQueries;
  }

  async loadEphemerisPack(input: OepLoadInput): Promise<OepDataset> {
    return loadOepDataset(this.backend, input);
  }

  registerEphemerisSourceFrame(
    dataset: OepDataset,
    frameId: ReferenceFrameId,
    sourceNodeId: EphemerisSourceNodeId | number,
  ): RegisteredEphemerisFrameHandle {
    const id = referenceFrameId(frameId);
    const handle = dataset.sourceCenterProvider(sourceNodeId);
    let registered = false;
    try {
      const frame = this.frames().register({ id, parent: this.frames().root(), provider: handle.provider });
      registered = true;
      let closed = false;
      const close = () => {
        if (closed) return;
        this.frames().remove(id);
        handle.release();
        closed = true;
      };
      return Object.freeze({
        identity: handle.identity,
        provider: handle.provider,
        frame,
        release: close,
        unregister: close,
      });
    } catch (error) {
      if (!registered) handle.release();
      throw error;
    }
  }

  bindReferenceEphemeris(
    id: ObjectId,
    dataset: OepDataset,
    sourceNodeId: EphemerisSourceNodeId | number,
    propagationFrame: ReferenceFrameId,
  ): OepReferenceModelHandle {
    const object = objectId(id);
    const handle = dataset.referenceModel(sourceNodeId, referenceFrameId(propagationFrame), object);
    try {
      this.bindMotionModel(object, handle.model);
      return handle;
    } catch (error) {
      handle.release();
      throw error;
    }
  }

  bindMotionModel(id: ObjectId, model: PropagationModel): void {
    this.stateQueries().bindMotionModel(id, model);
  }

  stateAt(id: ObjectId, target: SimulationInstant, outputFrame?: ReferenceFrameId): PropagationState {
    return this.stateQueries().stateAt(id, target, outputFrame);
  }

  statesAt(
    ids: readonly ObjectId[],
    target: SimulationInstant,
    outputFrame?: ReferenceFrameId,
  ): readonly PropagationState[] {
    return this.stateQueries().statesAt(ids, target, outputFrame);
  }

  relativeStateAt(
    targetObject: ObjectId,
    observerObject: ObjectId,
    target: SimulationInstant,
    outputFrame?: ReferenceFrameId,
  ): PropagationState {
    return this.stateQueries().relativeStateAt(targetObject, observerObject, target, outputFrame);
  }

  objectStateSource(id: ObjectId, outputFrame: ReferenceFrameId): ObjectFrameStateSource {
    return this.stateQueries().objectStateSource(id, outputFrame);
  }

  twoBodyModel(configuration: TwoBodyAnalyticalModelConfiguration) {
    return createTwoBodyAnalyticalModel(configuration, {
      evaluate: (value) => this.#backend.roundTripTwoBody(value),
    });
  }

  numericalMotion(configuration: NumericalMotionConfiguration): NumericalMotion {
    return createNumericalMotion(configuration, this.#backend);
  }

  bindNumericalMotion(configuration: NumericalMotionConfiguration): NumericalMotion {
    const motion = this.numericalMotion(configuration);
    this.bindMotionModel(configuration.objectId, motion.model());
    return motion;
  }

  coupledMotion(configuration: CoupledMotionConfiguration): CoupledMotion {
    return createCoupledMotion(configuration, this.#backend);
  }

  bindCoupledMotion(configuration: CoupledMotionConfiguration): CoupledMotion {
    const motion = this.coupledMotion(configuration);
    for (const member of configuration.members) {
      this.bindMotionModel(member.objectId, motion.modelFor(member.objectId));
    }
    return motion;
  }
}
