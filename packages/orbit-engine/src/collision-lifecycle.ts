import {
  CollisionContactLifecycle,
  createCollisionContactRecord,
  transitionCollisionContactRecordLifecycle,
  type CollisionContactId,
  type CollisionContactRecord,
  type CollisionContactRecordInput,
  type CollisionContactLifecycle as CollisionContactLifecycleValue,
  type CollisionResponseResult,
} from "./collision.js";
import {
  applyCollisionResponseAtomically,
  CollisionResponseErrorCode,
  recordCollisionResponseResult,
  type CollisionAtomicHandoffInput,
  type CollisionAtomicHandoffResult,
  type CollisionResponseErrorCode as CollisionResponseErrorCodeValue,
} from "./collision-response.js";
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

export const CollisionContactBatchStatus = Object.freeze({
  committed: "committed",
  rolledBack: "rolledBack",
} as const);

export type CollisionContactBatchStatus = (typeof CollisionContactBatchStatus)[keyof typeof CollisionContactBatchStatus];

export const CollisionContactBatchErrorCode = Object.freeze({
  invalidTimestamp: "invalidTimestamp",
  unsupportedSimultaneousImpulseContact: "unsupportedSimultaneousImpulseContact",
  staleGeneration: "staleGeneration",
  responseFailed: "responseFailed",
} as const);

export type CollisionContactBatchErrorCode = (typeof CollisionContactBatchErrorCode)[keyof typeof CollisionContactBatchErrorCode];

export interface CollisionSimultaneousContactInput extends CollisionAtomicHandoffInput {}

export interface CollisionSimultaneousContactOutcome {
  readonly contact: CollisionContactRecord;
  readonly handoff: CollisionAtomicHandoffResult;
  readonly stateA: CollisionAtomicHandoffResult["stateA"];
  readonly stateB: CollisionAtomicHandoffResult["stateB"];
}

export interface CollisionSimultaneousContactResult {
  readonly status: CollisionContactBatchStatus;
  readonly exactContactInstant: SimulationInstant;
  readonly outcomes: readonly CollisionSimultaneousContactOutcome[];
  readonly errorCode?: CollisionContactBatchErrorCode;
}

export interface CollisionContactRegistrationInput {
  readonly record: CollisionContactRecordInput | CollisionContactRecord;
  readonly dependencyRevisions?: readonly DependencyRevision[];
}

export interface CollisionContactQuery {
  readonly objectId?: ObjectId;
  readonly from?: SimulationInstant;
  readonly to?: SimulationInstant;
  readonly lifecycle?: CollisionContactLifecycleValue;
}

export interface CollisionContactDiagnostic {
  readonly contactId: CollisionContactId;
  readonly generation: RevisionId;
  readonly lifecycle: CollisionContactLifecycleValue;
  readonly exactContactInstant: SimulationInstant;
  readonly policyRevision: RevisionId;
  readonly profileId: string;
  readonly quality: CollisionContactRecord["quality"];
  readonly responseMode: CollisionContactRecord["responseMode"];
  readonly responseResult: CollisionContactRecord["responseResult"];
  readonly timeUncertainty: CollisionContactRecord["timeUncertainty"];
  readonly separationUncertaintyMeters: CollisionContactRecord["separationUncertaintyMeters"];
  readonly dependencyRevisionDigest?: RevisionId;
  readonly invalidationCount: number;
  readonly lastInvalidation?: {
    readonly dependency: DependencyRevision;
    readonly effectiveFrom: SimulationInstant;
  };
}

export interface CollisionContactInvalidationResult {
  readonly dependency: DependencyRevision;
  readonly effectiveFrom: SimulationInstant;
  readonly staleContactIds: readonly CollisionContactId[];
}

export interface CollisionRemovalDependency {
  readonly kind: "structural" | "encounter" | "collisionContact" | "scheduledWork";
  readonly id: string;
}

export interface CollisionRemovalDependencyCheck {
  readonly objectId: ObjectId;
  readonly canRemove: boolean;
  readonly blockers: readonly CollisionRemovalDependency[];
}

export interface CollisionRemovalDependencyInput {
  readonly objectId: ObjectId;
  readonly dependencies?: readonly CollisionRemovalDependency[];
}

interface StoredContact {
  record: CollisionContactRecord;
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

interface CollisionLifecycleHost {
  readonly currentTime: () => SimulationInstant;
}

function compareObjectIds(left: ObjectId, right: ObjectId): number {
  const a = BigInt(left);
  const b = BigInt(right);
  return a === b ? 0 : a < b ? -1 : 1;
}

function compareText(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function compareContacts(left: CollisionContactRecord, right: CollisionContactRecord): number {
  return compareObjectIds(left.objectA, right.objectA)
    || compareObjectIds(left.objectB, right.objectB)
    || compareText(left.contactId, right.contactId)
    || compareText(left.generation, right.generation);
}

function normalizedInstant(value: SimulationInstant, name: string): SimulationInstant {
  if (typeof value !== "object" || value === null) throw new TypeError(`${name} must be a SimulationInstant`);
  return simulationInstant(value.seconds, value.nanoseconds);
}

function recordSource(value: CollisionContactRecordInput | CollisionContactRecord): CollisionContactRecordInput {
  return value as CollisionContactRecordInput;
}

function registrationRecord(input: CollisionContactRegistrationInput): {
  readonly record: CollisionContactRecord;
  readonly dependencies: readonly DependencyRevision[];
} {
  if (typeof input !== "object" || input === null) throw new TypeError("Collision contact registration must be an object");
  const source = recordSource(input.record);
  const embeddedDependencies = source.dependencyRevisions;
  const explicitDependencies = normalizeDependencyRevisions(input.dependencyRevisions ?? embeddedDependencies);
  const record = explicitDependencies.length === 0
    ? createCollisionContactRecord(source)
    : createCollisionContactRecord({ ...source, dependencyRevisions: explicitDependencies });
  const policyDependency = Object.freeze({
    kind: "interactionPolicy" as const,
    id: "collision-policy",
    revision: record.policyRevision,
  });
  const explicitPolicy = explicitDependencies.find((value) => dependencyKey(value) === dependencyKey(policyDependency));
  if (explicitPolicy !== undefined && explicitPolicy.revision !== policyDependency.revision) {
    throw new RangeError("Collision contact policyRevision must match its collision-policy dependency revision");
  }
  const dependencies = explicitPolicy === undefined
    ? normalizeDependencyRevisions([...explicitDependencies, policyDependency])
    : explicitDependencies;
  return Object.freeze({ record, dependencies });
}

function hasDifferentDependency(
  dependencies: readonly DependencyRevision[],
  target: DependencyRevision,
): boolean {
  return dependencies.some((value) => dependencyKey(value) === dependencyKey(target) && value.revision !== target.revision);
}

function cloneDiagnostic(value: CollisionContactDiagnostic): CollisionContactDiagnostic {
  return Object.freeze({
    ...value,
    exactContactInstant: simulationInstant(value.exactContactInstant.seconds, value.exactContactInstant.nanoseconds),
    ...(value.lastInvalidation === undefined ? {} : {
      lastInvalidation: Object.freeze({
        dependency: Object.freeze({ ...value.lastInvalidation.dependency }),
        effectiveFrom: simulationInstant(value.lastInvalidation.effectiveFrom.seconds, value.lastInvalidation.effectiveFrom.nanoseconds),
      }),
    }),
  });
}

function normalizeBatchInputs(
  values: readonly CollisionSimultaneousContactInput[],
): readonly CollisionSimultaneousContactInput[] {
  if (!Array.isArray(values) || values.length === 0) throw new RangeError("A collision timestamp transaction requires at least one contact");
  const normalized = values.map((value) => {
    if (typeof value !== "object" || value === null) throw new TypeError("Collision simultaneous contact input must be an object");
    return Object.freeze({ ...value, contact: createCollisionContactRecord(value.contact) });
  });
  const instant = normalized[0]!.contact.exactContactInstant;
  if (normalized.some((value) => compareSimulationInstants(value.contact.exactContactInstant, instant) !== 0)) {
    throw new RangeError("All simultaneous collision contacts must have the same exactContactInstant");
  }
  return Object.freeze(normalized.sort((left, right) => compareContacts(left.contact, right.contact)));
}

function hasSharedImpulseObject(inputs: readonly CollisionSimultaneousContactInput[]): boolean {
  const participants = new Set<string>();
  for (const input of inputs) {
    if (input.contact.responseMode !== "frictionlessImpulse") continue;
    const left = String(input.contact.objectA);
    const right = String(input.contact.objectB);
    if (participants.has(left) || participants.has(right)) return true;
    participants.add(left);
    participants.add(right);
  }
  return false;
}

function rollbackHandoff(
  handoff: CollisionAtomicHandoffResult,
  errorCode?: CollisionContactBatchErrorCode,
): CollisionAtomicHandoffResult {
  const responseError = errorCode === CollisionContactBatchErrorCode.unsupportedSimultaneousImpulseContact
    ? CollisionResponseErrorCode.unsupportedSimultaneousImpulseContact
    : handoff.response.errorCode;
  const responseResult = errorCode === CollisionContactBatchErrorCode.unsupportedSimultaneousImpulseContact
    ? "unsupported"
    : handoff.response.responseResult;
  return Object.freeze({
    ...handoff,
    status: "rolledBack",
    response: Object.freeze({
      ...handoff.response,
      responseResult,
      postStateA: handoff.response.preStateA,
      postStateB: handoff.response.preStateB,
      ...(responseError === undefined ? {} : { errorCode: responseError }),
    }),
    stateA: handoff.response.preStateA,
    stateB: handoff.response.preStateB,
    ...(errorCode === undefined ? {} : { errorCode: responseError }),
  });
}

function outcome(
  contact: CollisionContactRecord,
  handoff: CollisionAtomicHandoffResult,
): CollisionSimultaneousContactOutcome {
  return Object.freeze({ contact, handoff, stateA: handoff.stateA, stateB: handoff.stateB });
}

export function groupCollisionContactsByInstant(
  records: readonly (CollisionContactRecordInput | CollisionContactRecord)[],
): readonly { readonly exactContactInstant: SimulationInstant; readonly contacts: readonly CollisionContactRecord[] }[] {
  if (!Array.isArray(records)) throw new TypeError("Collision contacts must be an array");
  const normalized = records.map((value) => createCollisionContactRecord(recordSource(value))).sort((left, right) => {
    return compareSimulationInstants(left.exactContactInstant, right.exactContactInstant) || compareContacts(left, right);
  });
  const groups: Array<{ exactContactInstant: SimulationInstant; contacts: CollisionContactRecord[] }> = [];
  for (const record of normalized) {
    const current = groups.at(-1);
    if (current === undefined || compareSimulationInstants(current.exactContactInstant, record.exactContactInstant) !== 0) {
      groups.push({ exactContactInstant: record.exactContactInstant, contacts: [record] });
    } else {
      current.contacts.push(record);
    }
  }
  return Object.freeze(groups.map((group) => Object.freeze({
    exactContactInstant: group.exactContactInstant,
    contacts: Object.freeze([...group.contacts]),
  })));
}

export function resolveSimultaneousCollisionContacts(
  values: readonly CollisionSimultaneousContactInput[],
): CollisionSimultaneousContactResult {
  const inputs = normalizeBatchInputs(values);
  const exactContactInstant = inputs[0]!.contact.exactContactInstant;
  const handoffs = inputs.map((input) => applyCollisionResponseAtomically(input));
  if (hasSharedImpulseObject(inputs)) {
    return Object.freeze({
      status: CollisionContactBatchStatus.rolledBack,
      exactContactInstant,
      outcomes: Object.freeze(handoffs.map((handoff, index) => outcome(
        inputs[index]!.contact,
        rollbackHandoff(handoff, CollisionContactBatchErrorCode.unsupportedSimultaneousImpulseContact),
      ))),
      errorCode: CollisionContactBatchErrorCode.unsupportedSimultaneousImpulseContact,
    });
  }
  const failed = handoffs.find((handoff) => handoff.status === "rolledBack");
  if (failed !== undefined) {
    return Object.freeze({
      status: CollisionContactBatchStatus.rolledBack,
      exactContactInstant,
      outcomes: Object.freeze(handoffs.map((handoff, index) => outcome(
        inputs[index]!.contact,
        handoff.status === "committed" ? rollbackHandoff(handoff, CollisionContactBatchErrorCode.responseFailed) : handoff,
      ))),
      errorCode: CollisionContactBatchErrorCode.responseFailed,
    });
  }
  return Object.freeze({
    status: CollisionContactBatchStatus.committed,
    exactContactInstant,
    outcomes: Object.freeze(handoffs.map((handoff, index) => outcome(inputs[index]!.contact, handoff))),
  });
}

export function validateCollisionRemovalDependencies(
  input: CollisionRemovalDependencyInput,
): CollisionRemovalDependencyCheck {
  if (typeof input !== "object" || input === null) throw new TypeError("Collision removal dependency input must be an object");
  const object = objectId(input.objectId);
  if (input.dependencies !== undefined && !Array.isArray(input.dependencies)) throw new TypeError("Removal dependencies must be an array");
  const blockers = (input.dependencies ?? []).map((dependency) => {
    if (typeof dependency !== "object" || dependency === null || typeof dependency.id !== "string" || dependency.id.length === 0) {
      throw new TypeError("Removal dependency must contain a non-empty id");
    }
    if (dependency.kind !== "structural"
      && dependency.kind !== "encounter"
      && dependency.kind !== "collisionContact"
      && dependency.kind !== "scheduledWork") {
      throw new TypeError(`Unknown removal dependency kind: ${String(dependency.kind)}`);
    }
    return Object.freeze({ kind: dependency.kind, id: dependency.id });
  });
  return Object.freeze({ objectId: object, canRemove: blockers.length === 0, blockers: Object.freeze(blockers) });
}

export class CollisionContactLifecycleManager {
  readonly #host: CollisionLifecycleHost;
  readonly #records = new Map<CollisionContactId, StoredContact>();
  readonly #dependencyIndex = new Map<string, Set<CollisionContactId>>();
  readonly #currentRevisions = new Map<string, CurrentRevision>();

  constructor(host: CollisionLifecycleHost) {
    this.#host = host;
  }

  #removeDependencyIndexes(id: CollisionContactId, dependencies: readonly DependencyRevision[]): void {
    for (const dependency of dependencies) {
      const key = dependencyKey(dependency);
      const index = this.#dependencyIndex.get(key);
      index?.delete(id);
      if (index !== undefined && index.size === 0) this.#dependencyIndex.delete(key);
    }
  }

  #addDependencyIndexes(id: CollisionContactId, dependencies: readonly DependencyRevision[]): void {
    for (const dependency of dependencies) {
      const key = dependencyKey(dependency);
      const index = this.#dependencyIndex.get(key) ?? new Set<CollisionContactId>();
      index.add(id);
      this.#dependencyIndex.set(key, index);
    }
  }

  #isImmediatelyStale(record: CollisionContactRecord, dependencies: readonly DependencyRevision[]): boolean {
    return dependencies.some((dependency) => {
      const current = this.#currentRevisions.get(dependencyKey(dependency));
      return current !== undefined
        && current.revision !== dependency.revision
        && compareSimulationInstants(record.exactContactInstant, current.effectiveFrom) >= 0;
    });
  }

  register(input: CollisionContactRegistrationInput): CollisionContactRecord {
    const normalized = registrationRecord(input);
    let record = normalized.record;
    if (record.lifecycle === CollisionContactLifecycle.active && this.#isImmediatelyStale(record, normalized.dependencies)) {
      record = transitionCollisionContactRecordLifecycle(record, CollisionContactLifecycle.stale);
    }
    const existing = this.#records.get(record.contactId);
    if (existing !== undefined && BigInt(existing.record.generation) > BigInt(record.generation)) {
      throw new RangeError("Collision contact generation cannot move backwards");
    }
    if (existing !== undefined) this.#removeDependencyIndexes(existing.record.contactId, existing.dependencies);
    this.#records.set(record.contactId, {
      record,
      dependencies: normalized.dependencies,
      invalidationCount: existing?.invalidationCount ?? 0,
      lastInvalidation: existing?.lastInvalidation,
    });
    this.#addDependencyIndexes(record.contactId, normalized.dependencies);
    return record;
  }

  get(id: CollisionContactId | string): CollisionContactRecord | undefined {
    return this.#records.get(String(id) as CollisionContactId)?.record;
  }

  list(input: CollisionContactQuery): readonly CollisionContactRecord[] {
    if (typeof input !== "object" || input === null) throw new TypeError("Collision contact query must be an object");
    const from = input.from === undefined ? undefined : normalizedInstant(input.from, "from");
    const to = input.to === undefined ? undefined : normalizedInstant(input.to, "to");
    if (from !== undefined && to !== undefined && compareSimulationInstants(from, to) >= 0) {
      throw new RangeError("Collision contact query requires to after from");
    }
    const object = input.objectId === undefined ? undefined : objectId(input.objectId);
    return Object.freeze([...this.#records.values()]
      .map((value) => value.record)
      .filter((record) => input.lifecycle === undefined
        ? record.lifecycle === CollisionContactLifecycle.active
        : record.lifecycle === input.lifecycle)
      .filter((record) => object === undefined || record.objectA === object || record.objectB === object)
      .filter((record) => (from === undefined || compareSimulationInstants(record.exactContactInstant, from) >= 0)
        && (to === undefined || compareSimulationInstants(record.exactContactInstant, to) < 0))
      .sort(compareContacts));
  }

  diagnostics(id: CollisionContactId | string): CollisionContactDiagnostic | undefined {
    const stored = this.#records.get(String(id) as CollisionContactId);
    if (stored === undefined) return undefined;
    return cloneDiagnostic({
      contactId: stored.record.contactId,
      generation: stored.record.generation,
      lifecycle: stored.record.lifecycle,
      exactContactInstant: stored.record.exactContactInstant,
      policyRevision: stored.record.policyRevision,
      profileId: stored.record.profileId,
      quality: stored.record.quality,
      responseMode: stored.record.responseMode,
      responseResult: stored.record.responseResult,
      timeUncertainty: stored.record.timeUncertainty,
      separationUncertaintyMeters: stored.record.separationUncertaintyMeters,
      ...(stored.record.motionDependencyRevisionDigest === undefined ? {} : { dependencyRevisionDigest: stored.record.motionDependencyRevisionDigest }),
      invalidationCount: stored.invalidationCount,
      ...(stored.lastInvalidation === undefined ? {} : { lastInvalidation: stored.lastInvalidation }),
    });
  }

  invalidate(
    target: DependencyInvalidationTarget,
    effectiveFrom: SimulationInstant,
  ): CollisionContactInvalidationResult {
    const dependency = dependencyRevisionIdentity(target);
    const instant = normalizedInstant(effectiveFrom, "effectiveFrom");
    this.#currentRevisions.set(dependencyKey(dependency), { revision: dependency.revision, effectiveFrom: instant });
    const candidates = [...(this.#dependencyIndex.get(dependencyKey(dependency)) ?? [])]
      .map((id) => this.#records.get(id))
      .filter((value): value is StoredContact => value !== undefined)
      .sort((left, right) => compareContacts(left.record, right.record));
    const staleContactIds: CollisionContactId[] = [];
    for (const stored of candidates) {
      if (stored.record.lifecycle !== CollisionContactLifecycle.active
        || compareSimulationInstants(stored.record.exactContactInstant, instant) < 0
        || !hasDifferentDependency(stored.dependencies, dependency)) continue;
      stored.record = transitionCollisionContactRecordLifecycle(stored.record, CollisionContactLifecycle.stale);
      stored.invalidationCount += 1;
      stored.lastInvalidation = Object.freeze({ dependency, effectiveFrom: instant });
      this.#removeDependencyIndexes(stored.record.contactId, stored.dependencies);
      staleContactIds.push(stored.record.contactId);
    }
    return Object.freeze({ dependency, effectiveFrom: instant, staleContactIds: Object.freeze(staleContactIds) });
  }

  isCurrentGeneration(contact: CollisionContactRecord | { readonly contactId: CollisionContactId | string; readonly generation: RevisionId | string }): boolean {
    const contactId = String(contact.contactId) as CollisionContactId;
    const stored = this.#records.get(contactId);
    return stored !== undefined
      && stored.record.lifecycle === CollisionContactLifecycle.active
      && BigInt(stored.record.generation) === BigInt(revisionId(contact.generation));
  }

  executeSimultaneous(
    values: readonly CollisionSimultaneousContactInput[],
  ): CollisionSimultaneousContactResult {
    const result = resolveSimultaneousCollisionContacts(values);
    const stale = values.some((value) => !this.isCurrentGeneration(value.contact));
    if (stale) {
      return Object.freeze({
        ...result,
        status: CollisionContactBatchStatus.rolledBack,
        outcomes: Object.freeze(result.outcomes.map((value) => outcome(
          value.contact,
          rollbackHandoff(value.handoff, CollisionContactBatchErrorCode.staleGeneration),
        ))),
        errorCode: CollisionContactBatchErrorCode.staleGeneration,
      });
    }
    if (result.status === CollisionContactBatchStatus.committed) {
      for (const value of result.outcomes) {
        const stored = this.#records.get(value.contact.contactId);
        if (stored === undefined) continue;
        const nextResult: CollisionResponseResult = value.handoff.response.responseResult;
        stored.record = recordCollisionResponseResult(stored.record, nextResult);
      }
    }
    return result;
  }

  checkRemovalDependencies(
    object: ObjectId,
    dependencies: readonly CollisionRemovalDependency[] = [],
  ): CollisionRemovalDependencyCheck {
    const input = validateCollisionRemovalDependencies({ objectId: object, dependencies });
    const activeContacts = [...this.#records.values()]
      .filter((stored) => stored.record.lifecycle === CollisionContactLifecycle.active)
      .filter((stored) => stored.record.objectA === input.objectId || stored.record.objectB === input.objectId)
      .map((stored) => Object.freeze({ kind: "collisionContact" as const, id: stored.record.contactId }));
    const blockers = Object.freeze([...input.blockers, ...activeContacts]);
    return Object.freeze({ objectId: input.objectId, canRemove: blockers.length === 0, blockers });
  }

  currentTime(): SimulationInstant {
    return this.#host.currentTime();
  }
}

export { CollisionContactLifecycleManager as CollisionLifecycleManager };
