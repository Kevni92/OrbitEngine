import { validateTimeWire, type TimeWire } from "./time-wire.js";

export interface CoupledMemberWire {
  readonly objectIdHigh: number; readonly objectIdLow: number; readonly epoch: TimeWire;
  readonly frameHigh: number; readonly frameLow: number;
  readonly positionX: number; readonly positionY: number; readonly positionZ: number;
  readonly velocityX: number; readonly velocityY: number; readonly velocityZ: number;
  readonly massPresent: boolean; readonly mass: number; readonly muPresent: boolean; readonly mu: number;
  readonly motionRevisionHigh: number; readonly motionRevisionLow: number;
  readonly propertyRevisionHigh: number; readonly propertyRevisionLow: number;
  readonly massRevisionHigh: number; readonly massRevisionLow: number;
}

export interface CoupledWire {
  readonly resultCode: number; readonly operationCode: number; readonly targetEpoch: TimeWire;
  readonly authorityIdHigh: number; readonly authorityIdLow: number;
  readonly groupRevisionHigh: number; readonly groupRevisionLow: number;
  readonly memberCount: number; readonly members: readonly CoupledMemberWire[];
  readonly requestedCount: number; readonly requestedIds: readonly { readonly high: number; readonly low: number }[];
  readonly configurationRevisionHigh: number; readonly configurationRevisionLow: number;
  readonly relativeTolerance: number; readonly positionAbsoluteToleranceMeters: number;
  readonly velocityAbsoluteToleranceMetersPerSecond: number; readonly massAbsoluteToleranceKilograms: number;
  readonly checkpointStrideAcceptedSteps: number; readonly maxCheckpointCount: number;
  readonly maxDenseStepCount: number; readonly maxAcceptedStepsPerExtension: number; readonly maxRejectedStepsPerExtension: number;
  readonly minStep: TimeWire; readonly maxStep: TimeWire;
  readonly constantAccelerationX: number; readonly constantAccelerationY: number; readonly constantAccelerationZ: number;
  readonly resultCount: number; readonly results: readonly CoupledMemberWire[];
  readonly sharedEvaluationCountHigh: number; readonly sharedEvaluationCountLow: number;
}

function integer(value: unknown, name: string, minimum = 0, maximum = 4_294_967_295): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > maximum) throw new RangeError(`${name} is outside its integer range`);
  return value;
}
function finite(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${name} must be finite`); return value;
}
function member(value: unknown): CoupledMemberWire {
  if (typeof value !== "object" || value === null) throw new TypeError("coupled member wire must be an object");
  const v = value as Record<string, unknown>;
  const result = {
    objectIdHigh: integer(v.objectIdHigh, "objectIdHigh"), objectIdLow: integer(v.objectIdLow, "objectIdLow"), epoch: validateTimeWire(v.epoch),
    frameHigh: integer(v.frameHigh, "frameHigh"), frameLow: integer(v.frameLow, "frameLow"),
    positionX: finite(v.positionX, "positionX"), positionY: finite(v.positionY, "positionY"), positionZ: finite(v.positionZ, "positionZ"),
    velocityX: finite(v.velocityX, "velocityX"), velocityY: finite(v.velocityY, "velocityY"), velocityZ: finite(v.velocityZ, "velocityZ"),
    massPresent: Boolean(v.massPresent), mass: finite(v.mass, "mass"), muPresent: Boolean(v.muPresent), mu: finite(v.mu, "mu"),
    motionRevisionHigh: integer(v.motionRevisionHigh, "motionRevisionHigh"), motionRevisionLow: integer(v.motionRevisionLow, "motionRevisionLow"),
    propertyRevisionHigh: integer(v.propertyRevisionHigh, "propertyRevisionHigh"), propertyRevisionLow: integer(v.propertyRevisionLow, "propertyRevisionLow"),
    massRevisionHigh: integer(v.massRevisionHigh, "massRevisionHigh"), massRevisionLow: integer(v.massRevisionLow, "massRevisionLow"),
  } satisfies CoupledMemberWire;
  return Object.freeze(result);
}

export function validateCoupledWire(value: unknown): CoupledWire {
  if (typeof value !== "object" || value === null) throw new TypeError("coupled wire value must be an object");
  const v = value as Record<string, unknown>;
  const members = Array.isArray(v.members) ? v.members.map(member) : (() => { throw new TypeError("coupled members must be an array"); })();
  const results = Array.isArray(v.results) ? v.results.map(member) : (() => { throw new TypeError("coupled results must be an array"); })();
  const requestedIds = Array.isArray(v.requestedIds) ? v.requestedIds.map((id) => {
    if (typeof id !== "object" || id === null) throw new TypeError("coupled requested ID must be an object");
    const item = id as Record<string, unknown>;
    return Object.freeze({ high: integer(item.high, "requestedId.high"), low: integer(item.low, "requestedId.low") });
  }) : (() => { throw new TypeError("coupled requested IDs must be an array"); })();
  return Object.freeze({
    resultCode: integer(v.resultCode, "resultCode", 0, 65_535), operationCode: integer(v.operationCode, "operationCode", 1, 4), targetEpoch: validateTimeWire(v.targetEpoch),
    authorityIdHigh: integer(v.authorityIdHigh, "authorityIdHigh"), authorityIdLow: integer(v.authorityIdLow, "authorityIdLow"), groupRevisionHigh: integer(v.groupRevisionHigh, "groupRevisionHigh"), groupRevisionLow: integer(v.groupRevisionLow, "groupRevisionLow"),
    memberCount: integer(v.memberCount, "memberCount", 0, 32), members, requestedCount: integer(v.requestedCount, "requestedCount", 0, 32), requestedIds,
    configurationRevisionHigh: integer(v.configurationRevisionHigh, "configurationRevisionHigh"), configurationRevisionLow: integer(v.configurationRevisionLow, "configurationRevisionLow"),
    relativeTolerance: finite(v.relativeTolerance, "relativeTolerance"), positionAbsoluteToleranceMeters: finite(v.positionAbsoluteToleranceMeters, "positionAbsoluteToleranceMeters"), velocityAbsoluteToleranceMetersPerSecond: finite(v.velocityAbsoluteToleranceMetersPerSecond, "velocityAbsoluteToleranceMetersPerSecond"), massAbsoluteToleranceKilograms: finite(v.massAbsoluteToleranceKilograms, "massAbsoluteToleranceKilograms"),
    checkpointStrideAcceptedSteps: integer(v.checkpointStrideAcceptedSteps, "checkpointStrideAcceptedSteps", 1), maxCheckpointCount: integer(v.maxCheckpointCount, "maxCheckpointCount", 1), maxDenseStepCount: integer(v.maxDenseStepCount, "maxDenseStepCount", 1), maxAcceptedStepsPerExtension: integer(v.maxAcceptedStepsPerExtension, "maxAcceptedStepsPerExtension", 1), maxRejectedStepsPerExtension: integer(v.maxRejectedStepsPerExtension, "maxRejectedStepsPerExtension", 1),
    minStep: validateTimeWire(v.minStep), maxStep: validateTimeWire(v.maxStep), constantAccelerationX: finite(v.constantAccelerationX, "constantAccelerationX"), constantAccelerationY: finite(v.constantAccelerationY, "constantAccelerationY"), constantAccelerationZ: finite(v.constantAccelerationZ, "constantAccelerationZ"),
    resultCount: integer(v.resultCount, "resultCount", 0, 32), results, sharedEvaluationCountHigh: integer(v.sharedEvaluationCountHigh, "sharedEvaluationCountHigh"), sharedEvaluationCountLow: integer(v.sharedEvaluationCountLow, "sharedEvaluationCountLow"),
  });
}

const MEMBER_WORDS = 23;
const INPUT_WORDS = 31 + 32 * MEMBER_WORDS + 32 * 2;
const OUTPUT_WORDS = 9 + 32 * MEMBER_WORDS;

function memberPacket(value: CoupledMemberWire | undefined, output: number[]): void {
  const item = value ?? {
    objectIdHigh: 0, objectIdLow: 0, epoch: { secondsHigh: 0, secondsLow: 0, nanoseconds: 0 }, frameHigh: 0, frameLow: 0,
    positionX: 0, positionY: 0, positionZ: 0, velocityX: 0, velocityY: 0, velocityZ: 0, massPresent: false, mass: 0, muPresent: false, mu: 0,
    motionRevisionHigh: 0, motionRevisionLow: 0, propertyRevisionHigh: 0, propertyRevisionLow: 0, massRevisionHigh: 0, massRevisionLow: 0,
  } satisfies CoupledMemberWire;
  output.push(item.objectIdHigh, item.objectIdLow, item.epoch.secondsHigh, item.epoch.secondsLow, item.epoch.nanoseconds, item.frameHigh, item.frameLow,
    item.positionX, item.positionY, item.positionZ, item.velocityX, item.velocityY, item.velocityZ, item.massPresent ? 1 : 0, item.mass, item.muPresent ? 1 : 0, item.mu,
    item.motionRevisionHigh, item.motionRevisionLow, item.propertyRevisionHigh, item.propertyRevisionLow, item.massRevisionHigh, item.massRevisionLow);
}

export function encodeCoupledPacket(value: CoupledWire): Float64Array {
  const input: number[] = [
    value.resultCode, value.operationCode, value.targetEpoch.secondsHigh, value.targetEpoch.secondsLow, value.targetEpoch.nanoseconds,
    value.authorityIdHigh, value.authorityIdLow, value.groupRevisionHigh, value.groupRevisionLow, value.memberCount,
  ];
  for (let index = 0; index < 32; index += 1) memberPacket(value.members[index], input);
  input.push(value.requestedCount);
  for (let index = 0; index < 32; index += 1) input.push(value.requestedIds[index]?.high ?? 0, value.requestedIds[index]?.low ?? 0);
  input.push(value.configurationRevisionHigh, value.configurationRevisionLow, value.relativeTolerance, value.positionAbsoluteToleranceMeters,
    value.velocityAbsoluteToleranceMetersPerSecond, value.massAbsoluteToleranceKilograms, value.checkpointStrideAcceptedSteps, value.maxCheckpointCount,
    value.maxDenseStepCount, value.maxAcceptedStepsPerExtension, value.maxRejectedStepsPerExtension,
    value.minStep.secondsHigh, value.minStep.secondsLow, value.minStep.nanoseconds, value.maxStep.secondsHigh, value.maxStep.secondsLow, value.maxStep.nanoseconds,
    value.constantAccelerationX, value.constantAccelerationY, value.constantAccelerationZ);
  if (input.length !== INPUT_WORDS) throw new RangeError("coupled packet has an invalid length");
  return Float64Array.from(input);
}

export function decodeCoupledPacket(value: CoupledWire, packet: Float64Array): CoupledWire {
  if (packet.length !== OUTPUT_WORDS) throw new RangeError("coupled output packet has an invalid length");
  let cursor = 0;
  const resultCode = packet[cursor++] ?? 0; const operationCode = packet[cursor++] ?? 0;
  const authorityIdHigh = packet[cursor++] ?? 0; const authorityIdLow = packet[cursor++] ?? 0;
  const groupRevisionHigh = packet[cursor++] ?? 0; const groupRevisionLow = packet[cursor++] ?? 0;
  const resultCount = packet[cursor++] ?? 0; const sharedEvaluationCountHigh = packet[cursor++] ?? 0; const sharedEvaluationCountLow = packet[cursor++] ?? 0;
  const results: CoupledMemberWire[] = [];
  for (let index = 0; index < 32; index += 1) {
    const get = () => packet[cursor++] ?? 0;
    results.push({ objectIdHigh: get(), objectIdLow: get(), epoch: { secondsHigh: get(), secondsLow: get(), nanoseconds: get() }, frameHigh: get(), frameLow: get(),
      positionX: get(), positionY: get(), positionZ: get(), velocityX: get(), velocityY: get(), velocityZ: get(), massPresent: get() !== 0, mass: get(), muPresent: get() !== 0, mu: get(),
      motionRevisionHigh: get(), motionRevisionLow: get(), propertyRevisionHigh: get(), propertyRevisionLow: get(), massRevisionHigh: get(), massRevisionLow: get() });
  }
  return validateCoupledWire({ ...value, resultCode, operationCode, authorityIdHigh, authorityIdLow, groupRevisionHigh, groupRevisionLow, resultCount, results, sharedEvaluationCountHigh, sharedEvaluationCountLow });
}
