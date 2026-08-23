import type { Backend } from "./internal/backends/contract.js";
import {
  decodeSimulationInstant,
  encodeDuration,
  encodeSimulationInstant,
} from "./internal/time-wire.js";
import { objectId, type ObjectId } from "./objects.js";
import { objectIdToWire } from "./internal/object-wire.js";
import { validateNumericalWire, type NumericalWire } from "./internal/numerical-wire.js";
import {
  FrameDynamicsAssumption,
  PropagationError,
  PropagationErrorCode,
  PropagationModelKind,
  propagationModelDeclaration,
  propagationState,
  revisionId,
  type PropagationErrorContract,
  type PropagationModel,
  type PropagationState,
  type ReadOnlyPropagationEvaluationContext,
  type RevisionId,
} from "./propagation.js";
import { referenceFrameId, type ReferenceFrameId, type Vec3 } from "./frames.js";
import {
  compareSimulationInstants,
  duration,
  simulationInstant,
  type Duration,
  type SimulationInstant,
} from "./time.js";
import {
  gravitationalParameter,
  type GravitationalParameter,
} from "./properties.js";
import {
  kilograms,
  meters,
  metersPerSecond,
  metersPerSecondSquared,
  type Kilograms,
  type Meters,
  type MetersPerSecondSquared,
} from "./units.js";

const UINT32_BASE = 4_294_967_296;
const DEFAULT_NUMERICAL_WORK_BUDGET = Object.freeze({
  checkpointStrideAcceptedSteps: 32,
  maxCheckpointCount: 64,
  maxDenseStepCount: 256,
  maxAcceptedStepsPerExtension: 100_000,
  maxRejectedStepsPerExtension: 10_000,
});

export const NumericalResultCode = Object.freeze({
  success: 0,
  invalidInput: 1,
  unsupportedTemporalDirection: 2,
  invalidConfiguration: 3,
  numericalFailure: 4,
  invalidMass: 5,
  stepUnderflow: 6,
  acceptedStepBudget: 7,
  rejectedStepBudget: 8,
} as const);

export interface NumericalGravitySource {
  readonly objectId: ObjectId;
  readonly revision: RevisionId;
  readonly position: Vec3<Meters>;
  readonly mu?: GravitationalParameter;
  readonly mass?: Kilograms;
}

export interface NumericalMotionConfiguration {
  readonly objectId: ObjectId;
  readonly anchor: PropagationState;
  readonly configurationRevision: RevisionId;
  readonly motionRevision: RevisionId;
  readonly relativeTolerance: number;
  readonly positionAbsoluteToleranceMeters: number;
  readonly velocityAbsoluteToleranceMetersPerSecond: number;
  readonly massAbsoluteToleranceKilograms?: number;
  readonly checkpointStrideAcceptedSteps?: number;
  readonly maxCheckpointCount?: number;
  readonly maxDenseStepCount?: number;
  readonly maxAcceptedStepsPerExtension?: number;
  readonly maxRejectedStepsPerExtension?: number;
  readonly minStep: Duration;
  readonly maxStep: Duration;
  readonly mass?: Kilograms;
  readonly constantAcceleration?: Vec3<MetersPerSecondSquared>;
  readonly gravitySource?: NumericalGravitySource;
  readonly frameRevision?: RevisionId;
}

export interface NumericalMotionStatus {
  readonly kind: "numerical";
  readonly objectId: ObjectId;
  readonly propagationFrame: ReferenceFrameId;
  readonly anchorEpoch: SimulationInstant;
  readonly configurationRevision: RevisionId;
  readonly motionRevision: RevisionId;
  readonly backend: "native" | "wasm";
}

interface NormalizedConfiguration {
  readonly objectId: ObjectId;
  readonly anchor: PropagationState;
  readonly propagationFrame: ReferenceFrameId;
  readonly configurationRevision: RevisionId;
  readonly motionRevision: RevisionId;
  readonly relativeTolerance: number;
  readonly positionAbsoluteToleranceMeters: number;
  readonly velocityAbsoluteToleranceMetersPerSecond: number;
  readonly massAbsoluteToleranceKilograms: number;
  readonly checkpointStrideAcceptedSteps: number;
  readonly maxCheckpointCount: number;
  readonly maxDenseStepCount: number;
  readonly maxAcceptedStepsPerExtension: number;
  readonly maxRejectedStepsPerExtension: number;
  readonly minStep: Duration;
  readonly maxStep: Duration;
  readonly mass?: Kilograms;
  readonly constantAcceleration: Vec3<MetersPerSecondSquared>;
  readonly gravitySource?: NumericalGravitySource;
  readonly frameRevision: RevisionId;
}

function finite(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be finite`);
  }
  return value;
}

function positive(value: unknown, name: string): number {
  const result = finite(value, name);
  if (result <= 0) throw new RangeError(`${name} must be greater than zero`);
  return result;
}

function positiveInteger(value: unknown, name: string, fallback: number): number {
  const result = value === undefined ? fallback : finite(value, name);
  if (!Number.isInteger(result) || result < 1 || result > 4_294_967_295) {
    throw new RangeError(`${name} must be a positive uint32`);
  }
  return result;
}

function nonNegativeDuration(value: Duration, name: string): Duration {
  const result = duration(value.seconds, value.nanoseconds);
  if (result.seconds < 0) throw new RangeError(`${name} must be non-negative`);
  return result;
}

function positiveDuration(value: Duration, name: string): Duration {
  const result = nonNegativeDuration(value, name);
  if (result.seconds === 0 && result.nanoseconds === 0) {
    throw new RangeError(`${name} must be greater than zero`);
  }
  return result;
}

function uint64Words(value: string, name: string): { readonly high: number; readonly low: number } {
  if (typeof value !== "string" || !/^\d+$/.test(value) || value.length > 20
      || (value.length === 20 && value > "18446744073709551615")) {
    throw new RangeError(`${name} must be canonical uint64 decimal text`);
  }
  let high = 0;
  let low = 0;
  for (const character of value) {
    const product = low * 10 + character.charCodeAt(0) - 48;
    low = product % UINT32_BASE;
    high = high * 10 + Math.floor(product / UINT32_BASE);
  }
  if (high >= UINT32_BASE) throw new RangeError(`${name} exceeds uint64 range`);
  return { high, low };
}

function vector<T extends number>(value: Vec3<T> | undefined, name: string, wrap: (number: number) => T): Vec3<T> {
  if (value === undefined) return Object.freeze({ x: wrap(0), y: wrap(0), z: wrap(0) });
  return Object.freeze({
    x: wrap(finite(value.x, `${name}.x`)),
    y: wrap(finite(value.y, `${name}.y`)),
    z: wrap(finite(value.z, `${name}.z`)),
  });
}

function normalizeConfiguration(value: NumericalMotionConfiguration): NormalizedConfiguration {
  if (typeof value !== "object" || value === null) throw new TypeError("Numerical motion configuration must be an object");
  const object = objectId(value.objectId);
  const anchor = propagationState(value.anchor);
  const propagationFrame = referenceFrameId(anchor.referenceFrame);
  const configurationRevision = revisionId(value.configurationRevision);
  const motionRevision = revisionId(value.motionRevision);
  if (motionRevision === "0") throw new RangeError("motionRevision must be non-zero");
  const minStep = positiveDuration(value.minStep, "minStep");
  const maxStep = positiveDuration(value.maxStep, "maxStep");
  if (maxStep.seconds < minStep.seconds
      || (maxStep.seconds === minStep.seconds && maxStep.nanoseconds < minStep.nanoseconds)) {
    throw new RangeError("maxStep must be greater than or equal to minStep");
  }
  const mass = value.mass === undefined ? undefined : kilograms(finite(value.mass, "mass"));
  if (mass !== undefined && mass < 0) throw new RangeError("mass must be non-negative");
  const gravitySource = value.gravitySource === undefined ? undefined : (() => {
    const source = value.gravitySource;
    const sourceId = objectId(source.objectId);
    const sourceRevision = revisionId(source.revision);
    const position = vector(source.position, "gravitySource.position", meters);
    const mu = source.mu === undefined ? undefined : gravitationalParameter(finite(source.mu, "gravitySource.mu"));
    const sourceMass = source.mass === undefined ? undefined : kilograms(finite(source.mass, "gravitySource.mass"));
    if (sourceMass !== undefined && sourceMass < 0) throw new RangeError("gravitySource.mass must be non-negative");
    if (mu === undefined && sourceMass === undefined) {
      throw new RangeError("gravitySource requires mu or mass");
    }
    return Object.freeze({ objectId: sourceId, revision: sourceRevision, position, mu, mass: sourceMass });
  })();
  return Object.freeze({
    objectId: object,
    anchor,
    propagationFrame,
    configurationRevision,
    motionRevision,
    relativeTolerance: positive(value.relativeTolerance, "relativeTolerance"),
    positionAbsoluteToleranceMeters: positive(value.positionAbsoluteToleranceMeters, "positionAbsoluteToleranceMeters"),
    velocityAbsoluteToleranceMetersPerSecond: positive(
      value.velocityAbsoluteToleranceMetersPerSecond,
      "velocityAbsoluteToleranceMetersPerSecond",
    ),
    massAbsoluteToleranceKilograms: positive(
      value.massAbsoluteToleranceKilograms ?? 1e-6,
      "massAbsoluteToleranceKilograms",
    ),
    checkpointStrideAcceptedSteps: positiveInteger(
      value.checkpointStrideAcceptedSteps,
      "checkpointStrideAcceptedSteps",
      DEFAULT_NUMERICAL_WORK_BUDGET.checkpointStrideAcceptedSteps,
    ),
    maxCheckpointCount: positiveInteger(
      value.maxCheckpointCount,
      "maxCheckpointCount",
      DEFAULT_NUMERICAL_WORK_BUDGET.maxCheckpointCount,
    ),
    maxDenseStepCount: positiveInteger(
      value.maxDenseStepCount,
      "maxDenseStepCount",
      DEFAULT_NUMERICAL_WORK_BUDGET.maxDenseStepCount,
    ),
    maxAcceptedStepsPerExtension: positiveInteger(
      value.maxAcceptedStepsPerExtension,
      "maxAcceptedStepsPerExtension",
      DEFAULT_NUMERICAL_WORK_BUDGET.maxAcceptedStepsPerExtension,
    ),
    maxRejectedStepsPerExtension: positiveInteger(
      value.maxRejectedStepsPerExtension,
      "maxRejectedStepsPerExtension",
      DEFAULT_NUMERICAL_WORK_BUDGET.maxRejectedStepsPerExtension,
    ),
    minStep,
    maxStep,
    ...(mass === undefined ? {} : { mass }),
    constantAcceleration: vector(value.constantAcceleration, "constantAcceleration", metersPerSecondSquared),
    ...(gravitySource === undefined ? {} : { gravitySource }),
    frameRevision: revisionId(value.frameRevision ?? configurationRevision),
  });
}

function mapResultError(code: number): PropagationError {
  if (code === NumericalResultCode.unsupportedTemporalDirection) {
    return new PropagationError(PropagationErrorCode.unsupportedTemporalDirection, "Numerical propagation does not support backward queries");
  }
  if (code === NumericalResultCode.invalidInput
      || code === NumericalResultCode.invalidConfiguration
      || code === NumericalResultCode.invalidMass) {
    return new PropagationError(PropagationErrorCode.invalidConfiguration, "Numerical propagation configuration was rejected", { resultCode: code });
  }
  if (code === NumericalResultCode.numericalFailure) {
    return new PropagationError(PropagationErrorCode.numericalFailure, "Numerical propagation failed to converge", { resultCode: code });
  }
  if (code === NumericalResultCode.stepUnderflow) {
    return new PropagationError(PropagationErrorCode.numericalStepUnderflow, "Numerical propagation requires a step below the configured minimum or exact time resolution", { resultCode: code });
  }
  if (code === NumericalResultCode.acceptedStepBudget || code === NumericalResultCode.rejectedStepBudget) {
    return new PropagationError(PropagationErrorCode.numericalWorkBudgetExceeded, "Numerical propagation exhausted its configured work budget", { resultCode: code });
  }
  return new PropagationError(PropagationErrorCode.invalidModelRepresentation, "Numerical propagation returned an invalid result", { resultCode: code });
}

function encodeWire(configuration: NormalizedConfiguration, target: SimulationInstant): NumericalWire {
  const objectWords = objectIdToWire(configuration.objectId);
  const frameWords = objectIdToWire(configuration.propagationFrame as unknown as ObjectId);
  const configurationWords = uint64Words(configuration.configurationRevision, "configurationRevision");
  const motionWords = uint64Words(configuration.motionRevision, "motionRevision");
  const frameRevisionWords = uint64Words(configuration.frameRevision, "frameRevision");
  const sourceWords = configuration.gravitySource === undefined
    ? { high: 0, low: 0 }
    : (() => {
      const words = objectIdToWire(configuration.gravitySource.objectId);
      return { high: words.objectIdHigh, low: words.objectIdLow };
    })();
  const sourceRevisionWords = configuration.gravitySource === undefined
    ? { high: 0, low: 0 }
    : uint64Words(configuration.gravitySource.revision, "gravitySource.revision");
  const massPresent = configuration.mass !== undefined;
  const sourceMuPresent = configuration.gravitySource?.mu !== undefined;
  const sourceMassPresent = configuration.gravitySource?.mass !== undefined;
  const targetEpoch = encodeSimulationInstant(target);
  return validateNumericalWire({
    resultCode: NumericalResultCode.success,
    objectIdHigh: objectWords.objectIdHigh,
    objectIdLow: objectWords.objectIdLow,
    propagationFrameHigh: frameWords.objectIdHigh,
    propagationFrameLow: frameWords.objectIdLow,
    frameRevisionHigh: frameRevisionWords.high,
    frameRevisionLow: frameRevisionWords.low,
    anchorEpoch: encodeSimulationInstant(configuration.anchor.epoch),
    targetEpoch,
    anchorPositionX: configuration.anchor.position.x,
    anchorPositionY: configuration.anchor.position.y,
    anchorPositionZ: configuration.anchor.position.z,
    anchorVelocityX: configuration.anchor.velocity.x,
    anchorVelocityY: configuration.anchor.velocity.y,
    anchorVelocityZ: configuration.anchor.velocity.z,
    massPresent,
    mass: configuration.mass ?? 0,
    constantAccelerationX: configuration.constantAcceleration.x,
    constantAccelerationY: configuration.constantAcceleration.y,
    constantAccelerationZ: configuration.constantAcceleration.z,
    sourcePresent: configuration.gravitySource !== undefined,
    sourceIdHigh: sourceWords.high,
    sourceIdLow: sourceWords.low,
    sourceRevisionHigh: sourceRevisionWords.high,
    sourceRevisionLow: sourceRevisionWords.low,
    sourcePositionX: configuration.gravitySource?.position.x ?? 0,
    sourcePositionY: configuration.gravitySource?.position.y ?? 0,
    sourcePositionZ: configuration.gravitySource?.position.z ?? 0,
    sourceMuPresent,
    sourceMu: configuration.gravitySource?.mu ?? 0,
    sourceMassPresent,
    sourceMass: configuration.gravitySource?.mass ?? 0,
    relativeTolerance: configuration.relativeTolerance,
    positionAbsoluteToleranceMeters: configuration.positionAbsoluteToleranceMeters,
    velocityAbsoluteToleranceMetersPerSecond: configuration.velocityAbsoluteToleranceMetersPerSecond,
    massAbsoluteToleranceKilograms: configuration.massAbsoluteToleranceKilograms,
    checkpointStrideAcceptedSteps: configuration.checkpointStrideAcceptedSteps,
    maxCheckpointCount: configuration.maxCheckpointCount,
    maxDenseStepCount: configuration.maxDenseStepCount,
    maxAcceptedStepsPerExtension: configuration.maxAcceptedStepsPerExtension,
    maxRejectedStepsPerExtension: configuration.maxRejectedStepsPerExtension,
    minStep: encodeDuration(configuration.minStep),
    maxStep: encodeDuration(configuration.maxStep),
    configurationRevisionHigh: configurationWords.high,
    configurationRevisionLow: configurationWords.low,
    motionRevisionHigh: motionWords.high,
    motionRevisionLow: motionWords.low,
    resultEpoch: targetEpoch,
    resultPositionX: configuration.anchor.position.x,
    resultPositionY: configuration.anchor.position.y,
    resultPositionZ: configuration.anchor.position.z,
    resultVelocityX: configuration.anchor.velocity.x,
    resultVelocityY: configuration.anchor.velocity.y,
    resultVelocityZ: configuration.anchor.velocity.z,
    resultMassPresent: massPresent,
    resultMass: configuration.mass ?? 0,
  });
}

function decodeState(value: NumericalWire, frame: ReferenceFrameId): PropagationState {
  return propagationState({
    position: { x: meters(value.resultPositionX), y: meters(value.resultPositionY), z: meters(value.resultPositionZ) },
    velocity: {
      x: metersPerSecond(value.resultVelocityX),
      y: metersPerSecond(value.resultVelocityY),
      z: metersPerSecond(value.resultVelocityZ),
    },
    epoch: decodeSimulationInstant(value.resultEpoch),
    referenceFrame: frame,
  });
}

export class NumericalMotion {
  readonly #configuration: NormalizedConfiguration;
  readonly #backend: Backend;
  readonly #declaration: ReturnType<typeof propagationModelDeclaration>;

  protected constructor(configuration: NumericalMotionConfiguration, backend: unknown) {
    this.#configuration = normalizeConfiguration(configuration);
    this.#backend = backend as Backend;
    const dependencies = [
      { kind: "object" as const, id: this.#configuration.objectId, revision: this.#configuration.motionRevision },
      ...(this.#configuration.gravitySource === undefined ? [] : [
        { kind: "object" as const, id: this.#configuration.gravitySource.objectId, revision: this.#configuration.gravitySource.revision },
      ]),
    ];
    this.#declaration = propagationModelDeclaration({
      kind: PropagationModelKind.numerical,
      validity: { start: this.#configuration.anchor.epoch },
      direction: "forwardOnly",
      propagationFrame: this.#configuration.propagationFrame,
      supportedFrameDynamics: [FrameDynamicsAssumption.inertial],
      dependencies,
      requiredPhysicalProperties: [],
      configurationRevision: this.#configuration.configurationRevision,
      errorContract: {
        positionAbsoluteMeters: this.#configuration.positionAbsoluteToleranceMeters,
        velocityAbsoluteMetersPerSecond: this.#configuration.velocityAbsoluteToleranceMetersPerSecond,
        notes: "Portable-core DOP853 evaluation with strict f64 wire values.",
      } satisfies PropagationErrorContract,
    });
  }

  get configuration(): NumericalMotionConfiguration {
    return this.#configuration;
  }

  declaration(): ReturnType<typeof propagationModelDeclaration> {
    return this.#declaration;
  }

  status(): NumericalMotionStatus {
    return Object.freeze({
      kind: "numerical",
      objectId: this.#configuration.objectId,
      propagationFrame: this.#configuration.propagationFrame,
      anchorEpoch: this.#configuration.anchor.epoch,
      configurationRevision: this.#configuration.configurationRevision,
      motionRevision: this.#configuration.motionRevision,
      backend: this.#backend.kind,
    });
  }

  stateAt(target: SimulationInstant): PropagationState {
    const normalizedTarget = simulationInstant(target.seconds, target.nanoseconds);
    if (compareSimulationInstants(normalizedTarget, this.#configuration.anchor.epoch) < 0) {
      throw mapResultError(NumericalResultCode.unsupportedTemporalDirection);
    }
    const result = validateNumericalWire(this.#backend.roundTripNumerical(encodeWire(this.#configuration, normalizedTarget)));
    if (result.resultCode !== NumericalResultCode.success) throw mapResultError(result.resultCode);
    const state = decodeState(result, this.#configuration.propagationFrame);
    if (compareSimulationInstants(state.epoch, normalizedTarget) !== 0) {
      throw new PropagationError(PropagationErrorCode.invalidCanonicalState, "Numerical result epoch does not equal its target");
    }
    return state;
  }

  massAt(target: SimulationInstant): Kilograms | undefined {
    if (this.#configuration.mass === undefined) return undefined;
    const normalizedTarget = simulationInstant(target.seconds, target.nanoseconds);
    const result = validateNumericalWire(this.#backend.roundTripNumerical(encodeWire(this.#configuration, normalizedTarget)));
    if (result.resultCode !== NumericalResultCode.success) throw mapResultError(result.resultCode);
    return result.resultMassPresent ? kilograms(result.resultMass) : undefined;
  }

  model(): PropagationModel {
    return Object.freeze({
      declaration: this.#declaration,
      evaluate: (target: SimulationInstant, context: ReadOnlyPropagationEvaluationContext) => {
        if (context.objectId !== undefined && context.objectId !== this.#configuration.objectId) {
          throw new PropagationError(PropagationErrorCode.invalidConfiguration, "Numerical model is bound to a different object");
        }
        return this.stateAt(target);
      },
    });
  }
}

class BoundNumericalMotion extends NumericalMotion {
  constructor(configuration: NumericalMotionConfiguration, backend: Backend) {
    super(configuration, backend);
  }
}

export function createNumericalMotion(
  configuration: NumericalMotionConfiguration,
  backend: Backend,
): NumericalMotion {
  return new BoundNumericalMotion(configuration, backend);
}
