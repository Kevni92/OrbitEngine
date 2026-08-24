import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { positionToSceneUnits } from "../src/rendering/render-space.js";
import {
  MAX_FOCUS_DISTANCE_SCENE_UNITS,
  INSPECTION_FILL_LAYER,
  MIN_FOCUS_DISTANCE_SCENE_UNITS,
  SolarSystemScene,
} from "../src/rendering/solar-system-scene.js";
import { meters, metersPerSecond, ObjectType, propagationState, referenceFrameId, revisionId, simulationInstant } from "orbit-engine";
import type { OrbitPath } from "../src/simulation/path-sampling.js";
import {
  EARTH_ID,
  EUROPA_ID,
  JUPITER_ID,
  PHOBOS_ID,
  SCENARIO_BODIES,
  SCENARIO_OBJECT_IDS,
  SUN_CENTERED_FRAME,
  SUN_ID,
  TITAN_ID,
} from "../src/scenario/scenario-data.js";
import type { SolarSystemScenario } from "../src/scenario/load-solar-system.js";

const FLOAT32_SCENE_POSITION_TOLERANCE = 1e-4;

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

test("scene keys meshes by stable ObjectId and consumes returned positions", () => {
  const root = new THREE.Scene();
  const visual = new SolarSystemScene(root, scenario());
  const states = SCENARIO_BODIES.map((body) => body.anchor);
  const earth = SCENARIO_BODIES.find((body) => body.id === EARTH_ID)!;
  const rawEarthPosition = { ...earth.anchor.position };
  visual.update(states);

  const earthMesh = visual.meshFor(earth.id)!;
  assert.equal(earthMesh.userData.objectId, earth.id);
  const expected = positionToSceneUnits(earth.anchor.position);
  assert.deepEqual(earthMesh.position.toArray(), [expected.x, expected.y, expected.z]);
  assert.deepEqual(earth.anchor.position, rawEarthPosition);

  visual.setSelected(SUN_ID);
  assert.equal(visual.selectedObjectId(), SUN_ID);
  visual.setRadiusMode("physical");
  assert.ok(visual.stateFor(SUN_ID) !== undefined);
  const focusDistance = visual.focusDistanceFor(EARTH_ID);
  assert.ok(focusDistance >= MIN_FOCUS_DISTANCE_SCENE_UNITS);
  assert.ok(focusDistance <= MAX_FOCUS_DISTANCE_SCENE_UNITS);
  assert.throws(() => visual.focusDistanceFor("999999" as typeof SUN_ID), /Unknown scenario body/);

  const path: OrbitPath = {
    objectId: EARTH_ID,
    focusId: SUN_ID,
    outputFrame: SUN_CENTERED_FRAME,
    interval: { start: simulationInstant(0), end: simulationInstant(10) },
    sampleCount: 2,
    motionRevision: revisionId("1"),
    configurationRevision: revisionId("1"),
    samples: [
      { instant: simulationInstant(0), state: earth.anchor },
      { instant: simulationInstant(1), state: earth.anchor },
    ],
  };
  visual.setPath(path);
  assert.equal(visual.pathCount(), 1);

  const orbitGroup = root.getObjectByName(`Orbit ${EARTH_ID}`);
  assert.ok(orbitGroup instanceof THREE.Group);
  const orbitLine = orbitGroup.children[0];
  assert.ok(orbitLine instanceof THREE.LineLoop);
  const positions = orbitLine.geometry.getAttribute("position");
  const firstOrbitPoint = new THREE.Vector3(
    positions.getX(0),
    positions.getY(0),
    positions.getZ(0),
  );
  // BufferGeometry position attributes are Float32, while body mesh positions
  // retain JavaScript double precision. They must coincide within GPU geometry precision.
  assert.ok(firstOrbitPoint.distanceTo(earthMesh.position) < FLOAT32_SCENE_POSITION_TOLERANCE);

  visual.clearPaths();
  assert.equal(visual.pathCount(), 0);
  visual.dispose();
  assert.equal(visual.meshFor(SUN_ID), undefined);
});

test("scene accepts paths in arbitrary declared output frames", () => {
  const root = new THREE.Scene();
  const visual = new SolarSystemScene(root, scenario());
  const sun = SCENARIO_BODIES.find((body) => body.id === SUN_ID)!;
  const path: OrbitPath = {
    objectId: SUN_ID,
    focusId: SUN_ID,
    outputFrame: referenceFrameId("1"),
    interval: { start: simulationInstant(0), end: simulationInstant(1) },
    sampleCount: 2,
    motionRevision: revisionId("1"),
    configurationRevision: revisionId("1"),
    samples: [
      { instant: simulationInstant(0), state: sun.anchor },
      { instant: simulationInstant(1), state: sun.anchor },
    ],
  };
  visual.setPath(path);
  assert.equal(visual.pathCount(), 1);
  visual.dispose();
});

test("resolved surfaces use lit materials while stellar illumination survives star LOD", () => {
  const root = new THREE.Scene();
  const visual = new SolarSystemScene(root, scenario());
  visual.update(SCENARIO_BODIES.map((body) => body.anchor));
  const earthMaterial = visual.meshFor(EARTH_ID)?.material;
  assert.ok(earthMaterial instanceof THREE.MeshLambertMaterial);
  assert.equal(earthMaterial.emissiveMap, null);
  assert.ok(visual.meshFor(SUN_ID)?.material instanceof THREE.MeshStandardMaterial);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 10_000);
  camera.position.set(0, -1_000, 600);
  camera.lookAt(0, 0, 0);
  visual.setFocusId(SUN_ID);
  visual.updatePresentation(camera, 900);
  assert.ok(visual.illuminationFor(EARTH_ID)?.totalIrradianceWattsPerSquareMeter! > 0);
  assert.notEqual(visual.representationFor(SUN_ID), "sphere");
  assert.ok(visual.illuminationFor(EARTH_ID)?.contributions.some((contribution) => contribution.emitterId === SUN_ID));
  visual.dispose();
});

test("direction diagnostics keep physical/render/shader spaces aligned across presentation sizing", () => {
  const root = new THREE.Scene();
  const visual = new SolarSystemScene(root, scenario());
  const earth = SCENARIO_BODIES.find((body) => body.id === EARTH_ID)!;
  const earthPosition = positionToSceneUnits(earth.anchor.position);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.0001, 10_000);
  camera.position.set(earthPosition.x, earthPosition.y - 1.5, earthPosition.z + 0.9);
  camera.lookAt(earthPosition.x, earthPosition.y, earthPosition.z);
  visual.update(SCENARIO_BODIES.map((body) => body.anchor));
  visual.setSelected(EARTH_ID);
  visual.setFocusId(EARTH_ID);

  visual.setRadiusMode("adaptive");
  visual.updatePresentation(camera, 900);
  const adaptive = visual.renderDiagnosticsFor(EARTH_ID, camera)!;
  const adaptiveSun = adaptive.stellarDirections.find((direction) => direction.emitterId === SUN_ID)!;
  assert.deepEqual(adaptiveSun.shaderDirectionToEmitter, adaptiveSun.renderDirectionToEmitter);
  assert.ok(Math.abs(Math.hypot(
    adaptiveSun.shaderDirectionToEmitter.x,
    adaptiveSun.shaderDirectionToEmitter.y,
    adaptiveSun.shaderDirectionToEmitter.z,
  ) - 1) < 1e-12);

  visual.setRadiusMode("physical");
  visual.updatePresentation(camera, 900);
  const physical = visual.renderDiagnosticsFor(EARTH_ID, camera)!;
  const physicalSun = physical.stellarDirections.find((direction) => direction.emitterId === SUN_ID)!;
  assert.deepEqual(physicalSun.physicalDirectionToEmitter, adaptiveSun.physicalDirectionToEmitter);
  assert.deepEqual(physicalSun.renderDirectionToEmitter, adaptiveSun.renderDirectionToEmitter);
  assert.deepEqual(physicalSun.shaderDirectionToEmitter, adaptiveSun.shaderDirectionToEmitter);
  visual.dispose();
});

test("Enhanced adds bounded selected-body fill without changing physical irradiance", () => {
  const root = new THREE.Scene();
  const visual = new SolarSystemScene(root, scenario());
  const earth = SCENARIO_BODIES.find((body) => body.id === EARTH_ID)!;
  const earthPosition = positionToSceneUnits(earth.anchor.position);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.0001, 10_000);
  camera.position.set(earthPosition.x, earthPosition.y - 1.5, earthPosition.z + 0.9);
  camera.lookAt(earthPosition.x, earthPosition.y, earthPosition.z);
  visual.update(SCENARIO_BODIES.map((body) => body.anchor));
  visual.setSelected(EARTH_ID);
  visual.setFocusId(EARTH_ID);
  visual.updatePresentation(camera, 900);

  const physicalIrradiance = visual.illuminationFor(EARTH_ID)?.totalIrradianceWattsPerSquareMeter;
  const physicalDiagnostics = visual.renderDiagnosticsFor(EARTH_ID, camera)!;
  assert.equal(visual.lightingMode(), "physical");
  assert.equal(physicalDiagnostics.inspectionFillApplied, false);
  assert.equal(physicalDiagnostics.inspectionFillContribution, 0);

  visual.setLightingMode("enhanced");
  visual.updatePresentation(camera, 900);
  const enhancedDiagnostics = visual.renderDiagnosticsFor(EARTH_ID, camera)!;
  assert.equal(enhancedDiagnostics.lightingMode, "enhanced");
  assert.equal(enhancedDiagnostics.inspectionFillApplied, true);
  assert.equal(enhancedDiagnostics.inspectionFillContribution, 0.18);
  assert.equal(visual.lightingDiagnostics().inspectionFillSource, "presentation-only artificial inspection lighting");
  assert.equal(visual.illuminationFor(EARTH_ID)?.totalIrradianceWattsPerSquareMeter, physicalIrradiance);
  assert.ok((visual.meshFor(EARTH_ID)!.layers.mask & (1 << INSPECTION_FILL_LAYER)) !== 0);
  assert.equal(root.getObjectByName("Enhanced inspection fill (presentation-only)")?.visible, true);

  visual.setLightingMode("physical");
  visual.updatePresentation(camera, 900);
  assert.equal(visual.renderDiagnosticsFor(EARTH_ID, camera)!.inspectionFillApplied, false);
  assert.equal(root.getObjectByName("Enhanced inspection fill (presentation-only)")?.visible, false);
  visual.dispose();
});

test("hierarchical LOD preserves global context while resolving only the focused local system", () => {
  const root = new THREE.Scene();
  const visual = new SolarSystemScene(root, scenario());
  const statesById = new Map(SCENARIO_BODIES.map((body) => [body.id, body.anchor]));
  for (const body of SCENARIO_BODIES) {
    const parentId = body.centralBody;
    const parent = parentId === undefined ? undefined : statesById.get(parentId);
    if (parent === undefined) continue;
    statesById.set(body.id, propagationState({
      position: {
        x: meters(parent.position.x + body.anchor.position.x),
        y: meters(parent.position.y + body.anchor.position.y),
        z: meters(parent.position.z + body.anchor.position.z),
      },
      velocity: {
        x: metersPerSecond(parent.velocity.x + body.anchor.velocity.x),
        y: metersPerSecond(parent.velocity.y + body.anchor.velocity.y),
        z: metersPerSecond(parent.velocity.z + body.anchor.velocity.z),
      },
      epoch: body.anchor.epoch,
      referenceFrame: SUN_CENTERED_FRAME,
    }));
  }
  const states = SCENARIO_BODIES.map((body) => statesById.get(body.id)!);
  const globalContextIds = SCENARIO_BODIES
    .filter((body) => body.type === ObjectType.star || body.type === ObjectType.planet)
    .map((body) => body.id);
  assert.equal(globalContextIds.length, 9);

  const jupiter = SCENARIO_BODIES.find((body) => body.id === JUPITER_ID)!;
  const jupiterPosition = positionToSceneUnits(jupiter.anchor.position);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.0001, 10_000);
  camera.position.set(jupiterPosition.x, jupiterPosition.y - 900, jupiterPosition.z + 540);
  camera.lookAt(jupiterPosition.x, jupiterPosition.y, jupiterPosition.z);
  visual.update(states);
  visual.setFocusId(SUN_ID);
  visual.updatePresentation(camera, 900);
  visual.updatePresentation(camera, 900);
  assert.equal(visual.representationFor(EUROPA_ID), "hidden");
  for (const objectId of globalContextIds) assert.notEqual(visual.representationFor(objectId), "hidden");

  visual.setFocusId(JUPITER_ID);
  camera.position.set(jupiterPosition.x, jupiterPosition.y - 1.6, jupiterPosition.z + 0.96);
  camera.lookAt(jupiterPosition.x, jupiterPosition.y, jupiterPosition.z);
  visual.updatePresentation(camera, 900);
  assert.notEqual(visual.representationFor(EUROPA_ID), "hidden");
  for (const objectId of globalContextIds) assert.notEqual(visual.representationFor(objectId), "hidden");

  visual.setSelected(EUROPA_ID);
  visual.setFocusId(EUROPA_ID);
  visual.updatePresentation(camera, 900);
  assert.notEqual(visual.representationFor(EUROPA_ID), "hidden");
  assert.equal(visual.representationFor(TITAN_ID), "hidden");
  for (const objectId of globalContextIds) assert.notEqual(visual.representationFor(objectId), "hidden");

  const markerContextId = globalContextIds.find((objectId) =>
    visual.representationFor(objectId) === "marker" && (visual.positionFor(objectId)?.lengthSq() ?? 0) > 0);
  assert.ok(markerContextId !== undefined, "expected at least one distant global-context marker");
  const markerDiagnostics = visual.renderDiagnosticsFor(markerContextId, camera);
  assert.ok(markerDiagnostics !== undefined);
  assert.equal(markerDiagnostics.submitted, true);
  assert.ok((markerDiagnostics.positionErrorSceneUnits ?? Number.POSITIVE_INFINITY) < FLOAT32_SCENE_POSITION_TOLERANCE);

  visual.setSelected(PHOBOS_ID);
  visual.setFocusId(PHOBOS_ID);
  visual.updatePresentation(camera, 900);
  assert.notEqual(visual.representationFor(PHOBOS_ID), "hidden");
  for (const objectId of globalContextIds) assert.notEqual(visual.representationFor(objectId), "hidden");
  assert.ok(visual.focusDistanceFor(PHOBOS_ID) < 1.6);
  visual.dispose();
});
