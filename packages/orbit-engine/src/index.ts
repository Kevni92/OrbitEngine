import type { Backend, BackendHealth, BackendKind } from "./internal/backends/contract.js";
import { initializeBackend, type BackendPreference } from "./internal/backends/selection.js";
import { ObjectRegistry } from "./registry.js";
import { FrameRegistry, type FrameNode, type ObjectFrameStateSource } from "./frame-registry.js";
import { referenceFrameId, type ReferenceFrameId } from "./frames.js";
import { objectId, type ObjectId } from "./objects.js";
import { type PropagationModel, type PropagationState, type RevisionId } from "./propagation.js";
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
  RevisionInvalidationManager,
  type DependencyInvalidationOptions,
  type DependencyInvalidationTarget,
  type InvalidationReport,
} from "./invalidation.js";

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

  private constructor(backend: Backend, health: BackendHealth, scheduler?: ScheduledWorkQueueConfiguration) {
    this.backend = backend.kind;
    this.#backend = backend;
    this.#health = health;
    this.#scheduledWorkQueue = new ScheduledWorkQueue(backend, scheduler);
    this.#fidelityManager = new FidelityManager();
    this.#invalidationManager = new RevisionInvalidationManager(this.#scheduledWorkQueue);
    this.#encounterPolicyManager = new EncounterPolicyManager(undefined, (_previous, next) => {
      const dependency = { kind: "interactionPolicy" as const, id: "encounter-policy", revision: next.revision };
      this.#invalidationManager.invalidate(dependency, this.currentTime);
      this.#encounterSchedulingManager.invalidateDependency(dependency, this.currentTime);
      this.#encounterLifecycleManager.invalidate(dependency, this.currentTime);
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
      if (compareSimulationInstants(current, normalizedTarget) < 0
        && nextEncounterInstant !== undefined
        && compareSimulationInstants(nextEncounterInstant, current) <= 0) {
        this.#encounterSchedulingManager.applyDue(current);
        current = this.currentTime;
        continue;
      }
      const stepTarget = nextEncounterInstant !== undefined
        && compareSimulationInstants(nextEncounterInstant, current) > 0
        && compareSimulationInstants(nextEncounterInstant, normalizedTarget) < 0
        ? nextEncounterInstant
        : normalizedTarget;
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
