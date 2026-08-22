import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_INSPECTION_FILL_STRENGTH,
  LIGHTING_MODES,
  MAX_INSPECTION_FILL_CONTRIBUTION,
  inspectionFillContribution,
  lightingModeDiagnostics,
  parseLightingMode,
} from "../src/rendering/lighting-mode.js";
import { objectId } from "orbit-engine";

test("lighting modes expose exactly Physical and Enhanced", () => {
  assert.deepEqual(LIGHTING_MODES, ["physical", "enhanced"]);
  assert.equal(parseLightingMode("physical"), "physical");
  assert.equal(parseLightingMode("enhanced"), "enhanced");
  assert.throws(() => parseLightingMode("ambient"), /Unknown lighting mode/);
});

test("Physical has no artificial incident fill and Enhanced is bounded", () => {
  assert.equal(inspectionFillContribution("physical"), 0);
  assert.equal(inspectionFillContribution("enhanced"), DEFAULT_INSPECTION_FILL_STRENGTH);
  assert.equal(inspectionFillContribution("enhanced", 1), MAX_INSPECTION_FILL_CONTRIBUTION);
  assert.throws(() => inspectionFillContribution("enhanced", -0.1), /finite and non-negative/);
});

test("lighting diagnostics identify presentation-only selected/focused fill targets", () => {
  const physical = lightingModeDiagnostics("physical", [objectId("1003"), objectId("1003")]);
  assert.equal(physical.physicalIncidentFill, 0);
  assert.equal(physical.inspectionFillContribution, 0);
  assert.equal(physical.inspectionFillSource, "none");

  const enhanced = lightingModeDiagnostics("enhanced", [objectId("1003"), objectId("1001"), objectId("1003")]);
  assert.deepEqual(enhanced.targetObjectIds, [objectId("1001"), objectId("1003")]);
  assert.equal(enhanced.inspectionFillContribution, DEFAULT_INSPECTION_FILL_STRENGTH);
  assert.equal(enhanced.inspectionFillMaximum, MAX_INSPECTION_FILL_CONTRIBUTION);
  assert.equal(enhanced.inspectionFillSource, "presentation-only artificial inspection lighting");
});
