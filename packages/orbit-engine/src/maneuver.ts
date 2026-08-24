import { objectId, type ObjectId } from "./objects.js";
import {
  referenceFrameId,
  type ReferenceFrameId,
  type Vec3,
  vec3,
} from "./frames.js";
import {
  compareSimulationInstants,
  simulationInstant,
  type SimulationInstant,
} from "./time.js";
import {
  kilogramsPerSecond,
  metersPerSecond,
  newtons,
  type KilogramsPerSecond,
  type MetersPerSecond,
  type Newtons,
} from "./units.js";
import { revisionId, type RevisionId } from "./propagation.js";
import { encodeSimulationInstant, decodeSimulationInstant, type TimeWire } from "./internal/time-wire.js";
import { objectIdFromWire, objectIdToWire } from "./internal/object-wire.js";

const UINT64_MAX = 18_446_744_073_709_551_615n;
const UINT64_MAX_DECIMAL = UINT64_MAX.toString();
const UNIT_VECTOR_TOLERANCE = 1e-12;

export const STANDARD_GRAVITY_METERS_PER_SECOND_SQUARED = 9.80665;
export const STANDARD_GRAVITY = STANDARD_GRAVITY_METERS_PER_SECOND_SQUARED;

export const ManeuverKind = Object.freeze({
  impulse: "impulse",
  finiteBurn: "finiteBurn",
} as const);
export type ManeuverKind = (typeof ManeuverKind)[keyof typeof ManeuverKind];

export const ManeuverLifecycle = Object.freeze({
  scheduled: "scheduled",
  active: "active",
  completed: "completed",
  cancelled: "cancelled",
  failed: "failed",
  stale: "stale",
} as const);
export type ManeuverLifecycle = (typeof ManeuverLifecycle)[keyof typeof ManeuverLifecycle];

export const MassFlowSpecificationKind = Object.freeze({
  directMassFlow: "directMassFlow",
  exhaustVelocity: "exhaustVelocity",
  specificImpulse: "specificImpulse",
} as const);
export type MassFlowSpecificationKind =
  (typeof MassFlowSpecificationKind)[keyof typeof MassFlowSpecificationKind];

export const ManeuverErrorCode = Object.freeze({
  invalidId: "invalidId",
  invalidInput: "invalidInput",
  invalidTime: "invalidTime",
  notFuture: "notFuture",
  notFound: "notFound",
  invalidLifecycle: "invalidLifecycle",
  idExhausted: "idExhausted",
  invalidDirection: "invalidDirection",
  invalidPerformance: "invalidPerformance",
  invalidStage: "invalidStage",
  stageCount: "stageCount",
  stageOverlap: "stageOverlap",
  burnOverlap: "burnOverlap",
  revisionExhausted: "revisionExhausted",
} as const);
export type ManeuverErrorCode = (typeof ManeuverErrorCode)[keyof typeof ManeuverErrorCode];

export class ManeuverError extends Error {
  readonly code: ManeuverErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: ManeuverErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "ManeuverError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function fail(code: ManeuverErrorCode, message: string, details: Record<string, unknown> = {}): never {
  throw new ManeuverError(code, message, details);
}

declare const maneuverIdBrand: unique symbol;
export type ManeuverId = string & { readonly [maneuverIdBrand]: "ManeuverId" };

export function isManeuverId(value: unknown): value is ManeuverId {
  if (typeof value !== "string" || value.length === 0 || value.length > UINT64_MAX_DECIMAL.length) return false;
  if (value.length > 1 && value[0] === "0") return false;
  for (const character of value) {
    if (character < "0" || character > "9") return false;
  }
  return value !== "0" && (value.length < UINT64_MAX_DECIMAL.length || value <= UINT64_MAX_DECIMAL);
}

export function maneuverId(value: string): ManeuverId {
  if (!isManeuverId(value)) {
    fail(ManeuverErrorCode.invalidId, "ManeuverId must be canonical decimal text in the range 1..uint64_max");
  }
  return value;
}

function nextUint64(value: string, code: ManeuverErrorCode, name: string): string {
  const next = BigInt(value) + 1n;
  if (next > UINT64_MAX) fail(code, `${name} exhausted`);
  return next.toString();
}

function nextRevision(value: RevisionId): RevisionId {
  return revisionId(nextUint64(value, ManeuverErrorCode.revisionExhausted, "Maneuver revision"));
}

function finite(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(ManeuverErrorCode.invalidInput, `${name} must be finite`);
  }
  return value;
}

function nonNegative(value: unknown, name: string): number {
  const result = finite(value, name);
  if (result < 0) fail(ManeuverErrorCode.invalidInput, `${name} must be non-negative`);
  return result;
}

function positive(value: unknown, name: string): number {
  const result = finite(value, name);
  if (result <= 0) fail(ManeuverErrorCode.invalidInput, `${name} must be positive`);
  return result;
}

function normalizedInstant(value: SimulationInstant, name: string): SimulationInstant {
  try {
    return simulationInstant(value.seconds, value.nanoseconds);
  } catch (error) {
    fail(ManeuverErrorCode.invalidTime, `${name} is not a valid SimulationInstant`, { cause: error });
  }
}

function normalizedObjectId(value: ObjectId | string): ObjectId {
  try {
    return objectId(value);
  } catch (error) {
    fail(ManeuverErrorCode.invalidInput, "Maneuver objectId is invalid", { cause: error });
  }
}

function normalizedRevision(value: RevisionId | string | undefined, name: string): RevisionId {
  if (value === undefined) fail(ManeuverErrorCode.invalidDirection, `${name} is required`);
  try {
    return revisionId(value);
  } catch (error) {
    fail(ManeuverErrorCode.invalidInput, `${name} is invalid`, { cause: error });
  }
}

function normalizedVector<T extends number>(value: Vec3<number>, name: string, wrap: (value: number) => T): Vec3<T> {
  if (typeof value !== "object" || value === null) fail(ManeuverErrorCode.invalidDirection, `${name} must be a vector`);
  const candidate = value as Vec3<number>;
  const x = finite(candidate.x, `${name}.x`);
  const y = finite(candidate.y, `${name}.y`);
  const z = finite(candidate.z, `${name}.z`);
  const magnitude = Math.hypot(x, y, z);
  if (!Number.isFinite(magnitude) || magnitude <= UNIT_VECTOR_TOLERANCE) {
    fail(ManeuverErrorCode.invalidDirection, `${name} must have non-zero magnitude`);
  }
  return vec3(wrap(x / magnitude), wrap(y / magnitude), wrap(z / magnitude));
}

function finiteVector<T extends number>(value: Vec3<number>, name: string, wrap: (value: number) => T): Vec3<T> {
  if (typeof value !== "object" || value === null) fail(ManeuverErrorCode.invalidInput, `${name} must be a vector`);
  const candidate = value as Vec3<number>;
  return vec3(
    wrap(finite(candidate.x, `${name}.x`)),
    wrap(finite(candidate.y, `${name}.y`)),
    wrap(finite(candidate.z, `${name}.z`)),
  );
}

export interface ReferenceFrameDirectionInput {
  readonly kind: "referenceFrame";
  readonly frameId?: ReferenceFrameId | string;
  readonly frame?: ReferenceFrameId | string;
  readonly unitVector: Vec3<number>;
}

export interface BodyFrameDirectionInput {
  readonly kind: "bodyFrame";
  readonly unitVectorBody: Vec3<number>;
  readonly attitudeSourceId: string;
  readonly attitudeRevision: RevisionId | string;
}

export type ManeuverDirectionInput = ReferenceFrameDirectionInput | BodyFrameDirectionInput;

export interface ReferenceFrameDirection {
  readonly kind: "referenceFrame";
  readonly frameId: ReferenceFrameId;
  readonly unitVector: Vec3<number>;
}

export interface BodyFrameDirection {
  readonly kind: "bodyFrame";
  readonly unitVectorBody: Vec3<number>;
  readonly attitudeSourceId: string;
  readonly attitudeRevision: RevisionId;
}

export type ManeuverDirection = ReferenceFrameDirection | BodyFrameDirection;

function normalizeDirection(value: ManeuverDirectionInput): ManeuverDirection {
  if (typeof value !== "object" || value === null || typeof value.kind !== "string") {
    fail(ManeuverErrorCode.invalidDirection, "Maneuver direction must be an explicit reference- or body-frame vector");
  }
  if (value.kind === "referenceFrame") {
    const frameValue = value.frameId ?? value.frame;
    if (frameValue === undefined) fail(ManeuverErrorCode.invalidDirection, "Reference-frame direction requires frameId");
    let frameId: ReferenceFrameId;
    try {
      frameId = referenceFrameId(frameValue);
    } catch (error) {
      fail(ManeuverErrorCode.invalidDirection, "Reference-frame direction frameId is invalid", { cause: error });
    }
    return Object.freeze({
      kind: value.kind,
      frameId,
      unitVector: normalizedVector(value.unitVector, "direction.unitVector", (component) => component),
    });
  }
  if (value.kind === "bodyFrame") {
    if (typeof value.attitudeSourceId !== "string" || value.attitudeSourceId.length === 0) {
      fail(ManeuverErrorCode.invalidDirection, "Body-frame direction requires a non-empty attitudeSourceId");
    }
    return Object.freeze({
      kind: value.kind,
      unitVectorBody: normalizedVector(value.unitVectorBody, "direction.unitVectorBody", (component) => component),
      attitudeSourceId: value.attitudeSourceId,
      attitudeRevision: normalizedRevision(value.attitudeRevision, "attitudeRevision"),
    });
  }
  fail(ManeuverErrorCode.invalidDirection, `Unsupported maneuver direction kind: ${String((value as { readonly kind?: unknown }).kind)}`);
}

export interface DirectMassFlowInput {
  readonly kind: "directMassFlow";
  readonly massFlowKilogramsPerSecond: number;
}

export interface ExhaustVelocityInput {
  readonly kind: "exhaustVelocity";
  readonly exhaustVelocityMetersPerSecond: number;
}

export interface SpecificImpulseInput {
  readonly kind: "specificImpulse";
  readonly specificImpulseSeconds: number;
}

export type MassFlowSpecificationInput = DirectMassFlowInput | ExhaustVelocityInput | SpecificImpulseInput;

export interface NormalizedMassFlowSpecification {
  readonly kind: MassFlowSpecificationKind;
  readonly inputValue: number;
  readonly massFlowKilogramsPerSecond: KilogramsPerSecond;
  readonly exhaustVelocityMetersPerSecond?: number;
  readonly specificImpulseSeconds?: number;
}

function normalizeMassFlow(
  value: MassFlowSpecificationInput,
  forceMagnitudeNewtons: number,
): NormalizedMassFlowSpecification {
  if (typeof value !== "object" || value === null || typeof value.kind !== "string") {
    fail(ManeuverErrorCode.invalidPerformance, "Mass-flow specification is invalid");
  }
  if (value.kind === "directMassFlow") {
    const flow = nonNegative(value.massFlowKilogramsPerSecond, "massFlowKilogramsPerSecond");
    return Object.freeze({
      kind: value.kind,
      inputValue: flow,
      massFlowKilogramsPerSecond: kilogramsPerSecond(flow),
    });
  }
  if (value.kind === "exhaustVelocity") {
    const exhaustVelocity = positive(value.exhaustVelocityMetersPerSecond, "exhaustVelocityMetersPerSecond");
    const flow = forceMagnitudeNewtons === 0 ? 0 : forceMagnitudeNewtons / exhaustVelocity;
    return Object.freeze({
      kind: value.kind,
      inputValue: exhaustVelocity,
      massFlowKilogramsPerSecond: kilogramsPerSecond(flow),
      exhaustVelocityMetersPerSecond: exhaustVelocity,
    });
  }
  if (value.kind === "specificImpulse") {
    const specificImpulse = positive(value.specificImpulseSeconds, "specificImpulseSeconds");
    const exhaustVelocity = specificImpulse * STANDARD_GRAVITY_METERS_PER_SECOND_SQUARED;
    if (!Number.isFinite(exhaustVelocity)) fail(ManeuverErrorCode.invalidPerformance, "Specific impulse overflowed exhaust velocity");
    const flow = forceMagnitudeNewtons === 0 ? 0 : forceMagnitudeNewtons / exhaustVelocity;
    return Object.freeze({
      kind: value.kind,
      inputValue: specificImpulse,
      massFlowKilogramsPerSecond: kilogramsPerSecond(flow),
      exhaustVelocityMetersPerSecond: exhaustVelocity,
      specificImpulseSeconds: specificImpulse,
    });
  }
  fail(ManeuverErrorCode.invalidPerformance, `Unsupported mass-flow specification kind: ${String((value as { readonly kind?: unknown }).kind)}`);
}

export interface ImpulseManeuverInput {
  readonly instant: SimulationInstant;
  readonly deltaVelocity: Vec3<number>;
  readonly frame?: ReferenceFrameId | string;
  readonly referenceFrame?: ReferenceFrameId | string;
}

export interface FiniteBurnStageInput {
  readonly start: SimulationInstant;
  readonly end: SimulationInstant;
  readonly forceMagnitudeNewtons: number;
  readonly throttle: number;
  readonly direction: ManeuverDirectionInput;
  readonly massFlowSpecification?: MassFlowSpecificationInput;
  readonly massFlow?: MassFlowSpecificationInput;
}

export interface FiniteBurnManeuverInput {
  readonly start: SimulationInstant;
  readonly end: SimulationInstant;
  readonly stages: readonly FiniteBurnStageInput[];
  readonly minimumMassKilograms?: number;
}

export interface ImpulseManeuver extends ImpulseManeuverInput {
  readonly id: ManeuverId;
  readonly revision: RevisionId;
  readonly objectId: ObjectId;
  readonly kind: "impulse";
  readonly lifecycle: ManeuverLifecycle;
  readonly frame: ReferenceFrameId;
  readonly deltaVelocity: Vec3<MetersPerSecond>;
  readonly orderingKey: ManeuverId;
  readonly sameTimeOrder: ManeuverId;
}

export interface NormalizedFiniteBurnStage {
  readonly start: SimulationInstant;
  readonly end: SimulationInstant;
  readonly forceMagnitudeNewtons: Newtons;
  readonly throttle: number;
  readonly effectiveForceMagnitudeNewtons: Newtons;
  readonly direction: ManeuverDirection;
  readonly massFlowSpecification: NormalizedMassFlowSpecification;
  readonly effectiveMassFlowKilogramsPerSecond: KilogramsPerSecond;
}

/** Immutable force configuration handed to the authority-transition layer. */
export interface ManeuverForceConfiguration {
  readonly kind: "ballistic" | "finiteThrust";
  readonly maneuverId: ManeuverId;
  readonly maneuverRevision: RevisionId;
  readonly objectId: ObjectId;
  readonly configurationRevision: RevisionId;
  readonly stages: readonly NormalizedFiniteBurnStage[];
  readonly minimumMassKilograms?: number;
  readonly activeStageIndex?: number;
}

const UINT64_MASK = (1n << 64n) - 1n;

function forceConfigurationRevision(value: {
  readonly kind: "ballistic" | "finiteThrust";
  readonly maneuverId: ManeuverId;
  readonly maneuverRevision: RevisionId;
  readonly objectId: ObjectId;
  readonly stages: readonly NormalizedFiniteBurnStage[];
  readonly minimumMassKilograms?: number;
  readonly activeStageIndex?: number;
}): RevisionId {
  const serialized = JSON.stringify(value);
  let hash = 14_695_981_039_346_656_037n;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= BigInt(serialized.charCodeAt(index));
    hash = (hash * 1_099_511_628_211n) & UINT64_MASK;
  }
  return revisionId(hash.toString());
}

export interface FiniteBurnManeuver extends Omit<FiniteBurnManeuverInput, "stages" | "minimumMassKilograms"> {
  readonly id: ManeuverId;
  readonly revision: RevisionId;
  readonly objectId: ObjectId;
  readonly kind: "finiteBurn";
  readonly lifecycle: ManeuverLifecycle;
  readonly stages: readonly NormalizedFiniteBurnStage[];
  readonly minimumMassKilograms?: number;
}

export type Maneuver = ImpulseManeuver | FiniteBurnManeuver;
export type ManeuverDefinition = ImpulseManeuverInput | FiniteBurnManeuverInput;

export function maneuverForceConfiguration(
  maneuver: Maneuver,
  activeStageIndex?: number,
): ManeuverForceConfiguration {
  if (maneuver.kind === "impulse") {
    return Object.freeze({
      kind: "ballistic",
      maneuverId: maneuver.id,
      maneuverRevision: maneuver.revision,
      objectId: maneuver.objectId,
      configurationRevision: forceConfigurationRevision({
        kind: "ballistic",
        maneuverId: maneuver.id,
        maneuverRevision: maneuver.revision,
        objectId: maneuver.objectId,
        stages: [],
      }),
      stages: Object.freeze([]),
    });
  }
  const configurationRevision = forceConfigurationRevision({
    kind: "finiteThrust",
    maneuverId: maneuver.id,
    maneuverRevision: maneuver.revision,
    objectId: maneuver.objectId,
    stages: maneuver.stages,
    ...(maneuver.minimumMassKilograms === undefined ? {} : { minimumMassKilograms: maneuver.minimumMassKilograms }),
    ...(activeStageIndex === undefined ? {} : { activeStageIndex }),
  });
  return Object.freeze({
    kind: "finiteThrust",
    maneuverId: maneuver.id,
    maneuverRevision: maneuver.revision,
    objectId: maneuver.objectId,
    configurationRevision,
    stages: maneuver.stages,
    ...(maneuver.minimumMassKilograms === undefined ? {} : { minimumMassKilograms: maneuver.minimumMassKilograms }),
    ...(activeStageIndex === undefined ? {} : { activeStageIndex }),
  });
}

export function ballisticForceConfiguration(maneuver: Maneuver): ManeuverForceConfiguration {
  const configurationRevision = forceConfigurationRevision({
    kind: "ballistic",
    maneuverId: maneuver.id,
    maneuverRevision: maneuver.revision,
    objectId: maneuver.objectId,
    stages: [],
  });
  return Object.freeze({
    kind: "ballistic",
    maneuverId: maneuver.id,
    maneuverRevision: maneuver.revision,
    objectId: maneuver.objectId,
    configurationRevision,
    stages: Object.freeze([]),
  });
}

export interface ManeuverReplacement {
  readonly objectId?: ObjectId | string;
  readonly instant?: SimulationInstant;
  readonly deltaVelocity?: Vec3<number>;
  readonly frame?: ReferenceFrameId | string;
  readonly referenceFrame?: ReferenceFrameId | string;
  readonly start?: SimulationInstant;
  readonly end?: SimulationInstant;
  readonly stages?: readonly FiniteBurnStageInput[];
  readonly minimumMassKilograms?: number;
}

export interface ManeuverQuery {
  readonly objectId?: ObjectId | string;
  readonly from?: SimulationInstant;
  readonly to?: SimulationInstant;
  readonly lifecycle?: ManeuverLifecycle;
}

export interface ManeuverStatus {
  readonly id: ManeuverId;
  readonly revision: RevisionId;
  readonly objectId: ObjectId;
  readonly kind: ManeuverKind;
  readonly lifecycle: ManeuverLifecycle;
  readonly currentStageIndex?: number;
  readonly dependencyRevisionDigest: RevisionId;
  readonly resultingMotionRevision?: RevisionId;
  readonly lastResult?: string;
}

export const ManeuverScheduledEventKind = Object.freeze({
  impulse: "impulse",
  burnStart: "burnStart",
  stageBoundary: "stageBoundary",
  burnEnd: "burnEnd",
  minimumMassTermination: "minimumMassTermination",
} as const);
export type ManeuverScheduledEventKind =
  (typeof ManeuverScheduledEventKind)[keyof typeof ManeuverScheduledEventKind];

export interface ManeuverScheduledEvent {
  readonly maneuverId: ManeuverId;
  readonly revision: RevisionId;
  readonly kind: ManeuverScheduledEventKind;
  readonly stageIndex?: number;
}

export type ManeuverEventApplication = "applied" | "stale" | "ignored";

type NormalizedImpulseDefinition = Pick<ImpulseManeuver, "instant" | "deltaVelocity" | "frame">;
type NormalizedFiniteBurnDefinition = Pick<FiniteBurnManeuver, "start" | "end" | "stages" | "minimumMassKilograms">;

function normalizeImpulseDefinition(value: ImpulseManeuverInput): NormalizedImpulseDefinition {
  if (typeof value !== "object" || value === null) fail(ManeuverErrorCode.invalidInput, "Impulse definition must be an object");
  const instant = normalizedInstant(value.instant, "impulse.instant");
  const frameValue = value.frame ?? value.referenceFrame;
  if (frameValue === undefined) fail(ManeuverErrorCode.invalidDirection, "Impulse requires an explicit reference frame");
  let frame: ReferenceFrameId;
  try {
    frame = referenceFrameId(frameValue);
  } catch (error) {
    fail(ManeuverErrorCode.invalidDirection, "Impulse reference frame is invalid", { cause: error });
  }
  return Object.freeze({
    instant,
    deltaVelocity: finiteVector(value.deltaVelocity, "impulse.deltaVelocity", metersPerSecond),
    frame,
  });
}

function normalizeStage(value: FiniteBurnStageInput, burnStart: SimulationInstant, burnEnd: SimulationInstant): NormalizedFiniteBurnStage {
  if (typeof value !== "object" || value === null) fail(ManeuverErrorCode.invalidStage, "Finite-burn stage must be an object");
  const start = normalizedInstant(value.start, "stage.start");
  const end = normalizedInstant(value.end, "stage.end");
  if (compareSimulationInstants(start, end) >= 0) fail(ManeuverErrorCode.invalidStage, "Stage end must be after stage start");
  if (compareSimulationInstants(start, burnStart) < 0 || compareSimulationInstants(end, burnEnd) > 0) {
    fail(ManeuverErrorCode.invalidStage, "Stage interval must be contained in the finite-burn interval");
  }
  const force = nonNegative(value.forceMagnitudeNewtons, "forceMagnitudeNewtons");
  const throttle = finite(value.throttle, "throttle");
  if (throttle < 0 || throttle > 1) fail(ManeuverErrorCode.invalidStage, "throttle must be in [0, 1]");
  const performance = value.massFlowSpecification ?? value.massFlow;
  if (performance === undefined) fail(ManeuverErrorCode.invalidPerformance, "Stage requires a mass-flow specification");
  const massFlowSpecification = normalizeMassFlow(performance, force);
  const normalizedThrottle = throttle;
  return Object.freeze({
    start,
    end,
    forceMagnitudeNewtons: newtons(force),
    throttle: normalizedThrottle,
    effectiveForceMagnitudeNewtons: newtons(force * normalizedThrottle),
    direction: normalizeDirection(value.direction),
    massFlowSpecification,
    effectiveMassFlowKilogramsPerSecond: kilogramsPerSecond(
      massFlowSpecification.massFlowKilogramsPerSecond * normalizedThrottle,
    ),
  });
}

function normalizeFiniteBurnDefinition(value: FiniteBurnManeuverInput): NormalizedFiniteBurnDefinition {
  if (typeof value !== "object" || value === null) fail(ManeuverErrorCode.invalidInput, "Finite-burn definition must be an object");
  const start = normalizedInstant(value.start, "finiteBurn.start");
  const end = normalizedInstant(value.end, "finiteBurn.end");
  if (compareSimulationInstants(start, end) >= 0) fail(ManeuverErrorCode.invalidTime, "Finite-burn end must be after start");
  if (!Array.isArray(value.stages) || value.stages.length < 1 || value.stages.length > 64) {
    fail(ManeuverErrorCode.stageCount, "Finite burn must contain between 1 and 64 stages");
  }
  const stages = value.stages.map((stage) => normalizeStage(stage, start, end));
  for (let index = 1; index < stages.length; index += 1) {
    const previous = stages[index - 1];
    const current = stages[index];
    if (previous === undefined || current === undefined) fail(ManeuverErrorCode.invalidStage, "Stage normalization failed");
    if (compareSimulationInstants(current.start, previous.end) < 0) {
      fail(ManeuverErrorCode.stageOverlap, "Finite-burn stages must not overlap");
    }
  }
  const minimumMass = value.minimumMassKilograms === undefined
    ? undefined
    : positive(value.minimumMassKilograms, "minimumMassKilograms");
  return Object.freeze({ start, end, stages: Object.freeze(stages), ...(minimumMass === undefined ? {} : { minimumMassKilograms: minimumMass }) });
}

function definitionKind(value: ManeuverReplacement | ManeuverDefinition): ManeuverKind {
  if ("instant" in value || "deltaVelocity" in value || "frame" in value || "referenceFrame" in value) return "impulse";
  return "finiteBurn";
}

function normalizeDefinition(value: ManeuverDefinition | ManeuverReplacement, kind: ManeuverKind): NormalizedImpulseDefinition | NormalizedFiniteBurnDefinition {
  if (kind === "impulse") return normalizeImpulseDefinition(value as ImpulseManeuverInput);
  return normalizeFiniteBurnDefinition(value as FiniteBurnManeuverInput);
}

function maneuverStart(value: Maneuver): SimulationInstant {
  return value.kind === "impulse" ? value.instant : value.start;
}

function maneuverEnd(value: Maneuver): SimulationInstant {
  return value.kind === "impulse" ? value.instant : value.end;
}

function intervalsOverlap(left: FiniteBurnManeuver, right: FiniteBurnManeuver): boolean {
  return compareSimulationInstants(left.start, right.end) < 0 && compareSimulationInstants(right.start, left.end) < 0;
}

function freezeManeuver(value: Maneuver): Maneuver {
  if (value.kind === "finiteBurn") {
    return Object.freeze({ ...value, stages: Object.freeze(value.stages.map((stage) => Object.freeze(stage))) });
  }
  return Object.freeze(value);
}

function wireId(value: string): { readonly high: number; readonly low: number } {
  let high = 0;
  let low = 0;
  for (const character of value) {
    const lowProduct = low * 10 + (character.charCodeAt(0) - 48);
    low = lowProduct % 4_294_967_296;
    high = high * 10 + Math.floor(lowProduct / 4_294_967_296);
  }
  return { high, low };
}

function idFromWire(high: number, low: number): string {
  if (!Number.isInteger(high) || !Number.isInteger(low) || high < 0 || low < 0 || high > 4_294_967_295 || low > 4_294_967_295) {
    throw new TypeError("Maneuver wire ID words must be uint32");
  }
  let currentHigh = high;
  let currentLow = low;
  let digits = "";
  while (currentHigh !== 0 || currentLow !== 0) {
    const remainder = currentHigh % 10;
    currentHigh = Math.floor(currentHigh / 10);
    const combined = remainder * 4_294_967_296 + currentLow;
    currentLow = Math.floor(combined / 10);
    digits = String(combined % 10) + digits;
  }
  return maneuverId(digits);
}

export interface ManeuverStageWire {
  readonly start: TimeWire;
  readonly end: TimeWire;
  readonly forceMagnitudeNewtons: number;
  readonly throttle: number;
  readonly effectiveForceMagnitudeNewtons: number;
  readonly directionKind: 1 | 2;
  readonly directionFrameHigh: number;
  readonly directionFrameLow: number;
  readonly directionX: number;
  readonly directionY: number;
  readonly directionZ: number;
  readonly attitudeSourceId: string;
  readonly attitudeRevisionHigh: number;
  readonly attitudeRevisionLow: number;
  readonly massFlowKind: 1 | 2 | 3;
  readonly massFlowInputValue: number;
  readonly massFlowKilogramsPerSecond: number;
  readonly exhaustVelocityMetersPerSecond: number;
  readonly specificImpulseSeconds: number;
  readonly effectiveMassFlowKilogramsPerSecond: number;
}

export interface ManeuverWire {
  readonly idHigh: number;
  readonly idLow: number;
  readonly revisionHigh: number;
  readonly revisionLow: number;
  readonly objectIdHigh: number;
  readonly objectIdLow: number;
  readonly kind: 1 | 2;
  readonly lifecycle: number;
  readonly orderingHigh: number;
  readonly orderingLow: number;
  readonly instant: TimeWire;
  readonly deltaVelocityX: number;
  readonly deltaVelocityY: number;
  readonly deltaVelocityZ: number;
  readonly frameHigh: number;
  readonly frameLow: number;
  readonly start: TimeWire;
  readonly end: TimeWire;
  readonly minimumMassPresent: boolean;
  readonly minimumMassKilograms: number;
  readonly stageCount: number;
  readonly stages: readonly ManeuverStageWire[];
}

const LIFECYCLE_CODES: Readonly<Record<ManeuverLifecycle, number>> = Object.freeze({
  scheduled: 1,
  active: 2,
  completed: 3,
  cancelled: 4,
  failed: 5,
  stale: 6,
});

function lifecycleFromCode(value: number): ManeuverLifecycle {
  const result = (Object.entries(LIFECYCLE_CODES) as readonly (readonly [ManeuverLifecycle, number])[]).find((entry) => entry[1] === value)?.[0];
  if (result === undefined) throw new RangeError(`Unknown maneuver lifecycle code: ${value}`);
  return result;
}

function kindFromCode(value: number): ManeuverKind {
  if (value === 1) return "impulse";
  if (value === 2) return "finiteBurn";
  throw new RangeError(`Unknown maneuver kind code: ${value}`);
}

function directionKindCode(value: ManeuverDirection): 1 | 2 {
  return value.kind === "referenceFrame" ? 1 : 2;
}

function massFlowKindCode(value: NormalizedMassFlowSpecification): 1 | 2 | 3 {
  return value.kind === "directMassFlow" ? 1 : value.kind === "exhaustVelocity" ? 2 : 3;
}

export function encodeManeuverWire(value: Maneuver): ManeuverWire {
  const id = wireId(maneuverId(value.id));
  const revision = wireId(revisionId(value.revision));
  const object = objectIdToWire(objectId(value.objectId));
  const ordering = wireId(maneuverId(value.kind === "impulse" ? value.orderingKey : value.id));
  const emptyTime = encodeSimulationInstant(simulationInstant(0));
  const wireStages: ManeuverStageWire[] = value.kind === "finiteBurn"
    ? value.stages.map((stage) => {
      const directionFrame = stage.direction.kind === "referenceFrame" ? wireId(stage.direction.frameId) : { high: 0, low: 0 };
      const attitudeRevision = stage.direction.kind === "bodyFrame" ? wireId(stage.direction.attitudeRevision) : { high: 0, low: 0 };
      const vector = stage.direction.kind === "referenceFrame" ? stage.direction.unitVector : stage.direction.unitVectorBody;
      const massFlow = stage.massFlowSpecification;
      return Object.freeze({
        start: encodeSimulationInstant(stage.start),
        end: encodeSimulationInstant(stage.end),
        forceMagnitudeNewtons: stage.forceMagnitudeNewtons,
        throttle: stage.throttle,
        effectiveForceMagnitudeNewtons: stage.effectiveForceMagnitudeNewtons,
        directionKind: directionKindCode(stage.direction),
        directionFrameHigh: directionFrame.high,
        directionFrameLow: directionFrame.low,
        directionX: vector.x,
        directionY: vector.y,
        directionZ: vector.z,
        attitudeSourceId: stage.direction.kind === "bodyFrame" ? stage.direction.attitudeSourceId : "",
        attitudeRevisionHigh: attitudeRevision.high,
        attitudeRevisionLow: attitudeRevision.low,
        massFlowKind: massFlowKindCode(massFlow),
        massFlowInputValue: massFlow.inputValue,
        massFlowKilogramsPerSecond: massFlow.massFlowKilogramsPerSecond,
        exhaustVelocityMetersPerSecond: massFlow.exhaustVelocityMetersPerSecond ?? 0,
        specificImpulseSeconds: massFlow.specificImpulseSeconds ?? 0,
        effectiveMassFlowKilogramsPerSecond: stage.effectiveMassFlowKilogramsPerSecond,
      });
    })
    : [];
  return Object.freeze({
    idHigh: id.high,
    idLow: id.low,
    revisionHigh: revision.high,
    revisionLow: revision.low,
    objectIdHigh: object.objectIdHigh,
    objectIdLow: object.objectIdLow,
    kind: value.kind === "impulse" ? 1 : 2,
    lifecycle: LIFECYCLE_CODES[value.lifecycle],
    orderingHigh: ordering.high,
    orderingLow: ordering.low,
    instant: value.kind === "impulse" ? encodeSimulationInstant(value.instant) : emptyTime,
    deltaVelocityX: value.kind === "impulse" ? value.deltaVelocity.x : 0,
    deltaVelocityY: value.kind === "impulse" ? value.deltaVelocity.y : 0,
    deltaVelocityZ: value.kind === "impulse" ? value.deltaVelocity.z : 0,
    frameHigh: value.kind === "impulse" ? wireId(value.frame).high : 0,
    frameLow: value.kind === "impulse" ? wireId(value.frame).low : 0,
    start: value.kind === "finiteBurn" ? encodeSimulationInstant(value.start) : emptyTime,
    end: value.kind === "finiteBurn" ? encodeSimulationInstant(value.end) : emptyTime,
    minimumMassPresent: value.kind === "finiteBurn" && value.minimumMassKilograms !== undefined,
    minimumMassKilograms: value.kind === "finiteBurn" ? value.minimumMassKilograms ?? 0 : 0,
    stageCount: wireStages.length,
    stages: Object.freeze(wireStages),
  });
}

function decodeStage(value: ManeuverStageWire): FiniteBurnStageInput {
  const vector = vec3(value.directionX, value.directionY, value.directionZ);
  const direction: ManeuverDirectionInput = value.directionKind === 1
    ? { kind: "referenceFrame", frameId: idFromWire(value.directionFrameHigh, value.directionFrameLow), unitVector: vector }
    : {
      kind: "bodyFrame",
      unitVectorBody: vector,
      attitudeSourceId: value.attitudeSourceId,
      attitudeRevision: idFromWire(value.attitudeRevisionHigh, value.attitudeRevisionLow),
    };
  const massFlowSpecification: MassFlowSpecificationInput = value.massFlowKind === 1
    ? { kind: "directMassFlow", massFlowKilogramsPerSecond: value.massFlowInputValue }
    : value.massFlowKind === 2
      ? { kind: "exhaustVelocity", exhaustVelocityMetersPerSecond: value.massFlowInputValue }
      : { kind: "specificImpulse", specificImpulseSeconds: value.massFlowInputValue };
  return {
    start: decodeSimulationInstant(value.start),
    end: decodeSimulationInstant(value.end),
    forceMagnitudeNewtons: value.forceMagnitudeNewtons,
    throttle: value.throttle,
    direction,
    massFlowSpecification,
  };
}

export function decodeManeuverWire(value: ManeuverWire): Maneuver {
  const kind = kindFromCode(value.kind);
  const lifecycle = lifecycleFromCode(value.lifecycle);
  const id = maneuverId(idFromWire(value.idHigh, value.idLow));
  const revision = revisionId(idFromWire(value.revisionHigh, value.revisionLow));
  const object = objectIdFromWire(value.objectIdHigh, value.objectIdLow);
  const orderingKey = maneuverId(idFromWire(value.orderingHigh, value.orderingLow));
  if (value.stageCount !== value.stages.length) throw new RangeError("Maneuver wire stage count does not match stages");
  if (kind === "impulse") {
    const frame = referenceFrameId(idFromWire(value.frameHigh, value.frameLow));
    return freezeManeuver({
      id,
      revision,
      objectId: object,
      kind,
      lifecycle,
      instant: decodeSimulationInstant(value.instant),
      deltaVelocity: finiteVector(vec3(value.deltaVelocityX, value.deltaVelocityY, value.deltaVelocityZ), "wire.deltaVelocity", metersPerSecond),
      frame,
      orderingKey,
      sameTimeOrder: orderingKey,
    });
  }
  const stages = value.stages.map(decodeStage);
  return freezeManeuver({
    id,
    revision,
    objectId: object,
    kind,
    lifecycle,
    ...normalizeFiniteBurnDefinition({
      start: decodeSimulationInstant(value.start),
      end: decodeSimulationInstant(value.end),
      stages,
      ...(value.minimumMassPresent ? { minimumMassKilograms: value.minimumMassKilograms } : {}),
    }),
  });
}

export function roundTripManeuver(value: Maneuver): Maneuver {
  return decodeManeuverWire(encodeManeuverWire(value));
}

export interface ManeuverManagerOptions {
  readonly currentTime?: () => SimulationInstant;
  /**
   * Called while a maneuver mutation is being committed. The manager rolls
   * its own record back when the host rejects the associated scheduled work.
   */
  readonly onMutation?: (previous: Maneuver | undefined, next: Maneuver) => void;
}

function normalizeCurrentTime(value: SimulationInstant): SimulationInstant {
  return normalizedInstant(value, "currentTime");
}

function assertFuture(value: SimulationInstant, currentTime: SimulationInstant, name: string): void {
  if (compareSimulationInstants(value, currentTime) <= 0) {
    fail(ManeuverErrorCode.notFuture, `${name} must be strictly later than committed currentTime`);
  }
}

function assertReplacementObject(record: Maneuver, replacement: ManeuverReplacement): void {
  if (replacement.objectId !== undefined && normalizedObjectId(replacement.objectId) !== record.objectId) {
    fail(ManeuverErrorCode.invalidInput, "Maneuver updates cannot change objectId");
  }
}

export class ManeuverManager {
  readonly #currentTime: () => SimulationInstant;
  readonly #onMutation?: (previous: Maneuver | undefined, next: Maneuver) => void;
  readonly #records = new Map<ManeuverId, Maneuver>();
  readonly #runtime = new Map<ManeuverId, { readonly currentStageIndex?: number; readonly lastResult?: string }>();
  #nextId: ManeuverId = maneuverId("1");

  constructor(options: ManeuverManagerOptions = {}) {
    this.#currentTime = options.currentTime ?? (() => simulationInstant(0));
    this.#onMutation = options.onMutation;
  }

  #allocateId(): ManeuverId {
    const id = this.#nextId;
    this.#nextId = maneuverId(nextUint64(id, ManeuverErrorCode.idExhausted, "Maneuver ID"));
    return id;
  }

  #validateFuture(start: SimulationInstant): void {
    assertFuture(start, normalizeCurrentTime(this.#currentTime()), "Maneuver effective instant");
  }

  #validateOverlap(candidate: Maneuver): void {
    if (candidate.kind !== "finiteBurn" || candidate.lifecycle !== "scheduled") return;
    for (const existing of this.#records.values()) {
      if (existing.id === candidate.id || existing.kind !== "finiteBurn" || existing.lifecycle !== "scheduled") continue;
      if (existing.objectId === candidate.objectId && intervalsOverlap(existing, candidate)) {
        fail(ManeuverErrorCode.burnOverlap, "Finite-burn intervals overlap for the same object", {
          objectId: candidate.objectId,
          existingManeuverId: existing.id,
        });
      }
    }
  }

  scheduleImpulse(objectIdValue: ObjectId | string, definition: ImpulseManeuverInput): ImpulseManeuver {
    const objectIdValueNormalized = normalizedObjectId(objectIdValue);
    const normalized = normalizeImpulseDefinition(definition);
    this.#validateFuture(normalized.instant);
    const id = this.#allocateId();
    const record = freezeManeuver({
      ...normalized,
      id,
      revision: revisionId("1"),
      objectId: objectIdValueNormalized,
      kind: "impulse",
      lifecycle: "scheduled",
      orderingKey: id,
      sameTimeOrder: id,
    }) as ImpulseManeuver;
    this.#records.set(id, record);
    this.#runtime.delete(id);
    try {
      this.#onMutation?.(undefined, record);
    } catch (error) {
      this.#records.delete(id);
      this.#nextId = id;
      throw error;
    }
    return record;
  }

  scheduleFiniteBurn(objectIdValue: ObjectId | string, definition: FiniteBurnManeuverInput): FiniteBurnManeuver {
    const objectIdValueNormalized = normalizedObjectId(objectIdValue);
    const normalized = normalizeFiniteBurnDefinition(definition);
    this.#validateFuture(normalized.start);
    const id = this.#nextId;
    const record = freezeManeuver({
      ...normalized,
      id,
      revision: revisionId("1"),
      objectId: objectIdValueNormalized,
      kind: "finiteBurn",
      lifecycle: "scheduled",
    }) as FiniteBurnManeuver;
    this.#validateOverlap(record);
    this.#nextId = maneuverId(nextUint64(id, ManeuverErrorCode.idExhausted, "Maneuver ID"));
    this.#records.set(id, record);
    this.#runtime.delete(id);
    try {
      this.#onMutation?.(undefined, record);
    } catch (error) {
      this.#records.delete(id);
      this.#nextId = id;
      throw error;
    }
    return record;
  }

  updateManeuver(idValue: ManeuverId | string, replacement: ManeuverReplacement): Maneuver {
    const id = maneuverId(idValue);
    const current = this.#records.get(id);
    if (current === undefined) fail(ManeuverErrorCode.notFound, `Maneuver ${id} was not found`);
    assertReplacementObject(current, replacement);
    const kind = definitionKind(replacement);
    if (kind !== current.kind) fail(ManeuverErrorCode.invalidInput, "Maneuver updates cannot change maneuver kind");
    const normalized = normalizeDefinition(replacement, kind);
    const effective = kind === "impulse"
      ? (normalized as NormalizedImpulseDefinition).instant
      : (normalized as NormalizedFiniteBurnDefinition).start;
    this.#validateFuture(effective);
    if (current.lifecycle !== "scheduled") fail(ManeuverErrorCode.invalidLifecycle, "Only scheduled maneuvers can be updated");
    const next = kind === "impulse"
      ? freezeManeuver({
        ...(normalized as NormalizedImpulseDefinition),
        id,
        revision: nextRevision(current.revision),
        objectId: current.objectId,
        kind: "impulse",
        lifecycle: "scheduled",
        orderingKey: id,
        sameTimeOrder: id,
      })
      : freezeManeuver({
        ...(normalized as NormalizedFiniteBurnDefinition),
        id,
        revision: nextRevision(current.revision),
        objectId: current.objectId,
        kind: "finiteBurn",
        lifecycle: "scheduled",
      });
    this.#validateOverlap(next);
    const previousRuntime = this.#runtime.get(id);
    this.#records.set(id, next);
    this.#runtime.delete(id);
    try {
      this.#onMutation?.(current, next);
    } catch (error) {
      this.#records.set(id, current);
      if (previousRuntime === undefined) this.#runtime.delete(id);
      else this.#runtime.set(id, previousRuntime);
      throw error;
    }
    return next;
  }

  cancelManeuver(idValue: ManeuverId | string): Maneuver {
    const id = maneuverId(idValue);
    const current = this.#records.get(id);
    if (current === undefined) fail(ManeuverErrorCode.notFound, `Maneuver ${id} was not found`);
    if (current.lifecycle !== "scheduled") fail(ManeuverErrorCode.invalidLifecycle, "Only scheduled maneuvers can be cancelled");
    this.#validateFuture(maneuverStart(current));
    const next = freezeManeuver({ ...current, revision: nextRevision(current.revision), lifecycle: "cancelled" }) as Maneuver;
    const previousRuntime = this.#runtime.get(id);
    this.#records.set(id, next);
    this.#runtime.delete(id);
    try {
      this.#onMutation?.(current, next);
    } catch (error) {
      this.#records.set(id, current);
      if (previousRuntime === undefined) this.#runtime.delete(id);
      else this.#runtime.set(id, previousRuntime);
      throw error;
    }
    return next;
  }

  applyScheduledEvent(event: ManeuverScheduledEvent): ManeuverEventApplication {
    const current = this.#records.get(event.maneuverId);
    if (current === undefined || current.revision !== event.revision) return "stale";
    if (current.lifecycle === "cancelled" || current.lifecycle === "failed" || current.lifecycle === "stale") return "ignored";

    let next: Maneuver;
    let runtime: { readonly currentStageIndex?: number; readonly lastResult?: string } = {};
    switch (event.kind) {
      case "impulse":
        if (current.kind !== "impulse" || current.lifecycle !== "scheduled") return "ignored";
        next = freezeManeuver({ ...current, lifecycle: "completed" });
        runtime = { lastResult: "impulseApplied" };
        break;
      case "burnStart":
        if (current.kind !== "finiteBurn" || current.lifecycle !== "scheduled") return "ignored";
        next = freezeManeuver({ ...current, lifecycle: "active" });
        runtime = { currentStageIndex: event.stageIndex, lastResult: "burnStarted" };
        break;
      case "stageBoundary":
        if (current.kind !== "finiteBurn" || (current.lifecycle !== "scheduled" && current.lifecycle !== "active")) return "ignored";
        next = freezeManeuver({ ...current, lifecycle: "active" });
        runtime = { currentStageIndex: event.stageIndex, lastResult: "stageBoundary" };
        break;
      case "burnEnd":
        if (current.kind !== "finiteBurn" || (current.lifecycle !== "scheduled" && current.lifecycle !== "active")) return "ignored";
        next = freezeManeuver({ ...current, lifecycle: "completed" });
        runtime = { lastResult: "burnCompleted" };
        break;
      case "minimumMassTermination":
        if (current.kind !== "finiteBurn" || (current.lifecycle !== "scheduled" && current.lifecycle !== "active")) return "ignored";
        next = freezeManeuver({ ...current, lifecycle: "completed" });
        runtime = { lastResult: "minimumMassReached" };
        break;
      default:
        return "ignored";
    }
    this.#records.set(event.maneuverId, next);
    this.#runtime.set(event.maneuverId, runtime);
    return "applied";
  }

  getManeuver(idValue: ManeuverId | string): Maneuver | undefined {
    const id = maneuverId(idValue);
    return this.#records.get(id);
  }

  listManeuvers(query: ManeuverQuery = {}): readonly Maneuver[] {
    const object = query.objectId === undefined ? undefined : normalizedObjectId(query.objectId);
    const from = query.from === undefined ? undefined : normalizedInstant(query.from, "list.from");
    const to = query.to === undefined ? undefined : normalizedInstant(query.to, "list.to");
    if (from !== undefined && to !== undefined && compareSimulationInstants(from, to) > 0) {
      fail(ManeuverErrorCode.invalidTime, "list.to must not be earlier than list.from");
    }
    return Object.freeze([...this.#records.values()]
      .filter((record) => object === undefined || record.objectId === object)
      .filter((record) => query.lifecycle === undefined || record.lifecycle === query.lifecycle)
      .filter((record) => from === undefined || (record.kind === "impulse"
        ? compareSimulationInstants(maneuverStart(record), from) >= 0
        : compareSimulationInstants(maneuverEnd(record), from) > 0))
      .filter((record) => to === undefined || compareSimulationInstants(maneuverStart(record), to) < 0)
      .sort((left, right) => {
        const time = compareSimulationInstants(maneuverStart(left), maneuverStart(right));
        return time !== 0 ? time : BigInt(left.id) < BigInt(right.id) ? -1 : 1;
      }));
  }

  getManeuverStatus(idValue: ManeuverId | string): ManeuverStatus | undefined {
    const record = this.getManeuver(idValue);
    if (record === undefined) return undefined;
    return Object.freeze({
      id: record.id,
      revision: record.revision,
      objectId: record.objectId,
      kind: record.kind,
      lifecycle: record.lifecycle,
      dependencyRevisionDigest: revisionId("0"),
      ...this.#runtime.get(record.id),
    });
  }

  roundTrip(value: Maneuver): Maneuver {
    return roundTripManeuver(value);
  }

  clear(): void {
    this.#records.clear();
    this.#runtime.clear();
  }
}

export const createManeuverManager = (options?: ManeuverManagerOptions): ManeuverManager => new ManeuverManager(options);

export function impulseManeuverDefinition(value: ImpulseManeuverInput): NormalizedImpulseDefinition {
  return normalizeImpulseDefinition(value);
}

export function finiteBurnManeuverDefinition(value: FiniteBurnManeuverInput): NormalizedFiniteBurnDefinition {
  return normalizeFiniteBurnDefinition(value);
}

export function sortSameTimeImpulses(values: readonly ImpulseManeuver[]): readonly ImpulseManeuver[] {
  return Object.freeze([...values].sort((left, right) => {
    const time = compareSimulationInstants(left.instant, right.instant);
    return time !== 0 ? time : BigInt(left.id) < BigInt(right.id) ? -1 : BigInt(left.id) > BigInt(right.id) ? 1 : 0;
  }));
}
