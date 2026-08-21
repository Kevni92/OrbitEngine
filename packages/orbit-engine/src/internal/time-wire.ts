import type { Duration, SimulationInstant } from "../time.js";
import { duration, simulationInstant } from "../time.js";

const TWO_TO_32 = 4_294_967_296;
const NANOSECONDS_PER_SECOND = 1_000_000_000;

export interface TimeWire {
  readonly secondsHigh: number;
  readonly secondsLow: number;
  readonly nanoseconds: number;
}

function assertWireInteger(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new TypeError(`${name} must be an integer`);
  }
  return value;
}

export function validateTimeWire(value: unknown): TimeWire {
  if (typeof value !== "object" || value === null) {
    throw new TypeError("time wire value must be an object");
  }

  const candidate = value as Record<string, unknown>;
  const secondsHigh = assertWireInteger(candidate.secondsHigh, "time wire secondsHigh");
  const secondsLow = assertWireInteger(candidate.secondsLow, "time wire secondsLow");
  const nanoseconds = assertWireInteger(candidate.nanoseconds, "time wire nanoseconds");

  if (secondsHigh < -2_147_483_648 || secondsHigh > 2_147_483_647) {
    throw new RangeError("time wire secondsHigh is outside signed 32-bit range");
  }
  if (secondsLow < 0 || secondsLow >= TWO_TO_32) {
    throw new RangeError("time wire secondsLow is outside unsigned 32-bit range");
  }
  if (nanoseconds < 0 || nanoseconds >= NANOSECONDS_PER_SECOND) {
    throw new RangeError("time wire nanoseconds must be in [0, 1_000_000_000)");
  }

  return Object.freeze({
    secondsHigh: secondsHigh === 0 ? 0 : secondsHigh,
    secondsLow,
    nanoseconds,
  });
}

function encodeSeconds(seconds: number, nanoseconds: number): TimeWire {
  const secondsHigh = Math.floor(seconds / TWO_TO_32);
  const secondsLow = seconds - secondsHigh * TWO_TO_32;
  return validateTimeWire({ secondsHigh, secondsLow, nanoseconds });
}

function decodeSeconds(wire: TimeWire): number {
  const seconds = wire.secondsHigh * TWO_TO_32 + wire.secondsLow;
  if (!Number.isSafeInteger(seconds)) {
    throw new RangeError("time wire seconds exceed the public safe-integer range");
  }
  return seconds === 0 ? 0 : seconds;
}

export function encodeSimulationInstant(value: SimulationInstant): TimeWire {
  return encodeSeconds(value.seconds, value.nanoseconds);
}

export function decodeSimulationInstant(value: unknown): SimulationInstant {
  const wire = validateTimeWire(value);
  return simulationInstant(decodeSeconds(wire), wire.nanoseconds);
}

export function encodeDuration(value: Duration): TimeWire {
  return encodeSeconds(value.seconds, value.nanoseconds);
}

export function decodeDuration(value: unknown): Duration {
  const wire = validateTimeWire(value);
  return duration(decodeSeconds(wire), wire.nanoseconds);
}
