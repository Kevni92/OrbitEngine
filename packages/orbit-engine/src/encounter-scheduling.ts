import {
  EncounterRecordLifecycle,
  createEncounterRecord,
  normalizeEncounterPredictionProfile,
  type EncounterPredictionProfile,
  type EncounterPredictionProfileInput,
  type EncounterRecord,
  type EncounterPair,
} from "./encounter.js";
import type { EncounterWindow } from "./broad-phase.js";
import {
  fidelityRequirement,
  type FidelityRequirement,
  type FidelityRequirementInput,
} from "./fidelity.js";
import { objectId, type ObjectId } from "./objects.js";
import { revisionId, type RevisionId } from "./propagation.js";
import {
  addDurationToInstant,
  compareDurations,
  compareSimulationInstants,
  duration,
  durationToSeconds,
  simulationInstant,
  subtractDurationFromInstant,
  type Duration,
  type SimulationInstant,
} from "./time.js";
import {
  ScheduledWorkPayloadKind,
  ScheduledWorkPhase,
  ScheduledWorkSourceKind,
  type ScheduledWorkId,
  type ScheduledWorkInput,
  type ScheduledWorkRecord,
} from "./scheduler.js";
import type { DependencyRevision } from "./dependency.js";
import { dependencyKey, dependencyRevisionIdentity, type DependencyInvalidationTarget } from "./dependency.js";

const NEWTONIAN_GRAVITATIONAL_CONSTANT = 6.67430e-11;
const DEFAULT_COUPLED_GROUP_LIMIT = 32;

export const EncounterSchedulingDiagnosticCode = Object.freeze({
  incompleteHorizon: "incompleteHorizon",
  overload: "overload",
  lateWork: "lateWork",
  groupLimitExceeded: "groupLimitExceeded",
  insufficientPhysicalData: "insufficientPhysicalData",
  staleWork: "staleWork",
} as const);

export type EncounterSchedulingDiagnosticCode =
  (typeof EncounterSchedulingDiagnosticCode)[keyof typeof EncounterSchedulingDiagnosticCode];

export interface EncounterSchedulingDiagnostic {
  readonly code: EncounterSchedulingDiagnosticCode;
  readonly message: string;
  readonly instant?: SimulationInstant;
  readonly domainId?: string;
  readonly encounterId?: string;
}

export const EncounterSchedulingErrorCode = Object.freeze({
  invalidHorizon: "invalidHorizon",
  incompleteHorizon: "incompleteHorizon",
  overload: "overload",
  groupLimitExceeded: "groupLimitExceeded",
  invalidInput: "invalidInput",
} as const);

export type EncounterSchedulingErrorCode =
  (typeof EncounterSchedulingErrorCode)[keyof typeof EncounterSchedulingErrorCode];

export class EncounterSchedulingError extends RangeError {
  readonly code: EncounterSchedulingErrorCode;

  constructor(code: EncounterSchedulingErrorCode, message: string) {
    super(message);
    this.name = "EncounterSchedulingError";
    this.code = code;
  }
}

export interface EncounterSchedulingHost {
  readonly currentTime: () => SimulationInstant;
  readonly scheduleWork: (input: ScheduledWorkInput) => ScheduledWorkRecord;
  readonly cancelScheduledWork: (id: ScheduledWorkId, generation: RevisionId) => ScheduledWorkRecord;
  readonly setFidelitySignal: (
    id: ObjectId,
    signalId: string,
    requirement: FidelityRequirementInput | null,
  ) => unknown;
}

export interface EncounterMaintenanceInput {
  readonly domainId: string;
  readonly sourceId: ObjectId;
  readonly profile: EncounterPredictionProfileInput | EncounterPredictionProfile;
  readonly from?: SimulationInstant;
  readonly dependencyRevisions?: readonly DependencyRevision[];
  readonly dependencyRevisionDigest?: RevisionId | string;
  readonly sourceOrdinal?: RevisionId | string;
}

export interface EncounterMaintenanceCoverage {
  readonly domainId: string;
  readonly profileId: string;
  readonly interval: {
    readonly start: SimulationInstant;
    readonly end: SimulationInstant;
  };
  readonly maintenanceInstant: SimulationInstant;
  readonly scheduledWorkId: ScheduledWorkId;
  readonly scheduledGeneration: RevisionId;
}

export interface EncounterFidelitySchedulingInput {
  readonly record: EncounterRecord;
  readonly profile: EncounterPredictionProfileInput | EncounterPredictionProfile;
  readonly promotionLeadTime?: Duration;
  readonly promotionDistanceMeters?: number;
  readonly requirement?: FidelityRequirementInput;
  readonly coupling?: EncounterCouplingAssessment;
  readonly sourceOrdinal?: RevisionId | string;
  readonly dependencyRevisions?: readonly DependencyRevision[];
  readonly dependencyRevisionDigest?: RevisionId | string;
}

export const EncounterFidelityScheduleStatus = Object.freeze({
  scheduled: "scheduled",
  active: "active",
  notRequired: "notRequired",
  expired: "expired",
} as const);

export type EncounterFidelityScheduleStatus =
  (typeof EncounterFidelityScheduleStatus)[keyof typeof EncounterFidelityScheduleStatus];

export interface EncounterFidelitySchedule {
  readonly status: EncounterFidelityScheduleStatus;
  readonly signalId: string;
  readonly encounterId: string;
  readonly promotionInstant: SimulationInstant;
  readonly refinementInstant: SimulationInstant;
  readonly expirationInstant: SimulationInstant;
  readonly requirement?: FidelityRequirement;
  readonly promotionWorkId?: ScheduledWorkId;
  readonly refinementWorkId?: ScheduledWorkId;
  readonly expirationWorkId?: ScheduledWorkId;
}

export interface EncounterSchedulingStatus {
  readonly nextScheduledInstant?: SimulationInstant;
  readonly maintenanceCoverage: readonly EncounterMaintenanceCoverage[];
  readonly fidelitySchedules: readonly EncounterFidelitySchedule[];
  readonly diagnostics: readonly EncounterSchedulingDiagnostic[];
}

interface MaintenanceState {
  readonly input: EncounterMaintenanceInput;
  readonly profile: EncounterPredictionProfile;
  readonly coverage: EncounterMaintenanceCoverage;
}

type FidelityActionKind = "promote" | "refine" | "expire";

interface FidelityAction {
  readonly kind: FidelityActionKind;
  readonly instant: SimulationInstant;
  readonly signalId: string;
  readonly objectId: ObjectId;
  readonly requirement: FidelityRequirement;
  readonly encounterId: string;
  readonly workId: ScheduledWorkId;
  readonly generation: RevisionId;
}

interface FidelityState {
  readonly input: EncounterFidelitySchedulingInput;
  readonly profile: EncounterPredictionProfile;
  readonly schedule: EncounterFidelitySchedule;
  readonly actions: readonly FidelityAction[];
}

function compareObjectIds(left: ObjectId, right: ObjectId): number {
  const a = BigInt(left);
  const b = BigInt(right);
  return a === b ? 0 : a < b ? -1 : 1;
}

function compareText(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function normalizedInstant(value: SimulationInstant, name: string): SimulationInstant {
  try {
    return simulationInstant(value.seconds, value.nanoseconds);
  } catch (error) {
    throw new EncounterSchedulingError(
      EncounterSchedulingErrorCode.invalidInput,
      `${name} is invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function normalizedDuration(value: Duration, name: string, allowZero = true): Duration {
  let result: Duration;
  try {
    result = duration(value.seconds, value.nanoseconds);
  } catch (error) {
    throw new EncounterSchedulingError(
      EncounterSchedulingErrorCode.invalidInput,
      `${name} is invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (compareDurations(result, duration(0)) < 0 || (!allowZero && compareDurations(result, duration(0)) === 0)) {
    throw new EncounterSchedulingError(
      EncounterSchedulingErrorCode.invalidInput,
      `${name} must be ${allowZero ? "non-negative" : "positive"}`,
    );
  }
  return result;
}

function normalizedRevision(value: RevisionId | string | undefined, name: string): RevisionId {
  try {
    return revisionId(value ?? "0");
  } catch (error) {
    throw new EncounterSchedulingError(
      EncounterSchedulingErrorCode.invalidInput,
      `${name} is invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function normalizedIdentifier(value: string, name: string): string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    throw new EncounterSchedulingError(EncounterSchedulingErrorCode.invalidInput, `${name} must be a non-empty identifier`);
  }
  return value;
}

function maxInstant(left: SimulationInstant, right: SimulationInstant): SimulationInstant {
  return compareSimulationInstants(left, right) >= 0 ? left : right;
}

function minInstant(left: SimulationInstant, right: SimulationInstant): SimulationInstant {
  return compareSimulationInstants(left, right) <= 0 ? left : right;
}

function freezeInstant(value: SimulationInstant): SimulationInstant {
  return simulationInstant(value.seconds, value.nanoseconds);
}

function safeWorkMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function fidelitySignalId(record: EncounterRecord): string {
  return `encounter:${record.encounterId}:${record.generation}`;
}

function intervalOverlaps(left: EncounterWindow, right: EncounterWindow): boolean {
  return compareSimulationInstants(left.start, right.end) < 0
    && compareSimulationInstants(right.start, left.end) < 0;
}

export interface EncounterCouplingBodyInput {
  readonly objectId: ObjectId;
  readonly mu?: number;
  readonly massKilograms?: number;
}

export interface EncounterCouplingInteractionInput {
  readonly objectA: ObjectId;
  readonly objectB: ObjectId;
  readonly distanceMeters: number;
}

export interface EncounterCouplingAssessmentInput {
  readonly requiredPair: EncounterPair;
  readonly bodies: readonly EncounterCouplingBodyInput[];
  readonly interactions: readonly EncounterCouplingInteractionInput[];
  readonly interactionWindow: Duration;
  readonly maxPositionErrorMeters?: number;
  readonly maxVelocityErrorMetersPerSecond?: number;
  readonly perturbationFraction: number;
  readonly groupLimit?: number;
}

export interface EncounterPerturbationMetric {
  readonly objectA: ObjectId;
  readonly objectB: ObjectId;
  readonly distanceMeters: number;
  readonly accelerationMetersPerSecondSquared: number;
  readonly positionPerturbationMeters: number;
  readonly velocityPerturbationMetersPerSecond: number;
  readonly significant: boolean;
  readonly physicalDataComplete: boolean;
}

export const EncounterCouplingAssessmentStatus = Object.freeze({
  notRequired: "notRequired",
  required: "required",
  failed: "failed",
} as const);

export type EncounterCouplingAssessmentStatus =
  (typeof EncounterCouplingAssessmentStatus)[keyof typeof EncounterCouplingAssessmentStatus];

export interface EncounterCouplingAssessment {
  readonly status: EncounterCouplingAssessmentStatus;
  readonly requiresMutualCoupling: boolean;
  readonly participantIds: readonly ObjectId[];
  readonly metrics: readonly EncounterPerturbationMetric[];
  readonly groupLimit: number;
  readonly failure?: string;
}

export interface EncounterCouplingWindowInput {
  readonly window: EncounterWindow;
  readonly participantIds: readonly ObjectId[];
  readonly requiresMutualCoupling?: boolean;
  readonly proposalId?: string;
}

export interface EncounterCoupledGroupPlan {
  readonly status: "ready" | "failed";
  readonly window: EncounterWindow;
  readonly participantIds: readonly ObjectId[];
  readonly proposalIds: readonly string[];
  readonly failure?: string;
}

function normalizedWindow(value: EncounterWindow, name: string): EncounterWindow {
  if (typeof value !== "object" || value === null) {
    throw new EncounterSchedulingError(EncounterSchedulingErrorCode.invalidInput, `${name} must be an object`);
  }
  const start = normalizedInstant(value.start, `${name}.start`);
  const end = normalizedInstant(value.end, `${name}.end`);
  if (compareSimulationInstants(start, end) >= 0) {
    throw new EncounterSchedulingError(EncounterSchedulingErrorCode.invalidInput, `${name} must have end after start`);
  }
  return Object.freeze({ start, end });
}

function normalizedParticipants(values: readonly ObjectId[], name: string): readonly ObjectId[] {
  if (!Array.isArray(values) || values.length === 0) {
    throw new EncounterSchedulingError(EncounterSchedulingErrorCode.invalidInput, `${name} must not be empty`);
  }
  const result = [...values].map((value) => objectId(value));
  result.sort(compareObjectIds);
  for (let index = 1; index < result.length; index += 1) {
    if (result[index] === result[index - 1]) {
      throw new EncounterSchedulingError(EncounterSchedulingErrorCode.invalidInput, `${name} must not contain duplicate IDs`);
    }
  }
  return Object.freeze(result);
}

function normalizedPair(objectA: ObjectId, objectB: ObjectId): readonly [ObjectId, ObjectId] {
  const left = objectId(objectA);
  const right = objectId(objectB);
  if (left === right) {
    throw new EncounterSchedulingError(EncounterSchedulingErrorCode.invalidInput, "Coupling interactions require distinct ObjectIds");
  }
  return BigInt(left) < BigInt(right) ? [left, right] : [right, left];
}

function normalizedNonNegative(value: number | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new EncounterSchedulingError(EncounterSchedulingErrorCode.invalidInput, `${name} must be finite and non-negative`);
  }
  return value;
}

function bodyMu(value: EncounterCouplingBodyInput): number | undefined {
  const mu = normalizedNonNegative(value.mu, "body.mu");
  const mass = normalizedNonNegative(value.massKilograms, "body.massKilograms");
  if (mu !== undefined) return mu;
  return mass === undefined ? undefined : mass * NEWTONIAN_GRAVITATIONAL_CONSTANT;
}

function metricKey(objectA: ObjectId, objectB: ObjectId): string {
  const [left, right] = normalizedPair(objectA, objectB);
  return `${left}:${right}`;
}

function metricIsRequired(metric: EncounterPerturbationMetric, input: EncounterCouplingAssessmentInput): boolean {
  const positionBudget = input.maxPositionErrorMeters === undefined
    ? Number.POSITIVE_INFINITY
    : input.maxPositionErrorMeters * input.perturbationFraction;
  const velocityBudget = input.maxVelocityErrorMetersPerSecond === undefined
    ? Number.POSITIVE_INFINITY
    : input.maxVelocityErrorMetersPerSecond * input.perturbationFraction;
  return metric.physicalDataComplete
    && ((input.maxPositionErrorMeters !== undefined && metric.positionPerturbationMeters > positionBudget)
      || (input.maxVelocityErrorMetersPerSecond !== undefined && metric.velocityPerturbationMetersPerSecond > velocityBudget));
}

export function assessEncounterMutualCoupling(input: EncounterCouplingAssessmentInput): EncounterCouplingAssessment {
  const window = normalizedDuration(input.interactionWindow, "interactionWindow", false);
  const perturbationFraction = input.perturbationFraction;
  if (typeof perturbationFraction !== "number" || !Number.isFinite(perturbationFraction) || perturbationFraction <= 0 || perturbationFraction > 1) {
    throw new EncounterSchedulingError(EncounterSchedulingErrorCode.invalidInput, "perturbationFraction must be in (0, 1]");
  }
  const maxPositionErrorMeters = normalizedNonNegative(input.maxPositionErrorMeters, "maxPositionErrorMeters");
  const maxVelocityErrorMetersPerSecond = normalizedNonNegative(input.maxVelocityErrorMetersPerSecond, "maxVelocityErrorMetersPerSecond");
  if (maxPositionErrorMeters === undefined && maxVelocityErrorMetersPerSecond === undefined) {
    return Object.freeze({
      status: EncounterCouplingAssessmentStatus.notRequired,
      requiresMutualCoupling: false,
      participantIds: Object.freeze([]),
      metrics: Object.freeze([]),
      groupLimit: input.groupLimit ?? DEFAULT_COUPLED_GROUP_LIMIT,
    });
  }
  const groupLimit = input.groupLimit ?? DEFAULT_COUPLED_GROUP_LIMIT;
  if (!Number.isSafeInteger(groupLimit) || groupLimit < 2) {
    throw new EncounterSchedulingError(EncounterSchedulingErrorCode.invalidInput, "groupLimit must be an integer of at least 2");
  }
  const bodies = new Map<ObjectId, number | undefined>();
  for (const body of input.bodies) {
    const id = objectId(body.objectId);
    if (bodies.has(id)) throw new EncounterSchedulingError(EncounterSchedulingErrorCode.invalidInput, `Duplicate coupling body: ${id}`);
    bodies.set(id, bodyMu(body));
  }
  const requiredPair = normalizedPair(input.requiredPair.objectA, input.requiredPair.objectB);
  const requiredKey = metricKey(requiredPair[0], requiredPair[1]);
  const seconds = durationToSeconds(window);
  const metrics = new Map<string, EncounterPerturbationMetric>();
  for (const interaction of input.interactions) {
    const [objectA, objectB] = normalizedPair(interaction.objectA, interaction.objectB);
    if (typeof interaction.distanceMeters !== "number" || !Number.isFinite(interaction.distanceMeters) || interaction.distanceMeters <= 0) {
      throw new EncounterSchedulingError(EncounterSchedulingErrorCode.invalidInput, "interaction.distanceMeters must be finite and positive");
    }
    const muA = bodies.get(objectA);
    const muB = bodies.get(objectB);
    const physicalDataComplete = muA !== undefined && muB !== undefined;
    const acceleration = physicalDataComplete
      ? (muA! + muB!) / (interaction.distanceMeters * interaction.distanceMeters)
      : 0;
    const metric: EncounterPerturbationMetric = {
      objectA,
      objectB,
      distanceMeters: interaction.distanceMeters,
      accelerationMetersPerSecondSquared: acceleration,
      positionPerturbationMeters: 0.5 * acceleration * seconds * seconds,
      velocityPerturbationMetersPerSecond: acceleration * seconds,
      significant: false,
      physicalDataComplete,
    };
    const significant = metricIsRequired(metric, {
      ...input,
      maxPositionErrorMeters,
      maxVelocityErrorMetersPerSecond,
    });
    metrics.set(metricKey(objectA, objectB), Object.freeze({ ...metric, significant }));
  }
  const orderedMetrics = [...metrics.values()].sort((left, right) => {
    const objectCompare = compareObjectIds(left.objectA, right.objectA);
    return objectCompare !== 0 ? objectCompare : compareObjectIds(left.objectB, right.objectB);
  });
  const requiredMetric = metrics.get(requiredKey);
  if (requiredMetric === undefined || !requiredMetric.significant) {
    const incomplete = requiredMetric?.physicalDataComplete === false;
    return Object.freeze({
      status: EncounterCouplingAssessmentStatus.notRequired,
      requiresMutualCoupling: false,
      participantIds: Object.freeze([]),
      metrics: Object.freeze(orderedMetrics),
      groupLimit,
      ...(incomplete ? { failure: "Required interaction has no complete mu/mass data" } : {}),
    });
  }
  const participants = new Set<ObjectId>();
  for (const metric of orderedMetrics) {
    if (!metric.significant) continue;
    participants.add(metric.objectA);
    participants.add(metric.objectB);
  }
  const participantIds = [...participants].sort(compareObjectIds);
  if (participantIds.length > groupLimit) {
    return Object.freeze({
      status: EncounterCouplingAssessmentStatus.failed,
      requiresMutualCoupling: true,
      participantIds: Object.freeze(participantIds),
      metrics: Object.freeze(orderedMetrics),
      groupLimit,
      failure: `Required coupled group contains ${participantIds.length} members but the limit is ${groupLimit}`,
    });
  }
  return Object.freeze({
    status: EncounterCouplingAssessmentStatus.required,
    requiresMutualCoupling: true,
    participantIds: Object.freeze(participantIds),
    metrics: Object.freeze(orderedMetrics),
    groupLimit,
  });
}

function normalizedProposal(value: EncounterCouplingWindowInput, index: number): {
  readonly window: EncounterWindow;
  readonly participantIds: readonly ObjectId[];
  readonly proposalId: string;
  readonly requiresMutualCoupling: boolean;
} {
  return {
    window: normalizedWindow(value.window, `proposals[${index}].window`),
    participantIds: normalizedParticipants(value.participantIds, `proposals[${index}].participantIds`),
    proposalId: value.proposalId === undefined ? String(index) : normalizedIdentifier(value.proposalId, `proposals[${index}].proposalId`),
    requiresMutualCoupling: value.requiresMutualCoupling ?? true,
  };
}

export function mergeEncounterCouplingWindows(
  values: readonly EncounterCouplingWindowInput[],
  groupLimit = DEFAULT_COUPLED_GROUP_LIMIT,
): readonly EncounterCoupledGroupPlan[] {
  if (!Number.isSafeInteger(groupLimit) || groupLimit < 2) {
    throw new EncounterSchedulingError(EncounterSchedulingErrorCode.invalidInput, "groupLimit must be an integer of at least 2");
  }
  const proposals = values.map(normalizedProposal).filter((value) => value.requiresMutualCoupling);
  proposals.sort((left, right) => {
    const start = compareSimulationInstants(left.window.start, right.window.start);
    if (start !== 0) return start;
    const end = compareSimulationInstants(left.window.end, right.window.end);
    if (end !== 0) return end;
    return compareText(left.proposalId, right.proposalId);
  });
  const plans: EncounterCoupledGroupPlan[] = [];
  for (const proposal of proposals) {
    const previous = plans[plans.length - 1];
    if (previous !== undefined && intervalOverlaps(previous.window, proposal.window)) {
      const ids = new Set<ObjectId>([...previous.participantIds, ...proposal.participantIds]);
      const participantIds = [...ids].sort(compareObjectIds);
      const end = maxInstant(previous.window.end, proposal.window.end);
      const proposalIds = [...previous.proposalIds, proposal.proposalId].sort(compareText);
      if (previous.status === "failed" || participantIds.length > groupLimit) {
        plans[plans.length - 1] = Object.freeze({
          status: "failed",
          window: Object.freeze({ start: previous.window.start, end }),
          participantIds: Object.freeze(participantIds),
          proposalIds: Object.freeze(proposalIds),
          failure: participantIds.length > groupLimit
            ? `Merged coupled group contains ${participantIds.length} members but the limit is ${groupLimit}`
            : previous.failure,
        });
      } else {
        plans[plans.length - 1] = Object.freeze({
          status: "ready",
          window: Object.freeze({ start: previous.window.start, end }),
          participantIds: Object.freeze(participantIds),
          proposalIds: Object.freeze(proposalIds),
        });
      }
      continue;
    }
    const participantIds = proposal.participantIds;
    plans.push(Object.freeze({
      status: participantIds.length > groupLimit ? "failed" : "ready",
      window: proposal.window,
      participantIds,
      proposalIds: Object.freeze([proposal.proposalId]),
      ...(participantIds.length > groupLimit
        ? { failure: `Coupled group contains ${participantIds.length} members but the limit is ${groupLimit}` }
        : {}),
    }));
  }
  return Object.freeze(plans);
}

export class EncounterSchedulingManager {
  readonly #host: EncounterSchedulingHost;
  readonly #maintenance = new Map<string, MaintenanceState>();
  readonly #fidelity = new Map<string, FidelityState>();
  readonly #diagnostics: EncounterSchedulingDiagnostic[] = [];

  constructor(host: EncounterSchedulingHost) {
    this.#host = host;
  }

  #diagnose(value: EncounterSchedulingDiagnostic): void {
    this.#diagnostics.push(Object.freeze({
      ...value,
      ...(value.instant === undefined ? {} : { instant: freezeInstant(value.instant) }),
    }));
    if (this.#diagnostics.length > 256) this.#diagnostics.shift();
  }

  #schedule(input: ScheduledWorkInput, context: { readonly domainId?: string; readonly encounterId?: string }): ScheduledWorkRecord {
    try {
      return this.#host.scheduleWork(input);
    } catch (error) {
      this.#diagnose({
        code: EncounterSchedulingDiagnosticCode.overload,
        message: `Encounter scheduled work could not be queued: ${safeWorkMessage(error)}`,
        instant: input.instant,
        ...context,
      });
      throw new EncounterSchedulingError(EncounterSchedulingErrorCode.overload, safeWorkMessage(error));
    }
  }

  #maintenanceKey(domainId: string, profileId: string): string {
    return `${domainId}\u0000${profileId}`;
  }

  #scheduleMaintenance(input: EncounterMaintenanceInput, profile: EncounterPredictionProfile, from: SimulationInstant): EncounterMaintenanceCoverage {
    const horizonEnd = addDurationToInstant(from, profile.lookahead);
    const maintenanceInstant = subtractDurationFromInstant(horizonEnd, profile.maintenanceLead);
    if (compareSimulationInstants(maintenanceInstant, from) <= 0) {
      this.#diagnose({
        code: EncounterSchedulingDiagnosticCode.incompleteHorizon,
        message: "Encounter maintenance lead must leave a future maintenance instant inside the rolling horizon",
        instant: from,
        domainId: input.domainId,
      });
      throw new EncounterSchedulingError(
        EncounterSchedulingErrorCode.invalidHorizon,
        "Encounter maintenance lead must be shorter than the lookahead horizon",
      );
    }
    const scheduled = this.#schedule({
      instant: maintenanceInstant,
      phase: ScheduledWorkPhase.predictionMaintenance,
      sourceKind: ScheduledWorkSourceKind.interaction,
      sourceId: objectId(input.sourceId),
      sourceOrdinal: normalizedRevision(input.sourceOrdinal, "sourceOrdinal"),
      dependencyRevisionDigest: input.dependencyRevisionDigest === undefined
        ? undefined
        : normalizedRevision(input.dependencyRevisionDigest, "dependencyRevisionDigest"),
      dependencies: input.dependencyRevisions,
      payload: { kind: ScheduledWorkPayloadKind.marker },
    }, { domainId: input.domainId });
    return Object.freeze({
      domainId: input.domainId,
      profileId: profile.profileId,
      interval: Object.freeze({ start: freezeInstant(from), end: freezeInstant(horizonEnd) }),
      maintenanceInstant: freezeInstant(maintenanceInstant),
      scheduledWorkId: scheduled.id,
      scheduledGeneration: scheduled.generation,
    });
  }

  scheduleMaintenance(input: EncounterMaintenanceInput): EncounterMaintenanceCoverage {
    const domainId = normalizedIdentifier(input.domainId, "domainId");
    const profile = normalizeEncounterPredictionProfile(input.profile);
    const now = this.#host.currentTime();
    const from = input.from === undefined ? now : maxInstant(normalizedInstant(input.from, "from"), now);
    const key = this.#maintenanceKey(domainId, profile.profileId);
    const previous = this.#maintenance.get(key);
    if (previous !== undefined && compareSimulationInstants(previous.coverage.maintenanceInstant, now) > 0) {
      try {
        this.#host.cancelScheduledWork(previous.coverage.scheduledWorkId, previous.coverage.scheduledGeneration);
      } catch (error) {
        this.#diagnose({
          code: EncounterSchedulingDiagnosticCode.lateWork,
          message: `Previous encounter maintenance work could not be cancelled: ${safeWorkMessage(error)}`,
          instant: now,
          domainId,
        });
      }
    }
    const coverage = this.#scheduleMaintenance({ ...input, domainId }, profile, from);
    this.#maintenance.set(key, { input: { ...input, domainId }, profile, coverage });
    return coverage;
  }

  #buildRequirement(input: EncounterFidelitySchedulingInput, profile: EncounterPredictionProfile, promotionInstant: SimulationInstant, expirationInstant: SimulationInstant, coupling: EncounterCouplingAssessment | undefined): FidelityRequirement {
    const requested = input.requirement ?? {};
    return fidelityRequirement({
      ...requested,
      requiresNumericalIntegration: requested.requiresNumericalIntegration ?? true,
      requiresEncounterRefinement: requested.requiresEncounterRefinement ?? true,
      requiresMutualCoupling: requested.requiresMutualCoupling || coupling?.requiresMutualCoupling === true,
      validFrom: promotionInstant,
      reevaluateBy: expirationInstant,
      reasons: [...(requested.reasons ?? []), `encounter:${input.record.encounterId}`, `profile:${profile.profileId}`],
    });
  }

  scheduleEncounterFidelity(input: EncounterFidelitySchedulingInput): EncounterFidelitySchedule {
    const record = createEncounterRecord(input.record);
    if (record.lifecycle !== EncounterRecordLifecycle.active) {
      throw new EncounterSchedulingError(EncounterSchedulingErrorCode.invalidInput, "Only active encounter records can schedule fidelity requirements");
    }
    const profile = normalizeEncounterPredictionProfile(input.profile);
    const expirationInstant = record.predictionInterval.end === undefined
      ? undefined
      : normalizedInstant(record.predictionInterval.end, "predictionInterval.end");
    if (expirationInstant === undefined) {
      this.#diagnose({
        code: EncounterSchedulingDiagnosticCode.incompleteHorizon,
        message: "Encounter fidelity cannot be scheduled without a finite interaction-window end",
        instant: this.#host.currentTime(),
        encounterId: record.encounterId,
      });
      throw new EncounterSchedulingError(EncounterSchedulingErrorCode.incompleteHorizon, "Encounter fidelity requires a finite interaction-window end");
    }
    const now = this.#host.currentTime();
    if (compareSimulationInstants(expirationInstant, now) <= 0) {
      this.#diagnose({
        code: EncounterSchedulingDiagnosticCode.incompleteHorizon,
        message: "Encounter interaction window has already expired; fidelity coverage was not silently retained",
        instant: now,
        encounterId: record.encounterId,
      });
      return Object.freeze({
        status: EncounterFidelityScheduleStatus.expired,
        signalId: fidelitySignalId(record),
        encounterId: record.encounterId,
        promotionInstant: freezeInstant(now),
        refinementInstant: freezeInstant(now),
        expirationInstant: freezeInstant(expirationInstant),
      });
    }
    const promotionDistanceMeters = input.promotionDistanceMeters ?? profile.refineDistanceMeters;
    if (typeof promotionDistanceMeters !== "number" || !Number.isFinite(promotionDistanceMeters) || promotionDistanceMeters < 0) {
      throw new EncounterSchedulingError(EncounterSchedulingErrorCode.invalidInput, "promotionDistanceMeters must be finite and non-negative");
    }
    const nearPass = record.closestApproachDistanceMeters <= promotionDistanceMeters + record.distanceUncertaintyMeters;
    const signalId = fidelitySignalId(record);
    const lead = input.promotionLeadTime === undefined
      ? profile.maintenanceLead
      : normalizedDuration(input.promotionLeadTime, "promotionLeadTime");
    const promotionMargin = addDurationToInstant(simulationInstant(0), lead);
    const totalMargin = addDurationToInstant(promotionMargin, record.timeUncertainty);
    const promotionCandidate = subtractDurationFromInstant(record.closestApproachInstant, duration(totalMargin.seconds, totalMargin.nanoseconds));
    let promotionInstant = maxInstant(promotionCandidate, now);
    if (compareSimulationInstants(promotionInstant, expirationInstant) >= 0) promotionInstant = now;
    const refinementCandidate = subtractDurationFromInstant(record.closestApproachInstant, record.timeUncertainty);
    const refinementInstant = maxInstant(refinementCandidate, now);
    if (!nearPass) {
      return Object.freeze({
        status: EncounterFidelityScheduleStatus.notRequired,
        signalId,
        encounterId: record.encounterId,
        promotionInstant: freezeInstant(promotionInstant),
        refinementInstant: freezeInstant(refinementInstant),
        expirationInstant: freezeInstant(expirationInstant),
      });
    }
    if (input.coupling?.status === EncounterCouplingAssessmentStatus.failed) {
      this.#diagnose({
        code: EncounterSchedulingDiagnosticCode.groupLimitExceeded,
        message: input.coupling.failure ?? "Required coupled group could not be constructed within the configured limit",
        instant: now,
        encounterId: record.encounterId,
      });
      throw new EncounterSchedulingError(EncounterSchedulingErrorCode.groupLimitExceeded, input.coupling.failure ?? "Required coupled group exceeds the configured limit");
    }
    const requirement = this.#buildRequirement(input, profile, promotionInstant, expirationInstant, input.coupling);
    const actions: FidelityAction[] = [];
    let promotionWork: ScheduledWorkRecord | undefined;
    let refinementWork: ScheduledWorkRecord | undefined;
    let expirationWork: ScheduledWorkRecord | undefined;
    try {
      if (compareSimulationInstants(promotionInstant, now) <= 0) {
        this.#host.setFidelitySignal(record.objectA, signalId, requirement);
      } else {
        promotionWork = this.#schedule({
          instant: promotionInstant,
          phase: ScheduledWorkPhase.authorityTransition,
          sourceKind: ScheduledWorkSourceKind.fidelity,
          sourceId: record.objectA,
          sourceOrdinal: normalizedRevision(input.sourceOrdinal, "sourceOrdinal"),
          dependencyRevisionDigest: input.dependencyRevisionDigest === undefined
            ? undefined
            : normalizedRevision(input.dependencyRevisionDigest, "dependencyRevisionDigest"),
          dependencies: input.dependencyRevisions,
          payload: { kind: ScheduledWorkPayloadKind.marker, objectId: record.objectA },
        }, { encounterId: record.encounterId });
        actions.push({
          kind: "promote",
          instant: promotionInstant,
          signalId,
          objectId: record.objectA,
          requirement,
          encounterId: record.encounterId,
          workId: promotionWork.id,
          generation: promotionWork.generation,
        });
      }
      if (compareSimulationInstants(refinementInstant, now) > 0
        && compareSimulationInstants(refinementInstant, expirationInstant) < 0) {
        refinementWork = this.#schedule({
          instant: refinementInstant,
          phase: ScheduledWorkPhase.predictionMaintenance,
          sourceKind: ScheduledWorkSourceKind.interaction,
          sourceId: record.objectA,
          sourceOrdinal: normalizedRevision(input.sourceOrdinal, "sourceOrdinal"),
          dependencyRevisionDigest: input.dependencyRevisionDigest === undefined
            ? undefined
            : normalizedRevision(input.dependencyRevisionDigest, "dependencyRevisionDigest"),
          dependencies: input.dependencyRevisions,
          payload: { kind: ScheduledWorkPayloadKind.marker, objectId: record.objectA },
        }, { encounterId: record.encounterId });
        actions.push({
          kind: "refine",
          instant: refinementInstant,
          signalId,
          objectId: record.objectA,
          requirement,
          encounterId: record.encounterId,
          workId: refinementWork.id,
          generation: refinementWork.generation,
        });
      }
      expirationWork = this.#schedule({
        instant: expirationInstant,
        phase: ScheduledWorkPhase.authorityTransition,
        sourceKind: ScheduledWorkSourceKind.fidelity,
        sourceId: record.objectA,
        sourceOrdinal: normalizedRevision(input.sourceOrdinal, "sourceOrdinal"),
        dependencyRevisionDigest: input.dependencyRevisionDigest === undefined
          ? undefined
          : normalizedRevision(input.dependencyRevisionDigest, "dependencyRevisionDigest"),
        dependencies: input.dependencyRevisions,
        payload: { kind: ScheduledWorkPayloadKind.marker, objectId: record.objectA },
      }, { encounterId: record.encounterId });
      actions.push({
        kind: "expire",
        instant: expirationInstant,
        signalId,
        objectId: record.objectA,
        requirement,
        encounterId: record.encounterId,
        workId: expirationWork.id,
        generation: expirationWork.generation,
      });
    } catch (error) {
      for (const work of [promotionWork, refinementWork, expirationWork]) {
        if (work === undefined) continue;
        try {
          this.#host.cancelScheduledWork(work.id, work.generation);
        } catch {
          // The original scheduling failure is the authoritative diagnostic.
        }
      }
      throw error;
    }
    const schedule = Object.freeze({
      status: compareSimulationInstants(promotionInstant, now) <= 0
        ? EncounterFidelityScheduleStatus.active
        : EncounterFidelityScheduleStatus.scheduled,
      signalId,
      encounterId: record.encounterId,
      promotionInstant: freezeInstant(promotionInstant),
      refinementInstant: freezeInstant(refinementInstant),
      expirationInstant: freezeInstant(expirationInstant),
      requirement,
      ...(promotionWork === undefined ? {} : { promotionWorkId: promotionWork.id }),
      ...(refinementWork === undefined ? {} : { refinementWorkId: refinementWork.id }),
      ...(expirationWork === undefined ? {} : { expirationWorkId: expirationWork.id }),
    });
    this.#fidelity.set(signalId, { input, profile, schedule, actions: Object.freeze(actions) });
    return schedule;
  }

  nextScheduledInstant(): SimulationInstant | undefined {
    const values: SimulationInstant[] = [];
    for (const state of this.#maintenance.values()) values.push(state.coverage.maintenanceInstant);
    for (const state of this.#fidelity.values()) for (const action of state.actions) values.push(action.instant);
    if (values.length === 0) return undefined;
    values.sort(compareSimulationInstants);
    return freezeInstant(values[0]!);
  }

  applyDue(nowInput: SimulationInstant): void {
    const now = normalizedInstant(nowInput, "now");
    const dueFidelity: FidelityState[] = [];
    for (const state of this.#fidelity.values()) {
      if (state.actions.some((action) => compareSimulationInstants(action.instant, now) <= 0)) dueFidelity.push(state);
    }
    dueFidelity.sort((left, right) => compareText(left.schedule.signalId, right.schedule.signalId));
    for (const state of dueFidelity) {
      const remaining: FidelityAction[] = [];
      let schedule = state.schedule;
      for (const action of state.actions) {
        if (compareSimulationInstants(action.instant, now) > 0) {
          remaining.push(action);
          continue;
        }
        if (compareSimulationInstants(action.instant, now) !== 0) {
          this.#diagnose({
            code: EncounterSchedulingDiagnosticCode.lateWork,
            message: `Encounter fidelity work was observed after its exact scheduled instant (${action.instant.seconds}.${action.instant.nanoseconds})`,
            instant: now,
            encounterId: action.encounterId,
          });
        }
        if (action.kind === "promote") {
          this.#host.setFidelitySignal(action.objectId, action.signalId, action.requirement);
          schedule = Object.freeze({ ...schedule, status: EncounterFidelityScheduleStatus.active });
        }
        else if (action.kind === "expire") this.#host.setFidelitySignal(action.objectId, action.signalId, null);
      }
      if (remaining.length === 0) this.#fidelity.delete(state.schedule.signalId);
      else this.#fidelity.set(state.schedule.signalId, { ...state, schedule, actions: Object.freeze(remaining) });
    }
    const dueMaintenance = [...this.#maintenance.values()]
      .filter((state) => compareSimulationInstants(state.coverage.maintenanceInstant, now) <= 0)
      .sort((left, right) => compareText(left.coverage.domainId, right.coverage.domainId));
    for (const state of dueMaintenance) {
      if (compareSimulationInstants(state.coverage.maintenanceInstant, now) !== 0) {
        this.#diagnose({
          code: EncounterSchedulingDiagnosticCode.lateWork,
          message: "Encounter maintenance coverage was observed after its exact scheduled instant",
          instant: now,
          domainId: state.coverage.domainId,
        });
      }
      const key = this.#maintenanceKey(state.coverage.domainId, state.profile.profileId);
      const next = this.#scheduleMaintenance(state.input, state.profile, now);
      this.#maintenance.set(key, { ...state, coverage: next });
    }
  }

  cancelEncounterFidelity(schedule: EncounterFidelitySchedule): void {
    const state = this.#fidelity.get(schedule.signalId);
    if (state === undefined) return;
    for (const action of state.actions) {
      try {
        this.#host.cancelScheduledWork(action.workId, action.generation);
      } catch (error) {
        this.#diagnose({
          code: EncounterSchedulingDiagnosticCode.lateWork,
          message: `Encounter fidelity work could not be cancelled: ${safeWorkMessage(error)}`,
          instant: this.#host.currentTime(),
          encounterId: action.encounterId,
        });
      }
    }
    this.#fidelity.delete(schedule.signalId);
  }

  invalidateDependency(target: DependencyInvalidationTarget, effectiveFrom: SimulationInstant): void {
    const dependency = dependencyRevisionIdentity(target);
    const instant = normalizedInstant(effectiveFrom, "effectiveFrom");
    for (const [key, state] of this.#maintenance) {
      const dependencies = state.input.dependencyRevisions ?? [];
      if (!dependencies.some((value) => dependencyKey(value) === dependencyKey(dependency) && value.revision !== dependency.revision)
        || compareSimulationInstants(state.coverage.maintenanceInstant, instant) < 0) continue;
      try {
        this.#host.cancelScheduledWork(state.coverage.scheduledWorkId, state.coverage.scheduledGeneration);
      } catch {
        // Generic invalidation may already have retired the same queue item.
      }
      this.#maintenance.delete(key);
      this.#diagnose({
        code: EncounterSchedulingDiagnosticCode.staleWork,
        message: "Encounter maintenance work was retired by a dependency revision",
        instant,
        domainId: state.coverage.domainId,
      });
    }
    for (const [signalId, state] of this.#fidelity) {
      const dependencies = state.input.dependencyRevisions ?? [];
      if (!dependencies.some((value) => dependencyKey(value) === dependencyKey(dependency) && value.revision !== dependency.revision)
        || !state.actions.some((action) => compareSimulationInstants(action.instant, instant) >= 0)) continue;
      for (const action of state.actions) {
        try {
          this.#host.cancelScheduledWork(action.workId, action.generation);
        } catch {
          // Generic invalidation may already have retired the same queue item.
        }
      }
      if (compareSimulationInstants(this.#host.currentTime(), state.schedule.promotionInstant) >= 0) {
        this.#host.setFidelitySignal(state.actions[0]?.objectId ?? objectId(state.input.record.objectA), signalId, null);
      }
      this.#fidelity.delete(signalId);
      this.#diagnose({
        code: EncounterSchedulingDiagnosticCode.staleWork,
        message: "Encounter fidelity/refinement work was retired by a dependency revision",
        instant,
        encounterId: state.schedule.encounterId,
      });
    }
  }

  status(): EncounterSchedulingStatus {
    const nextScheduledInstant = this.nextScheduledInstant();
    return Object.freeze({
      ...(nextScheduledInstant === undefined ? {} : { nextScheduledInstant }),
      maintenanceCoverage: Object.freeze([...this.#maintenance.values()]
        .sort((left, right) => compareText(left.coverage.domainId, right.coverage.domainId))
        .map((state) => state.coverage)),
      fidelitySchedules: Object.freeze([...this.#fidelity.values()]
        .sort((left, right) => compareText(left.schedule.signalId, right.schedule.signalId))
        .map((state) => state.schedule)),
      diagnostics: Object.freeze([...this.#diagnostics]),
    });
  }
}
