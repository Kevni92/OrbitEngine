import { simulationInstant, type SimulationInstant } from "orbit-engine";

const NANOSECONDS_PER_MILLISECOND = 1_000_000n;
const NANOSECONDS_PER_SECOND = 1_000_000_000n;
// J2000.0 is 2000-01-01 12:00:00 TT/TDB; TT-UTC was 64.184 s then.
const J2000_UTC_MILLISECONDS = 946_727_935_816n;
const J2000_TAI_UTC_SECONDS = 32n;

interface LeapSecondChange {
  readonly utcMilliseconds: number;
  readonly taiMinusUtcSeconds: bigint;
}

const LEAP_SECOND_CHANGES: readonly LeapSecondChange[] = [
  { utcMilliseconds: Date.parse("2006-01-01T00:00:00Z"), taiMinusUtcSeconds: 33n },
  { utcMilliseconds: Date.parse("2009-01-01T00:00:00Z"), taiMinusUtcSeconds: 34n },
  { utcMilliseconds: Date.parse("2012-07-01T00:00:00Z"), taiMinusUtcSeconds: 35n },
  { utcMilliseconds: Date.parse("2015-07-01T00:00:00Z"), taiMinusUtcSeconds: 36n },
  { utcMilliseconds: Date.parse("2017-01-01T00:00:00Z"), taiMinusUtcSeconds: 37n },
];

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

function taiMinusUtcAt(utcMilliseconds: number): bigint {
  let offset = J2000_TAI_UTC_SECONDS;
  for (const change of LEAP_SECOND_CHANGES) {
    if (utcMilliseconds < change.utcMilliseconds) break;
    offset = change.taiMinusUtcSeconds;
  }
  return offset;
}

function floorDivRem(value: bigint, divisor: bigint): { readonly quotient: bigint; readonly remainder: bigint } {
  let quotient = value / divisor;
  let remainder = value % divisor;
  if (remainder < 0n) {
    quotient -= 1n;
    remainder += divisor;
  }
  return { quotient, remainder };
}

function simulationNanoseconds(instant: SimulationInstant): bigint {
  return J2000_UTC_MILLISECONDS * NANOSECONDS_PER_MILLISECOND
    + BigInt(instant.seconds) * NANOSECONDS_PER_SECOND
    + BigInt(instant.nanoseconds);
}

function utcMillisecondsFromSimulationInstant(instant: SimulationInstant): number {
  const tdbNanoseconds = simulationNanoseconds(instant);
  let utcNanoseconds = tdbNanoseconds - (taiMinusUtcAt(Number(J2000_UTC_MILLISECONDS)) - J2000_TAI_UTC_SECONDS) * NANOSECONDS_PER_SECOND;
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const utcMilliseconds = Number(floorDivRem(utcNanoseconds, NANOSECONDS_PER_MILLISECOND).quotient);
    utcNanoseconds = tdbNanoseconds
      - (taiMinusUtcAt(utcMilliseconds) - J2000_TAI_UTC_SECONDS) * NANOSECONDS_PER_SECOND;
  }
  const utcMilliseconds = floorDivRem(utcNanoseconds, NANOSECONDS_PER_MILLISECOND).quotient;
  const numericMilliseconds = Number(utcMilliseconds);
  if (!Number.isSafeInteger(numericMilliseconds)) throw new RangeError("Simulation time is outside the civil date range");
  return numericMilliseconds;
}

function partsOf(date: Date, timeZone?: string): Record<string, string> {
  const formatter = new Intl.DateTimeFormat("de-DE", {
    ...(timeZone === undefined ? {} : { timeZone }),
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  return Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
}

/**
 * Converts the engine's TDB/J2000 instant to the user's local civil time.
 * This is deliberately an app-boundary presentation conversion: the engine
 * continues to use the exact seconds/nanoseconds pair as its authority.
 */
export function formatLocalSimulationTime(instant: SimulationInstant, timeZone?: string): string {
  const utcMilliseconds = utcMillisecondsFromSimulationInstant(instant);
  const date = new Date(utcMilliseconds);
  const parts = partsOf(date, timeZone);
  const milliseconds = date.getUTCMilliseconds();
  const fraction = milliseconds === 0 ? "" : `.${pad(milliseconds, 3)}`;
  const weekday = parts.weekday ?? "";
  return `${weekday.replace(/\.$/, "")}, ${parts.day}.${parts.month}.${parts.year} ${parts.hour}:${parts.minute}:${parts.second}${fraction} Uhr`;
}

/** Returns a value suitable for an HTML datetime-local input in local time. */
export function formatLocalDateTimeInput(instant: SimulationInstant): string {
  const date = new Date(utcMillisecondsFromSimulationInstant(instant));
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1, 2)}-${pad(date.getDate(), 2)}T${pad(date.getHours(), 2)}:${pad(date.getMinutes(), 2)}:${pad(date.getSeconds(), 2)}.${pad(date.getMilliseconds(), 3)}`;
}

function parseLocalDateTime(value: string): { readonly date: Date; readonly extraNanoseconds: bigint } {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?$/.exec(value);
  if (match === null) throw new RangeError("Enter a valid local date and time");
  const [, yearText, monthText, dayText, hourText, minuteText, secondText = "0", fractionText = ""] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) {
    throw new RangeError("Enter a valid local date and time");
  }
  const milliseconds = Number(fractionText.padEnd(3, "0").slice(0, 3) || "0");
  const extraNanoseconds = BigInt(fractionText.padEnd(9, "0").slice(3).padEnd(6, "0") || "0");
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(hour, minute, second, milliseconds);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day
      || date.getHours() !== hour || date.getMinutes() !== minute || date.getSeconds() !== second
      || date.getMilliseconds() !== milliseconds) {
    throw new RangeError("Enter a valid local date and time");
  }
  return { date, extraNanoseconds };
}

/** Converts the value of a local datetime-local input at the UI boundary. */
export function simulationInstantFromLocalDateTimeInput(value: string): SimulationInstant {
  const { date, extraNanoseconds } = parseLocalDateTime(value);
  const utcMilliseconds = BigInt(date.getTime());
  const civilNanoseconds = (utcMilliseconds - J2000_UTC_MILLISECONDS) * NANOSECONDS_PER_MILLISECOND + extraNanoseconds;
  const leapCorrection = (taiMinusUtcAt(date.getTime()) - J2000_TAI_UTC_SECONDS) * NANOSECONDS_PER_SECOND;
  const { quotient: seconds, remainder: nanoseconds } = floorDivRem(civilNanoseconds + leapCorrection, NANOSECONDS_PER_SECOND);
  const numericSeconds = Number(seconds);
  if (!Number.isSafeInteger(numericSeconds)) throw new RangeError("Local date is outside the supported simulation range");
  return simulationInstant(numericSeconds, Number(nanoseconds));
}
