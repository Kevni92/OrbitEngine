import * as THREE from "three";
import type { ObjectId } from "orbit-engine";
import type { OrbitPath } from "../simulation/path-sampling.js";
import { ORBIT_RENDER_ORDER } from "./presentation-order.js";
import { positionToSceneUnits } from "./render-space.js";

export const ORBIT_BASE_OPACITY = 0.18;
export const ORBIT_SELECTED_BASE_OPACITY = 0.34;
export const ORBIT_HEAD_FRACTION = 0.08;
export const ORBIT_TAIL_FRACTION = 0.34;

export interface TrailGradientOptions {
  readonly headFraction?: number;
  readonly tailFraction?: number;
}

export function nearestOrbitSampleIndex(points: readonly THREE.Vector3[], position: THREE.Vector3): number {
  if (points.length === 0) throw new RangeError("Orbit path must contain at least one point");
  let nearest = 0;
  let distance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index]!;
    const candidate = point.distanceToSquared(position);
    if (candidate < distance) {
      distance = candidate;
      nearest = index;
    }
  }
  return nearest;
}

export function computeTrailAlphas(
  sampleCount: number,
  phaseIndex: number,
  options: TrailGradientOptions = {},
): readonly number[] {
  if (!Number.isSafeInteger(sampleCount) || sampleCount < 2) throw new RangeError("Orbit sample count must be at least 2");
  if (!Number.isSafeInteger(phaseIndex) || phaseIndex < 0 || phaseIndex >= sampleCount) {
    throw new RangeError("Orbit phase index is out of range");
  }
  const headSamples = Math.max(1, Math.round(sampleCount * (options.headFraction ?? ORBIT_HEAD_FRACTION)));
  const tailSamples = Math.max(1, Math.round(sampleCount * (options.tailFraction ?? ORBIT_TAIL_FRACTION)));
  return Object.freeze(Array.from({ length: sampleCount }, (_, index) => {
    const forward = (index - phaseIndex + sampleCount) % sampleCount;
    const behind = (phaseIndex - index + sampleCount) % sampleCount;
    const headAlpha = forward <= headSamples
      ? 0.98 - (0.16 * forward) / headSamples
      : 0;
    const tailAlpha = behind <= tailSamples
      ? 0.84 * Math.max(0, 1 - behind / tailSamples) ** 1.15
      : 0;
    return Math.max(headAlpha, tailAlpha);
  }));
}

interface OrbitEntry {
  readonly path: OrbitPath;
  readonly group: THREE.Group;
  readonly points: readonly THREE.Vector3[];
  readonly geometry: THREE.BufferGeometry;
  readonly baseLine: THREE.LineLoop<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  readonly highlightLine: THREE.LineLoop<THREE.BufferGeometry, THREE.ShaderMaterial>;
  readonly baseMaterial: THREE.LineBasicMaterial;
  readonly highlightMaterial: THREE.ShaderMaterial;
  phaseIndex: number;
}

function mutedColor(value: number): THREE.Color {
  return new THREE.Color(value).lerp(new THREE.Color(0x8da1bf), 0.62);
}

function createHighlightMaterial(color: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
    },
    vertexShader: `
      attribute float trailAlpha;
      varying float vTrailAlpha;
      void main() {
        vTrailAlpha = trailAlpha;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      varying float vTrailAlpha;
      void main() {
        gl_FragColor = vec4(uColor, vTrailAlpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });
}

export class OrbitRenderer {
  readonly #root: THREE.Group;
  readonly #entries = new Map<ObjectId, OrbitEntry>();
  #visible = true;
  #selected?: ObjectId;
  #positions = new Map<ObjectId, THREE.Vector3>();
  readonly #representationVisible = new Map<ObjectId, boolean>();

  constructor(scene: THREE.Scene) {
    this.#root = new THREE.Group();
    this.#root.name = "orbit-layer";
    this.#root.userData.visible = true;
    this.#root.userData.orbitCount = 0;
    scene.add(this.#root);
  }

  get group(): THREE.Group {
    return this.#root;
  }

  isVisible(): boolean {
    return this.#visible;
  }

  setVisible(visible: boolean): void {
    this.#visible = Boolean(visible);
    this.#root.visible = this.#visible;
    this.#root.userData.visible = this.#visible;
  }

  setSelected(objectId: ObjectId | undefined): void {
    this.#selected = objectId;
    for (const entry of this.#entries.values()) this.#updateEntryVisibility(entry);
    if (objectId !== undefined) this.#updateSelectedGradient();
    this.#root.userData.selectedObjectId = objectId;
    this.#root.userData.selectedOrbitActive = objectId !== undefined && this.#entries.has(objectId);
  }

  /** Hide background paths for hidden/marker bodies without changing path ownership. */
  setBodyRepresentation(objectId: ObjectId, visible: boolean): void {
    this.#representationVisible.set(objectId, Boolean(visible));
    const entry = this.#entries.get(objectId);
    if (entry !== undefined) this.#updateEntryVisibility(entry);
  }

  setPath(path: OrbitPath, bodyColor: number): void {
    this.clearPath(path.objectId);
    const points = Object.freeze(path.samples.map((sample) => {
      const position = positionToSceneUnits(sample.state.position);
      return new THREE.Vector3(position.x, position.y, position.z);
    }));
    const geometry = new THREE.BufferGeometry().setFromPoints([...points]);
    geometry.setAttribute("trailAlpha", new THREE.Float32BufferAttribute(new Array(points.length).fill(0), 1));
    const baseMaterial = new THREE.LineBasicMaterial({
      color: mutedColor(bodyColor),
      transparent: true,
      opacity: ORBIT_BASE_OPACITY,
      depthWrite: false,
    });
    const highlightMaterial = createHighlightMaterial(bodyColor);
    const baseLine = new THREE.LineLoop(geometry, baseMaterial);
    const highlightLine = new THREE.LineLoop(geometry, highlightMaterial);
    baseLine.renderOrder = ORBIT_RENDER_ORDER;
    highlightLine.renderOrder = ORBIT_RENDER_ORDER;
    const group = new THREE.Group();
    group.name = `Orbit ${path.objectId}`;
    group.userData.objectId = path.objectId;
    group.userData.centralBodyId = path.focusId;
    group.userData.closedReferenceOrbit = path.closedReferenceOrbit ?? true;
    group.add(baseLine, highlightLine);
    this.#root.add(group);
    const entry: OrbitEntry = {
      path,
      group,
      points,
      geometry,
      baseLine,
      highlightLine,
      baseMaterial,
      highlightMaterial,
      phaseIndex: 0,
    };
    this.#entries.set(path.objectId, entry);
    this.#updateEntryVisibility(entry);
    this.#updateEntryAnchor(entry);
    this.#root.userData.orbitCount = this.#entries.size;
    if (this.#selected === path.objectId) this.#updateSelectedGradient();
  }

  updateBodyPositions(positions: ReadonlyMap<ObjectId, THREE.Vector3>): void {
    this.#positions = new Map([...positions].map(([id, position]) => [id, position.clone()]));
    for (const entry of this.#entries.values()) this.#updateEntryAnchor(entry);
    this.#updateSelectedGradient();
  }

  clearPath(objectId: ObjectId): void {
    const entry = this.#entries.get(objectId);
    if (entry === undefined) return;
    entry.group.remove(entry.baseLine, entry.highlightLine);
    this.#root.remove(entry.group);
    entry.geometry.dispose();
    entry.baseMaterial.dispose();
    entry.highlightMaterial.dispose();
    this.#entries.delete(objectId);
    this.#representationVisible.delete(objectId);
    this.#root.userData.orbitCount = this.#entries.size;
    this.#root.userData.selectedOrbitActive = this.#selected !== undefined && this.#entries.has(this.#selected);
  }

  clearPaths(): void {
    for (const objectId of [...this.#entries.keys()]) this.clearPath(objectId);
  }

  pathCount(): number {
    return this.#entries.size;
  }

  hasPath(objectId: ObjectId): boolean {
    return this.#entries.has(objectId);
  }

  isPathVisible(objectId: ObjectId): boolean {
    return this.#entries.get(objectId)?.group.visible === true && this.#root.visible;
  }

  phaseIndexFor(objectId: ObjectId): number | undefined {
    return this.#entries.get(objectId)?.phaseIndex;
  }

  dispose(): void {
    this.clearPaths();
    this.#root.parent?.remove(this.#root);
    this.#positions.clear();
    this.#representationVisible.clear();
  }

  #updateEntryVisibility(entry: OrbitEntry): void {
    const selected = entry.path.objectId === this.#selected;
    entry.baseMaterial.opacity = selected ? ORBIT_SELECTED_BASE_OPACITY : ORBIT_BASE_OPACITY;
    entry.highlightLine.visible = selected && this.#visible;
    entry.group.visible = this.#visible
      && ((this.#representationVisible.get(entry.path.objectId) ?? true) || selected);
  }

  #updateEntryAnchor(entry: OrbitEntry): void {
    const position = this.#positions.get(entry.path.focusId);
    if (position !== undefined) entry.group.position.copy(position);
  }

  #updateSelectedGradient(): void {
    if (this.#selected === undefined) return;
    const entry = this.#entries.get(this.#selected);
    if (entry === undefined) return;
    const bodyPosition = this.#positions.get(entry.path.objectId);
    const centralPosition = this.#positions.get(entry.path.focusId);
    if (bodyPosition === undefined || centralPosition === undefined) return;
    const relativePosition = bodyPosition.clone().sub(centralPosition);
    entry.phaseIndex = nearestOrbitSampleIndex(entry.points, relativePosition);
    const alphas = computeTrailAlphas(entry.points.length, entry.phaseIndex);
    const attribute = entry.geometry.getAttribute("trailAlpha") as THREE.BufferAttribute;
    for (let index = 0; index < alphas.length; index += 1) attribute.setX(index, alphas[index]!);
    attribute.needsUpdate = true;
  }
}
