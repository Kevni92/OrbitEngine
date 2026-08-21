const NANOSECONDS_PER_SECOND = 1_000_000_000;

declare const simulationInstantBrand: unique symbol;
declare const durationBrand: unique symbol;

export interface SimulationInstant {
  readonly seconds: number;
  readonly nanoseconds: number;
  readonly [simulationInstantBrand]: "SimulationInstant";
}

export interface Duration {
  readonly seconds: number;
  readonly nanoseconds: number;
  readonly [durationBrand]: "Duration";
}

type NormalizedComponents = {
  readonly seconds: number;
  readonly nanoseconds: number;
};

function assertFinite(value: number, name: string): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number`);
  }
}

function assertSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${name} must be a safe integer`);
  }
}

function normalizeComponents(seconds: number, nanoseconds: number, name: string): NormalizedComponents {
  assertSafeInteger(seconds, `${name} seconds`);
  assertSafeInteger(nanoseconds, `${name} nanoseconds`);

  const carry = Math.floor(nanoseconds / NANOSECONDS_PER_SECOND);
  const normalizedSeconds = seconds + carry;
  assertSafeInteger(normalizedSeconds, `${name} seconds`);

  const normalizedNanoseconds = nanoseconds - carry * NANOSECONDS_PER_SECOND;
  if (normalizedNanoseconds < 0 || normalizedNanoseconds >= NANOSECONDS_PER_SECOND) {
    throw new RangeError(`${name} nanoseconds could not be normalized`);
  }

  return {
    seconds: normalizedSeconds === 0 ? 0 : normalizedSeconds,
    nanoseconds: normalizedNanoseconds,
  };
}

function normalizeInput(seconds: number, nanoseconds: number, name: string): NormalizedComponents {
  assertFinite(seconds, `${name} seconds`);
  assertFinite(nanoseconds, `${name} nanoseconds`);
  if (Math.abs(seconds) > Number.MAX_SAFE_INTEGER) {
    throw new RangeError(`${name} seconds must remain within the safe integer range`);
  }
  assertSafeInteger(nanoseconds, `${name} nanoseconds`);

  const wholeSeconds = Math.floor(seconds);
  const fractionalNanoseconds = Math.round((seconds - wholeSeconds) * NANOSECONDS_PER_SECOND);
  const combinedNanoseconds = fractionalNanoseconds + nanoseconds;
  assertSafeInteger(combinedNanoseconds, `${name} nanoseconds`);
  return normalizeComponents(wholeSeconds, combinedNanoseconds, name);
}

function freezeInstant(components: NormalizedComponents): SimulationInstant {
  return Object.freeze(components) as SimulationInstant;
}

function freezeDuration(components: NormalizedComponents): Duration {
  return Object.freeze(components) as Duration;
}

function assertTimeValue(value: { readonly seconds: number; readonly nanoseconds: number }, name: string): void {
  if (typeof value !== "object" || value === null) {
    throw new TypeError(`${name} must be a time value`);
  }
  assertSafeInteger(value.seconds, `${name} seconds`);
  if (!Number.isInteger(value.nanoseconds)
    || value.nanoseconds < 0
    || value.nanoseconds >= NANOSECONDS_PER_SECOND) {
    throw new RangeError(`${name} nanoseconds must be in [0, 1_000_000_000)`);
  }
}

function checkedAdd(left: number, right: number, name: string): number {
  const result = left + right;
  assertSafeInteger(result, name);
  return result;
}

function checkedSubtract(left: number, right: number, name: string): number {
  const result = left - right;
  assertSafeInteger(result, name);
  return result;
}

export function simulationInstant(seconds: number, nanoseconds = 0): SimulationInstant {
  return freezeInstant(normalizeInput(seconds, nanoseconds, "SimulationInstant"));
}

export function duration(seconds: number, nanoseconds = 0): Duration {
  return freezeDuration(normalizeInput(seconds, nanoseconds, "Duration"));
}

export function simulationInstantFromSeconds(seconds: number): SimulationInstant {
  return simulationInstant(seconds);
}

export function durationFromSeconds(seconds: number): Duration {
  return duration(seconds);
}

export function compareSimulationInstants(left: SimulationInstant, right: SimulationInstant): -1 | 0 | 1 {
  assertTimeValue(left, "left instant");
  assertTimeValue(right, "right instant");
  if (left.seconds !== right.seconds) {
    return left.seconds < right.seconds ? -1 : 1;
  }
  if (left.nanoseconds !== right.nanoseconds) {
    return left.nanoseconds < right.nanoseconds ? -1 : 1;
  }
  return 0;
}

export function compareDurations(left: Duration, right: Duration): -1 | 0 | 1 {
  assertTimeValue(left, "left duration");
  assertTimeValue(right, "right duration");
  if (left.seconds !== right.seconds) {
    return left.seconds < right.seconds ? -1 : 1;
  }
  if (left.nanoseconds !== right.nanoseconds) {
    return left.nanoseconds < right.nanoseconds ? -1 : 1;
  }
  return 0;
}

export function subtractSimulationInstants(
  left: SimulationInstant,
  right: SimulationInstant,
): Duration {
  assertTimeValue(left, "left instant");
  assertTimeValue(right, "right instant");
  const seconds = checkedSubtract(left.seconds, right.seconds, "instant difference seconds");
  const nanoseconds = left.nanoseconds - right.nanoseconds;
  return freezeDuration(normalizeComponents(seconds, nanoseconds, "Duration"));
}

export function addDurationToInstant(instant: SimulationInstant, value: Duration): SimulationInstant {
  assertTimeValue(instant, "instant");
  assertTimeValue(value, "duration");
  const seconds = checkedAdd(instant.seconds, value.seconds, "instant sum seconds");
  const nanoseconds = instant.nanoseconds + value.nanoseconds;
  return freezeInstant(normalizeComponents(seconds, nanoseconds, "SimulationInstant"));
}

export function subtractDurationFromInstant(instant: SimulationInstant, value: Duration): SimulationInstant {
  assertTimeValue(instant, "instant");
  assertTimeValue(value, "duration");
  const seconds = checkedSubtract(instant.seconds, value.seconds, "instant difference seconds");
  const nanoseconds = instant.nanoseconds - value.nanoseconds;
  return freezeInstant(normalizeComponents(seconds, nanoseconds, "SimulationInstant"));
}

export function addDurations(left: Duration, right: Duration): Duration {
  assertTimeValue(left, "left duration");
  assertTimeValue(right, "right duration");
  const seconds = checkedAdd(left.seconds, right.seconds, "duration sum seconds");
  const nanoseconds = left.nanoseconds + right.nanoseconds;
  return freezeDuration(normalizeComponents(seconds, nanoseconds, "Duration"));
}

export function subtractDurations(left: Duration, right: Duration): Duration {
  assertTimeValue(left, "left duration");
  assertTimeValue(right, "right duration");
  const seconds = checkedSubtract(left.seconds, right.seconds, "duration difference seconds");
  const nanoseconds = left.nanoseconds - right.nanoseconds;
  return freezeDuration(normalizeComponents(seconds, nanoseconds, "Duration"));
}

export function negateDuration(value: Duration): Duration {
  assertTimeValue(value, "duration");
  return freezeDuration(normalizeComponents(-value.seconds, -value.nanoseconds, "Duration"));
}

export function durationToSeconds(value: Duration): number {
  assertTimeValue(value, "duration");
  return value.seconds + value.nanoseconds / NANOSECONDS_PER_SECOND;
}
