import * as THREE from "three";
import type { ObjectId, PropagationState } from "orbit-engine";
import type { RegisteredScenarioBody } from "../scenario/load-solar-system.js";
import { positionToSceneUnits } from "./render-space.js";

export const MARKER_PIXEL_SIZE = 7;

const MARKER_VERTEX_SHADER = `
uniform float uSize;

void main() {
  vec4 modelViewPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * modelViewPosition;
  gl_PointSize = uSize;
}
`;

const MARKER_FRAGMENT_SHADER = `
uniform vec3 uColor;

void main() {
  vec2 centered = gl_PointCoord - vec2(0.5);
  float distanceSquared = dot(centered, centered);
  if (distanceSquared > 0.25) discard;
  float edge = 1.0 - smoothstep(0.18, 0.25, distanceSquared);
  gl_FragColor = vec4(uColor, edge * 0.9);
}
`;

/** A single bounded GPU marker layer for all unresolved current objects. */
export class BatchedMarkerLayer {
  readonly #points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  #objectIds: readonly ObjectId[] = [];
  #positions = new Float32Array();

  constructor(scene: THREE.Scene) {
    const geometry = new THREE.BufferGeometry();
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(0x9aa7b5) },
        uSize: { value: MARKER_PIXEL_SIZE },
      },
      vertexShader: MARKER_VERTEX_SHADER,
      fragmentShader: MARKER_FRAGMENT_SHADER,
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

  setBodies(bodies: readonly RegisteredScenarioBody[]): void {
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

/** @deprecated Kept as a source-compatible alias for the Stage A marker path. */
export const RuntimeAsteroidMarkers = BatchedMarkerLayer;
