import assert from "node:assert/strict";
import test from "node:test";
import { simulationInstant } from "orbit-engine";
import { SimulationClock } from "../src/simulation/simulation-clock.js";

test("SimulationClock advances from an exact instant using warp", () => {
  const clock = new SimulationClock(simulationInstant(10, 500_000_000), 2);
  clock.play(1000);
  clock.advanceTo(1500);
  assert.deepEqual(clock.currentInstant(), simulationInstant(11, 500_000_000));
});

test("high warp keeps representable durations split into seconds and nanoseconds", () => {
  const clock = new SimulationClock(simulationInstant(10), 2_592_000);
  clock.play(0);
  clock.advanceTo(10_000);
  assert.deepEqual(clock.currentInstant(), simulationInstant(25_920_010));
});

test("high warp still rejects durations whose scaled seconds are unsafe", () => {
  const clock = new SimulationClock(undefined, Number.MAX_SAFE_INTEGER);
  clock.play(0);
  assert.throws(
    () => clock.advanceTo(1001),
    /scaled wall duration exceeds the exact time representation/,
  );
});

test("SimulationClock is frame-rate independent and pause freezes time", () => {
  const oneFrame = new SimulationClock();
  oneFrame.play(0);
  oneFrame.advanceTo(1000);

  const manyFrames = new SimulationClock();
  manyFrames.play(0);
  manyFrames.advanceTo(333);
  manyFrames.advanceTo(666);
  manyFrames.advanceTo(1000);

  assert.deepEqual(oneFrame.currentInstant(), simulationInstant(1));
  assert.deepEqual(manyFrames.currentInstant(), oneFrame.currentInstant());
  manyFrames.pause(1000);
  manyFrames.advanceTo(5000);
  assert.deepEqual(manyFrames.currentInstant(), oneFrame.currentInstant());
});

test("warp changes and exact jumps reset the wall-time anchor", () => {
  const clock = new SimulationClock();
  clock.play(0);
  clock.setWarpFactor(10, 1000);
  clock.advanceTo(1100);
  assert.deepEqual(clock.currentInstant(), simulationInstant(2));
  clock.jump(simulationInstant(42, 7), 1100);
  clock.advanceTo(1200);
  assert.deepEqual(clock.currentInstant(), simulationInstant(43, 7));
});

test("clock authority keeps nanoseconds exact instead of accumulating float seconds", () => {
  const clock = new SimulationClock();
  clock.play(0);
  clock.advanceTo(0.001);
  assert.deepEqual(clock.currentInstant(), simulationInstant(0, 1_000));
});

test("a fresh performance timestamp remains valid after a control event", () => {
  const clock = new SimulationClock();
  clock.play(1000.5);

  assert.throws(
    () => clock.advanceTo(1000.4),
    /wall-clock timestamps must be monotonic while playing/,
  );
  assert.doesNotThrow(() => clock.advanceTo(1000.6));
});
