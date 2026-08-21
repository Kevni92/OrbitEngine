import assert from "node:assert/strict";
import test from "node:test";

import {
  addDurationToInstant,
  addDurations,
  compareDurations,
  compareSimulationInstants,
  duration,
  durationFromSeconds,
  durationToSeconds,
  negateDuration,
  simulationInstant,
  subtractDurationFromInstant,
  subtractDurations,
  subtractSimulationInstants,
  type Duration,
  type SimulationInstant,
} from "../../src/time.js";
import {
  kilograms,
  meters,
  metersPerSecond,
  metersPerSecondSquared,
  radians,
  radiansPerSecond,
  type Kilograms,
  type Meters,
  type MetersPerSecond,
} from "../../src/units.js";

const typedMeters: Meters = meters(1);
const typedSpeed: MetersPerSecond = metersPerSecond(1);
const typedMass: Kilograms = kilograms(1);
void typedMeters;
void typedSpeed;
void typedMass;
// @ts-expect-error Different SI brands must not be assignable to each other.
const invalidUnitAssignment: Meters = typedSpeed;
void invalidUnitAssignment;

test("SI constructors preserve number representation and reject non-finite values", () => {
  const constructors = [meters, metersPerSecond, metersPerSecondSquared, kilograms, radians, radiansPerSecond];
  for (const constructor of constructors) {
    assert.equal(typeof constructor(1.25), "number");
    for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      assert.throws(() => constructor(invalid), TypeError);
    }
  }
});

test("time values are immutable and normalize negative fractions", () => {
  const instant = simulationInstant(-0.5);
  const value = durationFromSeconds(-0.5);

  assert.deepEqual(instant, { seconds: -1, nanoseconds: 500_000_000 });
  assert.deepEqual(value, { seconds: -1, nanoseconds: 500_000_000 });
  assert.equal(Object.isFrozen(instant), true);
  assert.equal(Object.isFrozen(value), true);
});

test("time constructors normalize carries and borrows", () => {
  assert.deepEqual(simulationInstant(0, 1_000_000_000), { seconds: 1, nanoseconds: 0 });
  assert.deepEqual(duration(1, -1), { seconds: 0, nanoseconds: 999_999_999 });
  assert.deepEqual(duration(-1, 1_000_000_000), { seconds: 0, nanoseconds: 0 });
  assert.throws(() => simulationInstant(0, Number.NaN), TypeError);
  assert.throws(() => simulationInstant(Number.MAX_SAFE_INTEGER + 1), RangeError);
});

test("instants and durations compare exactly around J2000", () => {
  const before = simulationInstant(-1, 999_999_999);
  const at = simulationInstant(0);
  const after = simulationInstant(0, 1);
  assert.equal(compareSimulationInstants(before, at), -1);
  assert.equal(compareSimulationInstants(at, at), 0);
  assert.equal(compareSimulationInstants(after, at), 1);
  assert.equal(compareDurations(duration(-1, 999_999_999), duration(0)), -1);
});

test("checked arithmetic preserves carries and rejects overflow", () => {
  const before = simulationInstant(-1, 999_999_999);
  const after = simulationInstant(0, 1);
  assert.deepEqual(subtractSimulationInstants(after, before), { seconds: 0, nanoseconds: 2 });
  assert.deepEqual(addDurationToInstant(simulationInstant(0), duration(-1, 500_000_000)), {
    seconds: -1,
    nanoseconds: 500_000_000,
  });
  assert.deepEqual(subtractDurationFromInstant(simulationInstant(1), duration(0, 1)), {
    seconds: 0,
    nanoseconds: 999_999_999,
  });
  assert.deepEqual(addDurations(duration(1, 750_000_000), duration(0, 250_000_000)), {
    seconds: 2,
    nanoseconds: 0,
  });
  assert.deepEqual(subtractDurations(duration(1), duration(0, 1)), {
    seconds: 0,
    nanoseconds: 999_999_999,
  });
  assert.deepEqual(negateDuration(duration(0, 1)), { seconds: -1, nanoseconds: 999_999_999 });
  assert.equal(durationToSeconds(duration(1, 500_000_000)), 1.5);
  assert.throws(() => addDurations(duration(Number.MAX_SAFE_INTEGER), duration(1)), RangeError);
  assert.throws(() => subtractDurationFromInstant(simulationInstant(Number.MIN_SAFE_INTEGER), duration(1)), RangeError);
});

test("time types remain distinct at compile time", () => {
  const instant: SimulationInstant = simulationInstant(0);
  const interval: Duration = duration(0);
  assert.equal(instant.seconds, interval.seconds);
  assert.equal(instant.nanoseconds, interval.nanoseconds);
});
