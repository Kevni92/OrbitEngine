import type { ObjectId } from "./objects.js";
import type { PhysicalProperties } from "./properties.js";
import {
  compareSimulationInstants,
  simulationInstant,
  type SimulationInstant,
} from "./time.js";
import {
  identityRigidStateTransform,
  referenceFrameId,
  rigidStateTransform,
  transformCartesianState,
  type CartesianState,
  type RigidStateTransform,
  type ReferenceFrameId,
  type Vec3,
} from "./frames.js";
import {
  meters,
  metersPerSecond,
  metersPerSecondSquared,
  radiansPerSecond,
  radiansPerSecondSquared,
  type Kilograms,
  type Meters,
  type MetersPerSecond,
  type MetersPerSecondSquared,
  type RadiansPerSecondSquared,
} from "./units.js";

const UINT64_MAX_DECIMAL = "18446744073709551615";

export const PropagationModelKind = Object.freeze({
  referenceEphemeris: "referenceEphemeris",
  twoBodyAnalytical: "twoBodyAnalytical",
  numerical: "numerical",
  attached: "attached",
} as const);

export type PropagationModelKind = (typeof PropagationModelKind)[keyof typeof PropagationModelKind];

const MODEL_KIND_CODES: Readonly<Record<PropagationModelKind, number>> = Object.freeze({
  referenceEphemeris: 1,
  twoBodyAnalytical: 2,
  numerical: 3,
  attached: 4,
});

export function propagationModelKindCode(value: PropagationModelKind): number {
  const code = MODEL_KIND_CODES[value];
  if (code === undefined) {
    throw new RangeError(`Unknown propagation model kind: ${String(value)}`);
  }
  return code;
}

export function propagationModelKindFromCode(value: number): PropagationModelKind {
  if (!Number.isInteger(value)) {
    throw new TypeError("PropagationModelKind code must be an integer");
  }
  const result = (Object.entries(MODEL_KIND_CODES) as readonly (readonly [PropagationModelKind, number])[])
    .find((entry) => entry[1] === value)?.[0];
  if (result === undefined) {
    throw new RangeError(`Unknown propagation model kind code: ${value}`);
  }
  return result;
}

export const PropagationDirection = Object.freeze({
  forwardOnly: "forwardOnly",
  bidirectional: "bidirectional",
  bounded: "bounded",
} as const);

export type PropagationDirection = (typeof PropagationDirection)[keyof typeof PropagationDirection];

const DIRECTION_CODES: Readonly<Record<PropagationDirection, number>> = Object.freeze({
  forwardOnly: 1,
  bidirectional: 2,
  bounded: 3,
});

export function propagationDirectionCode(value: PropagationDirection): number {
  const code = DIRECTION_CODES[value];
  if (code === undefined) {
    throw new RangeError(`Unknown propagation direction: ${String(value)}`);
  }
  return code;
}

export function propagationDirectionFromCode(value: number): PropagationDirection {
  if (!Number.isInteger(value)) {
    throw new TypeError("Propagation direction code must be an integer");
  }
  const result = (Object.entries(DIRECTION_CODES) as readonly (readonly [PropagationDirection, number])[])
    .find((entry) => entry[1] === value)?.[0];
  if (result === undefined) {
    throw new RangeError(`Unknown propagation direction code: ${value}`);
  }
  return result;
}

export const PropagationErrorCode = Object.freeze({
  targetOutsideValidity: "targetOutsideValidity",
  unsupportedTemporalDirection: "unsupportedTemporalDirection",
  unsupportedFrameDynamics: "unsupportedFrameDynamics",
  missingDependency: "missingDependency",
  dependencyCycle: "dependencyCycle",
  missingPhysicalProperty: "missingPhysicalProperty",
  sourceUnavailable: "sourceUnavailable",
  numericalFailure: "numericalFailure",
  invalidModelRepresentation: "invalidModelRepresentation",
  invalidCanonicalState: "invalidCanonicalState",
  invalidConfiguration: "invalidConfiguration",
  switchToleranceExceeded: "switchToleranceExceeded",
  acceptanceRejected: "acceptanceRejected",
  noActiveSegment: "noActiveSegment",
} as const);

export type PropagationErrorCode = (typeof PropagationErrorCode)[keyof typeof PropagationErrorCode];

export class PropagationError extends Error {
  readonly code: PropagationErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: PropagationErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "PropagationError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function fail(code: PropagationErrorCode, message: string, details: Record<string, unknown> = {}): never {
  throw new PropagationError(code, message, details);
}

function assertFinite(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number`);
  }
  return value;
}

function assertNonNegative(value: unknown, name: string): number {
  const result = assertFinite(value, name);
  if (result < 0) {
    throw new RangeError(`${name} must be non-negative`);
  }
  return result;
}

function isCanonicalDecimal(value: unknown, allowZero: boolean): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > UINT64_MAX_DECIMAL.length) {
    return false;
  }
  if (value.length > 1 && value[0] === "0") {
    return false;
  }
  for (const character of value) {
    if (character < "0" || character > "9") {
      return false;
    }
  }
  if (value.length === UINT64_MAX_DECIMAL.length && value > UINT64_MAX_DECIMAL) {
    return false;
  }
  return allowZero || value !== "0";
}

declare const revisionIdBrand: unique symbol;
export type RevisionId = string & { readonly [revisionIdBrand]: "RevisionId" };

export function revisionId(value: string): RevisionId {
  if (!isCanonicalDecimal(value, true)) {
    throw new RangeError("RevisionId must be canonical uint64 decimal text");
  }
  return value as RevisionId;
}

function incrementRevision(value: RevisionId): RevisionId {
  const digits = value.split("");
  let carry = 1;
  for (let index = digits.length - 1; index >= 0 && carry !== 0; index -= 1) {
    const digit = digits[index];
    if (digit === undefined) {
      fail(PropagationErrorCode.invalidConfiguration, "Propagation revision increment failed");
    }
    const next = digit.charCodeAt(0) - 48 + carry;
    digits[index] = String(next % 10);
    carry = Math.floor(next / 10);
  }
  if (carry !== 0) {
    fail(PropagationErrorCode.invalidConfiguration, "Propagation revision overflow");
  }
  return revisionId(digits.join(""));
}

export interface PropagationTimeInterval {
  readonly start: SimulationInstant;
  readonly end?: SimulationInstant;
}

export function propagationTimeInterval(
  start: SimulationInstant,
  end?: SimulationInstant,
): PropagationTimeInterval {
  const normalizedStart = simulationInstant(start.seconds, start.nanoseconds);
  const normalizedEnd = end === undefined ? undefined : simulationInstant(end.seconds, end.nanoseconds);
  if (normalizedEnd !== undefined && compareSimulationInstants(normalizedStart, normalizedEnd) >= 0) {
    throw new RangeError("Propagation validity end must be after start");
  }
  return Object.freeze({ start: normalizedStart, end: normalizedEnd });
}

export function containsPropagationTime(interval: PropagationTimeInterval, target: SimulationInstant): boolean {
  const value = simulationInstant(target.seconds, target.nanoseconds);
  return compareSimulationInstants(value, interval.start) >= 0
    && (interval.end === undefined || compareSimulationInstants(value, interval.end) < 0);
}

export const FrameDynamicsAssumption = Object.freeze({
  inertial: "inertial",
  translating: "translating",
  rotating: "rotating",
  requiresDerivatives: "requiresDerivatives",
} as const);

export type FrameDynamicsAssumption = (typeof FrameDynamicsAssumption)[keyof typeof FrameDynamicsAssumption];

const FRAME_DYNAMICS_VALUES = new Set<string>(Object.values(FrameDynamicsAssumption));

export type PropagationDependencyKind = "object" | "frame" | "source" | "property" | "attitude" | "mass";

export interface PropagationDependency {
  readonly kind: PropagationDependencyKind;
  readonly id: string;
  readonly revision: RevisionId;
}

export const PropagationPropertyRequirement = Object.freeze({
  mass: "mass",
  mu: "mu",
  attitude: "attitude",
} as const);

export type PropagationPropertyRequirement =
  (typeof PropagationPropertyRequirement)[keyof typeof PropagationPropertyRequirement];

export interface PropagationErrorContract {
  readonly positionAbsoluteMeters?: number;
  readonly velocityAbsoluteMetersPerSecond?: number;
  readonly notes?: string;
}

export interface PropagationModelDeclaration {
  readonly kind: PropagationModelKind;
  readonly validity: PropagationTimeInterval;
  readonly direction: PropagationDirection;
  readonly boundedDirection?: "forwardOnly" | "bidirectional";
  readonly propagationFrame: ReferenceFrameId;
  readonly supportedFrameDynamics: readonly FrameDynamicsAssumption[];
  readonly dependencies: readonly PropagationDependency[];
  readonly requiredPhysicalProperties: readonly PropagationPropertyRequirement[];
  readonly configurationRevision: RevisionId;
  readonly errorContract: PropagationErrorContract;
}

export interface PropagationStateInput {
  readonly position: Vec3<Meters>;
  readonly velocity: Vec3<MetersPerSecond>;
  readonly epoch: SimulationInstant;
  readonly referenceFrame: ReferenceFrameId;
}

export interface PropagationState extends PropagationStateInput {}
export type CanonicalCartesianState = PropagationState;

export function propagationState(value: PropagationStateInput): PropagationState {
  if (typeof value !== "object" || value === null) {
    throw new TypeError("Propagation state must be an object");
  }
  const position = Object.freeze({
    x: meters(assertFinite(value.position.x, "state.position.x")),
    y: meters(assertFinite(value.position.y, "state.position.y")),
    z: meters(assertFinite(value.position.z, "state.position.z")),
  });
  const velocity = Object.freeze({
    x: metersPerSecond(assertFinite(value.velocity.x, "state.velocity.x")),
    y: metersPerSecond(assertFinite(value.velocity.y, "state.velocity.y")),
    z: metersPerSecond(assertFinite(value.velocity.z, "state.velocity.z")),
  });
  return Object.freeze({
    position,
    velocity,
    epoch: simulationInstant(value.epoch.seconds, value.epoch.nanoseconds),
    referenceFrame: referenceFrameId(value.referenceFrame),
  });
}

function stateAsCartesian(value: PropagationState): CartesianState {
  return {
    position: value.position,
    velocity: value.velocity,
    epoch: value.epoch,
  };
}

function assertStateMatches(
  value: PropagationState,
  target: SimulationInstant,
  frame: ReferenceFrameId,
): PropagationState {
  const state = propagationState(value);
  if (compareSimulationInstants(state.epoch, target) !== 0) {
    fail(PropagationErrorCode.invalidCanonicalState, "Propagation result epoch does not equal its target", {
      expectedEpoch: target,
      actualEpoch: state.epoch,
    });
  }
  if (state.referenceFrame !== frame) {
    fail(PropagationErrorCode.invalidCanonicalState, "Propagation result frame does not match its model", {
      expectedFrame: frame,
      actualFrame: state.referenceFrame,
    });
  }
  return state;
}

function normalizeDependencies(values: readonly PropagationDependency[]): readonly PropagationDependency[] {
  const seen = new Set<string>();
  return Object.freeze(values.map((value) => {
    if (typeof value !== "object" || value === null || value.id.length === 0) {
      throw new TypeError("Propagation dependency must have a non-empty id");
    }
    if (seen.has(`${value.kind}:${value.id}`)) {
      throw new RangeError(`Duplicate propagation dependency: ${value.kind}:${value.id}`);
    }
    seen.add(`${value.kind}:${value.id}`);
    return Object.freeze({ kind: value.kind, id: value.id, revision: revisionId(value.revision) });
  }));
}

export function propagationModelDeclaration(
  value: PropagationModelDeclaration,
): PropagationModelDeclaration {
  propagationDirectionCode(value.direction);
  if (!Object.prototype.hasOwnProperty.call(MODEL_KIND_CODES, value.kind)) {
    throw new RangeError(`Unknown propagation model kind: ${String(value.kind)}`);
  }
  if (!FRAME_DYNAMICS_VALUES.has(value.supportedFrameDynamics[0] ?? "")) {
    throw new RangeError("Propagation model must declare at least one frame-dynamics assumption");
  }
  for (const assumption of value.supportedFrameDynamics) {
    if (!FRAME_DYNAMICS_VALUES.has(assumption)) {
      throw new RangeError(`Unknown frame-dynamics assumption: ${String(assumption)}`);
    }
  }
  if (value.direction === "bounded" && value.boundedDirection === undefined) {
    throw new RangeError("Bounded propagation models must declare their temporal direction");
  }
  if (value.direction !== "bounded" && value.boundedDirection !== undefined) {
    throw new RangeError("Only bounded propagation models may declare boundedDirection");
  }
  const errorContract = Object.freeze({
    positionAbsoluteMeters: value.errorContract.positionAbsoluteMeters === undefined
      ? undefined : assertNonNegative(value.errorContract.positionAbsoluteMeters, "position error contract"),
    velocityAbsoluteMetersPerSecond: value.errorContract.velocityAbsoluteMetersPerSecond === undefined
      ? undefined : assertNonNegative(value.errorContract.velocityAbsoluteMetersPerSecond, "velocity error contract"),
    notes: value.errorContract.notes,
  });
  return Object.freeze({
    kind: value.kind,
    validity: propagationTimeInterval(value.validity.start, value.validity.end),
    direction: value.direction,
    ...(value.boundedDirection === undefined ? {} : { boundedDirection: value.boundedDirection }),
    propagationFrame: referenceFrameId(value.propagationFrame),
    supportedFrameDynamics: Object.freeze([...value.supportedFrameDynamics]),
    dependencies: normalizeDependencies(value.dependencies),
    requiredPhysicalProperties: Object.freeze([...value.requiredPhysicalProperties]),
    configurationRevision: revisionId(value.configurationRevision),
    errorContract,
  });
}

function validateTargetDirection(declaration: PropagationModelDeclaration, target: SimulationInstant): void {
  const comparisonToStart = compareSimulationInstants(target, declaration.validity.start);
  if ((declaration.direction === "forwardOnly"
      || (declaration.direction === "bounded" && declaration.boundedDirection === "forwardOnly"))
      && comparisonToStart < 0) {
    fail(PropagationErrorCode.unsupportedTemporalDirection, "Propagation model does not support backward queries");
  }
  if (!containsPropagationTime(declaration.validity, target)) {
    fail(PropagationErrorCode.targetOutsideValidity, "Propagation target is outside the model validity domain");
  }
}

export interface ReadOnlyPropagationEvaluationContext {
  readonly objectId?: ObjectId;
  readonly currentTime: SimulationInstant;
  readonly physicalProperties?: PhysicalProperties;
  readonly resolveDependencyState?: (
    dependency: PropagationDependency,
    target: SimulationInstant,
  ) => PropagationState;
  readonly resolveFrameDynamics?: (
    frame: ReferenceFrameId,
    target: SimulationInstant,
  ) => FrameDynamicsSample;
}

export function propagationEvaluationContext(
  value: ReadOnlyPropagationEvaluationContext,
): ReadOnlyPropagationEvaluationContext {
  return Object.freeze({
    ...value,
    currentTime: simulationInstant(value.currentTime.seconds, value.currentTime.nanoseconds),
    physicalProperties: value.physicalProperties === undefined
      ? undefined : Object.freeze({ ...value.physicalProperties }),
  });
}

export interface PropagationModel {
  readonly declaration: PropagationModelDeclaration;
  evaluate(target: SimulationInstant, context: ReadOnlyPropagationEvaluationContext): PropagationState;
}

export function evaluatePropagationModel(
  model: PropagationModel,
  target: SimulationInstant,
  context: ReadOnlyPropagationEvaluationContext,
): PropagationState {
  const declaration = propagationModelDeclaration(model.declaration);
  const normalizedTarget = simulationInstant(target.seconds, target.nanoseconds);
  const readOnlyContext = propagationEvaluationContext(context);
  validateTargetDirection(declaration, normalizedTarget);
  let result: PropagationState;
  try {
    result = model.evaluate(normalizedTarget, readOnlyContext);
  } catch (error) {
    if (error instanceof PropagationError) {
      throw error;
    }
    throw new PropagationError(PropagationErrorCode.numericalFailure, "Propagation model evaluation failed", {
      cause: error,
    });
  }
  return assertStateMatches(result, normalizedTarget, declaration.propagationFrame);
}

export interface ReferenceEphemerisSource {
  readonly validity: PropagationTimeInterval;
  readonly direction: "bidirectional" | "bounded";
  readonly propagationFrame: ReferenceFrameId;
  readonly sourceRevision: RevisionId;
  readonly dependencies: readonly PropagationDependency[];
  readonly errorContract: PropagationErrorContract;
  evaluate(target: SimulationInstant, context: ReadOnlyPropagationEvaluationContext): PropagationState;
}

export function createReferenceEphemerisModel(source: ReferenceEphemerisSource): PropagationModel {
  const declaration = propagationModelDeclaration({
    kind: PropagationModelKind.referenceEphemeris,
    validity: source.validity,
    direction: source.direction,
    boundedDirection: source.direction === "bounded" ? "bidirectional" : undefined,
    propagationFrame: source.propagationFrame,
    supportedFrameDynamics: [FrameDynamicsAssumption.inertial],
    dependencies: source.dependencies,
    requiredPhysicalProperties: [],
    configurationRevision: source.sourceRevision,
    errorContract: source.errorContract,
  });
  return Object.freeze({ declaration, evaluate: source.evaluate.bind(source) });
}

export interface AttachedStateResolver {
  resolve(
    attachmentFrame: ReferenceFrameId,
    localState: CartesianState,
    target: SimulationInstant,
    context: ReadOnlyPropagationEvaluationContext,
  ): PropagationState;
}

export interface AttachedModelConfiguration {
  readonly validity: PropagationTimeInterval;
  readonly propagationFrame: ReferenceFrameId;
  readonly attachmentFrame: ReferenceFrameId;
  readonly localState: CartesianState;
  readonly configurationRevision: RevisionId;
  readonly dependencies: readonly PropagationDependency[];
  readonly supportedFrameDynamics?: readonly FrameDynamicsAssumption[];
}

export function createAttachedModel(
  configuration: AttachedModelConfiguration,
  resolver: AttachedStateResolver,
): PropagationModel {
  const declaration = propagationModelDeclaration({
    kind: PropagationModelKind.attached,
    validity: configuration.validity,
    direction: "bounded",
    boundedDirection: "bidirectional",
    propagationFrame: configuration.propagationFrame,
    supportedFrameDynamics: configuration.supportedFrameDynamics ?? [FrameDynamicsAssumption.requiresDerivatives],
    dependencies: configuration.dependencies,
    requiredPhysicalProperties: [],
    configurationRevision: configuration.configurationRevision,
    errorContract: {},
  });
  return Object.freeze({
    declaration,
    evaluate: (target: SimulationInstant, context: ReadOnlyPropagationEvaluationContext) => {
      const localState = {
        ...configuration.localState,
        epoch: target,
      };
      return resolver.resolve(configuration.attachmentFrame, localState, target, context);
    },
  });
}

export interface FrameDynamicsSample {
  readonly epoch: SimulationInstant;
  readonly transform: RigidStateTransform;
  readonly originAcceleration: Vec3<MetersPerSecondSquared>;
  readonly angularAcceleration: Vec3<RadiansPerSecondSquared>;
}

export function frameDynamicsSample(value: FrameDynamicsSample): FrameDynamicsSample {
  const epoch = simulationInstant(value.epoch.seconds, value.epoch.nanoseconds);
  const transform = rigidStateTransform(value.transform);
  if (compareSimulationInstants(transform.epoch, epoch) !== 0) {
    throw new RangeError("Frame dynamics sample transform and sample epoch must match exactly");
  }
  const originAcceleration = Object.freeze({
    x: metersPerSecondSquared(assertFinite(value.originAcceleration.x, "origin acceleration.x")),
    y: metersPerSecondSquared(assertFinite(value.originAcceleration.y, "origin acceleration.y")),
    z: metersPerSecondSquared(assertFinite(value.originAcceleration.z, "origin acceleration.z")),
  });
  const angularAcceleration = Object.freeze({
    x: radiansPerSecondSquared(assertFinite(value.angularAcceleration.x, "angular acceleration.x")),
    y: radiansPerSecondSquared(assertFinite(value.angularAcceleration.y, "angular acceleration.y")),
    z: radiansPerSecondSquared(assertFinite(value.angularAcceleration.z, "angular acceleration.z")),
  });
  return Object.freeze({ epoch, transform, originAcceleration, angularAcceleration });
}

export interface NumericalForceProviderDeclaration {
  readonly id: RevisionId;
  readonly order: number;
  readonly validity: PropagationTimeInterval;
  readonly dependencies: readonly PropagationDependency[];
  readonly propagationFrame: ReferenceFrameId;
  readonly supportedFrameDynamics: readonly FrameDynamicsAssumption[];
  readonly requiresMass: boolean;
}

export interface NumericalForceProviderContext {
  readonly target: SimulationInstant;
  readonly objectId: ObjectId;
  readonly state: PropagationState;
  readonly physicalProperties?: PhysicalProperties;
  readonly mass?: Kilograms;
  readonly frameDynamics?: FrameDynamicsSample;
}

export interface NumericalForceProvider {
  readonly declaration: NumericalForceProviderDeclaration;
  evaluate(context: NumericalForceProviderContext): Vec3<MetersPerSecondSquared>;
}

export interface TimeAwareMassAuthority {
  readonly revision: RevisionId;
  massAt(target: SimulationInstant): Kilograms | undefined;
}

function validateProviderDeclarations(providers: readonly NumericalForceProvider[]): readonly NumericalForceProvider[] {
  const orders = new Set<number>();
  return Object.freeze([...providers].sort((left, right) => left.declaration.order - right.declaration.order).map((provider) => {
    const order = provider.declaration.order;
    if (!Number.isSafeInteger(order) || order < 0 || orders.has(order)) {
      throw new RangeError("Numerical force provider orders must be unique non-negative safe integers");
    }
    orders.add(order);
    if (provider.declaration.supportedFrameDynamics.length === 0) {
      throw new RangeError("Numerical force provider must declare frame dynamics");
    }
    return provider;
  }));
}

export function evaluateOrderedForceProviders(
  providers: readonly NumericalForceProvider[],
  context: NumericalForceProviderContext,
  massAuthority?: TimeAwareMassAuthority,
): Vec3<MetersPerSecondSquared> {
  const ordered = validateProviderDeclarations(providers);
  let x = 0;
  let y = 0;
  let z = 0;
  for (const provider of ordered) {
    if (!containsPropagationTime(provider.declaration.validity, context.target)) {
      fail(PropagationErrorCode.sourceUnavailable, `Force provider ${provider.declaration.id} is outside validity`);
    }
    let mass = context.mass;
    if (mass === undefined && massAuthority !== undefined) {
      mass = massAuthority.massAt(context.target);
    }
    if (provider.declaration.requiresMass && (mass === undefined || mass === 0)) {
      fail(PropagationErrorCode.missingPhysicalProperty, `Force provider ${provider.declaration.id} requires non-zero mass`);
    }
    const contribution = provider.evaluate(Object.freeze({ ...context, mass }));
    x += assertFinite(contribution.x, "force provider acceleration.x");
    y += assertFinite(contribution.y, "force provider acceleration.y");
    z += assertFinite(contribution.z, "force provider acceleration.z");
  }
  return Object.freeze({
    x: metersPerSecondSquared(x),
    y: metersPerSecondSquared(y),
    z: metersPerSecondSquared(z),
  });
}

export interface NumericalModelConfiguration {
  readonly validity: PropagationTimeInterval;
  readonly direction: PropagationDirection;
  readonly boundedDirection?: "forwardOnly" | "bidirectional";
  readonly propagationFrame: ReferenceFrameId;
  readonly supportedFrameDynamics: readonly FrameDynamicsAssumption[];
  readonly dependencies: readonly PropagationDependency[];
  readonly requiredPhysicalProperties: readonly PropagationPropertyRequirement[];
  readonly configurationRevision: RevisionId;
  readonly providers: readonly NumericalForceProvider[];
  readonly massAuthority?: TimeAwareMassAuthority;
}

export function createNumericalModel(
  configuration: NumericalModelConfiguration,
  evaluator?: PropagationModel["evaluate"],
): PropagationModel {
  const declaration = propagationModelDeclaration({
    kind: PropagationModelKind.numerical,
    validity: configuration.validity,
    direction: configuration.direction,
    boundedDirection: configuration.boundedDirection,
    propagationFrame: configuration.propagationFrame,
    supportedFrameDynamics: configuration.supportedFrameDynamics,
    dependencies: configuration.dependencies,
    requiredPhysicalProperties: configuration.requiredPhysicalProperties,
    configurationRevision: configuration.configurationRevision,
    errorContract: {},
  });
  const model = Object.freeze({
    declaration,
    evaluate: evaluator ?? (() => fail(PropagationErrorCode.numericalFailure, "No numerical integrator is installed")),
  });
  validateProviderDeclarations(configuration.providers);
  return model;
}

export interface PropagationFrameResolver {
  resolveTransform(
    fromFrame: ReferenceFrameId,
    toFrame: ReferenceFrameId,
    epoch: SimulationInstant,
  ): RigidStateTransform;
}

function transformPropagationState(
  state: PropagationState,
  outputFrame: ReferenceFrameId,
  resolver: PropagationFrameResolver,
): PropagationState {
  const targetFrame = referenceFrameId(outputFrame);
  if (state.referenceFrame === targetFrame) {
    return state;
  }
  const transform = rigidStateTransform(resolver.resolveTransform(state.referenceFrame, targetFrame, state.epoch));
  if (compareSimulationInstants(transform.epoch, state.epoch) !== 0) {
    fail(PropagationErrorCode.invalidCanonicalState, "Frame resolver returned a different epoch");
  }
  const transformed = transformCartesianState(transform, stateAsCartesian(state));
  return propagationState({
    position: transformed.position,
    velocity: transformed.velocity,
    epoch: transformed.epoch,
    referenceFrame: targetFrame,
  });
}

export function evaluateStateAt(
  model: PropagationModel,
  target: SimulationInstant,
  context: ReadOnlyPropagationEvaluationContext,
  outputFrame?: ReferenceFrameId,
  resolver?: PropagationFrameResolver,
): PropagationState {
  const state = evaluatePropagationModel(model, target, context);
  if (outputFrame === undefined) {
    return state;
  }
  if (resolver === undefined) {
    throw new TypeError("A frame resolver is required for output-frame state queries");
  }
  return transformPropagationState(state, outputFrame, resolver);
}

export interface MotionSegment {
  readonly start: SimulationInstant;
  readonly end?: SimulationInstant;
  readonly modelKind: PropagationModelKind;
  readonly propagationFrame: ReferenceFrameId;
  readonly modelConfigurationRevision: RevisionId;
  readonly motionRevision: RevisionId;
  readonly dependencies: readonly PropagationDependency[];
  readonly model: PropagationModel;
}

export function motionSegment(value: Omit<MotionSegment, "modelKind" | "propagationFrame" | "modelConfigurationRevision" | "dependencies"> & {
  readonly model: PropagationModel;
  readonly start: SimulationInstant;
  readonly end?: SimulationInstant;
  readonly motionRevision: RevisionId;
}): MotionSegment {
  const declaration = propagationModelDeclaration(value.model.declaration);
  const start = simulationInstant(value.start.seconds, value.start.nanoseconds);
  const end = value.end === undefined ? undefined : simulationInstant(value.end.seconds, value.end.nanoseconds);
  if (end !== undefined && compareSimulationInstants(start, end) >= 0) {
    throw new RangeError("Motion segment end must be after start");
  }
  if (!containsPropagationTime(declaration.validity, start)
      || (declaration.validity.end !== undefined
        && end !== undefined && compareSimulationInstants(end, declaration.validity.end) > 0)) {
    throw new RangeError("Motion segment must remain within its model validity domain");
  }
  return Object.freeze({
    start,
    end,
    modelKind: declaration.kind,
    propagationFrame: declaration.propagationFrame,
    modelConfigurationRevision: declaration.configurationRevision,
    motionRevision: revisionId(value.motionRevision),
    dependencies: declaration.dependencies,
    model: value.model,
  });
}

export function containsMotionSegment(segment: MotionSegment, target: SimulationInstant): boolean {
  const effectiveEnd = segment.end ?? segment.model.declaration.validity.end;
  return compareSimulationInstants(target, segment.start) >= 0
    && (effectiveEnd === undefined || compareSimulationInstants(target, effectiveEnd) < 0);
}

export function selectActiveMotionSegment(
  segments: readonly MotionSegment[],
  target: SimulationInstant,
): MotionSegment {
  const matches = segments.filter((segment) => containsMotionSegment(segment, target));
  if (matches.length === 0) {
    fail(PropagationErrorCode.noActiveSegment, "No motion segment covers the requested instant");
  }
  if (matches.length !== 1) {
    fail(PropagationErrorCode.invalidConfiguration, "Motion segments overlap at the requested instant");
  }
  return matches[0]!;
}

export interface SwitchTolerance {
  readonly positionAbsoluteMeters: number;
  readonly positionRelative: number;
  readonly velocityAbsoluteMetersPerSecond: number;
  readonly velocityRelative: number;
}

export function switchTolerance(value: SwitchTolerance): SwitchTolerance {
  return Object.freeze({
    positionAbsoluteMeters: assertNonNegative(value.positionAbsoluteMeters, "positionAbsoluteMeters"),
    positionRelative: assertNonNegative(value.positionRelative, "positionRelative"),
    velocityAbsoluteMetersPerSecond: assertNonNegative(value.velocityAbsoluteMetersPerSecond, "velocityAbsoluteMetersPerSecond"),
    velocityRelative: assertNonNegative(value.velocityRelative, "velocityRelative"),
  });
}

function vectorMagnitude(value: Vec3<number>): number {
  return Math.hypot(value.x, value.y, value.z);
}

function vectorDifference(left: Vec3<number>, right: Vec3<number>): Vec3<number> {
  return {
    x: left.x - right.x,
    y: left.y - right.y,
    z: left.z - right.z,
  };
}

function withinTolerance(
  difference: Vec3<number>,
  expected: Vec3<number>,
  actual: Vec3<number>,
  absolute: number,
  relative: number,
): boolean {
  return vectorMagnitude(difference) <= absolute + relative * Math.max(vectorMagnitude(expected), vectorMagnitude(actual));
}

export function stateWithinSwitchTolerance(
  expected: PropagationState,
  actual: PropagationState,
  tolerance: SwitchTolerance,
): boolean {
  if (compareSimulationInstants(expected.epoch, actual.epoch) !== 0
      || expected.referenceFrame !== actual.referenceFrame) {
    return false;
  }
  return withinTolerance(
    vectorDifference(expected.position, actual.position),
    expected.position,
    actual.position,
    tolerance.positionAbsoluteMeters,
    tolerance.positionRelative,
  ) && withinTolerance(
    vectorDifference(expected.velocity, actual.velocity),
    expected.velocity,
    actual.velocity,
    tolerance.velocityAbsoluteMetersPerSecond,
    tolerance.velocityRelative,
  );
}

export interface SwitchAcceptanceInput {
  readonly handoff: PropagationState;
  readonly candidate: PropagationState;
  readonly target: SimulationInstant;
  readonly candidateModel: PropagationModel;
}

export interface SwitchOptions {
  readonly tolerance: SwitchTolerance;
  readonly frameResolver?: PropagationFrameResolver;
  readonly acceptance?: (input: SwitchAcceptanceInput) => boolean;
  readonly context?: ReadOnlyPropagationEvaluationContext;
}

export interface AuthoritySnapshot {
  readonly segments: readonly MotionSegment[];
  readonly referenceStatus: "none" | "followingReference" | "diverged";
}

export type SwitchResult =
  | {
    readonly ok: true;
    readonly handoff: PropagationState;
    readonly candidate: PropagationState;
    readonly segment: MotionSegment;
    readonly snapshot: AuthoritySnapshot;
  }
  | {
    readonly ok: false;
    readonly error: PropagationError;
    readonly snapshot: AuthoritySnapshot;
  };

function identityResolver(): PropagationFrameResolver {
  return {
    resolveTransform: (fromFrame, toFrame, epoch) => {
      if (fromFrame !== toFrame) {
        fail(PropagationErrorCode.missingDependency, "A frame resolver is required for a cross-frame propagation operation");
      }
      return identityRigidStateTransform(epoch);
    },
  };
}

export class MotionAuthority {
  readonly objectId: ObjectId;
  #segments: MotionSegment[];
  #referenceStatus: "none" | "followingReference" | "diverged";

  constructor(objectId: ObjectId, initialSegment: MotionSegment, referenceStatus?: "none" | "followingReference") {
    this.objectId = objectId;
    this.#segments = [initialSegment];
    this.#referenceStatus = referenceStatus ?? (initialSegment.modelKind === PropagationModelKind.referenceEphemeris
      ? "followingReference" : "none");
  }

  snapshot(): AuthoritySnapshot {
    return Object.freeze({
      segments: Object.freeze([...this.#segments]),
      referenceStatus: this.#referenceStatus,
    });
  }

  segments(): readonly MotionSegment[] {
    return this.snapshot().segments;
  }

  referenceStatus(): AuthoritySnapshot["referenceStatus"] {
    return this.#referenceStatus;
  }

  evaluate(
    target: SimulationInstant,
    context: ReadOnlyPropagationEvaluationContext,
    outputFrame?: ReferenceFrameId,
    resolver?: PropagationFrameResolver,
  ): PropagationState {
    const segment = selectActiveMotionSegment(this.#segments, target);
    return evaluateStateAt(segment.model, target, context, outputFrame, resolver);
  }

  switchModel(
    candidateModel: PropagationModel,
    target: SimulationInstant,
    options: SwitchOptions,
  ): SwitchResult {
    const before = this.snapshot();
    try {
      const oldSegment = selectActiveMotionSegment(this.#segments, target);
      const normalizedTarget = simulationInstant(target.seconds, target.nanoseconds);
      const context = options.context ?? propagationEvaluationContext({
        objectId: this.objectId,
        currentTime: normalizedTarget,
      });
      const handoff = evaluatePropagationModel(oldSegment.model, normalizedTarget, context);
      const resolver = options.frameResolver ?? identityResolver();
      const candidateFrame = referenceFrameId(candidateModel.declaration.propagationFrame);
      const candidateHandoff = transformPropagationState(handoff, candidateFrame, resolver);
      const candidate = evaluatePropagationModel(candidateModel, normalizedTarget, context);
      const tolerance = switchTolerance(options.tolerance);
      if (!stateWithinSwitchTolerance(candidateHandoff, candidate, tolerance)) {
        fail(PropagationErrorCode.switchToleranceExceeded, "Candidate model exceeds switch tolerance");
      }
      if (options.acceptance !== undefined && !options.acceptance({
        handoff: candidateHandoff,
        candidate,
        target: normalizedTarget,
        candidateModel,
      })) {
        fail(PropagationErrorCode.acceptanceRejected, "Candidate model was rejected by the acceptance policy");
      }
      const segment = this.commitCandidate(oldSegment, candidateModel, normalizedTarget, candidateHandoff);
      return { ok: true, handoff: candidateHandoff, candidate, segment, snapshot: this.snapshot() };
    } catch (error) {
      const propagationError = error instanceof PropagationError
        ? error
        : new PropagationError(PropagationErrorCode.invalidConfiguration, "Propagation switch failed", { cause: error });
      return { ok: false, error: propagationError, snapshot: before };
    }
  }

  applyImpulse(
    target: SimulationInstant,
    impulse: CartesianImpulse,
    candidateModel: PropagationModel,
    options: SwitchOptions,
  ): SwitchResult {
    const before = this.snapshot();
    try {
      const oldSegment = selectActiveMotionSegment(this.#segments, target);
      const normalizedTarget = simulationInstant(target.seconds, target.nanoseconds);
      const context = options.context ?? propagationEvaluationContext({ objectId: this.objectId, currentTime: normalizedTarget });
      const state = evaluatePropagationModel(oldSegment.model, normalizedTarget, context);
      const resolver = options.frameResolver ?? identityResolver();
      const postEvent = createImpulseHandoff(state, impulse, resolver);
      const result = this.commitFromHandoff(oldSegment, candidateModel, normalizedTarget, postEvent, options);
      if (!result.ok) {
        return { ok: false, error: result.error, snapshot: before };
      }
      return result;
    } catch (error) {
      return {
        ok: false,
        error: error instanceof PropagationError
          ? error : new PropagationError(PropagationErrorCode.invalidConfiguration, "Impulse application failed", { cause: error }),
        snapshot: before,
      };
    }
  }

  private commitFromHandoff(
    oldSegment: MotionSegment,
    candidateModel: PropagationModel,
    target: SimulationInstant,
    handoff: PropagationState,
    options: SwitchOptions,
  ): SwitchResult {
    const candidate = evaluatePropagationModel(candidateModel, target, options.context ?? propagationEvaluationContext({
      objectId: this.objectId,
      currentTime: target,
    }));
    if (!stateWithinSwitchTolerance(handoff, candidate, switchTolerance(options.tolerance))) {
      return { ok: false, error: new PropagationError(PropagationErrorCode.switchToleranceExceeded, "Impulse candidate exceeds switch tolerance"), snapshot: this.snapshot() };
    }
    if (options.acceptance !== undefined && !options.acceptance({ handoff, candidate, target, candidateModel })) {
      return { ok: false, error: new PropagationError(PropagationErrorCode.acceptanceRejected, "Impulse candidate was rejected"), snapshot: this.snapshot() };
    }
    const segment = this.commitCandidate(oldSegment, candidateModel, target, handoff);
    return { ok: true, handoff, candidate, segment, snapshot: this.snapshot() };
  }

  private commitCandidate(
    oldSegment: MotionSegment,
    candidateModel: PropagationModel,
    target: SimulationInstant,
    _handoff: PropagationState,
  ): MotionSegment {
    const revisions = this.#segments.map((segment) => segment.motionRevision);
    let next = revisions.reduce((largest, value) => value.length > largest.length || (value.length === largest.length && value > largest) ? value : largest, "0" as RevisionId);
    next = incrementRevision(next);
    const retained = this.#segments
      .filter((segment) => compareSimulationInstants(segment.start, target) < 0)
      .map((segment) => {
        if (segment === oldSegment) {
          return motionSegment({ ...segment, end: target });
        }
        return segment;
      })
      .filter((segment) => segment.end === undefined || compareSimulationInstants(segment.end, target) <= 0);
    const newSegment = motionSegment({
      start: target,
      model: candidateModel,
      motionRevision: next,
    });
    this.#segments = [...retained, newSegment].sort((left, right) => compareSimulationInstants(left.start, right.start));
    if (this.#referenceStatus === "followingReference" && candidateModel.declaration.kind !== PropagationModelKind.referenceEphemeris) {
      this.#referenceStatus = "diverged";
    }
    return newSegment;
  }
}

export interface CartesianImpulse {
  readonly epoch: SimulationInstant;
  readonly referenceFrame: ReferenceFrameId;
  readonly deltaPosition?: Vec3<Meters>;
  readonly deltaVelocity: Vec3<MetersPerSecond>;
}

export function createImpulseHandoff(
  state: PropagationState,
  impulse: CartesianImpulse,
  resolver: PropagationFrameResolver,
): PropagationState {
  const epoch = simulationInstant(impulse.epoch.seconds, impulse.epoch.nanoseconds);
  if (compareSimulationInstants(epoch, state.epoch) !== 0) {
    throw new RangeError("Impulse and state must have the same exact epoch");
  }
  const zeroPosition = impulse.deltaPosition ?? { x: meters(0), y: meters(0), z: meters(0) };
  const delta = propagationState({
    position: zeroPosition,
    velocity: impulse.deltaVelocity,
    epoch,
    referenceFrame: referenceFrameId(impulse.referenceFrame),
  });
  const targetFrame = referenceFrameId(state.referenceFrame);
  const sourceFrame = referenceFrameId(impulse.referenceFrame);
  const frameTransform = rigidStateTransform(resolver.resolveTransform(sourceFrame, targetFrame, epoch));
  if (compareSimulationInstants(frameTransform.epoch, epoch) !== 0) {
    throw new RangeError("Impulse frame resolver returned a different epoch");
  }
  const vectorTransform = rigidStateTransform({
    translation: { x: meters(0), y: meters(0), z: meters(0) },
    originVelocity: { x: metersPerSecond(0), y: metersPerSecond(0), z: metersPerSecond(0) },
    rotation: frameTransform.rotation,
    angularVelocity: { x: radiansPerSecond(0), y: radiansPerSecond(0), z: radiansPerSecond(0) },
    epoch,
  });
  const transformedDelta = transformCartesianState(vectorTransform, stateAsCartesian(delta));
  return propagationState({
    position: {
      x: meters(state.position.x + transformedDelta.position.x),
      y: meters(state.position.y + transformedDelta.position.y),
      z: meters(state.position.z + transformedDelta.position.z),
    },
    velocity: {
      x: metersPerSecond(state.velocity.x + transformedDelta.velocity.x),
      y: metersPerSecond(state.velocity.y + transformedDelta.velocity.y),
      z: metersPerSecond(state.velocity.z + transformedDelta.velocity.z),
    },
    epoch,
    referenceFrame: state.referenceFrame,
  });
}

export interface PropagationCacheKey {
  readonly objectId: ObjectId;
  readonly segmentRevision: RevisionId;
  readonly modelConfigurationRevision: RevisionId;
  readonly dependencyRevisions: readonly RevisionId[];
  readonly target: SimulationInstant;
}

function cacheKeyText(key: PropagationCacheKey): string {
  return [
    key.objectId,
    key.segmentRevision,
    key.modelConfigurationRevision,
    ...key.dependencyRevisions,
    `${key.target.seconds}:${key.target.nanoseconds}`,
  ].join("|");
}

export function propagationCacheKey(value: PropagationCacheKey): PropagationCacheKey {
  return Object.freeze({
    objectId: value.objectId,
    segmentRevision: revisionId(value.segmentRevision),
    modelConfigurationRevision: revisionId(value.modelConfigurationRevision),
    dependencyRevisions: Object.freeze(value.dependencyRevisions.map((revision) => revisionId(revision))),
    target: simulationInstant(value.target.seconds, value.target.nanoseconds),
  });
}

export class PropagationCache {
  readonly #maxEntries: number;
  readonly #entries = new Map<string, { key: PropagationCacheKey; state: PropagationState }>();

  constructor(maxEntries = 256) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries <= 0) {
      throw new RangeError("Propagation cache maxEntries must be a positive safe integer");
    }
    this.#maxEntries = maxEntries;
  }

  get(key: PropagationCacheKey): PropagationState | undefined {
    const normalized = propagationCacheKey(key);
    const entry = this.#entries.get(cacheKeyText(normalized));
    return entry?.state;
  }

  set(key: PropagationCacheKey, state: PropagationState): void {
    const normalized = propagationCacheKey(key);
    const value = propagationState(state);
    const text = cacheKeyText(normalized);
    this.#entries.delete(text);
    this.#entries.set(text, { key: normalized, state: value });
    while (this.#entries.size > this.#maxEntries) {
      const first = this.#entries.keys().next().value as string | undefined;
      if (first === undefined) break;
      this.#entries.delete(first);
    }
  }

  invalidateFrom(target: SimulationInstant): void {
    const normalized = simulationInstant(target.seconds, target.nanoseconds);
    for (const [text, entry] of this.#entries) {
      if (compareSimulationInstants(entry.key.target, normalized) >= 0) {
        this.#entries.delete(text);
      }
    }
  }

  clear(): void {
    this.#entries.clear();
  }

  get size(): number {
    return this.#entries.size;
  }
}

export interface PropagationDependencyGraph {
  readonly edges: ReadonlyMap<string, readonly string[]>;
}

export function validateAcyclicPropagationDependencies(
  edges: ReadonlyMap<string, readonly string[]>,
): PropagationDependencyGraph {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (node: string): void => {
    if (visiting.has(node)) {
      fail(PropagationErrorCode.dependencyCycle, `Propagation dependency cycle detected at ${node}`);
    }
    if (visited.has(node)) return;
    visiting.add(node);
    for (const dependency of edges.get(node) ?? []) visit(dependency);
    visiting.delete(node);
    visited.add(node);
  };
  for (const node of edges.keys()) visit(node);
  return Object.freeze({ edges });
}

export const createRevisionId = revisionId;
export const createPropagationTimeInterval = propagationTimeInterval;
export const createPropagationState = propagationState;
export const createMotionSegment = motionSegment;
export const selectActiveSegment = selectActiveMotionSegment;
export const createSwitchTolerance = switchTolerance;
export const createPropagationCacheKey = propagationCacheKey;
