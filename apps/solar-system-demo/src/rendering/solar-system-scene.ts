import * as THREE from "three";
import {
  createCelestialRenderSnapshot,
  CelestialSystemView,
  createRenderSpaceConfig,
  applyTexturedBodyPoleAlignment,
  transformSnapshotDirectionToRenderSpace,
  transformSnapshotPositionToSceneUnits,
  type BodyRepresentation,
  type CelestialBodyRenderState,
  type CelestialRenderSnapshot,
  type CelestialRenderSnapshotInput,
  type OrbitPathSnapshot,
  type OrbitPathSnapshotInput,
  type OrbitPathStyle,
  type RenderSpaceConfig,
} from "orbit-engine-three";
import {
  deriveSurfaceReflectance,
  displayExposureDiagnostics as resolveDisplayExposureDiagnostics,
  inspectionFillContribution,
  lightingModeDiagnostics,
  resolveAtmosphereOptics,
  resolveStellarIllumination,
  type DisplayExposureDiagnostics as PresentationDisplayExposureDiagnostics,
  type LightingMode,
  type StellarIllumination,
} from "orbit-engine-three/presentation";
import {
  compareSimulationInstants,
  meters,
  ObjectType,
  simulationInstant,
  type Meters,
  type ObjectId,
  type PropagationState,
} from "orbit-engine";
import type { RegisteredScenarioBody, SolarSystemScenario } from "../scenario/load-solar-system.js";
import type { RuntimeAsteroidBody } from "../scenario/runtime-asteroid-overlay.js";
import type { OrbitPath } from "../simulation/path-sampling.js";
import {
  planetTextureAssets,
  planetTextureSetFor,
  type PlanetTextureAsset,
  type PlanetTexturePurpose,
  type PlanetTextureSet,
} from "../scenario/planet-texture-registry.js";
import {
  createEarthNightLightsMaterial,
  PlanetTextureResourceManager,
  type PlanetTextureLease,
  type PlanetTextureResourceDiagnostics,
} from "./planet-textures.js";
import {
  createProceduralSurfaceTexture,
  generateProceduralSurfaceData,
  type ProceduralSurfaceDiagnostics,
} from "./procedural-surface.js";
import { J2000_ECLIPTIC_OBLIQUITY_RADIANS } from "../coordinate-conventions.js";

export const MIN_FOCUS_DISTANCE_SCENE_UNITS = 0.000001;
export const MAX_FOCUS_DISTANCE_SCENE_UNITS = 24;
export const FOCUS_DISTANCE_RADIUS_MULTIPLIER = 24;
export const MAX_PROMOTED_RUNTIME_SPHERES = 128;
export const INSPECTION_FILL_LAYER = 1;
export const MARKER_PIXEL_SIZE = 7;

const DISPLAY_TONE_MAPPING_MODE = "ACESFilmic" as const;
const ATMOSPHERE_VIEW_SAMPLES = 8;
const ORBIT_BACKGROUND_OPACITY = 0.11;
const ORBIT_LOCAL_SYSTEM_OPACITY = 0.27;
const ORBIT_SELECTED_OPACITY = 0.34;
const CHILD_ORBIT_OPACITY = 0.3;
const CHILD_ORBIT_SELECTED_OPACITY = 1;

const PRESENTATION_AXIS_TRANSFORM = Object.freeze([
  1, 0, 0,
  0, Math.cos(J2000_ECLIPTIC_OBLIQUITY_RADIANS), Math.sin(J2000_ECLIPTIC_OBLIQUITY_RADIANS),
  0, -Math.sin(J2000_ECLIPTIC_OBLIQUITY_RADIANS), Math.cos(J2000_ECLIPTIC_OBLIQUITY_RADIANS),
] as const);

export interface SolarSystemSceneOptions {
  readonly onSelect?: (objectId: ObjectId) => void;
}

export interface StellarDirectionDiagnostics {
  readonly emitterId: ObjectId;
  readonly physicalDirectionToEmitter: Readonly<{ x: number; y: number; z: number }>;
  readonly renderDirectionToEmitter: Readonly<{ x: number; y: number; z: number }>;
  readonly shaderDirectionToEmitter: Readonly<{ x: number; y: number; z: number }>;
  readonly projectedDirection?: Readonly<{ x: number; y: number }>;
}

export interface BodyRenderDiagnostics {
  readonly objectId: ObjectId;
  readonly representation: BodyRepresentation;
  readonly submitted: boolean;
  readonly orbitVisible: boolean;
  readonly inFront: boolean;
  readonly inViewport: boolean;
  readonly ndcX: number;
  readonly ndcY: number;
  readonly ndcZ: number;
  readonly renderWorldPosition: Readonly<{ x: number; y: number; z: number }>;
  readonly markerSizePixels?: number;
  readonly positionErrorSceneUnits?: number;
  readonly surfaceReflectanceSource?: string;
  readonly surfaceTextureKind?: ProceduralSurfaceDiagnostics["kind"];
  readonly surfaceTextureLuminanceRange?: number;
  readonly planetTextureSetId?: string;
  readonly planetTextureLayers?: readonly Readonly<{
    readonly purpose: PlanetTexturePurpose;
    readonly assetKey: string;
    readonly loaded: boolean;
  }>[];
  readonly physicalIrradianceWattsPerSquareMeter?: number;
  readonly preExposureMappedIrradiance?: number;
  readonly displayExposure: number;
  readonly toneMappingMode: typeof DISPLAY_TONE_MAPPING_MODE;
  readonly lightingMode: LightingMode;
  readonly inspectionFillApplied: boolean;
  readonly inspectionFillContribution: number;
  readonly rendererInspectionFillIntensity: number;
  readonly stellarDirections: readonly StellarDirectionDiagnostics[];
}

export interface AtmosphereDiagnostics {
  readonly resourcesAllocated: boolean;
  readonly visible: boolean;
  readonly projectedDiameterPixels: number;
  readonly viewSampleCount: number;
  readonly opticalSource?: NonNullable<ReturnType<typeof resolveAtmosphereOptics>>["source"];
  readonly resolvedOptics?: ReturnType<typeof resolveAtmosphereOptics>;
}

export type OrbitGuideRole = "background" | "local-system" | "selected";
export type OrbitGuideKind = "primary" | "child";

export interface OrbitGuideDiagnostics {
  readonly objectId: ObjectId;
  readonly kind: OrbitGuideKind;
  readonly role: OrbitGuideRole;
  readonly opacity: number;
  readonly visible: boolean;
  readonly anchorPosition?: Readonly<{ x: number; y: number; z: number }>;
}

export interface LodDiagnostics {
  readonly registeredCount: number;
  readonly queriedCount: number;
  readonly hiddenCount: number;
  readonly markerCount: number;
  readonly sphereCount: number;
  readonly promotedRuntimeSphereCount: number;
}

interface PlanetLayerMeshes {
  readonly clouds?: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  readonly nightLights?: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
}

interface PlanetTextureState {
  readonly set: PlanetTextureSet;
  leases: readonly PlanetTextureLease[];
  readonly loadedKeys: Set<string>;
}

function isGlobalContextEntry(entry: RegisteredScenarioBody): boolean {
  return entry.definition.type === ObjectType.star || entry.definition.type === ObjectType.planet;
}

function physicalRadiusMeters(entry: RegisteredScenarioBody): Meters {
  const radius = entry.record.properties.physicalRadius ?? entry.definition.properties.physicalRadius;
  if (radius === undefined) throw new TypeError(`Scenario body ${entry.definition.id} has no physical radius`);
  return meters(radius);
}

function orbitSnapshotFromPath(path: OrbitPath | OrbitPathSnapshotInput): OrbitPathSnapshotInput {
  if ("focusId" in path) {
    const lastSample = path.samples[path.samples.length - 1]?.instant;
    const end = lastSample !== undefined && compareSimulationInstants(lastSample, path.interval.end) >= 0
      ? nextInstant(lastSample)
      : path.interval.end;
    return {
      objectId: path.objectId,
      parentId: path.focusId,
      origin: { kind: "object", objectId: path.focusId, frameId: path.outputFrame },
      frameId: path.outputFrame,
      interval: { start: path.interval.start, end },
      samples: path.samples.map((sample) => ({
        instant: sample.instant,
        positionRelativeToOriginMeters: sample.state.position,
      })),
      closedReferenceOrbit: path.closedReferenceOrbit,
      motionRevision: path.motionRevision,
      sourceRevision: path.configurationRevision,
    };
  }
  return path;
}

function nextInstant(value: { readonly seconds: number; readonly nanoseconds: number }): ReturnType<typeof simulationInstant> {
  return value.nanoseconds < 999_999_999
    ? simulationInstant(value.seconds, value.nanoseconds + 1)
    : simulationInstant(value.seconds + 1);
}

function orbitStyleFor(kind: OrbitGuideKind): OrbitPathStyle {
  return Object.freeze({
    color: 0x9aa7b5,
    opacity: kind === "child" ? CHILD_ORBIT_OPACITY : ORBIT_BACKGROUND_OPACITY,
    selectedOpacity: kind === "child" ? CHILD_ORBIT_SELECTED_OPACITY : ORBIT_SELECTED_OPACITY,
    depthTest: true,
    depthWrite: false,
    direction: {
      enabled: true,
      headFraction: 0.08,
      tailFraction: 0.34,
      headOpacity: 1,
      tailOpacity: 0.78,
    },
  });
}

export class SolarSystemScene {
  readonly #scene: THREE.Scene;
  readonly #view: CelestialSystemView;
  readonly #renderSpace: RenderSpaceConfig;
  readonly #committedEntries = new Map<ObjectId, RegisteredScenarioBody>();
  readonly #currentEntries = new Map<ObjectId, RegisteredScenarioBody>();
  readonly #runtimeIds = new Set<ObjectId>();
  readonly #states = new Map<ObjectId, PropagationState>();
  readonly #positions = new Map<ObjectId, THREE.Vector3>();
  readonly #representations = new Map<ObjectId, BodyRepresentation>();
  readonly #illuminationByBody = new Map<ObjectId, StellarIllumination>();
  readonly #paths = new Map<ObjectId, OrbitPathSnapshot>();
  readonly #orbitStyles = new Map<ObjectId, OrbitPathStyle>();
  readonly #surfaceTextures = new Map<ObjectId, THREE.DataTexture>();
  readonly #surfaceDiagnostics = new Map<ObjectId, ProceduralSurfaceDiagnostics>();
  readonly #planetTextureResources = new PlanetTextureResourceManager();
  readonly #planetTextureStates = new Map<ObjectId, PlanetTextureState>();
  readonly #loadedPlanetTextures = new Map<ObjectId, Map<string, THREE.Texture>>();
  readonly #planetLayerMeshes = new Map<ObjectId, PlanetLayerMeshes>();
  readonly #inspectionFillIndicator = new THREE.Object3D();
  readonly #onSelect?: (objectId: ObjectId) => void;
  #snapshot?: CelestialRenderSnapshot;
  #lastCamera?: THREE.Camera;
  #lastViewportHeight = 1_000;
  #radiusMode: "physical" | "adaptive" = "adaptive";
  #lightingMode: LightingMode = "physical";
  #selected?: ObjectId;
  #focusId?: ObjectId;
  #orbitsVisible = true;
  #queriedCount = 0;
  #promotedRuntimeSphereCount = 0;

  constructor(scene: THREE.Scene, scenario: SolarSystemScenario, options: SolarSystemSceneOptions = {}) {
    this.#scene = scene;
    this.#onSelect = options.onSelect;
    this.#renderSpace = createRenderSpaceConfig({
      metersPerSceneUnit: 149_597_870_700 / 100,
      presentationAxisTransform: PRESENTATION_AXIS_TRANSFORM,
    });
    this.#view = new CelestialSystemView({
      configuration: {
        renderSpace: this.#renderSpace,
        fallbackAccentColor: 0x808080,
        radiusMode: "adaptive",
        orbitPaths: { renderSpace: this.#renderSpace },
        // Preserve the demo's established neutral white selection ring while
        // delegating sizing and allocation to the public companion API.
        selectionIndicator: { color: 0xffffff },
      },
      surfaceTextureProvider: (body) => this.#surfaceTextureFor(body),
    });
    this.#scene.add(this.#view.root);
    this.#inspectionFillIndicator.name = "Enhanced inspection fill (presentation-only)";
    this.#inspectionFillIndicator.visible = false;
    this.#scene.add(this.#inspectionFillIndicator);
    for (const entry of scenario.bodies) {
      this.#committedEntries.set(entry.definition.id, entry);
      this.#currentEntries.set(entry.definition.id, entry);
      this.#representations.set(entry.definition.id, "sphere");
    }
  }

  setRadiusMode(mode: "physical" | "adaptive"): void {
    if (mode !== "physical" && mode !== "adaptive") throw new RangeError(`Unknown radius mode: ${String(mode)}`);
    this.#radiusMode = mode;
    this.#rerender();
  }

  radiusMode(): "physical" | "adaptive" { return this.#radiusMode; }

  setLightingMode(mode: LightingMode): void {
    this.#lightingMode = mode;
    this.#rerender();
  }

  lightingMode(): LightingMode { return this.#lightingMode; }

  setFocusId(objectId: ObjectId | undefined): void {
    if (objectId !== undefined && !this.#currentEntries.has(objectId)) throw new RangeError(`Unknown scenario body: ${objectId}`);
    this.#focusId = objectId;
    this.#rerender();
  }

  setCurrentBodies(entries: readonly RegisteredScenarioBody[]): void {
    const nextIds = new Set(entries.map((entry) => entry.definition.id));
    const nextRuntimeIds = new Set(entries.filter((entry) => !this.#committedEntries.has(entry.definition.id)).map((entry) => entry.definition.id));
    for (const objectId of [...this.#currentEntries.keys()]) {
      if (nextIds.has(objectId)) continue;
      this.#currentEntries.delete(objectId);
      this.#states.delete(objectId);
      this.#positions.delete(objectId);
      this.#representations.delete(objectId);
      this.#paths.delete(objectId);
      this.#orbitStyles.delete(objectId);
      this.#releasePlanetTextures(objectId);
      this.#surfaceTextures.get(objectId)?.dispose();
      this.#surfaceTextures.delete(objectId);
      this.#surfaceDiagnostics.delete(objectId);
      this.#removePlanetLayers(objectId);
    }
    for (const entry of entries) {
      this.#currentEntries.set(entry.definition.id, entry);
      if (!this.#representations.has(entry.definition.id)) this.#representations.set(entry.definition.id, nextRuntimeIds.has(entry.definition.id) ? "marker" : "sphere");
    }
    this.#runtimeIds.clear();
    nextRuntimeIds.forEach((objectId) => this.#runtimeIds.add(objectId));
    this.#refreshSnapshotPaths();
    this.#rerender();
  }

  setRuntimeAsteroids(bodies: readonly RuntimeAsteroidBody[]): void {
    this.setCurrentBodies([...this.#committedEntries.values(), ...bodies]);
  }

  setSelected(objectId: ObjectId | undefined): void {
    if (objectId !== undefined && !this.#currentEntries.has(objectId)) throw new RangeError(`Unknown scenario body: ${objectId}`);
    this.#selected = objectId;
    this.#rerender();
  }

  update(states: readonly PropagationState[], objectIds: readonly ObjectId[] = [...this.#currentEntries.keys()]): void {
    if (states.length !== objectIds.length) throw new RangeError(`Expected ${objectIds.length} scene states, received ${states.length}`);
    this.#queriedCount = objectIds.length;
    this.#states.clear();
    this.#positions.clear();
    const stateById = new Map(objectIds.map((objectId, index) => [objectId, states[index]!])) as Map<ObjectId, PropagationState>;
    for (const [objectId, state] of stateById) {
      this.#states.set(objectId, state);
      const position = transformSnapshotPositionToSceneUnits(state.position, this.#renderSpace);
      this.#positions.set(objectId, new THREE.Vector3(position.x, position.y, position.z));
    }
    const firstState = states[0];
    if (firstState === undefined) return;
    const bodies: CelestialBodyRenderState[] = [];
    for (const entry of this.#currentEntries.values()) {
      const state = stateById.get(entry.definition.id);
      if (state === undefined) continue;
      bodies.push({
        objectId: entry.definition.id,
        objectType: entry.definition.type,
        ...(entry.definition.centralBody === undefined ? {} : { parentId: entry.definition.centralBody }),
        positionRelativeToOriginMeters: state.position,
        velocityRelativeToOriginMetersPerSecond: state.velocity,
        physicalRadiusMeters: physicalRadiusMeters(entry),
        stateRevision: `${state.epoch.seconds}:${state.epoch.nanoseconds}`,
        propertyRevision: entry.record.propertyRevision,
        ...(entry.definition.appearance === undefined ? {} : { appearance: entry.definition.appearance }),
        accentColor: entry.definition.display.accentColor,
      });
    }
    const origin = this.#focusId === undefined
      ? { kind: "frame" as const, frameId: firstState.referenceFrame }
      : { kind: "object" as const, frameId: firstState.referenceFrame, objectId: this.#focusId };
    const input: CelestialRenderSnapshotInput = {
      instant: firstState.epoch,
      origin,
      bodies,
      ...(this.#paths.size === 0 ? {} : { orbitPaths: [...this.#paths.values()] }),
      revision: `${firstState.epoch.seconds}:${firstState.epoch.nanoseconds}`,
    };
    this.#snapshot = createCelestialRenderSnapshot(input);
    this.#resolveIllumination(bodies);
    this.#rerender();
  }

  updatePresentation(camera: THREE.Camera, viewportHeightPixels: number): void {
    this.#lastCamera = camera;
    this.#lastViewportHeight = viewportHeightPixels;
    this.#rerender();
    for (const entry of this.#currentEntries.values()) this.#updatePlanetTexturePresentation(entry);
    this.#updatePlanetLayerTransforms();
    this.#updateEarthNightLights();
  }

  pick(normalizedDeviceX: number, normalizedDeviceY: number, camera: THREE.Camera): ObjectId | undefined {
    // A centered, rendered sphere is the most specific hit target. Resolve
    // it before the companion's marker affordance so a nearby moon marker
    // cannot steal a click from the planet surface underneath it.
    const sphereHit = this.#spherePick(normalizedDeviceX, normalizedDeviceY, camera);
    if (sphereHit !== undefined) return sphereHit;
    const result = this.#view.pick(normalizedDeviceX, normalizedDeviceY, camera, this.#lastViewportHeight * (camera instanceof THREE.PerspectiveCamera ? camera.aspect : 1), this.#lastViewportHeight);
    return result?.objectId;
  }

  stateFor(objectId: ObjectId): PropagationState | undefined { return this.#states.get(objectId); }
  illuminationFor(objectId: ObjectId): StellarIllumination | undefined { return this.#illuminationByBody.get(objectId); }

  displayExposureDiagnostics(): DisplayExposureDiagnostics {
    const physical = this.#focusId === undefined ? undefined : this.#illuminationByBody.get(this.#focusId);
    const diagnostics = resolveDisplayExposureDiagnostics(physical?.contributions.length === 0 ? undefined : physical?.totalIrradianceWattsPerSquareMeter);
    return Object.freeze({ ...diagnostics, toneMappingMode: DISPLAY_TONE_MAPPING_MODE });
  }

  lightingDiagnostics(): ReturnType<typeof lightingModeDiagnostics> { return lightingModeDiagnostics(this.#lightingMode, this.#inspectionTargets()); }
  representationFor(objectId: ObjectId): BodyRepresentation | undefined { return this.#representations.get(objectId); }

  renderDiagnosticsFor(objectId: ObjectId, camera: THREE.Camera): BodyRenderDiagnostics | undefined {
    const body = this.#snapshot?.bodies.find((candidate) => candidate.objectId === objectId);
    const representation = this.#representations.get(objectId);
    const position = this.#positions.get(objectId);
    if (body === undefined || representation === undefined || position === undefined) return undefined;
    camera.updateMatrixWorld(true);
    const cameraSpace = position.clone().applyMatrix4(camera.matrixWorldInverse);
    const ndc = position.clone().project(camera);
    const marker = this.#markerFor(objectId);
    const mesh = this.meshFor(objectId);
    const illumination = this.#illuminationByBody.get(objectId);
    const bodyNdc = position.clone().project(camera);
    const stellarDirections = Object.freeze((illumination?.contributions ?? []).map((contribution) => {
      const renderDirection = transformSnapshotDirectionToRenderSpace(contribution.directionToEmitter, this.#renderSpace);
      const emitterPosition = this.#positions.get(contribution.emitterId);
      const projectedDirection = emitterPosition === undefined ? undefined : (() => {
        const emitterNdc = emitterPosition.clone().project(camera);
        const x = emitterNdc.x - bodyNdc.x;
        const y = emitterNdc.y - bodyNdc.y;
        const length = Math.hypot(x, y);
        return Object.freeze({ x: length > Number.EPSILON ? x / length : 0, y: length > Number.EPSILON ? y / length : 0 });
      })();
      return Object.freeze({
        emitterId: contribution.emitterId,
        physicalDirectionToEmitter: Object.freeze({ ...contribution.directionToEmitter }),
        renderDirectionToEmitter: renderDirection,
        shaderDirectionToEmitter: renderDirection,
        ...(projectedDirection === undefined ? {} : { projectedDirection }),
      });
    }));
    const textureSet = planetTextureSetFor(objectId);
    const textureState = this.#planetTextureStates.get(objectId);
    const fillApplied = this.#inspectionTargets().includes(objectId);
    const fill = inspectionFillContribution(this.#lightingMode);
    return Object.freeze({
      objectId,
      representation,
      submitted: representation === "marker" ? marker !== undefined : mesh?.visible === true,
      orbitVisible: this.isPathVisible(objectId),
      inFront: cameraSpace.z < 0,
      inViewport: cameraSpace.z < 0 && ndc.x >= -1 && ndc.x <= 1 && ndc.y >= -1 && ndc.y <= 1 && ndc.z >= -1 && ndc.z <= 1,
      ndcX: ndc.x,
      ndcY: ndc.y,
      ndcZ: ndc.z,
      renderWorldPosition: Object.freeze({ x: position.x, y: position.y, z: position.z }),
      ...(marker === undefined ? {} : { markerSizePixels: marker.size, positionErrorSceneUnits: marker.position.distanceTo(position) }),
      ...(mesh === undefined || marker !== undefined ? {} : {
        positionErrorSceneUnits: this.#view.bodyAnchor(objectId)?.position.distanceTo(position) ?? Number.POSITIVE_INFINITY,
      }),
      surfaceReflectanceSource: deriveSurfaceReflectance(body.appearance, body.accentColor ?? 0x808080).source,
      surfaceTextureKind: this.#surfaceDiagnostics.get(objectId)?.kind,
      surfaceTextureLuminanceRange: (() => {
        const value = this.#surfaceDiagnostics.get(objectId);
        return value === undefined ? undefined : value.maxLuminance - value.minLuminance;
      })(),
      ...(textureSet === undefined ? {} : {
        planetTextureSetId: objectId,
        planetTextureLayers: Object.freeze(planetTextureAssets(textureSet).map((asset) => Object.freeze({ purpose: asset.purpose, assetKey: asset.key, loaded: textureState?.loadedKeys.has(asset.key) ?? false }))),
      }),
      ...(illumination === undefined ? {} : {
        physicalIrradianceWattsPerSquareMeter: illumination.totalIrradianceWattsPerSquareMeter,
        preExposureMappedIrradiance: illumination.contributions[0]?.exposureMappedIrradiance,
      }),
      displayExposure: this.displayExposureDiagnostics().displayExposure,
      toneMappingMode: DISPLAY_TONE_MAPPING_MODE,
      lightingMode: this.#lightingMode,
      inspectionFillApplied: fillApplied,
      inspectionFillContribution: fillApplied ? fill : 0,
      rendererInspectionFillIntensity: fillApplied ? fill : 0,
      stellarDirections,
    });
  }

  setPath(path: OrbitPath | OrbitPathSnapshotInput): void {
    const input = orbitSnapshotFromPath(path);
    if (!this.#currentEntries.has(input.objectId)) throw new RangeError(`Unknown scenario body: ${input.objectId}`);
    const snapshot = createCelestialRenderSnapshot({ instant: input.interval.start, origin: { kind: "frame", frameId: input.origin.frameId }, bodies: [{ objectId: input.objectId, positionRelativeToOriginMeters: input.samples[0]!.positionRelativeToOriginMeters, physicalRadiusMeters: 1 }], orbitPaths: [input] }).orbitPaths![0]!;
    this.#paths.set(snapshot.objectId, snapshot);
    const parent = snapshot.parentId === undefined ? undefined : this.#currentEntries.get(snapshot.parentId);
    this.#orbitStyles.set(snapshot.objectId, orbitStyleFor(parent?.definition.type === ObjectType.star ? "primary" : "child"));
    this.#refreshSnapshotPaths();
    this.#rerender();
  }

  clearPath(objectId: ObjectId): void { this.#paths.delete(objectId); this.#orbitStyles.delete(objectId); this.#refreshSnapshotPaths(); this.#rerender(); }
  clearPaths(): void { this.#paths.clear(); this.#orbitStyles.clear(); this.#refreshSnapshotPaths(); this.#rerender(); }
  pathCount(): number { return this.#paths.size; }
  selectedOrbitActive(): boolean { return this.#selected !== undefined && this.#paths.has(this.#selected); }

  orbitGuideDiagnostics(): readonly OrbitGuideDiagnostics[] {
    return Object.freeze([...this.#paths.values()].map((path) => {
      const group = this.#view.root.getObjectByName(`Orbit ${path.objectId}`);
      const base = group?.children[0];
      const baseMaterial = base instanceof THREE.Line ? base.material : undefined;
      const parent = path.parentId === undefined ? undefined : this.#currentEntries.get(path.parentId);
      const localRoot = this.#localSystemRootFor(this.#focusId);
      const role: OrbitGuideRole = path.objectId === this.#selected ? "selected" : path.parentId === localRoot ? "local-system" : "background";
      const anchor = path.parentId === undefined ? undefined : this.#positions.get(path.parentId);
      return Object.freeze({
        objectId: path.objectId,
        kind: parent?.definition.type === ObjectType.star ? "primary" : "child",
        role,
        opacity: baseMaterial instanceof THREE.LineBasicMaterial ? baseMaterial.opacity : role === "selected" ? (parent?.definition.type === ObjectType.star ? ORBIT_SELECTED_OPACITY : CHILD_ORBIT_SELECTED_OPACITY) : role === "local-system" ? ORBIT_LOCAL_SYSTEM_OPACITY : parent?.definition.type === ObjectType.star ? ORBIT_BACKGROUND_OPACITY : CHILD_ORBIT_OPACITY,
        visible: group?.visible === true,
        ...(anchor === undefined ? {} : { anchorPosition: Object.freeze({ x: anchor.x, y: anchor.y, z: anchor.z }) }),
      });
    }));
  }

  setOrbitsVisible(visible: boolean): void { this.#orbitsVisible = Boolean(visible); this.#rerender(); }
  orbitsVisible(): boolean { return this.#orbitsVisible; }

  meshFor(objectId: ObjectId): THREE.Mesh | undefined {
    const anchor = this.#view.bodyAnchor(objectId);
    if (anchor === undefined) return undefined;
    return anchor.children.find((child): child is THREE.Mesh => child instanceof THREE.Mesh && child.userData.representation === "sphere")
      ?? anchor.children.find((child): child is THREE.Mesh => child instanceof THREE.Mesh);
  }

  positionFor(objectId: ObjectId): THREE.Vector3 | undefined { return this.#positions.get(objectId)?.clone(); }
  selectedObjectId(): ObjectId | undefined { return this.#selected; }
  markerCount(): number { return this.#markerObjectIds().length; }

  atmosphereDiagnosticsFor(objectId: ObjectId): AtmosphereDiagnostics {
    const body = this.#snapshot?.bodies.find((candidate) => candidate.objectId === objectId);
    const optics = resolveAtmosphereOptics(body?.appearance);
    const atmosphere = this.#view.bodyAnchor(objectId)?.getObjectByName(`Atmosphere shell ${objectId}`);
    return Object.freeze({
      resourcesAllocated: atmosphere !== undefined,
      visible: atmosphere?.visible === true,
      projectedDiameterPixels: this.#projectedDiameterPixels(objectId),
      viewSampleCount: ATMOSPHERE_VIEW_SAMPLES,
      ...(optics === undefined ? {} : { opticalSource: optics.source, resolvedOptics: optics }),
    });
  }

  atmosphereResourceCount(): number { return this.#view.diagnostics().atmosphereCount; }
  planetTextureResourceDiagnostics(): PlanetTextureResourceDiagnostics { return this.#planetTextureResources.diagnostics(); }

  lodDiagnostics(): LodDiagnostics {
    let hiddenCount = 0;
    let markerCount = 0;
    let sphereCount = 0;
    this.#representations.forEach((representation) => {
      if (representation === "hidden") hiddenCount += 1;
      else if (representation === "marker") markerCount += 1;
      else sphereCount += 1;
    });
    return Object.freeze({ registeredCount: this.#currentEntries.size, queriedCount: this.#queriedCount, hiddenCount, markerCount, sphereCount, promotedRuntimeSphereCount: this.#promotedRuntimeSphereCount });
  }

  focusDistanceFor(objectId: ObjectId): number {
    const entry = this.#currentEntries.get(objectId);
    if (entry === undefined) throw new RangeError(`Unknown scenario body: ${objectId}`);
    const radius = physicalRadiusMeters(entry) / this.#renderSpace.metersPerSceneUnit;
    if (entry.definition.type !== ObjectType.star) return Math.min(MAX_FOCUS_DISTANCE_SCENE_UNITS, Math.max(MIN_FOCUS_DISTANCE_SCENE_UNITS, radius * FOCUS_DISTANCE_RADIUS_MULTIPLIER));
    const position = this.#positions.get(objectId);
    if (position === undefined) return MAX_FOCUS_DISTANCE_SCENE_UNITS;
    const distances = [...this.#currentEntries.values()]
      .filter((candidate) => candidate.definition.centralBody === objectId)
      .map((candidate) => this.#positions.get(candidate.definition.id))
      .filter((candidate): candidate is THREE.Vector3 => candidate !== undefined)
      .map((candidate) => position.distanceTo(candidate));
    return Math.min(MAX_FOCUS_DISTANCE_SCENE_UNITS, Math.max(1.6, Math.max(...distances, 6) * 0.25));
  }

  dispose(): void {
    this.#view.dispose();
    this.#scene.remove(this.#inspectionFillIndicator);
    for (const objectId of [...this.#planetTextureStates.keys()]) this.#releasePlanetTextures(objectId);
    this.#planetTextureResources.dispose();
    for (const objectId of [...this.#planetLayerMeshes.keys()]) this.#removePlanetLayers(objectId);
    for (const texture of this.#surfaceTextures.values()) texture.dispose();
    this.#surfaceTextures.clear();
    this.#surfaceDiagnostics.clear();
    this.#currentEntries.clear();
    this.#states.clear();
    this.#positions.clear();
    this.#representations.clear();
    this.#illuminationByBody.clear();
    this.#paths.clear();
    this.#orbitStyles.clear();
  }

  selectFromPointer(normalizedDeviceX: number, normalizedDeviceY: number, camera: THREE.Camera): ObjectId | undefined {
    const objectId = this.pick(normalizedDeviceX, normalizedDeviceY, camera);
    if (objectId === undefined) return undefined;
    this.setSelected(objectId);
    this.#onSelect?.(objectId);
    return objectId;
  }

  #rerender(): void {
    if (this.#snapshot === undefined) return;
    const camera = this.#lastCamera;
    const selectedObjectIds = this.#selected === undefined ? new Set<ObjectId>() : new Set([this.#selected]);
    const contextPriorityObjectIds = new Set([...this.#currentEntries.values()]
      .filter(isGlobalContextEntry)
      .map((entry) => entry.definition.id));
    for (const rootId of [this.#localSystemRootFor(this.#focusId), this.#localSystemRootFor(this.#selected)]) {
      if (rootId === undefined) continue;
      for (const entry of this.#currentEntries.values()) {
        let current: ObjectId | undefined = entry.definition.id;
        while (current !== undefined) {
          if (current === rootId) {
            contextPriorityObjectIds.add(entry.definition.id);
            break;
          }
          current = this.#currentEntries.get(current)?.definition.centralBody;
        }
      }
    }
    const context = {
      camera,
      cameraPositionSceneUnits: camera?.getWorldPosition(new THREE.Vector3()),
      viewportWidthCssPixels: camera instanceof THREE.PerspectiveCamera ? this.#lastViewportHeight * camera.aspect : this.#lastViewportHeight,
      viewportHeightCssPixels: this.#lastViewportHeight,
      selectedObjectId: this.#selected,
      selectedObjectIds,
      focusedObjectId: this.#focusId,
      contextPriorityObjectIds,
      radiusMode: this.#radiusMode,
      orbitVisible: this.#orbitsVisible,
      orbitStyleByObjectId: this.#orbitStyles,
      lightingMode: this.#lightingMode,
    };
    const result = this.#view.update(this.#snapshot, context);
    if (!result.committed) throw new Error(result.diagnostics.lastFailure?.message ?? "orbit-engine-three view update failed");
    this.#representations.clear();
    for (const entry of this.#currentEntries.values()) {
      const representation = this.#view.representationFor(entry.definition.id);
      if (representation !== undefined) this.#representations.set(entry.definition.id, representation);
    }
    this.#promotedRuntimeSphereCount = [...this.#runtimeIds].filter((objectId) => this.#representations.get(objectId) === "sphere").length;
    const inspectionTargets = this.#inspectionTargets();
    this.#inspectionFillIndicator.visible = inspectionTargets.length > 0;
    for (const entry of this.#currentEntries.values()) {
      const mesh = this.meshFor(entry.definition.id);
      if (mesh === undefined) continue;
      mesh.layers.disable(INSPECTION_FILL_LAYER);
      if (inspectionTargets.includes(entry.definition.id)) mesh.layers.enable(INSPECTION_FILL_LAYER);
    }
  }

  #refreshSnapshotPaths(): void {
    if (this.#snapshot === undefined) return;
    this.#snapshot = createCelestialRenderSnapshot({
      instant: this.#snapshot.instant,
      origin: this.#snapshot.origin,
      bodies: this.#snapshot.bodies,
      revision: this.#snapshot.revision,
      ...(this.#paths.size === 0 ? {} : { orbitPaths: [...this.#paths.values()] }),
    });
  }

  #resolveIllumination(bodies: readonly CelestialBodyRenderState[]): void {
    const emitters = bodies.filter((body) => body.appearance?.stellarEmission !== undefined).map((body) => ({
      objectId: body.objectId,
      position: body.positionRelativeToOriginMeters,
      effectiveTemperatureKelvin: body.appearance!.stellarEmission!.effectiveTemperatureKelvin,
      luminosityWatts: body.appearance!.stellarEmission!.luminosityWatts,
    }));
    this.#illuminationByBody.clear();
    for (const body of bodies) {
      try {
        this.#illuminationByBody.set(body.objectId, resolveStellarIllumination(body.positionRelativeToOriginMeters, emitters.filter((emitter) => emitter.objectId !== body.objectId)));
      } catch {
        this.#illuminationByBody.set(body.objectId, resolveStellarIllumination(body.positionRelativeToOriginMeters, []));
      }
    }
  }

  #surfaceTextureFor(body: CelestialBodyRenderState): { readonly texture: THREE.Texture; readonly ownership: "caller" } | undefined {
    const textureSet = planetTextureSetFor(body.objectId);
    const loaded = this.#loadedPlanetTextures.get(body.objectId);
    if (textureSet !== undefined && loaded !== undefined) {
      const primary = loaded.get(textureSet.primary.key);
      if (primary !== undefined) return { texture: primary, ownership: "caller" };
    }
    if (textureSet !== undefined || body.appearance === undefined || body.objectType === ObjectType.star) return undefined;
    let texture = this.#surfaceTextures.get(body.objectId);
    if (texture === undefined) {
      const surface = generateProceduralSurfaceData(body.objectId, body.appearance, deriveSurfaceReflectance(body.appearance, body.accentColor ?? 0x808080).linearReflectance);
      if (surface === undefined) return undefined;
      texture = createProceduralSurfaceTexture(surface);
      this.#surfaceTextures.set(body.objectId, texture);
      this.#surfaceDiagnostics.set(body.objectId, surface);
    }
    return { texture, ownership: "caller" };
  }

  #updatePlanetTexturePresentation(entry: RegisteredScenarioBody): void {
    const textureSet = planetTextureSetFor(entry.definition.id);
    if (textureSet === undefined || this.#representations.get(entry.definition.id) !== "sphere") {
      this.#releasePlanetTextures(entry.definition.id);
      return;
    }
    let state = this.#planetTextureStates.get(entry.definition.id);
    if (state === undefined) {
      state = { set: textureSet, leases: [], loadedKeys: new Set() };
      this.#planetTextureStates.set(entry.definition.id, state);
      this.#ensurePlanetLayerMeshes(entry.definition.id, textureSet);
      state.leases = planetTextureAssets(textureSet).map((asset) => this.#planetTextureResources.acquire(asset, (texture) => this.#applyPlanetTexture(entry.definition.id, asset, texture)));
    }
  }

  #ensurePlanetLayerMeshes(objectId: ObjectId, textureSet: PlanetTextureSet): void {
    if (this.#planetLayerMeshes.has(objectId)) return;
    let clouds: PlanetLayerMeshes["clouds"];
    if (textureSet.clouds !== undefined) {
      clouds = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.88, depthWrite: false }));
      clouds.name = `Cloud layer ${objectId}`;
      clouds.userData.objectId = objectId;
      applyTexturedBodyPoleAlignment(clouds);
      clouds.visible = false;
      clouds.renderOrder = 1;
      this.#scene.add(clouds);
    }
    let nightLights: PlanetLayerMeshes["nightLights"];
    if (textureSet.nightLights !== undefined) {
      nightLights = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), createEarthNightLightsMaterial());
      nightLights.name = `Night lights layer ${objectId}`;
      nightLights.userData.objectId = objectId;
      applyTexturedBodyPoleAlignment(nightLights);
      nightLights.visible = false;
      nightLights.renderOrder = 3;
      this.#scene.add(nightLights);
    }
    this.#planetLayerMeshes.set(objectId, { clouds, nightLights });
  }

  #applyPlanetTexture(objectId: ObjectId, asset: PlanetTextureAsset, texture: THREE.Texture): void {
    const state = this.#planetTextureStates.get(objectId);
    if (state === undefined) return;
    state.loadedKeys.add(asset.key);
    let loaded = this.#loadedPlanetTextures.get(objectId);
    if (loaded === undefined) {
      loaded = new Map();
      this.#loadedPlanetTextures.set(objectId, loaded);
    }
    loaded.set(asset.key, texture);
    const layers = this.#planetLayerMeshes.get(objectId);
    if (asset === state.set.clouds && layers?.clouds !== undefined) {
      layers.clouds.material.map = texture;
      layers.clouds.material.needsUpdate = true;
      layers.clouds.visible = true;
    }
    if (asset === state.set.nightLights && layers?.nightLights !== undefined) {
      layers.nightLights.material.uniforms.uMap!.value = texture;
      layers.nightLights.material.needsUpdate = true;
      layers.nightLights.visible = true;
    }
    this.#rerender();
  }

  #releasePlanetTextures(objectId: ObjectId): void {
    const state = this.#planetTextureStates.get(objectId);
    if (state !== undefined) {
      state.leases.forEach((lease) => lease.release());
      this.#planetTextureStates.delete(objectId);
    }
    this.#loadedPlanetTextures.delete(objectId);
    this.#removePlanetLayers(objectId);
  }

  #removePlanetLayers(objectId: ObjectId): void {
    const layers = this.#planetLayerMeshes.get(objectId);
    if (layers === undefined) return;
    for (const layer of [layers.clouds, layers.nightLights]) {
      if (layer === undefined) continue;
      this.#scene.remove(layer);
      layer.geometry.dispose();
      layer.material.dispose();
    }
    this.#planetLayerMeshes.delete(objectId);
  }

  #updatePlanetLayerTransforms(): void {
    for (const [objectId, layers] of this.#planetLayerMeshes) {
      const body = this.meshFor(objectId);
      const anchor = this.#view.bodyAnchor(objectId);
      if (body === undefined || anchor === undefined) continue;
      for (const layer of [layers.clouds, layers.nightLights]) {
        if (layer === undefined) continue;
        layer.position.copy(anchor.position);
        layer.scale.copy(body.scale).multiplyScalar(layer === layers.clouds ? 1.006 : 1.009);
      }
    }
  }

  #updateEarthNightLights(): void {
    for (const [objectId, layers] of this.#planetLayerMeshes) {
      const layer = layers.nightLights;
      if (layer === undefined) continue;
      const direction = layer.material.uniforms.uLightDirection!.value as THREE.Vector3;
      const contribution = this.#illuminationByBody.get(objectId)?.contributions[0];
      if (contribution === undefined) direction.set(0, 1, 0);
      else {
        const render = transformSnapshotDirectionToRenderSpace(contribution.directionToEmitter, this.#renderSpace);
        direction.set(render.x, render.y, render.z).normalize();
      }
    }
  }

  #inspectionTargets(): ObjectId[] {
    if (this.#lightingMode !== "enhanced") return [];
    return [this.#selected, this.#focusId]
      .filter((objectId): objectId is ObjectId => objectId !== undefined && this.#representations.get(objectId) === "sphere")
      .filter((objectId, index, values) => values.indexOf(objectId) === index);
  }

  #markerObjectIds(): readonly ObjectId[] {
    const points = this.#view.root.getObjectByName("orbit-engine-three batched markers");
    return (points?.userData.objectIds as readonly ObjectId[] | undefined) ?? [];
  }

  #markerFor(objectId: ObjectId): { readonly position: THREE.Vector3; readonly size: number } | undefined {
    const ids = this.#markerObjectIds();
    const index = ids.indexOf(objectId);
    if (index < 0) return undefined;
    const points = this.#view.root.getObjectByName("orbit-engine-three batched markers");
    if (!(points instanceof THREE.Points)) return undefined;
    const position = points?.geometry.getAttribute("position");
    const sizes = points?.geometry.getAttribute("markerSize");
    if (!(position instanceof THREE.BufferAttribute) || !(sizes instanceof THREE.BufferAttribute)) return undefined;
    return { position: new THREE.Vector3(position.getX(index), position.getY(index), position.getZ(index)), size: sizes.getX(index) };
  }

  #spherePick(normalizedDeviceX: number, normalizedDeviceY: number, camera: THREE.Camera): ObjectId | undefined {
    this.#view.root.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(normalizedDeviceX, normalizedDeviceY), camera);
    const meshes = [...this.#currentEntries.keys()]
      .filter((objectId) => this.#representations.get(objectId) === "sphere")
      .map((objectId) => this.meshFor(objectId))
      .filter((mesh): mesh is THREE.Mesh => mesh !== undefined && mesh.visible);
    const hit = raycaster.intersectObjects(meshes, false)[0];
    return hit?.object.userData.objectId as ObjectId | undefined;
  }

  #projectedDiameterPixels(objectId: ObjectId): number {
    const mesh = this.meshFor(objectId);
    const position = this.#positions.get(objectId);
    if (mesh === undefined || position === undefined || !(this.#lastCamera instanceof THREE.PerspectiveCamera)) return 0;
    const distance = Math.max(this.#lastCamera.position.distanceTo(position), mesh.scale.x * 2, Number.EPSILON);
    return mesh.scale.x / distance / Math.tan(this.#lastCamera.fov * Math.PI / 360) * this.#lastViewportHeight;
  }

  #localSystemRootFor(objectId: ObjectId | undefined): ObjectId | undefined {
    if (objectId === undefined) return undefined;
    const entry = this.#currentEntries.get(objectId);
    if (entry === undefined || entry.definition.type === ObjectType.star) return undefined;
    if ([...this.#currentEntries.values()].some((candidate) => candidate.definition.centralBody === objectId)) return objectId;
    const parent = entry.definition.centralBody === undefined ? undefined : this.#currentEntries.get(entry.definition.centralBody);
    return parent?.definition.type === ObjectType.star ? undefined : entry.definition.centralBody;
  }

  isPathVisible(objectId: ObjectId): boolean {
    return this.#view.root.getObjectByName(`Orbit ${objectId}`)?.visible === true && this.#orbitsVisible;
  }
}

interface DisplayExposureDiagnostics extends PresentationDisplayExposureDiagnostics {
  readonly toneMappingMode: typeof DISPLAY_TONE_MAPPING_MODE;
}
