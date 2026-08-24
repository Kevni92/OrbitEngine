import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { objectId, simulationInstant } from "orbit-engine";
import {
  CelestialSystemView,
  createCelestialRenderSnapshot,
  createRenderSpaceConfig,
  transformSnapshotPositionToSceneUnits,
} from "../dist/index.js";
import { createCelestialAppearance } from "../dist/presentation.js";

const SUN_ID = objectId("1");
const EARTH_ID = objectId("2");
const MOON_ID = objectId("3");

const provenance = [{
  source: "test",
  sourceIdentifier: "test:render-view",
  fields: ["visibleLayer", "atmosphere", "stellarEmission"],
  normalization: "test values are normalized",
  limitations: "test fixture",
}];

const sunAppearance = createCelestialAppearance({
  schemaVersion: "1.0",
  stellarEmission: { effectiveTemperatureKelvin: 5772, luminosityWatts: 3.828e26 },
  provenance,
});

const earthAppearance = createCelestialAppearance({
  schemaVersion: "1.0",
  visibleLayer: { kind: "solidSurface", composition: [{ materialId: "basaltic-rock", fraction: 1 }] },
  atmosphere: {
    referencePressurePa: 101325,
    scaleHeightMeters: 8500,
    gases: [{ gasId: "N2", mixingRatio: 1 }],
    optics: {
      rayleighScattering: { r: 0.1, g: 0.2, b: 0.9 },
      mieScattering: { r: 0.05, g: 0.04, b: 0.03 },
      absorption: { r: 0.01, g: 0.02, b: 0.03 },
      referenceVerticalOpticalDepth: 0.5,
      mieAnisotropy: 0.1,
    },
    cloudLayers: [],
  },
  provenance,
});

function snapshot(bodies) {
  return createCelestialRenderSnapshot({
    instant: simulationInstant(100, 5),
    origin: { kind: "frame", frameId: "test:ssb-origin" },
    bodies,
    revision: "test-revision",
  });
}

function body(objectId, position, options = {}) {
  return {
    objectId,
    positionRelativeToOriginMeters: position,
    physicalRadiusMeters: options.radius ?? 1e6,
    accentColor: options.accentColor ?? 0x6688aa,
    ...options,
  };
}

test("snapshot and render-space conversion are immutable and origin-relative", () => {
  const renderSpace = createRenderSpaceConfig({
    metersPerSceneUnit: 1e9,
    presentationAxisTransform: [0, -1, 0, 1, 0, 0, 0, 0, 1],
  });
  assert.deepEqual(transformSnapshotPositionToSceneUnits({ x: 1e9, y: 2e9, z: 3e9 }, renderSpace), { x: -2, y: 1, z: 3 });
  const value = snapshot([body(EARTH_ID, { x: 1e9, y: 2e9, z: 3e9 })]);
  assert.equal(Object.isFrozen(value), true);
  assert.equal(Object.isFrozen(value.bodies), true);
  assert.equal(Object.isFrozen(value.bodies[0].positionRelativeToOriginMeters), true);
  assert.equal(value.origin.frameId, "test:ssb-origin");
  assert.notEqual(snapshot([body(EARTH_ID, { x: 1e9, y: 2e9, z: 3e9 })]).fingerprint, snapshot([body(EARTH_ID, { x: 1e9, y: 2e9, z: 4e9 })]).fingerprint);
  assert.throws(() => snapshot([body(EARTH_ID, { x: 0, y: 0, z: 0 }), body(EARTH_ID, { x: 1, y: 0, z: 0 })]), /duplicate objectId/);
});

test("view creates composed star, planet, moon, and bounded atmosphere resources", () => {
  const view = new CelestialSystemView({ configuration: { renderSpace: { metersPerSceneUnit: 1e9 } } });
  const renderSnapshot = snapshot([
    body(SUN_ID, { x: 0, y: 0, z: 0 }, { radius: 696_340_000, appearance: sunAppearance }),
    body(EARTH_ID, { x: 149_597_870_700, y: 0, z: 0 }, { radius: 6_371_000, parentId: SUN_ID, appearance: earthAppearance }),
    body(MOON_ID, { x: 149_597_870_700, y: 384_400_000, z: 0 }, { radius: 1_737_000, parentId: EARTH_ID }),
  ]);
  const result = view.update(renderSnapshot, { cameraPositionSceneUnits: { x: 0, y: 0, z: 300 } });
  assert.equal(result.committed, true);
  assert.equal(view.root.children.length, 3);
  assert.deepEqual(view.diagnostics(), {
    disposed: false,
    bodyCount: 3,
    sphereCount: 3,
    markerCount: 0,
    hiddenCount: 0,
    atmosphereCount: 1,
    packageOwnedResourceCount: 13,
    committedSnapshotFingerprint: renderSnapshot.fingerprint,
  });
  const earthAnchor = view.bodyAnchor(EARTH_ID);
  assert.ok(earthAnchor);
  assert.equal(earthAnchor.children.length, 2);
  assert.equal(earthAnchor.children[1].name, `Atmosphere shell ${EARTH_ID}`);
  assert.match(earthAnchor.children[1].material.fragmentShader, /sampleIndex/);
  assert.equal(earthAnchor.position.x, 149.5978707);
  assert.equal(view.update(renderSnapshot).committed, true);
  assert.equal(view.root.children.length, 3);
  assert.strictEqual(view.bodyAnchor(EARTH_ID), earthAnchor);
  view.dispose();
  assert.equal(view.root.children.length, 0);
  assert.equal(view.diagnostics().disposed, true);
  assert.equal(view.diagnostics().bodyCount, 0);
});

test("failed staged allocation preserves committed resources and disposal honors ownership", () => {
  const baseSnapshot = snapshot([body(EARTH_ID, { x: 0, y: 0, z: 0 })]);
  const failingId = objectId("9");
  const failingSnapshot = snapshot([body(EARTH_ID, { x: 0, y: 0, z: 0 }), body(failingId, { x: 1e9, y: 0, z: 0 })]);
  const view = new CelestialSystemView({ surfaceTextureProvider: (bodyState) => {
    if (bodyState.objectId === failingId) throw new Error("test texture allocation failure");
    return undefined;
  } });
  assert.equal(view.update(baseSnapshot).committed, true);
  const before = view.diagnostics();
  const failed = view.update(failingSnapshot);
  assert.equal(failed.committed, false);
  assert.equal(view.diagnostics().bodyCount, before.bodyCount);
  assert.equal(view.diagnostics().committedSnapshotFingerprint, before.committedSnapshotFingerprint);
  assert.equal(view.diagnostics().lastFailure.code, "resourceAllocation");
  view.dispose();

  let callerDisposeCount = 0;
  let packageDisposeCount = 0;
  const callerTexture = new THREE.Texture();
  callerTexture.dispose = () => { callerDisposeCount += 1; };
  const packageTexture = new THREE.Texture();
  packageTexture.dispose = () => { packageDisposeCount += 1; };
  const ownedView = new CelestialSystemView({ surfaceTextureProvider: (bodyState) => ({
    texture: bodyState.objectId === EARTH_ID ? callerTexture : packageTexture,
    ownership: bodyState.objectId === EARTH_ID ? "caller" : "package",
  }) });
  assert.equal(ownedView.update(baseSnapshot).committed, true);
  assert.equal(ownedView.update(snapshot([body(failingId, { x: 0, y: 0, z: 0 })])).committed, true);
  ownedView.dispose();
  assert.equal(callerDisposeCount, 0);
  assert.equal(packageDisposeCount, 1);
});

test("updates never render or own a loop and disposed views reject later snapshots structurally", () => {
  const view = new CelestialSystemView();
  view.dispose();
  const result = view.update(snapshot([body(EARTH_ID, { x: 0, y: 0, z: 0 })]));
  assert.equal(result.committed, false);
  assert.equal(result.diagnostics.lastFailure.code, "disposed");
  assert.equal("render" in view, false);
  assert.equal("requestAnimationFrame" in view, false);
});

test("camera-aware policy batches marker bodies, keeps hierarchy generic, and picks stable ids", () => {
  const rootId = objectId("10");
  const markerId = objectId("20");
  const view = new CelestialSystemView({
    configuration: { radiusMode: "physical", renderSpace: { metersPerSceneUnit: 1 } },
  });
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1_000);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  const renderSnapshot = snapshot([
    body(rootId, { x: 0, y: 0, z: 0 }, { radius: 1 }),
    body(markerId, { x: 20, y: 0, z: -90 }, { radius: 0.1, parentId: rootId }),
  ]);
  const result = view.update(renderSnapshot, {
    camera,
    viewportWidthCssPixels: 800,
    viewportHeightCssPixels: 800,
    contextPriorityObjectIds: new Set([markerId]),
  });
  assert.equal(result.committed, true);
  assert.deepEqual(view.diagnostics(), {
    disposed: false,
    bodyCount: 2,
    sphereCount: 1,
    markerCount: 1,
    hiddenCount: 0,
    atmosphereCount: 0,
    packageOwnedResourceCount: 7,
    committedSnapshotFingerprint: result.snapshotFingerprint,
  });
  const markerLayer = view.root.getObjectByName("orbit-engine-three batched markers");
  assert.ok(markerLayer instanceof THREE.Points);
  assert.equal(view.bodyAnchor(markerId)?.children.length, 0);
  assert.ok(markerLayer.geometry.getAttribute("markerSize").getX(0) < 2, "physical marker size must remain projected physical size");
  assert.deepEqual(view.pick(0.346, 0, camera, 800, 800)?.objectId, markerId);
  view.dispose();
  assert.equal(view.root.getObjectByName("orbit-engine-three batched markers"), undefined);
});
