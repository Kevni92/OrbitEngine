import * as THREE from "three";
import {
  meters,
  ObjectType,
  type Meters,
  type ObjectId,
  type PropagationState,
} from "orbit-engine";
import type { RegisteredScenarioBody, SolarSystemScenario } from "../scenario/load-solar-system.js";
import type { RuntimeAsteroidBody } from "../scenario/runtime-asteroid-overlay.js";
import type { OrbitPath } from "../simulation/path-sampling.js";
import { OrbitRenderer } from "./orbit-renderer.js";
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
import { positionToSceneUnits, radiusToSceneUnits, type RadiusMode } from "./render-space.js";
import { BatchedMarkerLayer } from "./runtime-asteroid-markers.js";

export const MIN_FOCUS_DISTANCE_SCENE_UNITS = 0.02;
export const MAX_FOCUS_DISTANCE_SCENE_UNITS = 24;
export const FOCUS_DISTANCE_RADIUS_MULTIPLIER = 8;
export const MAX_PROMOTED_RUNTIME_SPHERES = 128;

interface SceneBody {
  readonly objectId: ObjectId;
  readonly physicalRadiusMeters: Meters;
  readonly parentId?: ObjectId;
  readonly type: RegisteredScenarioBody["definition"]["type"];
  readonly mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
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
  readonly #runtimeSphereMeshes = new Map<ObjectId, THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>>();
  readonly #runtimeSphereGeometry: THREE.SphereGeometry;
  readonly #runtimeSphereMaterial: THREE.MeshBasicMaterial;
  readonly #representations = new Map<ObjectId, RepresentationLevel>();
  readonly #orbitRenderer: OrbitRenderer;
  readonly #markerLayer: BatchedMarkerLayer;
  readonly #states = new Map<ObjectId, PropagationState>();
  readonly #positions = new Map<ObjectId, THREE.Vector3>();
  readonly #onSelect?: (objectId: ObjectId) => void;
  readonly #selectionHalo: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
  #radiusMode: RadiusMode = "adaptive";
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
    this.#runtimeSphereMaterial = new THREE.MeshBasicMaterial({ color: 0x9aa7b5 });
    this.#selectionHalo = new THREE.Mesh(
      new THREE.TorusGeometry(1, 0.08, 8, 32),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }),
    );
    this.#selectionHalo.name = "Selected body halo";
    this.#selectionHalo.visible = false;
    this.#scene.add(this.#selectionHalo);

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

  setFocusId(objectId: ObjectId | undefined): void {
    if (objectId !== undefined && !this.#currentEntries.has(objectId)) {
      throw new RangeError(`Unknown scenario body: ${objectId}`);
    }
    this.#focusId = objectId;
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
    this.#orbitRenderer.updateBodyPositions(new Map(
      [...this.#positions].map(([objectId, position]) => [objectId, position.clone()]),
    ));
    this.#updateSelectionHalo(undefined);
  }

  /** Re-evaluates persistent LOD state for camera, hierarchy, focus, selection and viewport changes. */
  updatePresentation(camera: THREE.Camera, viewportHeightPixels: number): void {
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
    for (const entry of orderedEntries) {
      const objectId = entry.definition.id;
      const representation = this.#representations.get(objectId) ?? Representation.hidden;
      const staticBody = this.#bodies.get(objectId);
      if (staticBody !== undefined) {
        staticBody.mesh.visible = representation === Representation.sphere;
        if (staticBody.mesh.visible && perspective !== undefined) this.#applySphereScale(staticBody.mesh, entry, camera, perspective, viewportHeightPixels);
      }
      if (this.#runtimeIds.has(objectId)) {
        if (representation === Representation.sphere) {
          const mesh = this.#ensureRuntimeSphere(objectId);
          mesh.visible = true;
          if (perspective !== undefined) this.#applySphereScale(mesh, entry, camera, perspective, viewportHeightPixels);
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
    this.#updateSelectionHalo(camera);
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
    });
  }

  setPath(path: OrbitPath): void {
    const body = this.#bodies.get(path.objectId);
    const entry = this.#currentEntries.get(path.objectId);
    if (body === undefined && entry === undefined) throw new RangeError(`Unknown scenario body: ${path.objectId}`);
    const color = body?.mesh.material.color.getHex() ?? 0x9aa7b5;
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

  /** Local-system-aware framing avoids the old 1.6-unit minimum for compact moons. */
  focusDistanceFor(objectId: ObjectId): number {
    const entry = this.#currentEntries.get(objectId);
    if (entry === undefined) throw new RangeError(`Unknown scenario body: ${objectId}`);
    const physicalRadius = radiusToSceneUnits({
      mode: "physical",
      physicalRadiusMeters: meters(entry.record.properties.physicalRadius ?? entry.definition.properties.physicalRadius ?? 0),
    });
    const position = this.#positions.get(objectId);
    if (position === undefined) return Math.min(MAX_FOCUS_DISTANCE_SCENE_UNITS, Math.max(MIN_FOCUS_DISTANCE_SCENE_UNITS, physicalRadius * FOCUS_DISTANCE_RADIUS_MULTIPLIER));
    const localDistances: number[] = [];
    for (const candidate of this.#currentEntries.values()) {
      if (candidate.definition.id === objectId) continue;
      const isChild = candidate.definition.centralBody === objectId;
      const isMoonSibling = entry.definition.type === ObjectType.moon
        && candidate.definition.centralBody === entry.definition.centralBody;
      if (!isChild && !isMoonSibling && candidate.definition.id !== entry.definition.centralBody) continue;
      const candidatePosition = this.#positions.get(candidate.definition.id);
      if (candidatePosition !== undefined) localDistances.push(position.distanceTo(candidatePosition));
    }
    if (entry.definition.type === ObjectType.star) {
      const extent = Math.max(...localDistances, 6);
      return Math.min(MAX_FOCUS_DISTANCE_SCENE_UNITS, Math.max(1.6, extent * 0.25));
    }
    const localExtent = Math.max(...localDistances, 0);
    return Math.min(
      MAX_FOCUS_DISTANCE_SCENE_UNITS,
      Math.max(MIN_FOCUS_DISTANCE_SCENE_UNITS, localExtent * 4, physicalRadius * FOCUS_DISTANCE_RADIUS_MULTIPLIER * 3),
    );
  }

  dispose(): void {
    this.#orbitRenderer.dispose();
    this.#markerLayer.dispose();
    this.#scene.remove(this.#selectionHalo);
    this.#selectionHalo.geometry.dispose();
    this.#selectionHalo.material.dispose();
    for (const body of this.#bodies.values()) {
      this.#scene.remove(body.mesh);
      body.mesh.geometry.dispose();
      body.mesh.material.dispose();
    }
    for (const mesh of this.#runtimeSphereMeshes.values()) this.#scene.remove(mesh);
    this.#runtimeSphereMeshes.clear();
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
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 24, 16),
      new THREE.MeshBasicMaterial({ color: entry.definition.display.color }),
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

  #ensureRuntimeSphere(objectId: ObjectId): THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial> {
    const current = this.#runtimeSphereMeshes.get(objectId);
    if (current !== undefined) return current;
    const mesh = new THREE.Mesh(this.#runtimeSphereGeometry, this.#runtimeSphereMaterial);
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

  #updateSelectionHalo(camera: THREE.Camera | undefined): void {
    const selected = this.#selected;
    const position = selected === undefined ? undefined : this.#positions.get(selected);
    if (position === undefined) {
      this.#selectionHalo.visible = false;
      return;
    }
    this.#selectionHalo.visible = true;
    this.#selectionHalo.position.copy(position);
    const mesh = selected === undefined ? undefined : this.meshFor(selected);
    const radius = mesh?.scale.x ?? 0.002;
    this.#selectionHalo.scale.setScalar(Math.max(radius * 1.3, 0.002));
    if (camera !== undefined) this.#selectionHalo.lookAt(camera.position);
  }
}
