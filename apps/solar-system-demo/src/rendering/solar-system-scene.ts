import * as THREE from "three";
import { meters, type Meters, type ObjectId, type PropagationState } from "orbit-engine";
import type { SolarSystemScenario } from "../scenario/load-solar-system.js";
import type { OrbitPath } from "../simulation/path-sampling.js";
import { OrbitRenderer } from "./orbit-renderer.js";
import { positionToSceneUnits, radiusToSceneUnits, type RadiusMode } from "./render-space.js";

export const MIN_FOCUS_DISTANCE_SCENE_UNITS = 1.6;
export const MAX_FOCUS_DISTANCE_SCENE_UNITS = 24;
export const FOCUS_DISTANCE_RADIUS_MULTIPLIER = 8;

interface SceneBody {
  readonly objectId: ObjectId;
  readonly physicalRadiusMeters: Meters;
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
  readonly #orbitRenderer: OrbitRenderer;
  readonly #states = new Map<ObjectId, PropagationState>();
  readonly #onSelect?: (objectId: ObjectId) => void;
  #radiusMode: RadiusMode = "visible";
  #selected?: ObjectId;

  constructor(scene: THREE.Scene, scenario: SolarSystemScenario, options: SolarSystemSceneOptions = {}) {
    this.#scene = scene;
    this.#onSelect = options.onSelect;
    this.#orbitRenderer = new OrbitRenderer(scene);

    for (const entry of scenario.bodies) {
      const radius = entry.definition.properties.physicalRadius;
      if (radius === undefined) throw new TypeError(`Scenario body ${entry.definition.id} has no physical radius`);
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
        physicalRadiusMeters: meters(radius),
        mesh,
      });
      this.#applyScale(entry.definition.id);
    }
  }

  setRadiusMode(mode: RadiusMode): void {
    if (mode !== "physical" && mode !== "visible") throw new RangeError(`Unknown radius mode: ${String(mode)}`);
    this.#radiusMode = mode;
    for (const objectId of this.#bodies.keys()) this.#applyScale(objectId);
  }

  setSelected(objectId: ObjectId | undefined): void {
    if (objectId !== undefined && !this.#bodies.has(objectId)) {
      throw new RangeError(`Unknown scenario body: ${objectId}`);
    }
    this.#selected = objectId;
    for (const id of this.#bodies.keys()) this.#applyScale(id);
    this.#orbitRenderer.setSelected(objectId);
  }

  update(states: readonly PropagationState[]): void {
    const bodyIds = [...this.#bodies.keys()];
    if (states.length !== bodyIds.length) {
      throw new RangeError(`Expected ${bodyIds.length} scenario states, received ${states.length}`);
    }
    states.forEach((state, index) => {
      const objectId = bodyIds[index];
      if (objectId === undefined) throw new RangeError("Scenario state index is out of range");
      const body = this.#bodies.get(objectId)!;
      const position = positionToSceneUnits(state.position);
      body.mesh.position.set(position.x, position.y, position.z);
      this.#states.set(objectId, state);
    });
    this.#orbitRenderer.updateBodyPositions(new Map(
      [...this.#bodies].map(([objectId, body]) => [objectId, body.mesh.position.clone()]),
    ));
  }

  pick(normalizedDeviceX: number, normalizedDeviceY: number, camera: THREE.Camera): ObjectId | undefined {
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
    const color = body.mesh.material.color.getHex();
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
    return this.#bodies.get(objectId)?.mesh;
  }

  selectedObjectId(): ObjectId | undefined {
    return this.#selected;
  }

  /** Presentation-only distance used when a body becomes the camera focus. */
  focusDistanceFor(objectId: ObjectId): number {
    const body = this.#bodies.get(objectId);
    if (body === undefined) throw new RangeError(`Unknown scenario body: ${objectId}`);
    const visibleRadius = radiusToSceneUnits({ mode: "visible", physicalRadiusMeters: body.physicalRadiusMeters });
    return Math.min(
      MAX_FOCUS_DISTANCE_SCENE_UNITS,
      Math.max(MIN_FOCUS_DISTANCE_SCENE_UNITS, visibleRadius * FOCUS_DISTANCE_RADIUS_MULTIPLIER),
    );
  }

  dispose(): void {
    this.#orbitRenderer.dispose();
    for (const body of this.#bodies.values()) {
      this.#scene.remove(body.mesh);
      body.mesh.geometry.dispose();
      body.mesh.material.dispose();
    }
    this.#bodies.clear();
    this.#states.clear();
  }

  #applyScale(objectId: ObjectId): void {
    const body = this.#bodies.get(objectId);
    if (body === undefined) return;
    const radius = radiusToSceneUnits({ mode: this.#radiusMode, physicalRadiusMeters: body.physicalRadiusMeters });
    body.mesh.scale.setScalar(radius * (objectId === this.#selected ? 1.35 : 1));
  }

  selectFromPointer(normalizedDeviceX: number, normalizedDeviceY: number, camera: THREE.Camera): ObjectId | undefined {
    const objectId = this.pick(normalizedDeviceX, normalizedDeviceY, camera);
    if (objectId === undefined) return undefined;
    this.setSelected(objectId);
    this.#onSelect?.(objectId);
    return objectId;
  }
}
