import * as THREE from "three";
import {
  CelestialSystemView,
  ORBIT_ENGINE_THREE_PACKAGE_NAME,
  createCelestialRenderSnapshot,
  createOrbitPathSnapshot,
} from "orbit-engine-three";
import { createCelestialAppearance, presentationPackageInfo } from "orbit-engine-three/presentation";
import { objectId as engineObjectId, simulationInstant, type ObjectId } from "orbit-engine";

const status = document.querySelector<HTMLParagraphElement>("#status");
const canvas = document.querySelector<HTMLCanvasElement>("#scene");
const objectId = (value: string): ObjectId => engineObjectId(value);

function setStatus(value: "ready" | "error", message: string, diagnostics: Record<string, string | number | boolean> = {}): void {
  if (status === null) return;
  status.dataset.orbitEngineThreeSmoke = value;
  for (const [key, entry] of Object.entries(diagnostics)) status.dataset[key] = String(entry);
  status.textContent = message;
}

const provenance = [{
  source: "browser-smoke",
  sourceIdentifier: "browser-smoke:representative-fixture",
  fields: ["visibleLayer", "atmosphere", "stellarEmission"],
  normalization: "fixture values are normalized for browser validation",
  limitations: "not an astronomical reference dataset",
}];

const sunId = objectId("1");
const earthId = objectId("2");
const moonId = objectId("3");
const probeId = objectId("4");
const markerObjectIds = new Set<ObjectId>([
  probeId,
  ...Array.from({ length: 2_000 }, (_, index) => objectId(String(100 + index))),
]);

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
      mieScattering: { r: 0.03, g: 0.03, b: 0.03 },
      absorption: { r: 0.01, g: 0.01, b: 0.01 },
      referenceVerticalOpticalDepth: 0.5,
      mieAnisotropy: 0,
    },
    cloudLayers: [],
  },
  provenance,
});

function orbitPath(pathObjectId: ObjectId, parentId: ObjectId | undefined, radiusMeters: number, origin: { kind: "frame" | "object"; frameId: string; objectId?: ObjectId }) {
  const samples = Array.from({ length: 32 }, (_, index) => {
    const angle = (index / 32) * Math.PI * 2;
    return {
      instant: simulationInstant(index),
      positionRelativeToOriginMeters: { x: Math.cos(angle) * radiusMeters, y: Math.sin(angle) * radiusMeters, z: 0 },
    };
  });
  return createOrbitPathSnapshot({
    objectId: pathObjectId,
    ...(parentId === undefined ? {} : { parentId }),
    origin,
    interval: { start: simulationInstant(0), end: simulationInstant(32) },
    samples,
    closedReferenceOrbit: true,
    motionRevision: "browser-smoke-motion",
    sourceRevision: "browser-smoke-source",
  });
}

function fixtureBodies(probePosition: { x: number; y: number; z: number }) {
  const markers = Array.from({ length: 2_000 }, (_, index) => {
    const angle = (index / 2_000) * Math.PI * 2;
    return {
      objectId: objectId(String(100 + index)),
      parentId: sunId,
      positionRelativeToOriginMeters: {
        x: (1.6 + Math.cos(angle) * 0.35) * 1e9,
        y: (1.8 + Math.sin(angle) * 0.35) * 1e9,
        z: (index % 7) * 1e7,
      },
      physicalRadiusMeters: 1e6,
      accentColor: 0x6688aa,
      representation: "marker" as const,
    };
  });
  return [
    {
      objectId: sunId,
      positionRelativeToOriginMeters: { x: 0, y: 0, z: 0 },
      physicalRadiusMeters: 0.7e9,
      appearance: sunAppearance,
      representation: "sphere" as const,
      accentColor: 0xffdd88,
    },
    {
      objectId: earthId,
      parentId: sunId,
      positionRelativeToOriginMeters: { x: 3e9, y: 0, z: 0 },
      physicalRadiusMeters: 0.35e9,
      appearance: earthAppearance,
      representation: "sphere" as const,
      accentColor: 0x6688dd,
    },
    {
      objectId: moonId,
      parentId: earthId,
      positionRelativeToOriginMeters: { x: 3.6e9, y: 0, z: 0 },
      physicalRadiusMeters: 0.15e9,
      representation: "sphere" as const,
      accentColor: 0xbbbbbb,
    },
    {
      objectId: probeId,
      parentId: sunId,
      positionRelativeToOriginMeters: probePosition,
      physicalRadiusMeters: 0.2e9,
      representation: "marker" as const,
      accentColor: 0xff66aa,
    },
    ...markers,
  ];
}

function fixtureSnapshot(probePosition: { x: number; y: number; z: number }) {
  return createCelestialRenderSnapshot({
    instant: simulationInstant(0),
    origin: { kind: "frame", frameId: "browser-smoke:origin" },
    revision: "browser-smoke-snapshot",
    bodies: fixtureBodies(probePosition),
    orbitPaths: [
      orbitPath(earthId, sunId, 3e9, { kind: "frame", frameId: "browser-smoke:origin" }),
      orbitPath(moonId, earthId, 0.6e9, { kind: "object", frameId: "browser-smoke:origin", objectId: earthId }),
    ],
  });
}

try {
  if (canvas === null) throw new Error("browser smoke canvas is missing");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
  renderer.setSize(640, 480, false);
  renderer.setPixelRatio(1);
  renderer.setClearColor(0x03060f, 1);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 640 / 480, 0.1, 100);
  camera.position.set(-2, 0, 6);
  camera.lookAt(3, 0, 0);
  camera.updateProjectionMatrix();

  const view = new CelestialSystemView({
    configuration: {
      radiusMode: "adaptive",
      renderSpace: { metersPerSceneUnit: 1e9 },
      orbitPaths: { defaultStyle: { color: 0x6688bb, opacity: 0.7, direction: { enabled: true } } },
      selectionIndicator: { color: 0xffffff },
      markerLayer: { pickRadiusPixels: 8 },
    },
  });
  scene.add(view.root);
  const initialSnapshot = fixtureSnapshot({ x: 100e9, y: 100e9, z: 200e9 });
  const context = {
    camera,
    cameraPositionSceneUnits: { x: -2, y: 0, z: 6 },
    viewportWidthCssPixels: 640,
    viewportHeightCssPixels: 480,
    selectedObjectId: earthId,
    focusedObjectId: earthId,
    lightingMode: "physical" as const,
    contextPriorityObjectIds: markerObjectIds,
  };
  const initial = view.update(initialSnapshot, context);
  const markerBeforeFocus = view.representationFor(probeId);
  const focused = view.update(fixtureSnapshot({ x: 3e9, y: -2e9, z: 0 }), { ...context, focusedObjectId: probeId, selectedObjectId: probeId });
  const probeAfterFocus = view.representationFor(probeId);
  const final = view.update(initialSnapshot, context);
  const diagnostics = view.diagnostics();
  if (!initial.committed || !focused.committed || !final.committed) throw new Error("snapshot resource update failed");
  if (diagnostics.bodyCount !== 2_004 || diagnostics.atmosphereCount !== 1 || diagnostics.markerCount < 2_000) throw new Error(`representative resource matrix is incomplete: ${JSON.stringify(diagnostics)}`);
  if (markerBeforeFocus !== "marker" || probeAfterFocus !== "sphere" || view.representationFor(probeId) !== "marker") throw new Error(`LOD marker/sphere transition failed: ${markerBeforeFocus}:${probeAfterFocus}:${view.representationFor(probeId)}`);

  const orbitLayer = view.root.getObjectByName("orbit-engine-three orbit layer");
  const markerLayer = view.root.getObjectByName("orbit-engine-three batched markers");
  const earthAnchor = view.bodyAnchor(earthId);
  const earthSurface = earthAnchor?.children.find((child) => child.name === `Celestial surface ${earthId}`);
  const earthMaterial = earthSurface instanceof THREE.Mesh ? earthSurface.material as THREE.ShaderMaterial : undefined;
  const lightDirection = earthMaterial?.uniforms.uLightDirections?.value?.[0] as THREE.Vector3 | undefined;
  const earthScenePosition = new THREE.Vector3(3, 0, 0).project(camera);
  const earthPick = view.pick(earthScenePosition.x, earthScenePosition.y, camera, 640, 480);
  const firstMarkerScenePosition = new THREE.Vector3(1.95, 1.8, 0);
  const firstMarkerProjection = firstMarkerScenePosition.clone().project(camera);
  const markerPick = view.pick(firstMarkerProjection.x, firstMarkerProjection.y, camera, 640, 480);
  if (orbitLayer?.userData.orbitCount !== 2) throw new Error("star/child orbit resources were not created");
  if (!(markerLayer instanceof THREE.Points) || markerLayer.geometry.getAttribute("markerSize").count !== 2_001) throw new Error("marker population was not batched");
  if (!(earthAnchor?.children.some((child) => child.name === `Atmosphere shell ${earthId}`))) throw new Error("atmosphere shell was not created");
  if (lightDirection === undefined || lightDirection.x > -0.9 || Math.abs(lightDirection.y) > 0.1) throw new Error("stellar light direction is not aligned with the star");
  if (earthPick?.objectId !== earthId || markerPick?.representation !== "marker") throw new Error("public picking did not map stable ObjectIds");
  const orbitCount = orbitLayer.userData.orbitCount as number;
  const markerCount = markerLayer instanceof THREE.Points ? markerLayer.geometry.getAttribute("markerSize").count : 0;
  const markerDrawableCount = view.root.children.filter((child) => child instanceof THREE.Points).length;
  if (markerDrawableCount !== 1) throw new Error(`marker population allocated ${markerDrawableCount} drawables`);

  scene.updateMatrixWorld(true);
  renderer.render(scene, camera);
  const gl = renderer.getContext();
  const centerPixel = new Uint8Array(4);
  gl.readPixels(320, 240, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, centerPixel);
  const centerLuminance = centerPixel[0]! + centerPixel[1]! + centerPixel[2]!;
  const renderedCalls = renderer.info.render.calls;
  if (renderedCalls <= 0 || centerLuminance <= 0) throw new Error(`WebGL renderer did not produce visible output: calls=${renderedCalls}, pixel=${[...centerPixel].join(",")}`);

  const firstResourceCount = diagnostics.packageOwnedResourceCount;
  const stable = view.update(initialSnapshot, context).diagnostics.packageOwnedResourceCount;
  if (stable !== firstResourceCount) throw new Error("repeated snapshot update changed resource count");
  const recreatedBeforeDispose = view.diagnostics().bodyCount;
  view.dispose();
  if (view.root.children.length !== 0 || !view.diagnostics().disposed) throw new Error("package-owned resources were not disposed");
  const recreatedView = new CelestialSystemView({ configuration: { renderSpace: { metersPerSceneUnit: 1e9 } } });
  const recreatedResult = recreatedView.update(initialSnapshot);
  if (!recreatedResult.committed || recreatedView.diagnostics().bodyCount !== recreatedBeforeDispose) throw new Error("resource recreation failed");
  recreatedView.dispose();

  let callerTextureDisposed = false;
  const callerTexture = new THREE.Texture();
  callerTexture.dispose = () => { callerTextureDisposed = true; };
  const ownershipView = new CelestialSystemView({ surfaceTextureProvider: () => ({ texture: callerTexture, ownership: "caller" }) });
  ownershipView.update(createCelestialRenderSnapshot({ instant: simulationInstant(0), origin: { kind: "frame", frameId: "browser-smoke:ownership" }, bodies: fixtureBodies({ x: 100e9, y: 100e9, z: 200e9 }).slice(0, 1) }));
  ownershipView.dispose();
  if (callerTextureDisposed) throw new Error("caller-owned texture was disposed by the package");
  renderer.dispose();

  setStatus(
    "ready",
    `ready:${ORBIT_ENGINE_THREE_PACKAGE_NAME}:${presentationPackageInfo.entryPoint}:resources:${diagnostics.bodyCount}:${diagnostics.atmosphereCount}`,
    {
      webgl: true,
      rendered: renderedCalls > 0,
      luminance: centerLuminance,
      orbits: orbitCount,
      markers: markerCount,
      markerDrawables: markerDrawableCount,
      pickedBody: earthPick?.objectId ?? "none",
      pickedMarker: markerPick?.objectId ?? "none",
      stableResources: stable === firstResourceCount,
      callerTexturePreserved: !callerTextureDisposed,
    },
  );
} catch (error) {
  setStatus("error", `error:${error instanceof Error ? error.message : String(error)}`);
}
