import * as THREE from "three";
import type { ObjectId, PropagationState } from "orbit-engine";
import { positionToSceneUnits } from "./render-space.js";

export class AsteroidMarkerLayer {
  readonly #scene: THREE.Scene;
  readonly #geometry = new THREE.BufferGeometry();
  readonly #material = new THREE.PointsMaterial({
    color: 0xaec7ff,
    size: 3,
    sizeAttenuation: false,
    transparent: true,
    opacity: 0.9,
  });
  readonly #points: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  #objectIds: readonly ObjectId[] = Object.freeze([]);

  constructor(scene: THREE.Scene) {
    this.#scene = scene;
    this.#points = new THREE.Points(this.#geometry, this.#material);
    this.#points.name = "Runtime asteroid markers";
    this.#points.frustumCulled = true;
    this.#scene.add(this.#points);
    this.#replacePositions(new Float32Array(0));
  }

  update(
    frameObjectIds: readonly ObjectId[],
    states: readonly PropagationState[],
    runtimeObjectIds: readonly ObjectId[],
  ): void {
    if (frameObjectIds.length !== states.length) {
      throw new RangeError("Asteroid marker frame IDs and states must have equal length");
    }
    const runtimeSet = new Set<ObjectId>(runtimeObjectIds);
    const selectedIds: ObjectId[] = [];
    const positions = new Float32Array(runtimeSet.size * 3);
    let writeIndex = 0;
    for (let index = 0; index < frameObjectIds.length; index += 1) {
      const objectId = frameObjectIds[index];
      const state = states[index];
      if (objectId === undefined || state === undefined || !runtimeSet.has(objectId)) continue;
      const position = positionToSceneUnits(state.position);
      positions[writeIndex * 3] = position.x;
      positions[writeIndex * 3 + 1] = position.y;
      positions[writeIndex * 3 + 2] = position.z;
      selectedIds.push(objectId);
      writeIndex += 1;
    }
    const exactPositions = writeIndex === runtimeSet.size
      ? positions
      : positions.slice(0, writeIndex * 3);
    this.#objectIds = Object.freeze(selectedIds);
    this.#replacePositions(exactPositions);
    this.#geometry.computeBoundingSphere();
  }

  clear(): void {
    this.#objectIds = Object.freeze([]);
    this.#replacePositions(new Float32Array(0));
  }

  markerCount(): number {
    return this.#objectIds.length;
  }

  objectIdAt(index: number): ObjectId | undefined {
    return this.#objectIds[index];
  }

  pointsObject(): THREE.Points {
    return this.#points;
  }

  dispose(): void {
    this.#scene.remove(this.#points);
    this.#geometry.dispose();
    this.#material.dispose();
    this.#objectIds = Object.freeze([]);
  }

  #replacePositions(positions: Float32Array): void {
    this.#geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    this.#geometry.setDrawRange(0, positions.length / 3);
  }
}
