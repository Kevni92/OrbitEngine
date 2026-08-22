import * as THREE from "three";
import type { ObjectId, PropagationState } from "orbit-engine";
import type { RuntimeAsteroidBody } from "../scenario/runtime-asteroid-overlay.js";
import { positionToSceneUnits } from "./render-space.js";

/** A single bounded GPU marker layer for the runtime asteroid population. */
export class RuntimeAsteroidMarkers {
  readonly #points: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  #objectIds: readonly ObjectId[] = [];
  #positions = new Float32Array();

  constructor(scene: THREE.Scene) {
    const geometry = new THREE.BufferGeometry();
    const material = new THREE.PointsMaterial({
      color: 0x9aa7b5,
      size: 4,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
    this.#points = new THREE.Points(geometry, material);
    this.#points.name = "Runtime asteroid markers";
    this.#points.userData.objectType = "asteroid";
    this.#points.visible = false;
    scene.add(this.#points);
  }

  setBodies(bodies: readonly RuntimeAsteroidBody[]): void {
    this.#objectIds = Object.freeze(bodies.map((body) => body.definition.id));
    this.#positions = new Float32Array(this.#objectIds.length * 3);
    this.#points.geometry.setAttribute("position", new THREE.BufferAttribute(this.#positions, 3));
    this.#points.geometry.setDrawRange(0, this.#objectIds.length);
    this.#points.userData.objectIds = this.#objectIds;
    this.#points.visible = this.#objectIds.length > 0;
  }

  update(objectIds: readonly ObjectId[], states: readonly PropagationState[]): void {
    if (states.length !== objectIds.length) throw new RangeError("Runtime marker state/object count mismatch");
    const positions = this.#points.geometry.getAttribute("position");
    if (!(positions instanceof THREE.BufferAttribute)) return;
    const stateById = new Map(objectIds.map((id, index) => [id, states[index]!]));
    this.#objectIds.forEach((objectId, index) => {
      const state = stateById.get(objectId);
      if (state === undefined) return;
      const position = positionToSceneUnits(state.position);
      positions.setXYZ(index, position.x, position.y, position.z);
    });
    positions.needsUpdate = true;
  }

  pick(normalizedDeviceX: number, normalizedDeviceY: number, camera: THREE.Camera): ObjectId | undefined {
    if (!this.#points.visible || this.#objectIds.length === 0) return undefined;
    const raycaster = new THREE.Raycaster();
    raycaster.params.Points = { threshold: 0.75 };
    raycaster.setFromCamera(new THREE.Vector2(normalizedDeviceX, normalizedDeviceY), camera);
    const hit = raycaster.intersectObject(this.#points, false)[0];
    const index = hit?.index;
    return index === undefined ? undefined : this.#objectIds[index];
  }

  count(): number {
    return this.#objectIds.length;
  }

  dispose(): void {
    this.#points.parent?.remove(this.#points);
    this.#points.geometry.dispose();
    this.#points.material.dispose();
    this.#objectIds = [];
    this.#positions = new Float32Array();
  }
}
