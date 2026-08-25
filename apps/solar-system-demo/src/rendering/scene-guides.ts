import * as THREE from "three";

export interface SceneGuideSettings {
  readonly axesVisible: boolean;
  readonly gridVisible: boolean;
}
export const DEFAULT_SCENE_GUIDE_SETTINGS: SceneGuideSettings = Object.freeze({
  axesVisible: false,
  gridVisible: false,
});

export const GRID_MAJOR_RINGS = 8;
export const GRID_MINOR_SUBDIVISIONS = 4;
export const GRID_RADIAL_SPOKES = 16;
export const GRID_RING_SEGMENTS = 96;

export function niceGridStep(target: number): number {
  if (!Number.isFinite(target) || target <= 0) throw new RangeError("Grid step target must be positive and finite");
  const exponent = 10 ** Math.floor(Math.log10(target));
  const normalized = target / exponent;
  const factor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return factor * exponent;
}

function ringPositions(step: number, ringIndex: number): number[] {
  const radius = step * ringIndex;
  const positions: number[] = [];
  for (let segment = 0; segment < GRID_RING_SEGMENTS; segment += 1) {
    const start = (segment / GRID_RING_SEGMENTS) * Math.PI * 2;
    const end = ((segment + 1) / GRID_RING_SEGMENTS) * Math.PI * 2;
    positions.push(
      Math.cos(start) * radius, Math.sin(start) * radius, 0,
      Math.cos(end) * radius, Math.sin(end) * radius, 0,
    );
  }
  return positions;
}

function createGeometry(positions: readonly number[]): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}

function disposeMaterial(material: THREE.Material | readonly THREE.Material[]): void {
  for (const value of Array.isArray(material) ? material : [material]) value.dispose();
}

export class SceneGuides {
  readonly #root: THREE.Group;
  readonly #axes: THREE.AxesHelper;
  readonly #majorLines: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  readonly #minorLines: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  #settings: SceneGuideSettings = DEFAULT_SCENE_GUIDE_SETTINGS;
  #gridStep?: number;
  #gridRebuildCount = 0;

  constructor(scene: THREE.Scene) {
    this.#root = new THREE.Group();
    this.#root.name = "scene-guides";

    this.#axes = new THREE.AxesHelper(8);
    this.#axes.name = "scene-axes";
    const axisMaterials = Array.isArray(this.#axes.material) ? this.#axes.material : [this.#axes.material];
    for (const material of axisMaterials) {
      material.transparent = true;
      material.opacity = 0.45;
      material.depthWrite = false;
    }

    this.#majorLines = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0x6f8fb8, transparent: true, opacity: 0.18, depthWrite: false }),
    );
    this.#majorLines.name = "reference-grid-major";
    this.#minorLines = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0x496486, transparent: true, opacity: 0.08, depthWrite: false }),
    );
    this.#minorLines.name = "reference-grid-minor";

    this.#root.add(this.#minorLines, this.#majorLines, this.#axes);
    this.#root.userData.guideSettings = this.#settings;
    scene.add(this.#root);
    this.setAxesVisible(this.#settings.axesVisible);
    this.setGridVisible(this.#settings.gridVisible);
  }

  settings(): SceneGuideSettings {
    return this.#settings;
  }

  gridStep(): number | undefined {
    return this.#gridStep;
  }

  gridRebuildCount(): number {
    return this.#gridRebuildCount;
  }

  setAxesVisible(visible: boolean): void {
    this.#settings = Object.freeze({ ...this.#settings, axesVisible: Boolean(visible) });
    this.#axes.visible = this.#settings.axesVisible;
    this.#root.userData.guideSettings = this.#settings;
  }

  setGridVisible(visible: boolean): void {
    this.#settings = Object.freeze({ ...this.#settings, gridVisible: Boolean(visible) });
    this.#majorLines.visible = this.#settings.gridVisible;
    this.#minorLines.visible = this.#settings.gridVisible;
    this.#root.userData.guideSettings = this.#settings;
  }

  updateForCamera(camera: THREE.Camera): void {
    const position = camera.position;
    const distance = Math.max(position.length(), 1);
    const nextStep = niceGridStep(distance / 6);
    if (this.#gridStep !== undefined
        && nextStep < this.#gridStep * 1.5
        && nextStep > this.#gridStep / 1.5) return;
    this.#rebuildGrid(nextStep);
  }

  dispose(): void {
    this.#root.remove(this.#majorLines, this.#minorLines, this.#axes);
    this.#majorLines.geometry.dispose();
    this.#minorLines.geometry.dispose();
    this.#majorLines.material.dispose();
    this.#minorLines.material.dispose();
    this.#axes.geometry.dispose();
    disposeMaterial(this.#axes.material);
    this.#root.parent?.remove(this.#root);
  }

  #rebuildGrid(step: number): void {
    const majorPositions: number[] = [];
    const minorPositions: number[] = [];
    for (let ring = 1; ring <= GRID_MAJOR_RINGS * GRID_MINOR_SUBDIVISIONS; ring += 1) {
      const positions = ring % GRID_MINOR_SUBDIVISIONS === 0
        ? majorPositions
        : minorPositions;
      positions.push(...ringPositions(step / GRID_MINOR_SUBDIVISIONS, ring));
    }
    const outerRadius = step * GRID_MAJOR_RINGS;
    for (let spoke = 0; spoke < GRID_RADIAL_SPOKES; spoke += 1) {
      const angle = (spoke / GRID_RADIAL_SPOKES) * Math.PI * 2;
      majorPositions.push(0, 0, 0, Math.cos(angle) * outerRadius, Math.sin(angle) * outerRadius, 0);
    }

    this.#majorLines.geometry.dispose();
    this.#minorLines.geometry.dispose();
    this.#majorLines.geometry = createGeometry(majorPositions);
    this.#minorLines.geometry = createGeometry(minorPositions);
    this.#gridStep = step;
    this.#gridRebuildCount += 1;
  }
}
