import assert from "node:assert/strict";
import test from "node:test";
import { propagationState, meters, metersPerSecond, referenceFrameId, simulationInstant } from "orbit-engine";
import {
  formatDistance,
  formatExactInstant,
  formatRadius,
  formatSimulationTime,
  formatSpeed,
} from "../src/ui/formatters.js";

test("simulation formatter preserves J2000 offset semantics and exact details", () => {
  const instant = simulationInstant(12 * 86_400 + 4 * 3_600 + 31 * 60 + 15, 123_000_000);
  assert.equal(formatSimulationTime(instant), "J2000 + 12 d 04:31:15.123");
  assert.equal(formatExactInstant(instant), "seconds: 1053075\nnanoseconds: 123000000");
  assert.deepEqual(instant, simulationInstant(instant.seconds, instant.nanoseconds));
});

test("physical scalar formatters produce readable presentation values", () => {
  const state = propagationState({
    position: { x: meters(149_597_870_700), y: meters(0), z: meters(0) },
    velocity: { x: metersPerSecond(3), y: metersPerSecond(4), z: metersPerSecond(0) },
    epoch: simulationInstant(0),
    referenceFrame: referenceFrameId("1"),
  });
  assert.equal(formatDistance(state.position.x), "1.000 AU");
  assert.equal(formatSpeed(state), "5 m/s");
  assert.equal(formatRadius(6_371_000), "6,371 km");
});
