import * as THREE from "three";
import type { ObjectId } from "orbit-engine";
import { createRenderSpaceConfig, transformSnapshotPositionToSceneUnits, type RenderSpaceConfig, type RenderVector3 } from "./render-space.js";
import type { OrbitPathSnapshot } from "./orbit.js";

export const ORBIT_PATH_RENDER_ORDER = 10;
export const DEFAULT_ORBIT_BASE_OPACITY = 0.18;
export const DEFAULT_ORBIT_SELECTED_OPACITY = 0.42;
export const DEFAULT_ORBIT_PICK_RADIUS_SCENE_UNITS = 0.15;
export const DEFAULT_ORBIT_PICK_RADIUS_PIXELS = 6;
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
  /** Legacy fixed world-space picking radius. Prefer pickRadiusPixels. */
  readonly pickRadiusSceneUnits?: number;
  readonly pickRadiusPixels?: number;
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

export interface OrbitPathRendererWorkDiagnostics {
  readonly localSampleTransformCount: number;
  readonly geometryUpdateCount: number;
  readonly geometrySampleWriteCount: number;
  readonly trailUpdateCount: number;
  readonly trailSampleEvaluationCount: number;
}

export interface OrbitPickResult {
  readonly objectId: ObjectId;
  readonly representation: "orbit";
  readonly distance: number;
}

interface OrbitEntry {
  readonly path: OrbitPathSnapshot;
  readonly localPoints: readonly THREE.Vector3[];
  readonly group: THREE.Group;
  readonly geometry: THREE.BufferGeometry;
  readonly positionAttribute: THREE.BufferAttribute;
  readonly trailAttribute: THREE.BufferAttribute;
  readonly baseLine: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  readonly directionLine: THREE.Line<THREE.BufferGeometry, THREE.ShaderMaterial>;
  readonly baseMaterial: THREE.LineBasicMaterial;
  readonly directionMaterial: THREE.ShaderMaterial;
  style: Required<Pick<OrbitPathStyle, "color" | "opacity" | "selectedOpacity" | "depthTest" | "depthWrite" | "lineWidth">> & { readonly direction: OrbitDirectionStyle | false };
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

function sceneUnitsPerPixel(camera: THREE.Camera, viewportHeightCssPixels: number, target: THREE.Vector3): number {
  if (!Number.isFinite(viewportHeightCssPixels) || viewportHeightCssPixels <= 0) return 0;
  const targetCameraSpace = target.clone().applyMatrix4(camera.matrixWorldInverse);
  if (camera instanceof THREE.PerspectiveCamera) {
    const depth = Math.max(camera.near, -targetCameraSpace.z);
    return 2 * depth * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / viewportHeightCssPixels;
  }
  if (camera instanceof THREE.OrthographicCamera) {
    return (camera.top - camera.bottom) / Math.max(camera.zoom, Number.EPSILON) / viewportHeightCssPixels;
  }
  return 0;
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
  return Object.freeze(Array.from({ length: sampleCount }, (_, index) => trailAlphaAt(
    index,
    sampleCount,
    phaseIndex,
    direction,
    headSamples,
    tailSamples,
  )));
}

function equivalentDirection(left: OrbitDirectionStyle | false, right: OrbitDirectionStyle | false): boolean {
  if (left === false || right === false) return left === right;
  return left.enabled === right.enabled
    && left.headFraction === right.headFraction
    && left.tailFraction === right.tailFraction
    && left.headOpacity === right.headOpacity
    && left.tailOpacity === right.tailOpacity;
}

function equivalentStyle(left: OrbitEntry["style"], right: OrbitEntry["style"]): boolean {
  return left.color === right.color
    && left.opacity === right.opacity
    && left.selectedOpacity === right.selectedOpacity
    && left.depthTest === right.depthTest
    && left.depthWrite === right.depthWrite
    && left.lineWidth === right.lineWidth
    && equivalentDirection(left.direction, right.direction);
}

function trailAlphaAt(
  index: number,
  sampleCount: number,
  phaseIndex: number,
  direction: OrbitDirectionStyle,
  headSamples = Math.max(1, Math.round(sampleCount * direction.headFraction!)),
  tailSamples = Math.max(1, Math.round(sampleCount * direction.tailFraction!)),
): number {
  const forward = (index - phaseIndex + sampleCount) % sampleCount;
  const behind = (phaseIndex - index + sampleCount) % sampleCount;
  const head = forward <= headSamples
    ? direction.headOpacity! * Math.max(0, 1 - forward / headSamples)
    : 0;
  const tail = behind <= tailSamples
    ? direction.tailOpacity! * Math.max(0, 1 - behind / tailSamples)
    : 0;
  return Math.max(head, tail);
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
  readonly #pickRadiusSceneUnits?: number;
  readonly #pickRadiusPixels: number;
  readonly #entries = new Map<ObjectId, OrbitEntry>();
  readonly #positions = new Map<ObjectId, THREE.Vector3>();
  readonly #representationVisible = new Map<ObjectId, boolean>();
  #selected?: ObjectId;
  #visible = true;
  #localSampleTransformCount = 0;
  #geometryUpdateCount = 0;
  #geometrySampleWriteCount = 0;
  #trailUpdateCount = 0;
  #trailSampleEvaluationCount = 0;

  constructor(parent: THREE.Object3D, options: OrbitPathRendererOptions = {}) {
    this.#renderSpace = createRenderSpaceConfig(options.renderSpace);
    this.#defaultStyle = Object.freeze({ ...(options.defaultStyle ?? {}) });
    this.#pickRadiusSceneUnits = options.pickRadiusSceneUnits;
    if (this.#pickRadiusSceneUnits !== undefined) {
      finite("pickRadiusSceneUnits", this.#pickRadiusSceneUnits);
      if (this.#pickRadiusSceneUnits <= 0) throw new RangeError("pickRadiusSceneUnits must be positive");
    }
    this.#pickRadiusPixels = options.pickRadiusPixels ?? DEFAULT_ORBIT_PICK_RADIUS_PIXELS;
    finite("pickRadiusPixels", this.#pickRadiusPixels);
    if (this.#pickRadiusPixels <= 0) throw new RangeError("pickRadiusPixels must be positive");
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
    const nextVisible = Boolean(visible);
    if (this.#visible === nextVisible) return;
    this.#visible = nextVisible;
    this.#root.visible = this.#visible;
    for (const entry of this.#entries.values()) this.#updateVisibility(entry);
  }

  setSelected(objectId: ObjectId | undefined): void {
    if (this.#selected === objectId) return;
    const previous = this.#selected;
    this.#selected = objectId;
    this.#root.userData.selectedObjectId = objectId;
    const previousEntry = previous === undefined ? undefined : this.#entries.get(previous);
    const nextEntry = objectId === undefined ? undefined : this.#entries.get(objectId);
    if (previousEntry !== undefined) this.#updateVisibility(previousEntry);
    if (nextEntry !== undefined) {
      this.#updateVisibility(nextEntry);
      this.#updateTrail(nextEntry);
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
    const points = Object.freeze(path.samples.map((sample) => {
      this.#localSampleTransformCount += 1;
      return point(transformSnapshotPositionToSceneUnits(sample.positionRelativeToOriginMeters, this.#renderSpace));
    }));
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
      localPoints: points,
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
    if (entry.path.objectId === this.#selected) this.#updateTrail(entry);
    this.#root.userData.orbitCount = this.#entries.size;
  }

  setPaths(paths: readonly OrbitPathSnapshot[], styleByObjectId?: ReadonlyMap<ObjectId, OrbitPathStyle>): void {
    const next = new Map(paths.map((path) => [path.objectId, path]));
    for (const objectId of [...this.#entries.keys()]) if (!next.has(objectId)) this.clearPath(objectId);
    for (const path of [...paths].sort((left, right) => compareObjectId(left.objectId, right.objectId))) {
      const style = styleByObjectId?.get(path.objectId) ?? this.#defaultStyle;
      const current = this.#entries.get(path.objectId);
      if (current?.path.fingerprint === path.fingerprint) {
        this.#applyStyle(current, normalizeStyle(style, this.#defaultStyle));
        this.#updateVisibility(current);
        continue;
      }
      this.setPath(path, style);
    }
  }

  updateBodyPositions(positions: ReadonlyMap<ObjectId, RenderVector3 | THREE.Vector3>): void {
    const changedObjectIds = new Set<ObjectId>();
    const seenObjectIds = new Set<ObjectId>();
    for (const [objectId, value] of positions) {
      const next = point(value);
      const previous = this.#positions.get(objectId);
      if (previous === undefined || !previous.equals(next)) changedObjectIds.add(objectId);
      this.#positions.set(objectId, next);
      seenObjectIds.add(objectId);
    }
    for (const objectId of [...this.#positions.keys()]) {
      if (seenObjectIds.has(objectId)) continue;
      this.#positions.delete(objectId);
      changedObjectIds.add(objectId);
    }
    for (const entry of this.#entries.values()) {
      const originObjectId = entry.path.origin.kind === "object" ? entry.path.origin.objectId : undefined;
      if (originObjectId !== undefined && changedObjectIds.has(originObjectId)) this.#updateGeometry(entry);
      if (entry.path.objectId === this.#selected
          && (changedObjectIds.has(entry.path.objectId) || (originObjectId !== undefined && changedObjectIds.has(originObjectId)))) {
        this.#updateTrail(entry);
      }
    }
  }

  workDiagnostics(): OrbitPathRendererWorkDiagnostics {
    return Object.freeze({
      localSampleTransformCount: this.#localSampleTransformCount,
      geometryUpdateCount: this.#geometryUpdateCount,
      geometrySampleWriteCount: this.#geometrySampleWriteCount,
      trailUpdateCount: this.#trailUpdateCount,
      trailSampleEvaluationCount: this.#trailSampleEvaluationCount,
    });
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

  pick(normalizedDeviceX: number, normalizedDeviceY: number, camera: THREE.Camera, viewportHeightCssPixels = 1_000): OrbitPickResult | undefined {
    if (!this.#visible) return undefined;
    this.#root.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
    const raycaster = new THREE.Raycaster();
    const target = this.#root.getWorldPosition(new THREE.Vector3());
    const threshold = this.#pickRadiusSceneUnits
      ?? this.#pickRadiusPixels * sceneUnitsPerPixel(camera, viewportHeightCssPixels, target);
    if (!Number.isFinite(threshold) || threshold <= 0) return undefined;
    raycaster.params.Line = { threshold };
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

  #applyStyle(entry: OrbitEntry, style: OrbitEntry["style"]): void {
    if (equivalentStyle(entry.style, style)) return;
    entry.style = style;
    entry.baseMaterial.color.setHex(style.color);
    entry.baseMaterial.depthTest = style.depthTest;
    entry.baseMaterial.depthWrite = style.depthWrite;
    entry.baseMaterial.linewidth = style.lineWidth;
    entry.directionMaterial.uniforms.uColor!.value = new THREE.Color(style.color);
    entry.directionMaterial.depthTest = style.depthTest;
    entry.directionMaterial.depthWrite = style.depthWrite;
    if (entry.path.objectId === this.#selected) this.#updateTrail(entry);
  }

  #updateGeometry(entry: OrbitEntry): void {
    const anchor = entry.path.origin.kind === "object" && entry.path.origin.objectId !== undefined
      ? this.#positions.get(entry.path.origin.objectId)
      : undefined;
    const anchorX = anchor?.x ?? 0;
    const anchorY = anchor?.y ?? 0;
    const anchorZ = anchor?.z ?? 0;
    this.#geometryUpdateCount += 1;
    entry.localPoints.forEach((local, index) => {
      entry.positionAttribute.setXYZ(index, local.x + anchorX, local.y + anchorY, local.z + anchorZ);
      this.#geometrySampleWriteCount += 1;
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
      : new THREE.Vector3(
        body.x - (anchor?.x ?? 0),
        body.y - (anchor?.y ?? 0),
        body.z - (anchor?.z ?? 0),
      );
    entry.phaseIndex = nearestOrbitSampleIndex(entry.localPoints, bodyRelative);
    const direction = entry.style.direction;
    this.#trailUpdateCount += 1;
    for (let index = 0; index < entry.path.sampleCount; index += 1) {
      const value = direction === false || direction.enabled === false
        ? 1
        : trailAlphaAt(index, entry.path.sampleCount, entry.phaseIndex, direction);
      entry.trailAttribute.setX(index, value);
      this.#trailSampleEvaluationCount += 1;
    }
    entry.trailAttribute.needsUpdate = true;
  }
}

export { computeTrailAlphas };
export const OrbitRenderer = OrbitPathRenderer;
export const OrbitPathLayer = OrbitPathRenderer;
