import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { meters } from "orbit-engine";
import { projectedRadiusPixels } from "orbit-engine-three";
import { MARKER_PIXEL_SIZE, SolarSystemScene } from "../src/rendering/solar-system-scene.js";
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
  const physicalRadius = meters(definition.properties.physicalRadius ?? 0) / (149_597_870_700 / 100);
  camera.updateMatrixWorld(true);
  const cameraDepth = -position.clone().applyMatrix4(camera.matrixWorldInverse).z;
  const distance = Math.max(cameraDepth, physicalRadius * 2, Number.EPSILON);
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
  let earthDiagnostics = visual.renderDiagnosticsFor(EARTH_ID, camera);
  assert.equal(earthDiagnostics?.submitted, true);
  assert.equal(earthDiagnostics?.markerSizePixels, MARKER_PIXEL_SIZE);

  visual.setRadiusMode("physical");
  visual.updatePresentation(camera, 900);

  const expectedEarthDiameter = expectedPhysicalDiameterPixels(visual, camera, EARTH_ID, 900);
  earthDiagnostics = visual.renderDiagnosticsFor(EARTH_ID, camera);
  assert.equal(visual.representationFor(EARTH_ID), "marker");
  assert.equal(earthDiagnostics?.submitted, true, "radius-mode switch must keep the existing Earth marker submitted");
  const physicalEarthMarker = earthDiagnostics?.markerSizePixels;
  assert.ok(physicalEarthMarker !== undefined);
  assert.ok(Math.abs(physicalEarthMarker - expectedEarthDiameter) < 1e-6);
  assert.ok(physicalEarthMarker < MARKER_PIXEL_SIZE, "physical mode must not clamp distant Earth back to adaptive marker size");

  const uranusDefinition = SCENARIO_BODIES.find((body) => body.id === URANUS_ID)!;
  const expectedUranusRadius = meters(uranusDefinition.properties.physicalRadius ?? 0) / (149_597_870_700 / 100);
  assert.ok(Math.abs((visual.meshFor(URANUS_ID)?.scale.x ?? Number.NaN) - expectedUranusRadius) < 1e-12);

  visual.updatePresentation(camera, 450);
  earthDiagnostics = visual.renderDiagnosticsFor(EARTH_ID, camera);
  assert.equal(visual.representationFor(EARTH_ID), "marker");
  assert.equal(earthDiagnostics?.submitted, true);
  const halfViewportEarthMarker = earthDiagnostics?.markerSizePixels;
  assert.ok(halfViewportEarthMarker !== undefined);
  assert.ok(Math.abs(halfViewportEarthMarker - expectedEarthDiameter / 2) < 1e-6);

  visual.setRadiusMode("adaptive");
  visual.updatePresentation(camera, 450);
  earthDiagnostics = visual.renderDiagnosticsFor(EARTH_ID, camera);
  assert.equal(visual.representationFor(EARTH_ID), "marker");
  assert.equal(earthDiagnostics?.submitted, true);
  assert.equal(earthDiagnostics?.markerSizePixels, MARKER_PIXEL_SIZE);

  visual.dispose();
});
