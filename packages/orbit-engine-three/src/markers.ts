import * as THREE from "three";
import type { ObjectId } from "orbit-engine";
import type { RenderVector3 } from "./render-space.js";

export const DEFAULT_MARKER_PICK_RADIUS_PIXELS = 5;
export const DEFAULT_MARKER_PICK_TOLERANCE_PIXELS = 2;
const PICK_DEPTH_EPSILON = 1e-7;
const FALLBACK_MARKER_COLOR = 0x9aa7b5;

const MARKER_VERTEX_SHADER = `
attribute float markerSize;
attribute vec3 color;
varying vec3 vColor;
void main() {
  vColor = color;
  vec4 modelViewPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * modelViewPosition;
  gl_PointSize = markerSize;
}`;

const MARKER_FRAGMENT_SHADER = `
varying vec3 vColor;
void main() {
  vec2 centered = gl_PointCoord - vec2(0.5);
  float distanceSquared = dot(centered, centered);
  if (distanceSquared > 0.25) discard;
  float edge = 1.0 - smoothstep(0.18, 0.25, distanceSquared);
  gl_FragColor = vec4(vColor, edge);
}`;

export interface MarkerRenderEntry {
  readonly objectId: ObjectId;
  readonly positionSceneUnits: RenderVector3;
  readonly sizePixels: number;
  readonly color?: number;
}

export interface MarkerPickingResult {
  readonly objectId: ObjectId;
  readonly ndcDepth: number;
  readonly screenDistancePixels: number;
}

export interface BatchedMarkerLayerOptions {
  readonly pickRadiusPixels?: number;
  readonly pickTolerancePixels?: number;
  readonly fallbackColor?: number;
}

function compareObjectId(left: ObjectId, right: ObjectId): number {
  const leftNumber = BigInt(left);
  const rightNumber = BigInt(right);
  return leftNumber < rightNumber ? -1 : leftNumber > rightNumber ? 1 : 0;
}

function finite(name: string, value: number): void {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
}

function validateColor(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffff) throw new RangeError("marker color must be a 24-bit integer");
}

function fallbackViewport(camera: THREE.Camera): { width: number; height: number } {
  const height = typeof window === "undefined" && camera instanceof THREE.PerspectiveCamera
    ? 1_000
    : (typeof window === "undefined" ? 1_000 : Math.max(window.innerHeight, 1));
  const aspect = camera instanceof THREE.PerspectiveCamera && Number.isFinite(camera.aspect) && camera.aspect > 0 ? camera.aspect : 1;
  return { width: height * aspect, height };
}

/** One package-owned Points drawable for an arbitrary unresolved population. */
export class BatchedMarkerLayer {
  readonly #parent: THREE.Object3D;
  readonly #points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  readonly #pickRadiusPixels: number;
  readonly #pickTolerancePixels: number;
  readonly #fallbackColor: number;
  #objectIds: readonly ObjectId[] = [];
  #disposed = false;

  constructor(parent: THREE.Object3D, options: BatchedMarkerLayerOptions = {}) {
    this.#parent = parent;
    this.#pickRadiusPixels = options.pickRadiusPixels ?? DEFAULT_MARKER_PICK_RADIUS_PIXELS;
    this.#pickTolerancePixels = options.pickTolerancePixels ?? DEFAULT_MARKER_PICK_TOLERANCE_PIXELS;
    this.#fallbackColor = options.fallbackColor ?? FALLBACK_MARKER_COLOR;
    finite("pickRadiusPixels", this.#pickRadiusPixels);
    finite("pickTolerancePixels", this.#pickTolerancePixels);
    if (this.#pickRadiusPixels < 0 || this.#pickTolerancePixels < 0) throw new RangeError("marker picking radii must be non-negative");
    validateColor(this.#fallbackColor);
    this.#points = new THREE.Points(
      new THREE.BufferGeometry(),
      new THREE.ShaderMaterial({
        vertexShader: MARKER_VERTEX_SHADER,
        fragmentShader: MARKER_FRAGMENT_SHADER,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        depthTest: true,
        toneMapped: true,
      }),
    );
    this.#points.name = "orbit-engine-three batched markers";
    this.#points.userData.objectType = "batched-marker";
    this.#points.visible = false;
    this.#parent.add(this.#points);
  }

  get objectIds(): readonly ObjectId[] {
    return this.#objectIds;
  }

  setEntries(entries: readonly MarkerRenderEntry[]): void {
    if (this.#disposed) throw new Error("marker layer has already been disposed");
    const sorted = [...entries].sort((left, right) => compareObjectId(left.objectId, right.objectId));
    const ids = new Set<ObjectId>();
    const positions = new Float32Array(sorted.length * 3);
    const colors = new Float32Array(sorted.length * 3);
    const sizes = new Float32Array(sorted.length);
    sorted.forEach((entry, index) => {
      if (ids.has(entry.objectId)) throw new RangeError(`duplicate marker objectId ${entry.objectId}`);
      ids.add(entry.objectId);
      finite(`marker ${entry.objectId} position.x`, entry.positionSceneUnits.x);
      finite(`marker ${entry.objectId} position.y`, entry.positionSceneUnits.y);
      finite(`marker ${entry.objectId} position.z`, entry.positionSceneUnits.z);
      finite(`marker ${entry.objectId} sizePixels`, entry.sizePixels);
      if (entry.sizePixels < 0) throw new RangeError(`marker ${entry.objectId} sizePixels must be non-negative`);
      const color = new THREE.Color(entry.color ?? this.#fallbackColor);
      if (entry.color !== undefined) validateColor(entry.color);
      const offset = index * 3;
      positions[offset] = entry.positionSceneUnits.x;
      positions[offset + 1] = entry.positionSceneUnits.y;
      positions[offset + 2] = entry.positionSceneUnits.z;
      colors[offset] = color.r;
      colors[offset + 1] = color.g;
      colors[offset + 2] = color.b;
      sizes[index] = entry.sizePixels;
    });
    this.#objectIds = Object.freeze(sorted.map((entry) => entry.objectId));
    this.#points.geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    this.#points.geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    this.#points.geometry.setAttribute("markerSize", new THREE.BufferAttribute(sizes, 1));
    this.#points.geometry.setDrawRange(0, sorted.length);
    this.#points.userData.objectIds = this.#objectIds;
    this.#points.visible = sorted.length > 0;
  }

  count(): number {
    return this.#objectIds.length;
  }

  contains(objectId: ObjectId): boolean {
    return this.#objectIds.includes(objectId);
  }

  positionFor(objectId: ObjectId): THREE.Vector3 | undefined {
    const index = this.#objectIds.indexOf(objectId);
    if (index < 0) return undefined;
    const attribute = this.#points.geometry.getAttribute("position");
    if (!(attribute instanceof THREE.BufferAttribute)) return undefined;
    return new THREE.Vector3(attribute.getX(index), attribute.getY(index), attribute.getZ(index));
  }

  worldPositionFor(objectId: ObjectId): THREE.Vector3 | undefined {
    const position = this.positionFor(objectId);
    return position === undefined ? undefined : position.applyMatrix4(this.#points.matrixWorld);
  }

  sizeFor(objectId: ObjectId): number | undefined {
    const index = this.#objectIds.indexOf(objectId);
    if (index < 0) return undefined;
    const attribute = this.#points.geometry.getAttribute("markerSize");
    if (!(attribute instanceof THREE.BufferAttribute)) return undefined;
    return attribute.getX(index);
  }

  /** Hit area is a fixed interaction affordance independent of visible point size. */
  pick(normalizedDeviceX: number, normalizedDeviceY: number, camera: THREE.Camera, viewportWidthCssPixels?: number, viewportHeightCssPixels?: number): MarkerPickingResult | undefined {
    if (this.#disposed || !this.#points.visible || this.#objectIds.length === 0) return undefined;
    finite("normalizedDeviceX", normalizedDeviceX);
    finite("normalizedDeviceY", normalizedDeviceY);
    const fallback = fallbackViewport(camera);
    const viewportWidth = viewportWidthCssPixels ?? fallback.width;
    const viewportHeight = viewportHeightCssPixels ?? fallback.height;
    if (!Number.isFinite(viewportWidth) || viewportWidth <= 0 || !Number.isFinite(viewportHeight) || viewportHeight <= 0) {
      throw new RangeError("marker picking viewport must be finite and positive");
    }
    this.#points.updateMatrixWorld(true);
    const positions = this.#points.geometry.getAttribute("position");
    if (!(positions instanceof THREE.BufferAttribute)) return undefined;
    const candidates: MarkerPickingResult[] = [];
    this.#objectIds.forEach((objectId, index) => {
      const localPosition = new THREE.Vector3(positions.getX(index), positions.getY(index), positions.getZ(index));
      const worldPosition = localPosition.applyMatrix4(this.#points.matrixWorld);
      const cameraSpace = worldPosition.clone().applyMatrix4(camera.matrixWorldInverse);
      if (!Number.isFinite(cameraSpace.z) || cameraSpace.z >= 0) return;
      const ndc = worldPosition.project(camera);
      if (!Number.isFinite(ndc.x) || !Number.isFinite(ndc.y) || !Number.isFinite(ndc.z)) return;
      if (ndc.x < -1 || ndc.x > 1 || ndc.y < -1 || ndc.y > 1 || ndc.z < -1 || ndc.z > 1) return;
      const screenDistancePixels = Math.hypot(
        (ndc.x - normalizedDeviceX) * viewportWidth / 2,
        (ndc.y - normalizedDeviceY) * viewportHeight / 2,
      );
      if (screenDistancePixels > this.#pickRadiusPixels + this.#pickTolerancePixels) return;
      candidates.push({ objectId, ndcDepth: ndc.z, screenDistancePixels });
    });
    candidates.sort((left, right) => {
      const depthDelta = left.ndcDepth - right.ndcDepth;
      if (Math.abs(depthDelta) > PICK_DEPTH_EPSILON) return depthDelta;
      const screenDelta = left.screenDistancePixels - right.screenDistancePixels;
      if (Math.abs(screenDelta) > Number.EPSILON) return screenDelta;
      return compareObjectId(left.objectId, right.objectId);
    });
    return candidates[0];
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#points.removeFromParent();
    this.#points.geometry.dispose();
    this.#points.material.dispose();
    this.#objectIds = [];
  }
}
