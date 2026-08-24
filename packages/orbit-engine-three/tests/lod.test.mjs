import assert from "node:assert/strict";
import test from "node:test";
import { objectId } from "orbit-engine";
import {
  adaptiveRadiusPixels,
  cappedAdaptiveRadiusPixels,
  createAdaptiveSizingConfiguration,
  createRepresentationPolicy,
  resolveRepresentationDecisions,
  resolveBodySizing,
} from "../dist/index.js";

const PROJECTION = Object.freeze({
  projectable: true,
  cameraDepthSceneUnits: 100,
  verticalFieldOfViewRadians: Math.PI / 3,
  viewportHeightCssPixels: 900,
});

function sizing(physicalRadiusSceneUnits, radiusMode = "adaptive") {
  return resolveBodySizing({
    physicalRadiusSceneUnits,
    metersPerSceneUnit: 1,
    radiusMode,
    projection: PROJECTION,
  });
}

function body(id, parentId) {
  return { objectId: objectId(String(id)), parentId, positionRelativeToOriginMeters: { x: id, y: 0, z: 0 } };
}

test("adaptive sizing is finite, monotonic, physical at resolution, and separation-aware", () => {
  const values = [0, 0.1, 1, 2, 5, 7, 12].map(adaptiveRadiusPixels);
  for (let index = 1; index < values.length; index += 1) assert.ok(values[index] >= values[index - 1]);
  assert.equal(adaptiveRadiusPixels(7), 7);
  assert.equal(cappedAdaptiveRadiusPixels(7, 0.5, 1, 0.3), 0.5);
  assert.equal(cappedAdaptiveRadiusPixels(7, 0.5, 0, 0.3), 0.5);
  const config = createAdaptiveSizingConfiguration({ markerSizePixels: 7 });
  const adaptive = sizing(0.1);
  const physical = sizing(0.1, "physical");
  assert.ok(adaptive.presentedRadiusPixels > physical.presentedRadiusPixels);
  assert.equal(physical.markerSizePixels, physical.physicalDiameterPixels);
  assert.equal(config.markerSizePixels, 7);
});

test("representation policy uses hysteresis and generic selection hierarchy", () => {
  const policy = createRepresentationPolicy();
  assert.equal(policy.resolve("sphere", { physicalDiameterPixels: 3.9, hierarchyEligible: true, selected: false, focused: false }), "marker");
  assert.equal(policy.resolve("sphere", { physicalDiameterPixels: 3.9, hierarchyEligible: true, selected: false, focused: false }), "marker");
  assert.equal(policy.resolve("marker", { physicalDiameterPixels: 5.9, hierarchyEligible: true, selected: false, focused: false }), "marker");
  assert.equal(policy.resolve("marker", { physicalDiameterPixels: 6, hierarchyEligible: true, selected: false, focused: false }), "sphere");

  const root = body(10);
  const child = body(20, root.objectId);
  const sibling = body(30, root.objectId);
  const sizingById = new Map([
    [root.objectId, { ...sizing(0.1), physicalDiameterPixels: 1, presentedDiameterPixels: 2 }],
    [child.objectId, { ...sizing(0.01), physicalDiameterPixels: 1, presentedDiameterPixels: 2 }],
    [sibling.objectId, { ...sizing(0.01), physicalDiameterPixels: 1, presentedDiameterPixels: 2 }],
  ]);
  const selected = resolveRepresentationDecisions({
    bodies: [root, child, sibling],
    sizingById,
    selectedObjectIds: new Set([child.objectId]),
    policy,
  });
  assert.equal(selected.get(root.objectId).representation, "marker");
  assert.equal(selected.get(child.objectId).representation, "marker");
  assert.equal(selected.get(sibling.objectId).representation, "hidden");
});

test("physical mode keeps marker size tied to projected physical diameter", () => {
  const physical = resolveBodySizing({
    physicalRadiusSceneUnits: 0.01,
    metersPerSceneUnit: 1,
    radiusMode: "physical",
    projection: PROJECTION,
  });
  assert.equal(physical.markerSizePixels, physical.physicalDiameterPixels);
  assert.ok(physical.markerSizePixels < 1);
});
