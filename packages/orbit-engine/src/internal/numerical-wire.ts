import { validateTimeWire, type TimeWire } from "./time-wire.js";

export interface NumericalWire {
  readonly resultCode: number;
  readonly objectIdHigh: number;
  readonly objectIdLow: number;
  readonly propagationFrameHigh: number;
  readonly propagationFrameLow: number;
  readonly frameRevisionHigh: number;
  readonly frameRevisionLow: number;
  readonly anchorEpoch: TimeWire;
  readonly targetEpoch: TimeWire;
  readonly anchorPositionX: number;
  readonly anchorPositionY: number;
  readonly anchorPositionZ: number;
  readonly anchorVelocityX: number;
  readonly anchorVelocityY: number;
  readonly anchorVelocityZ: number;
  readonly massPresent: boolean;
  readonly mass: number;
  readonly constantAccelerationX: number;
  readonly constantAccelerationY: number;
  readonly constantAccelerationZ: number;
  readonly sourcePresent: boolean;
  readonly sourceIdHigh: number;
  readonly sourceIdLow: number;
  readonly sourceRevisionHigh: number;
  readonly sourceRevisionLow: number;
  readonly sourcePositionX: number;
  readonly sourcePositionY: number;
  readonly sourcePositionZ: number;
  readonly sourceMuPresent: boolean;
  readonly sourceMu: number;
  readonly sourceMassPresent: boolean;
  readonly sourceMass: number;
  readonly relativeTolerance: number;
  readonly positionAbsoluteToleranceMeters: number;
  readonly velocityAbsoluteToleranceMetersPerSecond: number;
  readonly massAbsoluteToleranceKilograms: number;
  readonly checkpointStrideAcceptedSteps: number;
  readonly maxCheckpointCount: number;
  readonly maxDenseStepCount: number;
  readonly maxAcceptedStepsPerExtension: number;
  readonly maxRejectedStepsPerExtension: number;
  readonly minStep: TimeWire;
  readonly maxStep: TimeWire;
  readonly configurationRevisionHigh: number;
  readonly configurationRevisionLow: number;
  readonly motionRevisionHigh: number;
  readonly motionRevisionLow: number;
  readonly resultEpoch: TimeWire;
  readonly resultPositionX: number;
  readonly resultPositionY: number;
  readonly resultPositionZ: number;
  readonly resultVelocityX: number;
  readonly resultVelocityY: number;
  readonly resultVelocityZ: number;
  readonly resultMassPresent: boolean;
  readonly resultMass: number;
}

function integer(value: unknown, name: string, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} is outside its integer range`);
  }
  return value;
}

function finite(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  return value;
}

function boolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") throw new TypeError(`${name} must be boolean`);
  return value;
}

export function validateNumericalWire(value: unknown): NumericalWire {
  if (typeof value !== "object" || value === null) throw new TypeError("numerical wire value must be an object");
  const candidate = value as Record<string, unknown>;
  const readTime = (name: string) => validateTimeWire(candidate[name]);
  const result = {
    resultCode: integer(candidate.resultCode, "numerical resultCode", 0, 65_535),
    objectIdHigh: integer(candidate.objectIdHigh, "numerical objectIdHigh", 0, 4_294_967_295),
    objectIdLow: integer(candidate.objectIdLow, "numerical objectIdLow", 0, 4_294_967_295),
    propagationFrameHigh: integer(candidate.propagationFrameHigh, "numerical propagationFrameHigh", 0, 4_294_967_295),
    propagationFrameLow: integer(candidate.propagationFrameLow, "numerical propagationFrameLow", 0, 4_294_967_295),
    frameRevisionHigh: integer(candidate.frameRevisionHigh, "numerical frameRevisionHigh", 0, 4_294_967_295),
    frameRevisionLow: integer(candidate.frameRevisionLow, "numerical frameRevisionLow", 0, 4_294_967_295),
    anchorEpoch: readTime("anchorEpoch"), targetEpoch: readTime("targetEpoch"),
    anchorPositionX: finite(candidate.anchorPositionX, "anchorPositionX"), anchorPositionY: finite(candidate.anchorPositionY, "anchorPositionY"), anchorPositionZ: finite(candidate.anchorPositionZ, "anchorPositionZ"),
    anchorVelocityX: finite(candidate.anchorVelocityX, "anchorVelocityX"), anchorVelocityY: finite(candidate.anchorVelocityY, "anchorVelocityY"), anchorVelocityZ: finite(candidate.anchorVelocityZ, "anchorVelocityZ"),
    massPresent: boolean(candidate.massPresent, "massPresent"), mass: finite(candidate.mass, "mass"),
    constantAccelerationX: finite(candidate.constantAccelerationX, "constantAccelerationX"), constantAccelerationY: finite(candidate.constantAccelerationY, "constantAccelerationY"), constantAccelerationZ: finite(candidate.constantAccelerationZ, "constantAccelerationZ"),
    sourcePresent: boolean(candidate.sourcePresent, "sourcePresent"), sourceIdHigh: integer(candidate.sourceIdHigh, "sourceIdHigh", 0, 4_294_967_295), sourceIdLow: integer(candidate.sourceIdLow, "sourceIdLow", 0, 4_294_967_295), sourceRevisionHigh: integer(candidate.sourceRevisionHigh, "sourceRevisionHigh", 0, 4_294_967_295), sourceRevisionLow: integer(candidate.sourceRevisionLow, "sourceRevisionLow", 0, 4_294_967_295),
    sourcePositionX: finite(candidate.sourcePositionX, "sourcePositionX"), sourcePositionY: finite(candidate.sourcePositionY, "sourcePositionY"), sourcePositionZ: finite(candidate.sourcePositionZ, "sourcePositionZ"),
    sourceMuPresent: boolean(candidate.sourceMuPresent, "sourceMuPresent"), sourceMu: finite(candidate.sourceMu, "sourceMu"), sourceMassPresent: boolean(candidate.sourceMassPresent, "sourceMassPresent"), sourceMass: finite(candidate.sourceMass, "sourceMass"),
    relativeTolerance: finite(candidate.relativeTolerance, "relativeTolerance"), positionAbsoluteToleranceMeters: finite(candidate.positionAbsoluteToleranceMeters, "positionAbsoluteToleranceMeters"), velocityAbsoluteToleranceMetersPerSecond: finite(candidate.velocityAbsoluteToleranceMetersPerSecond, "velocityAbsoluteToleranceMetersPerSecond"),
    massAbsoluteToleranceKilograms: finite(candidate.massAbsoluteToleranceKilograms, "massAbsoluteToleranceKilograms"), checkpointStrideAcceptedSteps: integer(candidate.checkpointStrideAcceptedSteps, "checkpointStrideAcceptedSteps", 1, 4_294_967_295), maxCheckpointCount: integer(candidate.maxCheckpointCount, "maxCheckpointCount", 1, 4_294_967_295), maxDenseStepCount: integer(candidate.maxDenseStepCount, "maxDenseStepCount", 1, 4_294_967_295), maxAcceptedStepsPerExtension: integer(candidate.maxAcceptedStepsPerExtension, "maxAcceptedStepsPerExtension", 1, 4_294_967_295), maxRejectedStepsPerExtension: integer(candidate.maxRejectedStepsPerExtension, "maxRejectedStepsPerExtension", 1, 4_294_967_295),
    minStep: readTime("minStep"), maxStep: readTime("maxStep"),
    configurationRevisionHigh: integer(candidate.configurationRevisionHigh, "configurationRevisionHigh", 0, 4_294_967_295), configurationRevisionLow: integer(candidate.configurationRevisionLow, "configurationRevisionLow", 0, 4_294_967_295),
    motionRevisionHigh: integer(candidate.motionRevisionHigh, "motionRevisionHigh", 0, 4_294_967_295), motionRevisionLow: integer(candidate.motionRevisionLow, "motionRevisionLow", 0, 4_294_967_295),
    resultEpoch: readTime("resultEpoch"), resultPositionX: finite(candidate.resultPositionX, "resultPositionX"), resultPositionY: finite(candidate.resultPositionY, "resultPositionY"), resultPositionZ: finite(candidate.resultPositionZ, "resultPositionZ"),
    resultVelocityX: finite(candidate.resultVelocityX, "resultVelocityX"), resultVelocityY: finite(candidate.resultVelocityY, "resultVelocityY"), resultVelocityZ: finite(candidate.resultVelocityZ, "resultVelocityZ"), resultMassPresent: boolean(candidate.resultMassPresent, "resultMassPresent"), resultMass: finite(candidate.resultMass, "resultMass"),
  } satisfies NumericalWire;
  return Object.freeze(result);
}
