import * as THREE from "three";
import {
  meters,
  ObjectType,
  type Meters,
  type ObjectId,
  type PropagationState,
} from "orbit-engine";
import {
  blackbodyTemperatureToLinearRgb,
  deriveSurfaceReflectance,
  REFERENCE_IRRADIANCE_WATTS_PER_SQUARE_METER,
  resolveStellarIllumination,
  type StellarEmitter,
  type StellarIlluminationSet,
} from "./celestial-appearance-rendering.js";
import type { RegisteredScenarioBody, SolarSystemScenario } from "../scenario/load-solar-system.js";
import type { RuntimeAsteroidBody } from "../scenario/runtime-asteroid-overlay.js";
import type { OrbitPath } from "../simulation/path-sampling.js";
import { OrbitRenderer } from "./orbit-renderer.js";
import type { OrbitGuideDiagnostics } from "./orbit-renderer.js";
import {
  adaptiveRadiusPixels,
  cappedAdaptiveRadiusSceneUnits,
  projectedPixelsToSceneRadius,
  projectedRadiusPixels,
} from "./adaptive-sizing.js";
import {
  Representation,
  transitionRepresentation,
  type LodDiagnostics,
  type RepresentationLevel,
} from "./representation-lod.js";
import { METERS_PER_SCENE_UNIT, positionToSceneUnits, radiusToSceneUnits, type RadiusMode } from "./render-space.js";
import { MARKER_PIXEL_SIZE, BatchedMarkerLayer } from "./runtime-asteroid-markers.js";
import { SelectionHalo } from "./selection-halo.js";
import { AtmosphereShellManager, type AtmosphereDiagnostics } from "./atmosphere-rendering.js";
import {
  inspectionFillContribution,
  lightingModeDiagnostics,
  parseLightingMode,
  type LightingMode,
  type LightingModeDiagnostics,
} from "./lighting-mode.js";

export const MIN_FOCUS_DISTANCE_SCENE_UNITS = 0.000001;
export const MAX_FOCUS_DISTANCE_SCENE_UNITS = 24;
export const FOCUS_DISTANCE_RADIUS_MULTIPLIER = 24;
export const MAX_PROMOTED_RUNTIME_SPHERES = 128;
export const INSPECTION_FILL_LAYER = 1;

interface SceneBody {
  readonly objectId: ObjectId;
  readonly physicalRadiusMeters: Meters;
  readonly parentId?: ObjectId;
  readonly type: RegisteredScenarioBody["definition"]["type"];
  readonly mesh: THREE.Mesh;
}

export interface SolarSystemSceneOptions {
  readonly onSelect?: (objectId: ObjectId) => void;
}

export interface BodyRenderDiagnostics {
  readonly objectId: ObjectId;
  readonly representation: RepresentationLevel;
  readonly submitted: boolean;
  readonly orbitVisible: boolean;
  readonly inFront: boolean;
  readonly inViewport: boolean;
  readonly ndcX: number;
  readonly ndcY: number;
  readonly ndcZ: number;
  readonly positionErrorSceneUnits?: number;
  readonly surfaceReflectanceSource?: string;
  readonly physicalIrradianceWattsPerSquareMeter?: number;
  readonly lightingMode: LightingMode;
  readonly inspectionFillApplied: boolean;
  readonly inspectionFillContribution: number;
}

function isGlobalContextEntry(entry: RegisteredScenarioBody): boolean {
  return entry.definition.type === ObjectType.star || entry.definition.type === ObjectType.planet;
}

/**
 * Presentation-only scene graph. Body positions are always copied from the
 * public engine state snapshots supplied to update(); this class never steps
 * or derives orbital motion.
 */
export class SolarSystemScene {
  readonly #scene: THREE.Scene;
  readonly #bodies = new Map<ObjectId, SceneBody>();
  readonly #committedEntries = new Map<ObjectId, RegisteredScenarioBody>();
  readonly #currentEntries = new Map<ObjectId, RegisteredScenarioBody>();
  readonly #runtimeIds = new Set<ObjectId>();
  readonly #runtimeSphereMeshes = new Map<ObjectId, THREE.Mesh<THREE.SphereGeometry, THREE.MeshLambertMaterial>>();
  readonly #runtimeSphereGeometry: THREE.SphereGeometry;
  readonly #runtimeSphereMaterial: THREE.MeshLambertMaterial;
  readonly #stellarLights = new Map<ObjectId, THREE.PointLight>();
  readonly #illuminationByBody = new Map<ObjectId, StellarIlluminationSet>();
  readonly #representations = new Map<ObjectId, RepresentationLevel>();
  readonly #orbitRenderer: OrbitRenderer;
  readonly #markerLayer: BatchedMarkerLayer;
  readonly #states = new Map<ObjectId, PropagationState>();
  readonly #positions = new Map<ObjectId, THREE.Vector3>();
  readonly #onSelect?: (objectId: ObjectId) => void;
  readonly #selectionHalo: SelectionHalo;
  readonly #atmosphereShells: AtmosphereShellManager;
  readonly #inspectionFillLight: THREE.PointLight;
  readonly #inspectionFillTargets = new Set<ObjectId>();
  #radiusMode: RadiusMode = "adaptive";
  #lightingMode: LightingMode = "physical";
  #selected?: ObjectId;
  #focusId?: ObjectId;
  #queriedCount = 0;
  #markerMembershipKey = "";
  #promotedRuntimeSphereCount = 0;

  constructor(scene: THREE.Scene, scenario: SolarSystemScenario, options: SolarSystemSceneOptions = {}) {
    this.#scene = scene;
    this.#onSelect = options.onSelect;
    this.#orbitRenderer = new OrbitRenderer(scene);
    this.#markerLayer = new BatchedMarkerLayer(scene);
    this.#runtimeSphereGeometry = new THREE.SphereGeometry(1, 20, 12);
    this.#runtimeSphereMaterial = new THREE.MeshLambertMaterial({ color: new THREE.Color(0.32, 0.32, 0.32) });
    this.#selectionHalo = new SelectionHalo(scene);
    this.#atmosphereShells = new AtmosphereShellManager(scene);
    this.#inspectionFillLight = new THREE.PointLight(new THREE.Color(1, 1, 1), 0, 0, 0);
    this.#inspectionFillLight.name = "Enhanced inspection fill (presentation-only)";
    this.#inspectionFillLight.layers.set(INSPECTION_FILL_LAYER);
    this.#inspectionFillLight.visible = false;
    this.#scene.add(this.#inspectionFillLight);

    for (const entry of scenario.bodies) {
      this.#committedEntries.set(entry.definition.id, entry);
      this.#currentEntries.set(entry.definition.id, entry);
      this.#addBody(entry);
      this.#representations.set(entry.definition.id, Representation.sphere);
    }
  }

  setRadiusMode(mode: RadiusMode): void {
    if (mode !== "physical" && mode !== "adaptive") throw new RangeError(`Unknown radius mode: ${String(mode)}`);
    this.#radiusMode = mode;
  }

  radiusMode(): RadiusMode {
    return this.#radiusMode;
  }

  setLightingMode(mode: LightingMode): void {
    this.#lightingMode = parseLightingMode(mode);
    this.#inspectionFillLight.visible = false;
    this.#inspectionFillLight.intensity = inspectionFillContribution(this.#lightingMode);
  }

  lightingMode(): LightingMode {
    return this.#lightingMode;
  }

  setFocusId(objectId: ObjectId | undefined): void {
    if (objectId !== undefined && !this.#currentEntries.has(objectId)) {
      throw new RangeError(`Unknown scenario body: ${objectId}`);
    }
    this.#focusId = objectId;
    const focus = objectId === undefined ? undefined : this.#currentEntries.get(objectId);
    const localSystemRootId = focus?.definition.type === ObjectType.moon
      ? focus.definition.centralBody
      : focus?.definition.type === ObjectType.planet
        ? focus.definition.id
        : undefined;
    this.#orbitRenderer.setLocalSystemRoot(localSystemRootId);
  }

  /** Updates the combined committed-plus-runtime membership without changing engine state. */
  setCurrentBodies(entries: readonly RegisteredScenarioBody[]): void {
    const nextIds = new Set(entries.map((entry) => entry.definition.id));
    const nextRuntimeIds = new Set(entries
      .filter((entry) => !this.#committedEntries.has(entry.definition.id))
      .map((entry) => entry.definition.id));
    for (const objectId of [...this.#currentEntries.keys()]) {
      if (nextIds.has(objectId)) continue;
      this.#currentEntries.delete(objectId);
      this.#representations.delete(objectId);
      this.#states.delete(objectId);
      this.#positions.delete(objectId);
      this.#removeRuntimeSphere(objectId);
      this.#atmosphereShells.remove(objectId);
    }
    for (const entry of entries) {
      const objectId = entry.definition.id;
      this.#currentEntries.set(objectId, entry);
      if (!this.#representations.has(objectId)) {
        this.#representations.set(objectId, nextRuntimeIds.has(objectId) ? Representation.marker : Representation.sphere);
      }
    }
    this.#runtimeIds.clear();
    for (const objectId of nextRuntimeIds) this.#runtimeIds.add(objectId);
    this.#markerMembershipKey = "";
  }

  /** Stage-A compatibility wrapper; Stage B uses setCurrentBodies for the unified layer. */
  setRuntimeAsteroids(bodies: readonly RuntimeAsteroidBody[]): void {
    this.setCurrentBodies([...this.#committedEntries.values(), ...bodies]);
  }

  setSelected(objectId: ObjectId | undefined): void {
    if (objectId !== undefined && !this.#currentEntries.has(objectId)) {
      throw new RangeError(`Unknown scenario body: ${objectId}`);
    }
    this.#selected = objectId;
    this.#orbitRenderer.setSelected(objectId);
    this.#updateSelectionHalo(undefined);
  }

  update(states: readonly PropagationState[], objectIds: readonly ObjectId[] = [...this.#bodies.keys()]): void {
    if (states.length !== objectIds.length) {
      throw new RangeError(`Expected ${objectIds.length} scene states, received ${states.length}`);
    }
    this.#queriedCount = objectIds.length;
    const stateById = new Map(objectIds.map((objectId, index) => [objectId, states[index]!]));
    for (const [objectId] of this.#currentEntries) {
      const state = stateById.get(objectId);
      if (state === undefined) continue;
      const position = positionToSceneUnits(state.position);
      const staticBody = this.#bodies.get(objectId);
      if (staticBody !== undefined) staticBody.mesh.position.set(position.x, position.y, position.z);
      const runtimeMesh = this.#runtimeSphereMeshes.get(objectId);
      if (runtimeMesh !== undefined) runtimeMesh.position.set(position.x, position.y, position.z);
      this.#positions.set(objectId, new THREE.Vector3(position.x, position.y, position.z));
      this.#states.set(objectId, state);
    }
    this.#markerLayer.update(objectIds, states);
    this.#updateStellarLighting(stateById);
    this.#orbitRenderer.updateBodyPositions(new Map(
      [...this.#positions].map(([objectId, position]) => [objectId, position.clone()]),
    ));
    this.#updateSelectionHalo(undefined);
  }

  /** Re-evaluates persistent LOD state for camera, hierarchy, focus, selection and viewport changes. */
  updatePresentation(camera: THREE.Camera, viewportHeightPixels: number): void {
    camera.layers.enable(INSPECTION_FILL_LAYER);
    const perspective = camera instanceof THREE.PerspectiveCamera ? camera : undefined;
    const orderedEntries = [...this.#currentEntries.values()].sort((left, right) => this.#depth(left) - this.#depth(right));
    const forcedAncestors = this.#ancestorIds(new Set([this.#selected, this.#focusId].filter((id): id is ObjectId => id !== undefined)));
    const next = new Map<ObjectId, RepresentationLevel>();

    for (const entry of orderedEntries) {
      const objectId = entry.definition.id;
      const previous = this.#representations.get(objectId);
      const position = this.#positions.get(objectId);
      if (perspective === undefined || position === undefined) {
        const fallback = this.#runtimeIds.has(objectId) ? Representation.marker : (previous ?? Representation.hidden);
        next.set(objectId, isGlobalContextEntry(entry) && fallback === Representation.hidden ? Representation.marker : fallback);
        continue;
      }
      const physicalRadius = radiusToSceneUnits({
        mode: "physical",
        physicalRadiusMeters: meters(entry.record.properties.physicalRadius ?? entry.definition.properties.physicalRadius ?? 0),
      });
      const distance = Math.max(camera.position.distanceTo(position), physicalRadius * 2, Number.EPSILON);
      const fieldOfView = perspective.fov * Math.PI / 180;
      const physicalRadiusPixels = projectedRadiusPixels(physicalRadius, distance, fieldOfView, viewportHeightPixels);
      const physicalDiameterPixels = physicalRadiusPixels * 2;
      const parentId = entry.definition.centralBody;
      const isMoon = entry.definition.type === ObjectType.moon && parentId !== undefined;
      const parentRepresentation = parentId === undefined ? undefined : next.get(parentId);
      const hierarchyEligible = !isMoon
        || parentRepresentation === Representation.sphere
        || parentId === this.#focusId
        || forcedAncestors.has(parentId!);
      const prominencePixels = isMoon && hierarchyEligible
        ? adaptiveRadiusPixels(physicalRadiusPixels) * 2
        : physicalDiameterPixels;
      next.set(objectId, transitionRepresentation(previous, {
        physicalDiameterPixels: prominencePixels,
        hierarchyEligible,
        selected: objectId === this.#selected || forcedAncestors.has(objectId),
        focused: objectId === this.#focusId,
        minimumRepresentation: isGlobalContextEntry(entry) ? Representation.marker : undefined,
      }));
    }

    const runtimeSphereCandidates = orderedEntries
      .filter((entry) => this.#runtimeIds.has(entry.definition.id) && next.get(entry.definition.id) === Representation.sphere)
      .sort((left, right) => {
        const leftPriority = left.definition.id === this.#selected || left.definition.id === this.#focusId ? 0 : 1;
        const rightPriority = right.definition.id === this.#selected || right.definition.id === this.#focusId ? 0 : 1;
        if (leftPriority !== rightPriority) return leftPriority - rightPriority;
        return BigInt(left.definition.id) < BigInt(right.definition.id) ? -1 : 1;
      });
    const allowedRuntimeSpheres = new Set(runtimeSphereCandidates.slice(0, MAX_PROMOTED_RUNTIME_SPHERES).map((entry) => entry.definition.id));
    for (const entry of orderedEntries) {
      const objectId = entry.definition.id;
      if (this.#runtimeIds.has(objectId) && next.get(objectId) === Representation.sphere && !allowedRuntimeSpheres.has(objectId)) {
        next.set(objectId, Representation.marker);
      }
    }
    this.#representations.clear();
    for (const [objectId, representation] of next) this.#representations.set(objectId, representation);

    const markerEntries = orderedEntries.filter((entry) =>
      this.#representations.get(entry.definition.id) === Representation.marker
      && this.#positions.has(entry.definition.id));
    const markerKey = markerEntries.map((entry) => entry.definition.id).join(",");
    if (markerKey !== this.#markerMembershipKey) {
      this.#markerLayer.setBodies(markerEntries, this.#positions);
      this.#markerMembershipKey = markerKey;
    }
    this.#promotedRuntimeSphereCount = 0;
    const presentedRadii = new Map<ObjectId, number>();
    for (const entry of orderedEntries) {
      const objectId = entry.definition.id;
      const representation = this.#representations.get(objectId) ?? Representation.hidden;
      const staticBody = this.#bodies.get(objectId);
      if (staticBody !== undefined) {
        staticBody.mesh.visible = representation === Representation.sphere;
        if (staticBody.mesh.visible && perspective !== undefined) {
          this.#applySphereScale(staticBody.mesh, entry, camera, perspective, viewportHeightPixels);
          presentedRadii.set(objectId, staticBody.mesh.scale.x);
        }
      }
      if (this.#runtimeIds.has(objectId)) {
        if (representation === Representation.sphere) {
          const mesh = this.#ensureRuntimeSphere(objectId);
          mesh.visible = true;
          if (perspective !== undefined) {
            this.#applySphereScale(mesh, entry, camera, perspective, viewportHeightPixels);
            presentedRadii.set(objectId, mesh.scale.x);
          }
          this.#promotedRuntimeSphereCount += 1;
        } else {
          this.#removeRuntimeSphere(objectId);
        }
      }
      const pathVisible = entry.definition.type === ObjectType.planet
        || representation === Representation.sphere
        || objectId === this.#selected
        || objectId === this.#focusId;
      this.#orbitRenderer.setBodyRepresentation(objectId, pathVisible);
    }
    this.#atmosphereShells.update(
      orderedEntries,
      this.#representations,
      this.#positions,
      presentedRadii,
      perspective,
      viewportHeightPixels,
      new Set([this.#selected, this.#focusId].filter((id): id is ObjectId => id !== undefined)),
      this.#illuminationByBody,
    );
    this.#updateInspectionFill(camera);
    this.#updateSelectionHalo(camera, viewportHeightPixels);
  }

  pick(normalizedDeviceX: number, normalizedDeviceY: number, camera: THREE.Camera): ObjectId | undefined {
    const markerHit = this.#markerLayer.pick(normalizedDeviceX, normalizedDeviceY, camera);
    if (markerHit !== undefined) return markerHit;
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(normalizedDeviceX, normalizedDeviceY), camera);
    const meshes = [
      ...[...this.#bodies.values()].filter((body) => body.mesh.visible).map((body) => body.mesh),
      ...[...this.#runtimeSphereMeshes.values()].filter((mesh) => mesh.visible),
    ];
    const hit = raycaster.intersectObjects(meshes, false)[0];
    const objectId = hit?.object.userData.objectId;
    return typeof objectId === "string" && this.#currentEntries.has(objectId as ObjectId) ? objectId as ObjectId : undefined;
  }

  stateFor(objectId: ObjectId): PropagationState | undefined {
    return this.#states.get(objectId);
  }

  illuminationFor(objectId: ObjectId): StellarIlluminationSet | undefined {
    return this.#illuminationByBody.get(objectId);
  }

  lightingDiagnostics(): LightingModeDiagnostics {
    return lightingModeDiagnostics(this.#lightingMode, this.#inspectionFillTargets);
  }

  representationFor(objectId: ObjectId): RepresentationLevel | undefined {
    return this.#representations.get(objectId);
  }

  renderDiagnosticsFor(objectId: ObjectId, camera: THREE.Camera): BodyRenderDiagnostics | undefined {
    const representation = this.#representations.get(objectId);
    const position = this.#positions.get(objectId);
    if (representation === undefined || position === undefined) return undefined;

    camera.updateMatrixWorld(true);
    const cameraSpace = position.clone().applyMatrix4(camera.matrixWorldInverse);
    const ndc = position.clone().project(camera);
    const inFront = cameraSpace.z < 0;
    const inViewport = inFront
      && ndc.x >= -1 && ndc.x <= 1
      && ndc.y >= -1 && ndc.y <= 1
      && ndc.z >= -1 && ndc.z <= 1;

    let submitted = false;
    let renderPosition: THREE.Vector3 | undefined;
    if (representation === Representation.marker) {
      submitted = this.#markerLayer.contains(objectId);
      renderPosition = this.#markerLayer.positionFor(objectId);
    } else if (representation === Representation.sphere) {
      const mesh = this.meshFor(objectId);
      submitted = mesh?.visible === true;
      renderPosition = mesh?.position.clone();
    }

    return Object.freeze({
      objectId,
      representation,
      submitted,
      orbitVisible: this.#orbitRenderer.isPathVisible(objectId),
      inFront,
      inViewport,
      ndcX: ndc.x,
      ndcY: ndc.y,
      ndcZ: ndc.z,
      positionErrorSceneUnits: renderPosition?.distanceTo(position),
      surfaceReflectanceSource: (() => {
        const entry = this.#currentEntries.get(objectId);
        return entry === undefined
          ? undefined
          : deriveSurfaceReflectance(entry.definition.appearance, entry.definition.display.accentColor).source;
      })(),
      physicalIrradianceWattsPerSquareMeter: this.#illuminationByBody.get(objectId)?.totalIrradianceWattsPerSquareMeter,
      lightingMode: this.#lightingMode,
      inspectionFillApplied: this.#inspectionFillTargets.has(objectId),
      inspectionFillContribution: this.#inspectionFillTargets.has(objectId)
        ? inspectionFillContribution(this.#lightingMode)
        : 0,
    });
  }

  setPath(path: OrbitPath): void {
    const body = this.#bodies.get(path.objectId);
    const entry = this.#currentEntries.get(path.objectId);
    if (body === undefined && entry === undefined) throw new RangeError(`Unknown scenario body: ${path.objectId}`);
    const color = this.#currentEntries.get(path.objectId)?.definition.display.accentColor ?? 0x9aa7b5;
    this.#orbitRenderer.setPath(path, color);
  }

  clearPath(objectId: ObjectId): void {
    this.#orbitRenderer.clearPath(objectId);
  }

  clearPaths(): void {
    this.#orbitRenderer.clearPaths();
  }

  pathCount(): number {
    return this.#orbitRenderer.pathCount();
  }

  orbitGuideDiagnostics(): readonly OrbitGuideDiagnostics[] {
    return this.#orbitRenderer.guideDiagnostics();
  }

  setOrbitsVisible(visible: boolean): void {
    this.#orbitRenderer.setVisible(visible);
  }

  orbitsVisible(): boolean {
    return this.#orbitRenderer.isVisible();
  }

  selectedOrbitActive(): boolean {
    const selected = this.#selected;
    return selected !== undefined && this.#orbitRenderer.hasPath(selected);
  }

  meshFor(objectId: ObjectId): THREE.Mesh | undefined {
    return this.#bodies.get(objectId)?.mesh ?? this.#runtimeSphereMeshes.get(objectId);
  }

  positionFor(objectId: ObjectId): THREE.Vector3 | undefined {
    return this.#positions.get(objectId)?.clone();
  }

  selectedObjectId(): ObjectId | undefined {
    return this.#selected;
  }

  markerCount(): number {
    return this.#markerLayer.count();
  }

  atmosphereDiagnosticsFor(objectId: ObjectId): AtmosphereDiagnostics {
    return this.#atmosphereShells.diagnosticsFor(objectId);
  }

  atmosphereResourceCount(): number {
    return this.#atmosphereShells.resourceCount();
  }

  lodDiagnostics(): LodDiagnostics {
    let hiddenCount = 0;
    let markerCount = 0;
    let sphereCount = 0;
    for (const objectId of this.#currentEntries.keys()) {
      const representation = this.#representations.get(objectId);
      if (representation === Representation.hidden) hiddenCount += 1;
      else if (representation === Representation.marker) markerCount += 1;
      else if (representation === Representation.sphere) sphereCount += 1;
    }
    return Object.freeze({
      registeredCount: this.#currentEntries.size,
      queriedCount: this.#queriedCount,
      hiddenCount,
      markerCount,
      sphereCount,
      promotedRuntimeSphereCount: this.#promotedRuntimeSphereCount,
    });
  }

  /** Non-star focus framing is body-size driven; local hierarchy is revealed by zooming back out. */
  focusDistanceFor(objectId: ObjectId): number {
    const entry = this.#currentEntries.get(objectId);
    if (entry === undefined) throw new RangeError(`Unknown scenario body: ${objectId}`);
    const physicalRadius = radiusToSceneUnits({
      mode: "physical",
      physicalRadiusMeters: meters(entry.record.properties.physicalRadius ?? entry.definition.properties.physicalRadius ?? 0),
    });
    if (entry.definition.type !== ObjectType.star) {
      return Math.min(
        MAX_FOCUS_DISTANCE_SCENE_UNITS,
        Math.max(MIN_FOCUS_DISTANCE_SCENE_UNITS, physicalRadius * FOCUS_DISTANCE_RADIUS_MULTIPLIER),
      );
    }

    const position = this.#positions.get(objectId);
    if (position === undefined) return MAX_FOCUS_DISTANCE_SCENE_UNITS;
    const localDistances: number[] = [];
    for (const candidate of this.#currentEntries.values()) {
      if (candidate.definition.id === objectId || candidate.definition.centralBody !== objectId) continue;
      const candidatePosition = this.#positions.get(candidate.definition.id);
      if (candidatePosition !== undefined) localDistances.push(position.distanceTo(candidatePosition));
    }
    const extent = Math.max(...localDistances, 6);
    return Math.min(MAX_FOCUS_DISTANCE_SCENE_UNITS, Math.max(1.6, extent * 0.25));
  }

  dispose(): void {
    this.#orbitRenderer.dispose();
    this.#markerLayer.dispose();
    this.#selectionHalo.dispose();
    this.#atmosphereShells.dispose();
    for (const body of this.#bodies.values()) {
      this.#scene.remove(body.mesh);
      body.mesh.geometry.dispose();
      if (Array.isArray(body.mesh.material)) body.mesh.material.forEach((material) => material.dispose());
      else body.mesh.material.dispose();
    }
    for (const mesh of this.#runtimeSphereMeshes.values()) this.#scene.remove(mesh);
    this.#runtimeSphereMeshes.clear();
    for (const light of this.#stellarLights.values()) {
      this.#scene.remove(light);
    }
    this.#stellarLights.clear();
    this.#scene.remove(this.#inspectionFillLight);
    this.#inspectionFillTargets.clear();
    this.#illuminationByBody.clear();
    this.#runtimeSphereGeometry.dispose();
    this.#runtimeSphereMaterial.dispose();
    this.#bodies.clear();
    this.#currentEntries.clear();
    this.#representations.clear();
    this.#states.clear();
    this.#positions.clear();
  }

  selectFromPointer(normalizedDeviceX: number, normalizedDeviceY: number, camera: THREE.Camera): ObjectId | undefined {
    const objectId = this.pick(normalizedDeviceX, normalizedDeviceY, camera);
    if (objectId === undefined) return undefined;
    this.setSelected(objectId);
    this.#onSelect?.(objectId);
    return objectId;
  }

  #addBody(entry: RegisteredScenarioBody): void {
    const radius = entry.record.properties.physicalRadius ?? entry.definition.properties.physicalRadius;
    if (radius === undefined) throw new TypeError(`Scenario body ${entry.definition.id} has no physical radius`);
    const physicalRadiusMeters = meters(radius);
    const accentColor = new THREE.Color(entry.definition.display.accentColor);
    const material = entry.definition.type === ObjectType.star
      ? new THREE.MeshStandardMaterial({
        color: accentColor,
        emissive: accentColor,
        emissiveIntensity: 1,
      })
      : new THREE.MeshLambertMaterial({
        color: (() => {
          const reflectance = deriveSurfaceReflectance(entry.definition.appearance, entry.definition.display.accentColor);
          return new THREE.Color(reflectance.linearReflectance.r, reflectance.linearReflectance.g, reflectance.linearReflectance.b);
        })(),
      });
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 24, 16),
      material,
    );
    mesh.name = entry.definition.name;
    mesh.userData.objectId = entry.definition.id;
    mesh.userData.objectType = entry.definition.type;
    this.#scene.add(mesh);
    this.#bodies.set(entry.definition.id, {
      objectId: entry.definition.id,
      physicalRadiusMeters,
      parentId: entry.definition.centralBody,
      type: entry.definition.type,
      mesh,
    });
    mesh.scale.setScalar(radiusToSceneUnits({ mode: "physical", physicalRadiusMeters }));
  }

  #updateInspectionFill(camera: THREE.Camera): void {
    for (const body of this.#bodies.values()) body.mesh.layers.disable(INSPECTION_FILL_LAYER);
    for (const mesh of this.#runtimeSphereMeshes.values()) mesh.layers.disable(INSPECTION_FILL_LAYER);
    this.#inspectionFillTargets.clear();
    if (this.#lightingMode !== "enhanced") {
      this.#inspectionFillLight.visible = false;
      this.#inspectionFillLight.intensity = 0;
      return;
    }

    for (const objectId of new Set([this.#selected, this.#focusId].filter((id): id is ObjectId => id !== undefined))) {
      if (this.#representations.get(objectId) !== Representation.sphere) continue;
      const mesh = this.meshFor(objectId);
      if (mesh === undefined || !mesh.visible) continue;
      mesh.layers.enable(INSPECTION_FILL_LAYER);
      this.#inspectionFillTargets.add(objectId);
    }
    this.#inspectionFillLight.position.copy(camera.position);
    this.#inspectionFillLight.intensity = inspectionFillContribution(this.#lightingMode);
    this.#inspectionFillLight.visible = this.#inspectionFillTargets.size > 0;
  }

  #ensureRuntimeSphere(objectId: ObjectId): THREE.Mesh<THREE.SphereGeometry, THREE.MeshLambertMaterial> {
    const current = this.#runtimeSphereMeshes.get(objectId);
    if (current !== undefined) return current;
    const mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshLambertMaterial> = new THREE.Mesh(
      this.#runtimeSphereGeometry,
      this.#runtimeSphereMaterial,
    );
    mesh.name = `Runtime sphere ${objectId}`;
    mesh.userData.objectId = objectId;
    mesh.userData.objectType = ObjectType.asteroid;
    this.#scene.add(mesh);
    this.#runtimeSphereMeshes.set(objectId, mesh);
    return mesh;
  }

  #removeRuntimeSphere(objectId: ObjectId): void {
    const mesh = this.#runtimeSphereMeshes.get(objectId);
    if (mesh === undefined) return;
    this.#scene.remove(mesh);
    this.#runtimeSphereMeshes.delete(objectId);
  }

  #applySphereScale(
    mesh: THREE.Mesh,
    entry: RegisteredScenarioBody,
    camera: THREE.Camera,
    perspective: THREE.PerspectiveCamera,
    viewportHeightPixels: number,
  ): void {
    const physicalRadiusMeters = meters(entry.record.properties.physicalRadius ?? entry.definition.properties.physicalRadius ?? 0);
    const physicalRadius = radiusToSceneUnits({ mode: "physical", physicalRadiusMeters });
    if (this.#radiusMode === "physical") {
      mesh.scale.setScalar(physicalRadius);
      return;
    }
    const distance = Math.max(camera.position.distanceTo(mesh.position), physicalRadius * 2, Number.EPSILON);
    const fieldOfView = perspective.fov * Math.PI / 180;
    const physicalPixels = projectedRadiusPixels(physicalRadius, distance, fieldOfView, viewportHeightPixels);
    const adaptiveRadius = projectedPixelsToSceneRadius(
      adaptiveRadiusPixels(physicalPixels),
      distance,
      fieldOfView,
      viewportHeightPixels,
    );
    mesh.scale.setScalar(cappedAdaptiveRadiusSceneUnits(
      adaptiveRadius,
      physicalRadius,
      this.#nearestLocalSeparation(entry.definition.id),
    ));
  }

  #nearestLocalSeparation(objectId: ObjectId): number | undefined {
    const body = this.#bodies.get(objectId);
    const position = this.#positions.get(objectId);
    if (body === undefined || position === undefined) return undefined;
    let nearest = Number.POSITIVE_INFINITY;
    for (const other of this.#bodies.values()) {
      if (other.objectId === objectId) continue;
      const sibling = other.parentId !== undefined && other.parentId === body.parentId;
      const parent = other.objectId === body.parentId || body.objectId === other.parentId;
      if (!sibling && !parent) continue;
      const otherPosition = this.#positions.get(other.objectId);
      if (otherPosition !== undefined) nearest = Math.min(nearest, position.distanceTo(otherPosition));
    }
    return Number.isFinite(nearest) ? nearest : undefined;
  }

  #updateStellarLighting(stateById: ReadonlyMap<ObjectId, PropagationState>): void {
    const emitters: StellarEmitter[] = [];
    for (const entry of this.#currentEntries.values()) {
      const emission = entry.definition.appearance?.stellarEmission;
      const state = stateById.get(entry.definition.id);
      if (emission === undefined || state === undefined) continue;
      emitters.push({
        objectId: entry.definition.id,
        position: state.position,
        effectiveTemperatureKelvin: emission.effectiveTemperatureKelvin,
        luminosityWatts: emission.luminosityWatts,
      });
    }
    const activeEmitterIds = new Set(emitters.map((emitter) => emitter.objectId));
    for (const emitter of emitters) {
      let light = this.#stellarLights.get(emitter.objectId);
      if (light === undefined) {
        light = new THREE.PointLight(0xffffff, 0, 0, 2);
        light.name = `Stellar illumination ${emitter.objectId}`;
        light.userData.objectId = emitter.objectId;
        this.#scene.add(light);
        this.#stellarLights.set(emitter.objectId, light);
      }
      const chromaticity = blackbodyTemperatureToLinearRgb(emitter.effectiveTemperatureKelvin);
      light.color.setRGB(chromaticity.r, chromaticity.g, chromaticity.b);
      // Three.js point-light intensity is expressed in scene-space units. The
      // conversion preserves the document-19 W/m² reference mapping while the
      // light's quadratic falloff preserves inverse-square ratios.
      light.intensity = emitter.luminosityWatts
        / (4 * Math.PI * METERS_PER_SCENE_UNIT ** 2 * REFERENCE_IRRADIANCE_WATTS_PER_SQUARE_METER);
      const position = positionToSceneUnits(emitter.position);
      light.position.set(position.x, position.y, position.z);
      light.visible = true;
    }
    for (const [objectId, light] of this.#stellarLights) {
      if (activeEmitterIds.has(objectId)) continue;
      this.#scene.remove(light);
      this.#stellarLights.delete(objectId);
    }

    this.#illuminationByBody.clear();
    for (const entry of this.#currentEntries.values()) {
      const state = stateById.get(entry.definition.id);
      if (state === undefined) continue;
      const bodyEmitters = emitters.filter((emitter) => emitter.objectId !== entry.definition.id);
      this.#illuminationByBody.set(
        entry.definition.id,
        resolveStellarIllumination(state.position, bodyEmitters),
      );
    }
  }

  #depth(entry: RegisteredScenarioBody): number {
    let depth = 0;
    let parent = entry.definition.centralBody;
    const seen = new Set<ObjectId>();
    while (parent !== undefined && this.#currentEntries.has(parent) && !seen.has(parent)) {
      seen.add(parent);
      depth += 1;
      parent = this.#currentEntries.get(parent)?.definition.centralBody;
    }
    return depth;
  }

  #ancestorIds(seeds: ReadonlySet<ObjectId>): Set<ObjectId> {
    const result = new Set<ObjectId>();
    for (const seed of seeds) {
      let current = this.#currentEntries.get(seed)?.definition.centralBody;
      while (current !== undefined && this.#currentEntries.has(current) && !result.has(current)) {
        result.add(current);
        current = this.#currentEntries.get(current)?.definition.centralBody;
      }
    }
    return result;
  }

  #updateSelectionHalo(camera: THREE.Camera | undefined, viewportHeightPixels?: number): void {
    const selected = this.#selected;
    if (selected === undefined) {
      this.#selectionHalo.hide();
      return;
    }
    const position = this.#positions.get(selected);
    if (position === undefined) {
      this.#selectionHalo.hide();
      return;
    }
    this.#selectionHalo.setPosition(position);
    if (!(camera instanceof THREE.PerspectiveCamera)
        || viewportHeightPixels === undefined
        || !Number.isFinite(viewportHeightPixels)
        || viewportHeightPixels <= 0) {
      return;
    }

    const representation = this.#representations.get(selected) ?? Representation.marker;
    let bodyRadiusPixels = MARKER_PIXEL_SIZE / 2;
    if (representation === Representation.sphere) {
      const mesh = this.meshFor(selected);
      if (mesh !== undefined) {
        const distance = Math.max(camera.position.distanceTo(position), mesh.scale.x * 2, Number.EPSILON);
        const fieldOfView = camera.fov * Math.PI / 180;
        bodyRadiusPixels = projectedRadiusPixels(mesh.scale.x, distance, fieldOfView, viewportHeightPixels);
      }
    }
    this.#selectionHalo.update(position, bodyRadiusPixels, camera, viewportHeightPixels);
  }
}
