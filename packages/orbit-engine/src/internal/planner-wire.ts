import type { NormalizedLambertGeometryRequest, PlannerGeometryWire } from "../planner.js";

const UINT32_MAX = 4_294_967_295;
const UINT64_MAX = 18_446_744_073_709_551_615n;

/** Versioned, backend-neutral numeric packet for the pure geometry boundary. */
export const PLANNER_GEOMETRY_WIRE_VERSION = 1;
export const PLANNER_GEOMETRY_PACKET_WORDS = 26;
export const PLANNER_GEOMETRY_RESULT_WORDS = 13;

function finite(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be finite`);
  }
  return value;
}

function uint32(value: unknown, name: string): number {
  const result = finite(value, name);
  if (!Number.isInteger(result) || result < 0 || result > UINT32_MAX) {
    throw new RangeError(`${name} must be a uint32`);
  }
  return result;
}

function words(value: string, name: string): readonly [number, number] {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new RangeError(`${name} must be canonical uint64 text`);
  const integer = BigInt(value);
  if (integer > UINT64_MAX) throw new RangeError(`${name} exceeds uint64 range`);
  return [Number(integer >> 32n), Number(integer & 0xffff_ffffn)];
}

function validateWords(value: unknown, name: string): readonly number[] {
  if (!Array.isArray(value) && !(value instanceof Float64Array)) {
    throw new TypeError(`${name}.words must be an array`);
  }
  const result = [...value].map((word, index) => finite(word, `${name}.words[${index}]`));
  if (result.length !== PLANNER_GEOMETRY_PACKET_WORDS) {
    throw new RangeError(`${name}.words must contain ${PLANNER_GEOMETRY_PACKET_WORDS} values`);
  }
  return result;
}

function validateResultWords(value: unknown, name: string): readonly number[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value) && !(value instanceof Float64Array)) throw new TypeError(`${name}.resultWords must be an array`);
  const result = [...value].map((word, index) => finite(word, `${name}.resultWords[${index}]`));
  if (result.length !== PLANNER_GEOMETRY_RESULT_WORDS) throw new RangeError(`${name}.resultWords must contain ${PLANNER_GEOMETRY_RESULT_WORDS} values`);
  return result;
}

/** Validates a packet returned by a native or WASM adapter. */
export function validatePlannerGeometryWire(value: unknown): PlannerGeometryWire {
  if (typeof value !== "object" || value === null) throw new TypeError("planner geometry wire must be an object");
  const candidate = value as Record<string, unknown>;
  const version = uint32(candidate.version, "planner geometry wire version");
  if (version !== PLANNER_GEOMETRY_WIRE_VERSION) throw new RangeError(`Unsupported planner geometry wire version: ${version}`);
  const resultWords = validateResultWords(candidate.resultWords, "planner geometry wire");
  return Object.freeze({ version, words: Object.freeze(validateWords(candidate.words, "planner geometry wire")), ...(resultWords.length === 0 ? {} : { resultWords: Object.freeze(resultWords) }) });
}

/** Encodes only normalized values so both adapters see the same canonical packet. */
export function encodeLambertGeometryWire(value: NormalizedLambertGeometryRequest): PlannerGeometryWire {
  const [centralBodyHigh, centralBodyLow] = words(value.centralBodyId, "centralBodyId");
  const [frameHigh, frameLow] = words(value.planningFrameId, "planningFrameId");
  const [provenanceHigh, provenanceLow] = value.provenanceDigest === undefined
    ? [0, 0]
    : words(value.provenanceDigest, "provenanceDigest");
  const packet = [
    centralBodyHigh, centralBodyLow, frameHigh, frameLow,
    value.mu,
    value.timeOfFlight.seconds, value.timeOfFlight.nanoseconds,
    value.departurePosition.x, value.departurePosition.y, value.departurePosition.z,
    value.arrivalPosition.x, value.arrivalPosition.y, value.arrivalPosition.z,
    value.branch.motionSense === "prograde" ? 1 : 2,
    value.branch.path === "shortWay" ? 1 : 2,
    value.branch.revolutions,
    value.branch.referenceNormal.x, value.branch.referenceNormal.y, value.branch.referenceNormal.z,
    value.solverConfiguration.relativeTimeOfFlightTolerance,
    value.solverConfiguration.velocityToleranceMetersPerSecond,
    value.solverConfiguration.maxIterations,
    value.solverConfiguration.minimumGeometryScaleMeters,
    value.provenancePresent ? 1 : 0,
    provenanceHigh,
    provenanceLow,
  ];
  return validatePlannerGeometryWire({ version: PLANNER_GEOMETRY_WIRE_VERSION, words: packet });
}

/** Creates a validated packet after each numeric word crossed a backend boundary. */
export function roundTripPlannerGeometryWire(
  value: PlannerGeometryWire,
  roundTripDouble: (word: number) => number,
): PlannerGeometryWire {
  const input = validatePlannerGeometryWire(value);
  const words = input.words.map((word, index) => {
    const result = roundTripDouble(word);
    return finite(result, `planner geometry result word ${index}`);
  });
  return validatePlannerGeometryWire({ version: input.version, words });
}

export function withPlannerGeometryResult(value: PlannerGeometryWire, resultWords: readonly number[]): PlannerGeometryWire {
  const input = validatePlannerGeometryWire(value);
  return validatePlannerGeometryWire({ ...input, resultWords });
}
