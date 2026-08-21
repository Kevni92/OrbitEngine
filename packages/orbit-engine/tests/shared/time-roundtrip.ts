import assert from "node:assert/strict";

import type { Backend } from "../../src/internal/backends/contract.js";
import {
  decodeSimulationInstant,
  encodeSimulationInstant,
} from "../../src/internal/time-wire.js";
import { simulationInstant, type SimulationInstant } from "../../src/time.js";

export const timeRoundTripCases: readonly SimulationInstant[] = [
  simulationInstant(0),
  simulationInstant(-0.5),
  simulationInstant(31_557_600_000, 999_999_999),
  simulationInstant(-31_557_600_000),
  simulationInstant(4_294_967_296 + 123, 1),
  simulationInstant(-(4_294_967_296 + 123), 999_999_999),
  simulationInstant(Number.MAX_SAFE_INTEGER, 999_999_999),
  simulationInstant(Number.MIN_SAFE_INTEGER, 1),
];

export function assertTimeRoundTrip(backend: Backend): void {
  for (const expected of timeRoundTripCases) {
    const wire = encodeSimulationInstant(expected);
    const returnedWire = backend.roundTripTime(wire);
    assert.deepEqual(returnedWire, wire);
    assert.deepEqual(decodeSimulationInstant(returnedWire), expected);
  }

  const binary64Sentinel = Math.PI;
  assert.equal(backend.roundTripDouble(binary64Sentinel), binary64Sentinel);
}
