import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { meters } from "orbit-engine";
import { projectedRadiusPixels } from "../src/rendering/adaptive-sizing.js";
import { radiusToSceneUnits } from "../src/rendering/render-space.js";
import { MARKER_PIXEL_SIZE } from "../src/rendering/runtime-asteroid-markers.js";
import { SolarSystemScene } from "../src/rendering/solar-system-scene.js";
import type { SolarSystemScenario } from "../src/scenario/load-solar-system.js";
import {
  EARTH_ID,
  SCENARIO_BODIES,
  SCENARIO_OBJECT_IDS,
  URANUS_ID,
} from "../src/scenario/scenario-data.js";

function scenario(): SolarSystemScenario {
  const bodies = SCENARIO_BODIES.map((definition) => ({
    definition,
    record: { properties: definition.properties } as SolarSystemScenario["bodies"][number]["record"],
  }));
  return {
    epoch: bodies[0]!.definition.anchor.epoch,
    validity: { start: bodies[0]!.definition.anchor.epoch },
    provenance: {} as SolarSystemScenario["provenance"],
    catalog: {} as SolarSystemScenario["catalog"],
    centeredFrames: [],
    rootFrame: bodies[0]!.definition.propagation.propagationFrame,
    sunCenteredFrame: bodies[1]!.definition.propagation.propagationFrame,
    earthCenteredFrame: bodies[3]!.definition.propagation.propagationFrame,
    bodies,
    bodyById: new Map(bodies.map((body) => [body.definition.id, body])),
    objectIds: SCENARIO_OBJECT_IDS,
  };
}

function expectedPhysicalDiameterPixels(
  visual: SolarSystemScene,
  camera: THREE.PerspectiveCamera,
  objectId: typeof EARTH_ID,
  viewportHeightPixels: number,
): number {
  const definition = SCENARIO_BODIES.find((body) => body.id === objectId)!;
  const position = visual.positionFor(objectId)!;
  const physicalRadius = radiusToSceneUnits({
    mode: "physical",
    physicalRadiusMeters: meters(definition.properties.physicalRadius ?? 0),
  });
  const distance = Math.max(camera.position.distanceTo(position), physicalRadius * 2, Number.EPSILON);
  return projectedRadiusPixels(
    physicalRadius,
    distance,
    camera.fov * Math.PI / 180,
    viewportHeightPixels,
  ) * 2;
}

test("radius mode applies globally to distant marker planets and focused spheres", () => {
  const root = new THREE.Scene();
  const visual = new SolarSystemScene(root, scenario());
  visual.update(SCENARIO_BODIES.map((body) => body.anchor));
  visual.setSelected(URANUS_ID);
  visual.setFocusId(URANUS_ID);

  const uranusPosition = visual.positionFor(URANUS_ID)!;
  const camera = new THREE.PerspectiveCamera(45, 1, 0.0001, 10_000);
  const focusDistance = visual.focusDistanceFor(URANUS_ID);
  camera.position.set(uranusPosition.x, uranusPosition.y - focusDistance, uranusPosition.z);
  camera.lookAt(uranusPosition);
  camera.updateProjectionMatrix();

  visual.setRadiusMode("adaptive");
  visual.updatePresentation(camera, 900);
  assert.equal(visual.representationFor(URANUS_ID), "sphere");
  assert.equal(visual.representationFor(EARTH_ID), "marker");
  assert.equal(visual.renderDiagnosticsFor(EARTH_ID, camera)?.markerSizePixels, MARKER_PIXEL_SIZE);

  const markerCount = visual.markerCount();
  visual.setRadiusMode("physical");
  visual.updatePresentation(camera, 900);

  const expectedEarthDiameter = expectedPhysicalDiameterPixels(visual, camera, EARTH_ID, 900);
  const physicalEarthMarker = visual.renderDiagnosticsFor(EARTH_ID, camera)?.markerSizePixels;
  assert.ok(physicalEarthMarker !== undefined);
  assert.ok(Math.abs(physicalEarthMarker - expectedEarthDiameter) < 1e-6);
  assert.ok(physicalEarthMarker < MARKER_PIXEL_SIZE, "physical mode must not clamp distant Earth back to adaptive marker size");
  assert.equal(visual.markerCount(), markerCount, "radius-mode switch must not require marker membership changes");

  const uranusDefinition = SCENARIO_BODIES.find((body) => body.id === URANUS_ID)!;
  const expectedUranusRadius = radiusToSceneUnits({
    mode: "physical",
    physicalRadiusMeters: meters(uranusDefinition.properties.physicalRadius ?? 0),
  });
  assert.equal(visual.meshFor(URANUS_ID)?.scale.x, expectedUranusRadius);

  visual.updatePresentation(camera, 450);
  const halfViewportEarthMarker = visual.renderDiagnosticsFor(EARTH_ID, camera)?.markerSizePixels;
  assert.ok(halfViewportEarthMarker !== undefined);
  assert.ok(Math.abs(halfViewportEarthMarker - expectedEarthDiameter / 2) < 1e-6);
  assert.equal(visual.markerCount(), markerCount);

  visual.setRadiusMode("adaptive");
  visual.updatePresentation(camera, 450);
  assert.equal(visual.renderDiagnosticsFor(EARTH_ID, camera)?.markerSizePixels, MARKER_PIXEL_SIZE);
  assert.equal(visual.markerCount(), markerCount);

  visual.dispose();
});