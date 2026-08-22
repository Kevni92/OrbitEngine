import * as THREE from "three";
import type { ObjectId, PropagationState } from "orbit-engine";
import type { RegisteredScenarioBody } from "../scenario/load-solar-system.js";
import { MARKER_RENDER_ORDER } from "./presentation-order.js";
import { positionToSceneUnits } from "./render-space.js";

export const MARKER_PIXEL_SIZE = 7;
export const MARKER_PICK_TOLERANCE_PIXELS = 2;
export const MARKER_PICK_RADIUS_PIXELS = MARKER_PIXEL_SIZE / 2 + MARKER_PICK_TOLERANCE_PIXELS;

const PICK_DEPTH_EPSILON = 1e-7;
const FALLBACK_MARKER_COLOR = 0x9aa7b5;

const MARKER_VERTEX_SHADER = `
uniform float uSize;
attribute vec3 color;
varying vec3 vColor;

void main() {
  vColor = color;
  vec4 modelViewPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * modelViewPosition;
  gl_PointSize = uSize;
}
`;

const MARKER_FRAGMENT_SHADER = `
varying vec3 vColor;

void main() {
  vec2 centered = gl_PointCoord - vec2(0.5);
  float distanceSquared = dot(centered, centered);
  if (distanceSquared > 0.25) discard;
  float edge = 1.0 - smoothstep(0.18, 0.25, distanceSquared);
  gl_FragColor = vec4(vColor, edge);
}
`;

interface MarkerPickCandidate {
  readonly objectId: ObjectId;
  readonly ndcDepth: number;
  readonly screenDistancePixels: number;
}

function fallbackViewport(camera: THREE.Camera): { width: number; height: number } {
  const browserHeight = typeof window === "undefined" ? undefined : window.innerHeight;
  const height = browserHeight !== undefined && Number.isFinite(browserHeight) && browserHeight > 0
    ? browserHeight
    : 1_000;
  const aspect = camera instanceof THREE.PerspectiveCamera && Number.isFinite(camera.aspect) && camera.aspect > 0
    ? camera.aspect
    : 1;
  return { width: height * aspect, height };
}

function isBodyMesh(object: THREE.Object3D): object is THREE.Mesh {
  return object instanceof THREE.Mesh
    && object.visible
    && typeof object.userData.objectId === "string";
}

/** A single bounded GPU marker layer for all unresolved current objects. */
export class BatchedMarkerLayer {
  readonly #scene: THREE.Scene;
  readonly #points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  #objectIds: readonly ObjectId[] = [];
  #positions = new Float32Array();
  #colors = new Float32Array();

  constructor(scene: THREE.Scene) {
    this.#scene = scene;
    const geometry = new THREE.BufferGeometry();
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uSize: { value: MARKER_PIXEL_SIZE },
      },
      vertexShader: MARKER_VERTEX_SHADER,
      fragmentShader: MARKER_FRAGMENT_SHADER,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      depthTest: true,
    });
    this.#points = new THREE.Points(geometry, material);
    this.#points.name = "Runtime asteroid markers";
    this.#points.userData.objectType = "asteroid";
    this.#points.renderOrder = MARKER_RENDER_ORDER;
    this.#points.visible = false;
    scene.add(this.#points);
  }

  setBodies(
    bodies: readonly RegisteredScenarioBody[],
    currentPositions: ReadonlyMap<ObjectId, THREE.Vector3> = new Map(),
  ): void {
    this.#objectIds = Object.freeze(bodies.map((body) => body.definition.id));
    this.#positions = new Float32Array(this.#objectIds.length * 3);
    this.#colors = new Float32Array(this.#objectIds.length * 3);
    bodies.forEach((body, index) => {
      const objectId = body.definition.id;
      const offset = index * 3;
      const position = currentPositions.get(objectId);
      if (position !== undefined) {
        this.#positions[offset] = position.x;
        this.#positions[offset + 1] = position.y;
        this.#positions[offset + 2] = position.z;
      }
      // Committed/runtime catalog bodies carry display colors. The fallback is
      // only for intentionally incomplete synthetic fixtures used by low-level tests.
      const color = new THREE.Color(body.definition.display?.color ?? FALLBACK_MARKER_COLOR);
      this.#colors[offset] = color.r;
      this.#colors[offset + 1] = color.g;
      this.#colors[offset + 2] = color.b;
    });
    this.#points.geometry.setAttribute("position", new THREE.BufferAttribute(this.#positions, 3));
    this.#points.geometry.setAttribute("color", new THREE.BufferAttribute(this.#colors, 3));
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

  contains(objectId: ObjectId): boolean {
    return this.#objectIds.includes(objectId);
  }

  positionFor(objectId: ObjectId): THREE.Vector3 | undefined {
    const index = this.#objectIds.indexOf(objectId);
    if (index < 0) return undefined;
    const positions = this.#points.geometry.getAttribute("position");
    if (!(positions instanceof THREE.BufferAttribute)) return undefined;
    return new THREE.Vector3(positions.getX(index), positions.getY(index), positions.getZ(index));
  }

  /**
   * Marker hit testing is screen-space based because the rendered marker is a
   * fixed-size point sprite. A world-space Raycaster Points threshold makes
   * the invisible hit area explode in compact local systems.
   */
  pick(
    normalizedDeviceX: number,
    normalizedDeviceY: number,
    camera: THREE.Camera,
    viewportWidthPixels?: number,
    viewportHeightPixels?: number,
  ): ObjectId | undefined {
    if (!this.#points.visible || this.#objectIds.length === 0) return undefined;

    const fallback = fallbackViewport(camera);
    const viewportWidth = viewportWidthPixels ?? fallback.width;
    const viewportHeight = viewportHeightPixels ?? fallback.height;
    if (!Number.isFinite(viewportWidth) || viewportWidth <= 0
        || !Number.isFinite(viewportHeight) || viewportHeight <= 0) {
      throw new RangeError("Marker picking viewport must be finite and positive");
    }

    camera.updateMatrixWorld(true);
    const positions = this.#points.geometry.getAttribute("position");
    if (!(positions instanceof THREE.BufferAttribute)) return undefined;

    const candidates: MarkerPickCandidate[] = [];
    this.#objectIds.forEach((objectId, index) => {
      const position = new THREE.Vector3(positions.getX(index), positions.getY(index), positions.getZ(index));
      const cameraSpace = position.clone().applyMatrix4(camera.matrixWorldInverse);
      if (!Number.isFinite(cameraSpace.z) || cameraSpace.z >= 0) return;

      const ndc = position.clone().project(camera);
      if (!Number.isFinite(ndc.x) || !Number.isFinite(ndc.y) || !Number.isFinite(ndc.z)) return;
      if (ndc.x < -1 || ndc.x > 1 || ndc.y < -1 || ndc.y > 1 || ndc.z < -1 || ndc.z > 1) return;

      const deltaPixelsX = (ndc.x - normalizedDeviceX) * viewportWidth / 2;
      const deltaPixelsY = (ndc.y - normalizedDeviceY) * viewportHeight / 2;
      const screenDistancePixels = Math.hypot(deltaPixelsX, deltaPixelsY);
      if (screenDistancePixels > MARKER_PICK_RADIUS_PIXELS) return;

      candidates.push({ objectId, ndcDepth: ndc.z, screenDistancePixels });
    });

    if (candidates.length === 0) return undefined;
    candidates.sort((left, right) => {
      const depthDelta = left.ndcDepth - right.ndcDepth;
      if (Math.abs(depthDelta) > PICK_DEPTH_EPSILON) return depthDelta;
      const screenDelta = left.screenDistancePixels - right.screenDistancePixels;
      if (Math.abs(screenDelta) > Number.EPSILON) return screenDelta;
      return BigInt(left.objectId) < BigInt(right.objectId) ? -1 : 1;
    });

    // Marker points use normal depth testing. If an opaque body sphere is in
    // front at the click location, the marker is not visually present there
    // and must not steal the click before SolarSystemScene raycasts spheres.
    const bodyMeshes: THREE.Mesh[] = [];
    this.#scene.traverse((object) => {
      if (isBodyMesh(object)) bodyMeshes.push(object);
    });
    if (bodyMeshes.length === 0) return candidates[0]!.objectId;

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(normalizedDeviceX, normalizedDeviceY), camera);
    const sphereHit = raycaster.intersectObjects(bodyMeshes, false)[0];
    if (sphereHit === undefined) return candidates[0]!.objectId;
    const sphereDepth = sphereHit.point.clone().project(camera).z;

    const visibleMarker = candidates.find((candidate) => candidate.ndcDepth <= sphereDepth + PICK_DEPTH_EPSILON);
    return visibleMarker?.objectId;
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
    this.#colors = new Float32Array();
  }
}

/** @deprecated Kept as a source-compatible alias for the Stage A marker path. */
export const RuntimeAsteroidMarkers = BatchedMarkerLayer;
