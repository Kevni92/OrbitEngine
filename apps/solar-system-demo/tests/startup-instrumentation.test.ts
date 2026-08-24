import assert from "node:assert/strict";
import test from "node:test";
import { STARTUP_MILESTONES, StartupInstrumentation, startupMarkName } from "../src/simulation/startup-instrumentation.js";

test("startup instrumentation records each milestone once and exposes browser performance mark names", () => {
  const instrumentation = new StartupInstrumentation();
  instrumentation.mark("bootstrap-start");
  instrumentation.mark("bootstrap-start");
  instrumentation.mark("first-rendered-frame");

  const diagnostics = instrumentation.diagnostics();
  assert.equal(typeof diagnostics.milestones["bootstrap-start"], "number");
  assert.equal(typeof diagnostics.milestones["first-rendered-frame"], "number");
  assert.equal(diagnostics.milestones["wasm-engine-ready"], undefined);
  assert.deepEqual(Object.keys(diagnostics.milestones), STARTUP_MILESTONES);
  assert.equal(startupMarkName("first-rendered-frame"), "orbit-demo:startup:first-rendered-frame");
});
