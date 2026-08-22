import * as THREE from "three";
import { meters, type Meters, type ObjectId, type PropagationState } from "orbit-engine";
import type { SolarSystemScenario, RegisteredScenarioBody } from "../scenario/load-solar-system.js";
import type { RuntimeAsteroidBody } from "../scenario/runtime-asteroid-overlay.js";
import type { OrbitPath } from "../simulation/path-sampling.js";
import { OrbitRenderer } from "./orbit-renderer.js";
import {
  adaptiveRadiusPixels,
  cappedAdaptiveRadiusSceneUnits,
  projectedPixelsToSceneRadius,
  projectedRadiusPixels,
} from "./adaptive-sizing.js";
import { positionToSceneUnits, radiusToSceneUnits, type RadiusMode } from "./render-space.js";
import { RuntimeAsteroidMarkers } from "./runtime-asteroid-markers.js";

export const MIN_FOCUS_DISTANCE_SCENE_UNITS = 1.6;
export const MAX_FOCUS_DISTANCE_SCENE_UNITS = 24;
export const FOCUS_DISTANCE_RADIUS_MULTIPLIER = 8;

interface SceneBody {
  readonly objectId: ObjectId;
  readonly physicalRadiusMeters: Meters;
  readonly parentId?: ObjectId;
  readonly mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
}

export interface SolarSystemSceneOptions {
  readonly onSelect?: (objectId: ObjectId) => void;
}

/**
 * Presentation-only scene graph. Body positions are always copied from the
 * public engine state snapshots supplied to update(); this class never steps
 * or derives orbital motion.
 */
export class SolarSystemScene {
  readonly #scene: THREE.Scene;
  readonly #bodies = new Map<ObjectId, SceneBody>();
  readonly #runtimeIds = new Set<ObjectId>();
  readonly #orbitRenderer: OrbitRenderer;
  readonly #runtimeMarkers: RuntimeAsteroidMarkers;
  readonly #states = new Map<ObjectId, PropagationState>();
  readonly #positions = new Map<ObjectId, THREE.Vector3>();
  readonly #onSelect?: (objectId: ObjectId) => void;
  readonly #selectionHalo: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
  #radiusMode: RadiusMode = "adaptive";
  #selected?: ObjectId;

  constructor(scene: THREE.Scene, scenario: SolarSystemScenario, options: SolarSystemSceneOptions = {}) {
    this.#scene = scene;
    this.#onSelect = options.onSelect;
    this.#orbitRenderer = new OrbitRenderer(scene);
    this.#runtimeMarkers = new RuntimeAsteroidMarkers(scene);
    this.#selectionHalo = new THREE.Mesh(
      new THREE.TorusGeometry(1, 0.08, 8, 32),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }),
    );
    this.#selectionHalo.name = "Selected body halo";
    this.#selectionHalo.visible = false;
    this.#scene.add(this.#selectionHalo);

    for (const entry of scenario.bodies) this.#addBody(entry);
  }

  setRadiusMode(mode: RadiusMode): void {
    if (mode !== "physical" && mode !== "adaptive") throw new RangeError(`Unknown radius mode: ${String(mode)}`);
    this.#radiusMode = mode;
  }

  radiusMode(): RadiusMode {
    return this.#radiusMode;
  }

  setRuntimeAsteroids(bodies: readonly RuntimeAsteroidBody[]): void {
    this.#runtimeIds.clear();
    for (const body of bodies) this.#runtimeIds.add(body.definition.id);
    for (const objectId of [...this.#states.keys()]) {
      if (!this.#runtimeIds.has(objectId) && !this.#bodies.has(objectId)) this.#states.delete(objectId);
    }
    this.#runtimeMarkers.setBodies(bodies);
    if (this.#selected !== undefined && this.#runtimeIds.has(this.#selected)) this.#selectionHalo.visible = false;
  }

  setSelected(objectId: ObjectId | undefined): void {
    if (objectId !== undefined && !this.#bodies.has(objectId) && !this.#runtimeIds.has(objectId)) {
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
    const stateById = new Map(objectIds.map((objectId, index) => [objectId, states[index]!]));
    for (const [objectId, body] of this.#bodies) {
      const state = stateById.get(objectId);
      if (state === undefined) continue;
      const position = positionToSceneUnits(state.position);
      body.mesh.position.set(position.x, position.y, position.z);
      this.#positions.set(objectId, body.mesh.position.clone());
      this.#states.set(objectId, state);
    }
    this.#runtimeMarkers.update(objectIds, states);
    for (const objectId of this.#runtimeIds) {
      const state = stateById.get(objectId);
      if (state === undefined) continue;
      const position = positionToSceneUnits(state.position);
      this.#positions.set(objectId, new THREE.Vector3(position.x, position.y, position.z));
      this.#states.set(objectId, state);
    }
    this.#orbitRenderer.updateBodyPositions(new Map(
      [...this.#bodies].map(([objectId, body]) => [objectId, body.mesh.position.clone()]),
    ));
    this.#updateSelectionHalo(undefined);
  }

  /** Recomputes camera-aware adaptive radii and keeps local bodies separated. */
  updatePresentation(camera: THREE.Camera, viewportHeightPixels: number): void {
    const perspective = camera instanceof THREE.PerspectiveCamera ? camera : undefined;
    for (const [objectId, body] of this.#bodies) {
      const physicalRadius = radiusToSceneUnits({ mode: "physical", physicalRadiusMeters: body.physicalRadiusMeters });
      if (this.#radiusMode === "physical" || perspective === undefined) {
        body.mesh.scale.setScalar(physicalRadius);
        continue;
      }
      const distance = Math.max(camera.position.distanceTo(body.mesh.position), physicalRadius * 2);
      const fieldOfView = perspective.fov * Math.PI / 180;
      const physicalPixels = projectedRadiusPixels(physicalRadius, distance, fieldOfView, viewportHeightPixels);
      const adaptivePixels = adaptiveRadiusPixels(physicalPixels);
      const adaptiveRadius = projectedPixelsToSceneRadius(adaptivePixels, distance, fieldOfView, viewportHeightPixels);
      body.mesh.scale.setScalar(cappedAdaptiveRadiusSceneUnits(
        adaptiveRadius,
        physicalRadius,
        this.#nearestLocalSeparation(objectId),
      ));
    }
    this.#updateSelectionHalo(camera);
  }

  pick(normalizedDeviceX: number, normalizedDeviceY: number, camera: THREE.Camera): ObjectId | undefined {
    const markerHit = this.#runtimeMarkers.pick(normalizedDeviceX, normalizedDeviceY, camera);
    if (markerHit !== undefined) return markerHit;
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(normalizedDeviceX, normalizedDeviceY), camera);
    const hit = raycaster.intersectObjects([...this.#bodies.values()].map((body) => body.mesh), false)[0];
    const objectId = hit?.object.userData.objectId;
    return typeof objectId === "string" && this.#bodies.has(objectId as ObjectId) ? objectId as ObjectId : undefined;
  }

  stateFor(objectId: ObjectId): PropagationState | undefined {
    return this.#states.get(objectId);
  }

  setPath(path: OrbitPath): void {
    const body = this.#bodies.get(path.objectId);
    if (body === undefined) throw new RangeError(`Unknown scenario body: ${path.objectId}`);
    this.#orbitRenderer.setPath(path, body.mesh.material.color.getHex());
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
    return this.#bodies.get(objectId)?.mesh;
  }

  positionFor(objectId: ObjectId): THREE.Vector3 | undefined {
    return this.#positions.get(objectId)?.clone();
  }

  selectedObjectId(): ObjectId | undefined {
    return this.#selected;
  }

  markerCount(): number {
    return this.#runtimeMarkers.count();
  }

  /** Presentation-only distance used when a body becomes the camera focus. */
  focusDistanceFor(objectId: ObjectId): number {
    if (!this.#bodies.has(objectId) && !this.#runtimeIds.has(objectId)) {
      throw new RangeError(`Unknown scenario body: ${objectId}`);
    }
    const body = this.#bodies.get(objectId);
    const physicalRadius = radiusToSceneUnits({
      mode: "physical",
      physicalRadiusMeters: body?.physicalRadiusMeters ?? meters(25_000),
    });
    return Math.min(
      MAX_FOCUS_DISTANCE_SCENE_UNITS,
      Math.max(MIN_FOCUS_DISTANCE_SCENE_UNITS, physicalRadius * FOCUS_DISTANCE_RADIUS_MULTIPLIER),
    );
  }

  dispose(): void {
    this.#orbitRenderer.dispose();
    this.#runtimeMarkers.dispose();
    this.#scene.remove(this.#selectionHalo);
    this.#selectionHalo.geometry.dispose();
    this.#selectionHalo.material.dispose();
    for (const body of this.#bodies.values()) {
      this.#scene.remove(body.mesh);
      body.mesh.geometry.dispose();
      body.mesh.material.dispose();
    }
    this.#bodies.clear();
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
    const radius = entry.definition.properties.physicalRadius;
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
      mesh,
    });
    mesh.scale.setScalar(radiusToSceneUnits({ mode: "physical", physicalRadiusMeters }));
  }

  #nearestLocalSeparation(objectId: ObjectId): number | undefined {
    const body = this.#bodies.get(objectId);
    if (body === undefined) return undefined;
    let nearest = Number.POSITIVE_INFINITY;
    for (const other of this.#bodies.values()) {
      if (other.objectId === objectId) continue;
      const sibling = other.parentId !== undefined && other.parentId === body.parentId;
      const parent = other.objectId === body.parentId || body.objectId === other.parentId;
      if (!sibling && !parent) continue;
      nearest = Math.min(nearest, body.mesh.position.distanceTo(other.mesh.position));
    }
    return Number.isFinite(nearest) ? nearest : undefined;
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
    const mesh = selected === undefined ? undefined : this.#bodies.get(selected)?.mesh;
    const radius = mesh?.scale.x ?? 0.25;
    this.#selectionHalo.scale.setScalar(Math.max(radius * 1.3, 0.25));
    if (camera !== undefined) this.#selectionHalo.lookAt(camera.position);
  }
}
