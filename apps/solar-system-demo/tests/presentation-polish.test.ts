import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import {
  meters,
  metersPerSecond,
  objectId,
  propagationState,
  referenceFrameId,
  revisionId,
  simulationInstant,
} from "orbit-engine";
import { projectedRadiusPixels } from "../src/rendering/adaptive-sizing.js";
import { OrbitRenderer } from "../src/rendering/orbit-renderer.js";
import {
  MARKER_RENDER_ORDER,
  ORBIT_RENDER_ORDER,
  SELECTION_HALO_RENDER_ORDER,
} from "../src/rendering/presentation-order.js";
import {
  SelectionHalo,
  SELECTION_HALO_GAP_PIXELS,
  SELECTION_HALO_THICKNESS_PIXELS,
  selectionHaloPixelSizing,
} from "../src/rendering/selection-halo.js";
import {
  FOCUS_DISTANCE_RADIUS_MULTIPLIER,
  MIN_FOCUS_DISTANCE_SCENE_UNITS,
  SolarSystemScene,
} from "../src/rendering/solar-system-scene.js";
import { BatchedMarkerLayer, MARKER_PIXEL_SIZE } from "../src/rendering/runtime-asteroid-markers.js";
import {
  BENNU_ID,
  EUROPA_ID,
  JUPITER_ID,
  MARS_ID,
  SCENARIO_BODIES,
  SCENARIO_OBJECT_IDS,
  SUN_ID,
} from "../src/scenario/scenario-data.js";
import type { SolarSystemScenario } from "../src/scenario/load-solar-system.js";
import type { OrbitPath } from "../src/simulation/path-sampling.js";

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

function sampleOrbit(): OrbitPath {
  const frame = referenceFrameId("1");
  const bodyId = objectId("1003");
  const centralId = objectId("1000");
  return {
    objectId: bodyId,
    focusId: centralId,
    outputFrame: frame,
    interval: { start: simulationInstant(0), end: simulationInstant(1) },
    sampleCount: 2,
    motionRevision: revisionId("1"),
    configurationRevision: revisionId("1"),
    samples: [0, 1].map((second) => ({
      instant: simulationInstant(second),
      state: propagationState({
        position: { x: meters(149_597_870_700), y: meters(second * 1_000), z: meters(0) },
        velocity: { x: metersPerSecond(0), y: metersPerSecond(1), z: metersPerSecond(0) },
        epoch: simulationInstant(second),
        referenceFrame: frame,
      }),
    })),
  };
}

test("selection halo keeps a thin viewport-stable screen-space ring", () => {
  const markerSizing = selectionHaloPixelSizing(MARKER_PIXEL_SIZE / 2);
  assert.equal(markerSizing.innerRadiusPixels, MARKER_PIXEL_SIZE / 2 + SELECTION_HALO_GAP_PIXELS);
  assert.equal(markerSizing.outerRadiusPixels - markerSizing.innerRadiusPixels, SELECTION_HALO_THICKNESS_PIXELS);
  assert.ok(markerSizing.outerRadiusPixels < 8);

  const root = new THREE.Scene();
  const halo = new SelectionHalo(root);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.000001, 10_000);
  const target = new THREE.Vector3(0, 0, 0);
  const viewportHeight = 900;
  const fieldOfView = camera.fov * Math.PI / 180;

  camera.position.set(0, -10, 0);
  halo.update(target, MARKER_PIXEL_SIZE / 2, camera, viewportHeight);
  const farProjected = projectedRadiusPixels(halo.mesh.scale.x, 10, fieldOfView, viewportHeight);

  camera.position.set(0, -1, 0);
  halo.update(target, MARKER_PIXEL_SIZE / 2, camera, viewportHeight);
  const nearProjected = projectedRadiusPixels(halo.mesh.scale.x, 1, fieldOfView, viewportHeight);

  assert.ok(Math.abs(farProjected - markerSizing.outerRadiusPixels) < 1e-9);
  assert.ok(Math.abs(nearProjected - markerSizing.outerRadiusPixels) < 1e-9);
  assert.equal(halo.mesh.renderOrder, SELECTION_HALO_RENDER_ORDER);
  halo.dispose();
});

test("transparent presentation order keeps orbit guides below markers and selection", () => {
  assert.ok(ORBIT_RENDER_ORDER < MARKER_RENDER_ORDER);
  assert.ok(MARKER_RENDER_ORDER < SELECTION_HALO_RENDER_ORDER);

  const root = new THREE.Scene();
  const markers = new BatchedMarkerLayer(root);
  const markerObject = root.getObjectByName("Runtime asteroid markers");
  assert.equal(markerObject?.renderOrder, MARKER_RENDER_ORDER);

  const orbits = new OrbitRenderer(root);
  const path = sampleOrbit();
  orbits.setPath(path, 0x4f83cc);
  orbits.setSelected(path.objectId);
  const orbitGroup = root.getObjectByName(`Orbit ${path.objectId}`);
  assert.ok(orbitGroup instanceof THREE.Group);
  assert.equal(orbitGroup.children.length, 2);
  assert.ok(orbitGroup.children.every((child) => child.renderOrder === ORBIT_RENDER_ORDER));
  assert.equal(orbitGroup.children[1]!.visible, true, "selected directional highlight remains active");

  markers.dispose();
  orbits.dispose();
});

test("non-star focus distance is physical-radius driven instead of local-system extent", () => {
  const root = new THREE.Scene();
  const visual = new SolarSystemScene(root, scenario());
  visual.update(SCENARIO_BODIES.map((body) => body.anchor));

  const marsDistance = visual.focusDistanceFor(MARS_ID);
  const jupiterDistance = visual.focusDistanceFor(JUPITER_ID);
  const europaDistance = visual.focusDistanceFor(EUROPA_ID);
  const bennuDistance = visual.focusDistanceFor(BENNU_ID);
  const sunDistance = visual.focusDistanceFor(SUN_ID);

  assert.ok(jupiterDistance > marsDistance);
  assert.ok(marsDistance > europaDistance);
  assert.ok(europaDistance > bennuDistance);
  assert.ok(bennuDistance > MIN_FOCUS_DISTANCE_SCENE_UNITS);
  assert.ok(bennuDistance < 0.001, "small asteroid no longer inherits a Solar-System-scale focus distance");
  assert.ok(europaDistance < 0.1, "moon focus is no longer dominated by parent/sibling separation");
  assert.ok(sunDistance >= 1.6, "Sun retains overview framing");
  assert.equal(FOCUS_DISTANCE_RADIUS_MULTIPLIER, 24);

  visual.dispose();
});
