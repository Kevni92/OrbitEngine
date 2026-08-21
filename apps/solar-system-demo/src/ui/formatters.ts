import type { PropagationState, SimulationInstant } from "orbit-engine";

const SECONDS_PER_DAY = 86_400;
const METERS_PER_KILOMETER = 1_000;
const METERS_PER_ASTRONOMICAL_UNIT = 149_597_870_700;

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

export function formatSimulationTime(instant: SimulationInstant): string {
  const sign = instant.seconds < 0 ? "−" : "+";
  const absoluteSeconds = Math.abs(instant.seconds);
  const days = Math.floor(absoluteSeconds / SECONDS_PER_DAY);
  const daySeconds = absoluteSeconds - days * SECONDS_PER_DAY;
  const hours = Math.floor(daySeconds / 3_600);
  const minutes = Math.floor((daySeconds - hours * 3_600) / 60);
  const seconds = daySeconds - hours * 3_600 - minutes * 60;
  const wholeSeconds = Math.floor(seconds);
  const milliseconds = Math.floor(instant.nanoseconds / 1_000_000);
  const suffix = milliseconds === 0 ? "" : `.${pad(milliseconds, 3)}`;
  return `J2000 ${sign} ${days} d ${pad(hours, 2)}:${pad(minutes, 2)}:${pad(wholeSeconds, 2)}${suffix}`;
}

export function formatExactInstant(instant: SimulationInstant): string {
  return `seconds: ${instant.seconds}\nnanoseconds: ${instant.nanoseconds}`;
}

export function formatDistance(meters: number): string {
  const absolute = Math.abs(meters);
  if (absolute >= METERS_PER_ASTRONOMICAL_UNIT) return `${(meters / METERS_PER_ASTRONOMICAL_UNIT).toFixed(3)} AU`;
  if (absolute >= 1_000_000) return `${(meters / METERS_PER_KILOMETER).toLocaleString("en-US", { maximumFractionDigits: 0 })} km`;
  if (absolute >= METERS_PER_KILOMETER) return `${(meters / METERS_PER_KILOMETER).toFixed(1)} km`;
  return `${meters.toFixed(0)} m`;
}

export function formatSpeed(state: PropagationState): string {
  const speed = Math.hypot(state.velocity.x, state.velocity.y, state.velocity.z);
  return `${speed.toLocaleString("en-US", { maximumFractionDigits: 1 })} m/s`;
}

export function formatRadius(meters: number): string {
  return `${(meters / METERS_PER_KILOMETER).toLocaleString("en-US", { maximumFractionDigits: 1 })} km`;
}

export function formatMass(mass: number | undefined): string {
  return mass === undefined ? "—" : `${mass.toExponential(3)} kg`;
}

export function formatVector(value: { readonly x: number; readonly y: number; readonly z: number }): string {
  return `(${value.x.toExponential(6)}, ${value.y.toExponential(6)}, ${value.z.toExponential(6)})`;
}

export function formatObjectType(value: string): string {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (character) => character.toUpperCase());
}

export function formatModel(value: string): string {
  return formatObjectType(value).replace("Two Body Analytical", "Two-body analytical");
}
