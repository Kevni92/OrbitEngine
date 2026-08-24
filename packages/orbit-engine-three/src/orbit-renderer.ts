import * as THREE from "three";
import type { ObjectId } from "orbit-engine";
import { createRenderSpaceConfig, transformSnapshotPositionToSceneUnits, type RenderSpaceConfig, type RenderVector3 } from "./render-space.js";
import type { OrbitPathSnapshot } from "./orbit.js";

export const ORBIT_PATH_RENDER_ORDER = 10;
export const DEFAULT_ORBIT_BASE_OPACITY = 0.18;
export const DEFAULT_ORBIT_SELECTED_OPACITY = 0.42;
export const DEFAULT_ORBIT_PICK_RADIUS_SCENE_UNITS = 0.15;
export const DEFAULT_ORBIT_HEAD_FRACTION = 0.08;
export const DEFAULT_ORBIT_TAIL_FRACTION = 0.34;

export interface OrbitDirectionStyle {
  readonly enabled?: boolean;
  readonly headFraction?: number;
  readonly tailFraction?: number;
  readonly headOpacity?: number;
  readonly tailOpacity?: number;
}

export interface OrbitPathStyle {
  readonly color?: number;
  readonly opacity?: number;
  readonly selectedOpacity?: number;
  readonly depthTest?: boolean;
  readonly depthWrite?: boolean;
  readonly lineWidth?: number;
  readonly direction?: OrbitDirectionStyle | false;
  readonly directionStyling?: OrbitDirectionStyle | false;
}

export interface OrbitPathRendererOptions {
  readonly renderSpace?: Partial<RenderSpaceConfig>;
  readonly defaultStyle?: OrbitPathStyle;
  readonly pickRadiusSceneUnits?: number;
}

export interface OrbitPathDiagnostics {
  readonly objectId: ObjectId;
  readonly parentId?: ObjectId;
  readonly visible: boolean;
  readonly selected: boolean;
  readonly opacity: number;
  readonly sampleCount: number;
  readonly fingerprint: string;
}

export interface OrbitPickResult {
  readonly objectId: ObjectId;
  readonly representation: "orbit";
  readonly distance: number;
}

interface OrbitEntry {
  readonly path: OrbitPathSnapshot;
  readonly group: THREE.Group;
  readonly geometry: THREE.BufferGeometry;
  readonly positionAttribute: THREE.BufferAttribute;
  readonly trailAttribute: THREE.BufferAttribute;
  readonly baseLine: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  readonly directionLine: THREE.Line<THREE.BufferGeometry, THREE.ShaderMaterial>;
  readonly baseMaterial: THREE.LineBasicMaterial;
  readonly directionMaterial: THREE.ShaderMaterial;
  readonly style: Required<Pick<OrbitPathStyle, "color" | "opacity" | "selectedOpacity" | "depthTest" | "depthWrite" | "lineWidth">> & { readonly direction: OrbitDirectionStyle | false };
  phaseIndex: number;
}

function finite(name: string, value: number): void {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
}

function opacity(name: string, value: number): void {
  finite(name, value);
  if (value < 0 || value > 1) throw new RangeError(`${name} must be in [0, 1]`);
}

function fraction(name: string, value: number): void {
  finite(name, value);
  if (value < 0 || value > 1) throw new RangeError(`${name} must be in [0, 1]`);
}

function color(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffff) throw new RangeError("Orbit color must be a 24-bit integer");
}

function compareObjectId(left: ObjectId, right: ObjectId): number {
  const leftValue = BigInt(left);
  const rightValue = BigInt(right);
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
}

function point(value: RenderVector3 | THREE.Vector3): THREE.Vector3 {
  return value instanceof THREE.Vector3 ? value.clone() : new THREE.Vector3(value.x, value.y, value.z);
}

function directionStyle(style: OrbitPathStyle): OrbitDirectionStyle | false {
  const candidate = style.directionStyling ?? style.direction;
  return candidate === undefined ? false : candidate;
}

function normalizeStyle(style: OrbitPathStyle, defaults: OrbitPathStyle): OrbitEntry["style"] {
  const merged = { ...defaults, ...style };
  const direction = directionStyle(merged);
  const normalizedDirection = direction === false ? false : Object.freeze({
    enabled: direction.enabled ?? true,
    headFraction: direction.headFraction ?? DEFAULT_ORBIT_HEAD_FRACTION,
    tailFraction: direction.tailFraction ?? DEFAULT_ORBIT_TAIL_FRACTION,
    headOpacity: direction.headOpacity ?? 1,
    tailOpacity: direction.tailOpacity ?? 0.78,
  });
  color(merged.color ?? 0x6688aa);
  opacity("orbit opacity", merged.opacity ?? DEFAULT_ORBIT_BASE_OPACITY);
  opacity("selected orbit opacity", merged.selectedOpacity ?? DEFAULT_ORBIT_SELECTED_OPACITY);
  finite("lineWidth", merged.lineWidth ?? 1);
  if ((merged.lineWidth ?? 1) <= 0) throw new RangeError("lineWidth must be positive");
  if (normalizedDirection !== false) {
    fraction("direction headFraction", normalizedDirection.headFraction);
    fraction("direction tailFraction", normalizedDirection.tailFraction);
    opacity("direction headOpacity", normalizedDirection.headOpacity);
    opacity("direction tailOpacity", normalizedDirection.tailOpacity);
  }
  return Object.freeze({
    color: merged.color ?? 0x6688aa,
    opacity: merged.opacity ?? DEFAULT_ORBIT_BASE_OPACITY,
    selectedOpacity: merged.selectedOpacity ?? DEFAULT_ORBIT_SELECTED_OPACITY,
    depthTest: merged.depthTest ?? true,
    depthWrite: merged.depthWrite ?? false,
    lineWidth: merged.lineWidth ?? 1,
    direction: normalizedDirection,
  });
}

function computeTrailAlphas(sampleCount: number, phaseIndex: number, direction: OrbitDirectionStyle): readonly number[] {
  const headSamples = Math.max(1, Math.round(sampleCount * direction.headFraction!));
  const tailSamples = Math.max(1, Math.round(sampleCount * direction.tailFraction!));
  return Object.freeze(Array.from({ length: sampleCount }, (_, index) => {
    const forward = (index - phaseIndex + sampleCount) % sampleCount;
    const behind = (phaseIndex - index + sampleCount) % sampleCount;
    const head = forward <= headSamples
      ? direction.headOpacity! * Math.max(0, 1 - forward / headSamples)
      : 0;
    const tail = behind <= tailSamples
      ? direction.tailOpacity! * Math.max(0, 1 - behind / tailSamples)
      : 0;
    return Math.max(head, tail);
  }));
}

function createDirectionMaterial(style: OrbitEntry["style"]): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(style.color) } },
    vertexShader: `
      attribute float orbitDirectionAlpha;
      varying float vOrbitDirectionAlpha;
      void main() {
        vOrbitDirectionAlpha = orbitDirectionAlpha;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      varying float vOrbitDirectionAlpha;
      void main() { gl_FragColor = vec4(uColor, vOrbitDirectionAlpha); }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: style.depthTest,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
}

export function nearestOrbitSampleIndex(points: readonly THREE.Vector3[], position: THREE.Vector3): number {
  if (points.length === 0) throw new RangeError("Orbit path must contain at least one point");
  let nearest = 0;
  let distance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < points.length; index += 1) {
    const candidate = points[index]!.distanceToSquared(position);
    if (candidate < distance) {
      distance = candidate;
      nearest = index;
    }
  }
  return nearest;
}

export class OrbitPathRenderer {
  readonly #root = new THREE.Group();
  readonly #renderSpace: RenderSpaceConfig;
  readonly #defaultStyle: OrbitPathStyle;
  readonly #pickRadiusSceneUnits: number;
  readonly #entries = new Map<ObjectId, OrbitEntry>();
  readonly #positions = new Map<ObjectId, THREE.Vector3>();
  readonly #representationVisible = new Map<ObjectId, boolean>();
  #selected?: ObjectId;
  #visible = true;

  constructor(parent: THREE.Object3D, options: OrbitPathRendererOptions = {}) {
    this.#renderSpace = createRenderSpaceConfig(options.renderSpace);
    this.#defaultStyle = Object.freeze({ ...(options.defaultStyle ?? {}) });
    this.#pickRadiusSceneUnits = options.pickRadiusSceneUnits ?? DEFAULT_ORBIT_PICK_RADIUS_SCENE_UNITS;
    finite("pickRadiusSceneUnits", this.#pickRadiusSceneUnits);
    if (this.#pickRadiusSceneUnits <= 0) throw new RangeError("pickRadiusSceneUnits must be positive");
    this.#root.name = "orbit-engine-three orbit layer";
    this.#root.userData.orbitCount = 0;
    parent.add(this.#root);
  }

  get group(): THREE.Group {
    return this.#root;
  }

  pathCount(): number {
    return this.#entries.size;
  }

  hasPath(objectId: ObjectId): boolean {
    return this.#entries.has(objectId);
  }

  isVisible(): boolean {
    return this.#visible;
  }

  setVisible(visible: boolean): void {
    this.#visible = Boolean(visible);
    this.#root.visible = this.#visible;
    for (const entry of this.#entries.values()) this.#updateVisibility(entry);
  }

  setSelected(objectId: ObjectId | undefined): void {
    this.#selected = objectId;
    this.#root.userData.selectedObjectId = objectId;
    for (const entry of this.#entries.values()) {
      this.#updateVisibility(entry);
      this.#updateTrail(entry);
    }
  }

  setBodyRepresentation(objectId: ObjectId, visible: boolean): void {
    this.#representationVisible.set(objectId, Boolean(visible));
    const entry = this.#entries.get(objectId);
    if (entry !== undefined) this.#updateVisibility(entry);
  }

  setPath(path: OrbitPathSnapshot, style: OrbitPathStyle = {}): void {
    this.clearPath(path.objectId);
    const normalizedStyle = normalizeStyle(style, this.#defaultStyle);
    const points = Object.freeze(path.samples.map((sample) => transformSnapshotPositionToSceneUnits(sample.positionRelativeToOriginMeters, this.#renderSpace)).map(point));
    const geometry = new THREE.BufferGeometry();
    const positionAttribute = new THREE.Float32BufferAttribute(new Array(points.length * 3).fill(0), 3);
    const trailAttribute = new THREE.Float32BufferAttribute(new Array(points.length).fill(0), 1);
    geometry.setAttribute("position", positionAttribute);
    geometry.setAttribute("orbitDirectionAlpha", trailAttribute);
    const baseMaterial = new THREE.LineBasicMaterial({
      color: normalizedStyle.color,
      transparent: true,
      opacity: normalizedStyle.opacity,
      depthTest: normalizedStyle.depthTest,
      depthWrite: normalizedStyle.depthWrite,
      linewidth: normalizedStyle.lineWidth,
      toneMapped: false,
    });
    const directionMaterial = createDirectionMaterial(normalizedStyle);
    const baseLine = path.closed
      ? new THREE.LineLoop(geometry, baseMaterial)
      : new THREE.Line(geometry, baseMaterial);
    const directionLine = path.closed
      ? new THREE.LineLoop(geometry, directionMaterial)
      : new THREE.Line(geometry, directionMaterial);
    baseLine.renderOrder = ORBIT_PATH_RENDER_ORDER;
    directionLine.renderOrder = ORBIT_PATH_RENDER_ORDER + 1;
    const group = new THREE.Group();
    group.name = `Orbit ${path.objectId}`;
    group.userData.objectId = path.objectId;
    group.userData.parentId = path.parentId;
    group.userData.origin = path.origin;
    group.userData.closedReferenceOrbit = path.closedReferenceOrbit;
    group.add(baseLine, directionLine);
    this.#root.add(group);
    const entry: OrbitEntry = {
      path,
      group,
      geometry,
      positionAttribute,
      trailAttribute,
      baseLine,
      directionLine,
      baseMaterial,
      directionMaterial,
      style: normalizedStyle,
      phaseIndex: 0,
    };
    this.#entries.set(path.objectId, entry);
    this.#updateVisibility(entry);
    this.#updateGeometry(entry);
    this.#updateTrail(entry);
    this.#root.userData.orbitCount = this.#entries.size;
  }

  setPaths(paths: readonly OrbitPathSnapshot[], styleByObjectId?: ReadonlyMap<ObjectId, OrbitPathStyle>): void {
    const next = new Map(paths.map((path) => [path.objectId, path]));
    for (const objectId of [...this.#entries.keys()]) if (!next.has(objectId)) this.clearPath(objectId);
    for (const path of [...paths].sort((left, right) => compareObjectId(left.objectId, right.objectId))) {
      const style = styleByObjectId?.get(path.objectId) ?? this.#defaultStyle;
      const current = this.#entries.get(path.objectId);
      if (current?.path.fingerprint === path.fingerprint) {
        this.#updateVisibility(current);
        continue;
      }
      this.setPath(path, style);
    }
  }

  updateBodyPositions(positions: ReadonlyMap<ObjectId, RenderVector3 | THREE.Vector3>): void {
    this.#positions.clear();
    for (const [objectId, value] of positions) this.#positions.set(objectId, point(value));
    for (const entry of this.#entries.values()) {
      this.#updateGeometry(entry);
      this.#updateTrail(entry);
    }
  }

  guideDiagnostics(): readonly OrbitPathDiagnostics[] {
    return Object.freeze([...this.#entries.values()].map((entry) => Object.freeze({
      objectId: entry.path.objectId,
      ...(entry.path.parentId === undefined ? {} : { parentId: entry.path.parentId }),
      visible: entry.group.visible,
      selected: entry.path.objectId === this.#selected,
      opacity: entry.baseMaterial.opacity,
      sampleCount: entry.path.sampleCount,
      fingerprint: entry.path.fingerprint,
    })));
  }

  pick(normalizedDeviceX: number, normalizedDeviceY: number, camera: THREE.Camera): OrbitPickResult | undefined {
    if (!this.#visible) return undefined;
    this.#root.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
    const raycaster = new THREE.Raycaster();
    raycaster.params.Line = { threshold: this.#pickRadiusSceneUnits };
    raycaster.setFromCamera(new THREE.Vector2(normalizedDeviceX, normalizedDeviceY), camera);
    const lines = [...this.#entries.values()].filter((entry) => entry.group.visible).map((entry) => entry.baseLine);
    const hit = raycaster.intersectObjects(lines, false)[0];
    if (hit === undefined) return undefined;
    return Object.freeze({
      objectId: hit.object.parent?.userData.objectId as ObjectId,
      representation: "orbit" as const,
      distance: hit.distance,
    });
  }

  clearPath(objectId: ObjectId): void {
    const entry = this.#entries.get(objectId);
    if (entry === undefined) return;
    entry.group.remove(entry.baseLine, entry.directionLine);
    this.#root.remove(entry.group);
    entry.geometry.dispose();
    entry.baseMaterial.dispose();
    entry.directionMaterial.dispose();
    this.#entries.delete(objectId);
    this.#representationVisible.delete(objectId);
    this.#root.userData.orbitCount = this.#entries.size;
  }

  clearPaths(): void {
    for (const objectId of [...this.#entries.keys()]) this.clearPath(objectId);
  }

  dispose(): void {
    this.clearPaths();
    this.#root.parent?.remove(this.#root);
    this.#positions.clear();
    this.#representationVisible.clear();
  }

  #updateVisibility(entry: OrbitEntry): void {
    const selected = entry.path.objectId === this.#selected;
    entry.baseMaterial.opacity = selected ? entry.style.selectedOpacity : entry.style.opacity;
    const direction = entry.style.direction;
    entry.directionLine.visible = selected && direction !== false && direction.enabled !== false && this.#visible;
    entry.group.visible = this.#visible && ((this.#representationVisible.get(entry.path.objectId) ?? true) || selected);
    entry.group.userData.selected = selected;
    entry.group.userData.opacity = entry.baseMaterial.opacity;
  }

  #updateGeometry(entry: OrbitEntry): void {
    const anchor = entry.path.origin.kind === "object" && entry.path.origin.objectId !== undefined
      ? this.#positions.get(entry.path.origin.objectId)
      : undefined;
    const anchorX = anchor?.x ?? 0;
    const anchorY = anchor?.y ?? 0;
    const anchorZ = anchor?.z ?? 0;
    entry.path.samples.forEach((sample, index) => {
      const local = transformSnapshotPositionToSceneUnits(sample.positionRelativeToOriginMeters, this.#renderSpace);
      entry.positionAttribute.setXYZ(index, local.x + anchorX, local.y + anchorY, local.z + anchorZ);
    });
    entry.positionAttribute.needsUpdate = true;
    entry.group.position.set(0, 0, 0);
  }

  #updateTrail(entry: OrbitEntry): void {
    const body = this.#positions.get(entry.path.objectId);
    const anchor = entry.path.origin.kind === "object" && entry.path.origin.objectId !== undefined
      ? this.#positions.get(entry.path.origin.objectId)
      : undefined;
    const bodyRelative = body === undefined
      ? new THREE.Vector3()
      : body.clone().sub(anchor ?? new THREE.Vector3());
    const points = entry.path.samples.map((sample) => point(transformSnapshotPositionToSceneUnits(sample.positionRelativeToOriginMeters, this.#renderSpace)));
    entry.phaseIndex = nearestOrbitSampleIndex(points, bodyRelative);
    const direction = entry.style.direction;
    const alphas = direction === false || direction.enabled === false
      ? new Array(entry.path.sampleCount).fill(1)
      : computeTrailAlphas(entry.path.sampleCount, entry.phaseIndex, direction);
    alphas.forEach((value, index) => entry.trailAttribute.setX(index, value));
    entry.trailAttribute.needsUpdate = true;
  }
}

export { computeTrailAlphas };
export const OrbitRenderer = OrbitPathRenderer;
export const OrbitPathLayer = OrbitPathRenderer;
