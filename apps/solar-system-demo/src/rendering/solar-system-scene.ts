import * as THREE from "three";
import { meters, type Meters, type ObjectId, type PropagationState } from "orbit-engine";
import type { SolarSystemScenario } from "../scenario/load-solar-system.js";
import type { OrbitPath } from "../simulation/path-sampling.js";
import { positionToSceneUnits, radiusToSceneUnits, type RadiusMode } from "./render-space.js";

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
  readonly #paths = new Map<ObjectId, THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>>();
  readonly #states = new Map<ObjectId, PropagationState>();
  readonly #onSelect?: (objectId: ObjectId) => void;
  #radiusMode: RadiusMode = "visible";
  #selected?: ObjectId;

  constructor(scene: THREE.Scene, scenario: SolarSystemScenario, options: SolarSystemSceneOptions = {}) {
    this.#scene = scene;
    this.#onSelect = options.onSelect;

    for (const entry of scenario.bodies) {
      const radius = entry.definition.properties.physicalRadius;
      if (radius === undefined) throw new TypeError(`Scenario body ${entry.definition.id} has no physical radius`);
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(1, 24, 16),
        new THREE.MeshBasicMaterial({ color: entry.definition.color }),
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
    this.clearPath(path.objectId);
    const points = path.samples.map((sample) => {
      const position = positionToSceneUnits(sample.state.position);
      return new THREE.Vector3(position.x, position.y, position.z);
    });
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({ color: this.#bodies.get(path.objectId)?.mesh.material.color ?? 0x8fb8ff }),
    );
    line.name = `Orbit path ${path.objectId}`;
    line.userData.objectId = path.objectId;
    line.userData.focusId = path.focusId;
    this.#scene.add(line);
    this.#paths.set(path.objectId, line);
  }

  clearPath(objectId: ObjectId): void {
    const line = this.#paths.get(objectId);
    if (line === undefined) return;
    this.#scene.remove(line);
    line.geometry.dispose();
    line.material.dispose();
    this.#paths.delete(objectId);
  }

  clearPaths(): void {
    for (const objectId of [...this.#paths.keys()]) this.clearPath(objectId);
  }

  pathCount(): number {
    return this.#paths.size;
  }

  meshFor(objectId: ObjectId): THREE.Mesh | undefined {
    return this.#bodies.get(objectId)?.mesh;
  }

  selectedObjectId(): ObjectId | undefined {
    return this.#selected;
  }

  dispose(): void {
    this.clearPaths();
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
