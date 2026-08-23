import type { Backend } from "./internal/backends/contract.js";
import {
  type CoupledMemberWire,
  type CoupledWire,
} from "./internal/coupled-wire.js";
import { encodeDuration, encodeSimulationInstant } from "./internal/time-wire.js";
import { objectIdFromWire, objectIdToWire } from "./internal/object-wire.js";
import {
  FrameDynamicsAssumption,
  PropagationError,
  PropagationErrorCode,
  PropagationModelKind,
  propagationModelDeclaration,
  propagationState,
  revisionId,
  type PropagationModel,
  type PropagationState,
  type ReadOnlyPropagationEvaluationContext,
  type RevisionId,
} from "./propagation.js";
import { referenceFrameId, type ReferenceFrameId, type Vec3 } from "./frames.js";
import { compareSimulationInstants, duration, simulationInstant, type Duration, type SimulationInstant } from "./time.js";
import { gravitationalParameter, type GravitationalParameter } from "./properties.js";
import { kilograms, meters, metersPerSecond, metersPerSecondSquared, type Kilograms, type Meters, type MetersPerSecondSquared } from "./units.js";
import { objectId, type ObjectId } from "./objects.js";

const DEFAULT_BUDGET = Object.freeze({ checkpointStrideAcceptedSteps: 32, maxCheckpointCount: 64, maxDenseStepCount: 256, maxAcceptedStepsPerExtension: 100_000, maxRejectedStepsPerExtension: 10_000 });
const UINT32_BASE = 4_294_967_296;

export interface CoupledMemberConfiguration {
  readonly objectId: ObjectId;
  readonly anchor: PropagationState;
  readonly motionRevision: RevisionId;
  readonly propertyRevision?: RevisionId;
  readonly massRevision?: RevisionId;
  readonly mass?: Kilograms;
  readonly mu?: GravitationalParameter;
}

export interface CoupledMotionConfiguration {
  readonly members: readonly CoupledMemberConfiguration[];
  readonly configurationRevision: RevisionId;
  readonly relativeTolerance: number;
  readonly positionAbsoluteToleranceMeters: number;
  readonly velocityAbsoluteToleranceMetersPerSecond: number;
  readonly massAbsoluteToleranceKilograms?: number;
  readonly minStep: Duration;
  readonly maxStep: Duration;
  readonly checkpointStrideAcceptedSteps?: number;
  readonly maxCheckpointCount?: number;
  readonly maxDenseStepCount?: number;
  readonly maxAcceptedStepsPerExtension?: number;
  readonly maxRejectedStepsPerExtension?: number;
  readonly constantAcceleration?: Vec3<MetersPerSecondSquared>;
}

export interface CoupledMotionStatus {
  readonly kind: "coupledNumerical";
  readonly active: boolean;
  readonly authorityId: string;
  readonly groupRevision: RevisionId;
  readonly members: readonly ObjectId[];
  readonly sharedEvaluationCount: number;
}

interface NormalizedMember extends CoupledMemberConfiguration {
  readonly anchor: PropagationState;
  readonly propertyRevision: RevisionId;
  readonly massRevision: RevisionId;
}
interface NormalizedConfiguration {
  readonly members: readonly NormalizedMember[];
  readonly configurationRevision: RevisionId;
  readonly relativeTolerance: number;
  readonly positionAbsoluteToleranceMeters: number;
  readonly velocityAbsoluteToleranceMetersPerSecond: number;
  readonly massAbsoluteToleranceKilograms: number;
  readonly minStep: Duration; readonly maxStep: Duration;
  readonly checkpointStrideAcceptedSteps: number; readonly maxCheckpointCount: number; readonly maxDenseStepCount: number;
  readonly maxAcceptedStepsPerExtension: number; readonly maxRejectedStepsPerExtension: number;
  readonly constantAcceleration: Vec3<MetersPerSecondSquared>;
}

function finite(value: unknown, name: string): number { if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${name} must be finite`); return value; }
function positive(value: unknown, name: string): number { const result = finite(value, name); if (result <= 0) throw new RangeError(`${name} must be greater than zero`); return result; }
function positiveInteger(value: unknown, name: string, fallback: number): number { const result = value === undefined ? fallback : finite(value, name); if (!Number.isInteger(result) || result < 1 || result > 4_294_967_295) throw new RangeError(`${name} must be a positive uint32`); return result; }
function words(value: string): { readonly high: number; readonly low: number } {
  if (!/^\d+$/.test(value) || value.length > 20 || (value.length === 20 && value > "18446744073709551615")) throw new RangeError("revision exceeds uint64 range");
  let high = 0; let low = 0; for (const character of value) { const product = low * 10 + character.charCodeAt(0) - 48; low = product % UINT32_BASE; high = high * 10 + Math.floor(product / UINT32_BASE); } return { high, low };
}
function normalizeDuration(value: Duration, name: string): Duration { const result = duration(value.seconds, value.nanoseconds); if (result.seconds < 0 || (result.seconds === 0 && result.nanoseconds === 0)) throw new RangeError(`${name} must be positive`); return result; }
function normalizeVector(value: Vec3<MetersPerSecondSquared> | undefined): Vec3<MetersPerSecondSquared> { return Object.freeze({ x: metersPerSecondSquared(value === undefined ? 0 : finite(value.x, "constantAcceleration.x")), y: metersPerSecondSquared(value === undefined ? 0 : finite(value.y, "constantAcceleration.y")), z: metersPerSecondSquared(value === undefined ? 0 : finite(value.z, "constantAcceleration.z")) }); }

function normalizeConfiguration(value: CoupledMotionConfiguration): NormalizedConfiguration {
  if (typeof value !== "object" || value === null || !Array.isArray(value.members) || value.members.length < 2 || value.members.length > 32) throw new RangeError("coupled motion requires 2..32 members");
  const configurationRevision = revisionId(value.configurationRevision);
  const minStep = normalizeDuration(value.minStep, "minStep"); const maxStep = normalizeDuration(value.maxStep, "maxStep");
  if (maxStep.seconds < minStep.seconds || (maxStep.seconds === minStep.seconds && maxStep.nanoseconds < minStep.nanoseconds)) throw new RangeError("maxStep must be greater than or equal to minStep");
  const members = value.members.map((candidate) => {
    const id = objectId(candidate.objectId); const anchor = propagationState(candidate.anchor); const motionRevision = revisionId(candidate.motionRevision);
    if (motionRevision === "0") throw new RangeError("coupled member motionRevision must be non-zero");
    const mass = candidate.mass === undefined ? undefined : kilograms(finite(candidate.mass, "member.mass")); if (mass !== undefined && mass < 0) throw new RangeError("member.mass must be non-negative");
    const mu = candidate.mu === undefined ? undefined : gravitationalParameter(finite(candidate.mu, "member.mu"));
    return { objectId: id, anchor, motionRevision, propertyRevision: revisionId(candidate.propertyRevision ?? "0"), massRevision: revisionId(candidate.massRevision ?? "0"), ...(mass === undefined ? {} : { mass }), ...(mu === undefined ? {} : { mu }) } as NormalizedMember;
  }).sort((left, right) => left.objectId === right.objectId ? 0 : BigInt(left.objectId) < BigInt(right.objectId) ? -1 : 1);
  const epoch = members[0]?.anchor.epoch; const frame = members[0]?.anchor.referenceFrame; if (epoch === undefined || frame === undefined) throw new RangeError("coupled members are missing an anchor");
  if (frame !== referenceFrameId("1")) throw new RangeError("coupled motion requires the root inertial reference frame");
  if (members.some((member) => compareSimulationInstants(member.anchor.epoch, epoch) !== 0 || member.anchor.referenceFrame !== frame)) throw new RangeError("coupled members must share one exact epoch and frame");
  const ids = new Set(members.map((member) => member.objectId)); if (ids.size !== members.length) throw new RangeError("coupled members must have unique IDs");
  return Object.freeze({ members: Object.freeze(members), configurationRevision, relativeTolerance: positive(value.relativeTolerance, "relativeTolerance"), positionAbsoluteToleranceMeters: positive(value.positionAbsoluteToleranceMeters, "positionAbsoluteToleranceMeters"), velocityAbsoluteToleranceMetersPerSecond: positive(value.velocityAbsoluteToleranceMetersPerSecond, "velocityAbsoluteToleranceMetersPerSecond"), massAbsoluteToleranceKilograms: positive(value.massAbsoluteToleranceKilograms ?? 1e-6, "massAbsoluteToleranceKilograms"), minStep, maxStep, checkpointStrideAcceptedSteps: positiveInteger(value.checkpointStrideAcceptedSteps, "checkpointStrideAcceptedSteps", DEFAULT_BUDGET.checkpointStrideAcceptedSteps), maxCheckpointCount: positiveInteger(value.maxCheckpointCount, "maxCheckpointCount", DEFAULT_BUDGET.maxCheckpointCount), maxDenseStepCount: positiveInteger(value.maxDenseStepCount, "maxDenseStepCount", DEFAULT_BUDGET.maxDenseStepCount), maxAcceptedStepsPerExtension: positiveInteger(value.maxAcceptedStepsPerExtension, "maxAcceptedStepsPerExtension", DEFAULT_BUDGET.maxAcceptedStepsPerExtension), maxRejectedStepsPerExtension: positiveInteger(value.maxRejectedStepsPerExtension, "maxRejectedStepsPerExtension", DEFAULT_BUDGET.maxRejectedStepsPerExtension), constantAcceleration: normalizeVector(value.constantAcceleration) });
}

function encodeMember(member: NormalizedMember): CoupledMemberWire {
  const id = objectIdToWire(member.objectId); const frame = objectIdToWire(member.anchor.referenceFrame as unknown as ObjectId); const motion = words(member.motionRevision); const property = words(member.propertyRevision); const massRevision = words(member.massRevision);
  return { objectIdHigh: id.objectIdHigh, objectIdLow: id.objectIdLow, epoch: encodeSimulationInstant(member.anchor.epoch), frameHigh: frame.objectIdHigh, frameLow: frame.objectIdLow, positionX: member.anchor.position.x, positionY: member.anchor.position.y, positionZ: member.anchor.position.z, velocityX: member.anchor.velocity.x, velocityY: member.anchor.velocity.y, velocityZ: member.anchor.velocity.z, massPresent: member.mass !== undefined, mass: member.mass ?? 0, muPresent: member.mu !== undefined, mu: member.mu ?? 0, motionRevisionHigh: motion.high, motionRevisionLow: motion.low, propertyRevisionHigh: property.high, propertyRevisionLow: property.low, massRevisionHigh: massRevision.high, massRevisionLow: massRevision.low };
}
function wire(configuration: NormalizedConfiguration, operationCode: number, target: SimulationInstant, authorityId = "0", requested: readonly ObjectId[] = []): CoupledWire {
  const authority = words(authorityId); const revision = words(configuration.configurationRevision); return { resultCode: 0, operationCode, targetEpoch: encodeSimulationInstant(target), authorityIdHigh: authority.high, authorityIdLow: authority.low, groupRevisionHigh: 0, groupRevisionLow: 0, memberCount: configuration.members.length, members: configuration.members.map(encodeMember), requestedCount: requested.length, requestedIds: requested.map((id) => { const value = objectIdToWire(id); return { high: value.objectIdHigh, low: value.objectIdLow }; }), configurationRevisionHigh: revision.high, configurationRevisionLow: revision.low, relativeTolerance: configuration.relativeTolerance, positionAbsoluteToleranceMeters: configuration.positionAbsoluteToleranceMeters, velocityAbsoluteToleranceMetersPerSecond: configuration.velocityAbsoluteToleranceMetersPerSecond, massAbsoluteToleranceKilograms: configuration.massAbsoluteToleranceKilograms, checkpointStrideAcceptedSteps: configuration.checkpointStrideAcceptedSteps, maxCheckpointCount: configuration.maxCheckpointCount, maxDenseStepCount: configuration.maxDenseStepCount, maxAcceptedStepsPerExtension: configuration.maxAcceptedStepsPerExtension, maxRejectedStepsPerExtension: configuration.maxRejectedStepsPerExtension, minStep: encodeDuration(configuration.minStep), maxStep: encodeDuration(configuration.maxStep), constantAccelerationX: configuration.constantAcceleration.x, constantAccelerationY: configuration.constantAcceleration.y, constantAccelerationZ: configuration.constantAcceleration.z, resultCount: 0, results: [], sharedEvaluationCountHigh: 0, sharedEvaluationCountLow: 0 };
}
function state(value: CoupledMemberWire): PropagationState { return propagationState({ position: { x: meters(value.positionX), y: meters(value.positionY), z: meters(value.positionZ) }, velocity: { x: metersPerSecond(value.velocityX), y: metersPerSecond(value.velocityY), z: metersPerSecond(value.velocityZ) }, epoch: simulationInstant(value.epoch.secondsHigh * UINT32_BASE + value.epoch.secondsLow, value.epoch.nanoseconds), referenceFrame: referenceFrameId(objectIdFromWire(value.frameHigh, value.frameLow)) }); }
function id(value: CoupledMemberWire): ObjectId { return objectIdFromWire(value.objectIdHigh, value.objectIdLow); }
function resultError(code: number): never { if (code === 4) throw new PropagationError(PropagationErrorCode.unsupportedTemporalDirection, "Coupled authority does not support backward queries"); if (code === 5) throw new PropagationError(PropagationErrorCode.numericalFailure, "Coupled authority numerical evaluation failed"); if (code === 2) throw new PropagationError(PropagationErrorCode.coupledMembership, "Coupled authority membership is invalid"); throw new PropagationError(PropagationErrorCode.coupledTransitionRejected, "Coupled authority transition was rejected", { resultCode: code }); }

export class CoupledMotion {
  readonly #backend: Backend; readonly #configuration: NormalizedConfiguration; readonly #declaration: ReturnType<typeof propagationModelDeclaration>; #authorityId = "0"; #groupRevision = revisionId("0"); #active = true; #members: NormalizedMember[]; #sharedEvaluationCount = 0;
  protected constructor(configuration: CoupledMotionConfiguration, backend: unknown) { this.#configuration = normalizeConfiguration(configuration); this.#members = [...this.#configuration.members]; this.#backend = backend as Backend; this.#declaration = propagationModelDeclaration({ kind: PropagationModelKind.numerical, validity: { start: this.#members[0]!.anchor.epoch }, direction: "forwardOnly", propagationFrame: this.#members[0]!.anchor.referenceFrame, supportedFrameDynamics: [FrameDynamicsAssumption.inertial], dependencies: [], requiredPhysicalProperties: [], configurationRevision: this.#configuration.configurationRevision, errorContract: { positionAbsoluteMeters: this.#configuration.positionAbsoluteToleranceMeters, velocityAbsoluteMetersPerSecond: this.#configuration.velocityAbsoluteToleranceMetersPerSecond, notes: "Shared portable-core coupled numerical authority." } }); this.#promote(); }
  #send(input: CoupledWire): CoupledWire { const result = this.#backend.roundTripCoupled(input); if (result.resultCode !== 0) resultError(result.resultCode); this.#authorityId = result.authorityIdHigh === 0 && result.authorityIdLow === 0 ? "0" : objectIdFromWire(result.authorityIdHigh, result.authorityIdLow); this.#groupRevision = revisionId(String((BigInt(result.groupRevisionHigh) << 32n) | BigInt(result.groupRevisionLow))); this.#sharedEvaluationCount = Number((BigInt(result.sharedEvaluationCountHigh) << 32n) | BigInt(result.sharedEvaluationCountLow)); return result; }
  #promote(): void { const result = this.#send(wire(this.#configuration, 1, this.#members[0]!.anchor.epoch)); if (result.authorityIdHigh === 0 && result.authorityIdLow === 0) throw new PropagationError(PropagationErrorCode.coupledTransitionRejected, "Coupled promotion returned no authority"); }
  status(): CoupledMotionStatus { return Object.freeze({ kind: "coupledNumerical", active: this.#active, authorityId: this.#authorityId, groupRevision: this.#groupRevision, members: Object.freeze(this.#members.map((member) => member.objectId)), sharedEvaluationCount: this.#sharedEvaluationCount }); }
  get configuration(): CoupledMotionConfiguration { return this.#configuration; }
  stateBatchAt(ids: readonly ObjectId[], target: SimulationInstant): readonly PropagationState[] { if (!this.#active) throw new PropagationError(PropagationErrorCode.coupledTransitionRejected, "Coupled authority is no longer active"); const normalized = ids.map(objectId); const result = this.#send(wire(this.#configuration, 2, simulationInstant(target.seconds, target.nanoseconds), this.#authorityId, normalized)); return Object.freeze(result.results.slice(0, result.resultCount).map(state)); }
  stateAt(id: ObjectId, target: SimulationInstant): PropagationState { const result = this.stateBatchAt([id], target); const value = result[0]; if (value === undefined) throw new PropagationError(PropagationErrorCode.invalidCanonicalState, "Coupled authority returned no requested state"); return value; }
  demote(ids: readonly ObjectId[], target: SimulationInstant): readonly PropagationState[] { const normalized = ids.map(objectId); const result = this.#send(wire(this.#configuration, 3, simulationInstant(target.seconds, target.nanoseconds), this.#authorityId, normalized)); const demoted = result.results.slice(0, result.resultCount); const removed = new Set(normalized); this.#members = this.#members.filter((member) => !removed.has(member.objectId)); this.#active = this.#members.length >= 2; if (!this.#active) this.#authorityId = "0"; return Object.freeze(demoted.map(state)); }
  remove(id: ObjectId, target: SimulationInstant): PropagationState { const result = this.#send(wire(this.#configuration, 4, simulationInstant(target.seconds, target.nanoseconds), this.#authorityId, [objectId(id)])); const value = result.results[0]; if (value === undefined) throw new PropagationError(PropagationErrorCode.invalidCanonicalState, "Coupled remove returned no state"); this.#members = this.#members.filter((member) => member.objectId !== objectId(id)); this.#active = this.#members.length >= 2; if (!this.#active) this.#authorityId = "0"; return state(value); }
  modelFor(id: ObjectId): PropagationModel { const normalized = objectId(id); if (!this.#members.some((member) => member.objectId === normalized)) throw new PropagationError(PropagationErrorCode.coupledMembership, "Object is not a coupled member"); return Object.freeze({ declaration: this.#declaration, evaluate: (target: SimulationInstant, context: ReadOnlyPropagationEvaluationContext) => { if (context.objectId !== undefined && context.objectId !== normalized) throw new PropagationError(PropagationErrorCode.invalidConfiguration, "Coupled model is bound to a different object"); return this.stateAt(normalized, target); }, evaluateBatch: (ids: readonly ObjectId[], target: SimulationInstant) => this.stateBatchAt(ids, target) }); }
}

class BoundCoupledMotion extends CoupledMotion {
  constructor(configuration: CoupledMotionConfiguration, backend: Backend) { super(configuration, backend); }
}
export function createCoupledMotion(configuration: CoupledMotionConfiguration, backend: Backend): CoupledMotion { return new BoundCoupledMotion(configuration, backend); }
