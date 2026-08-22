import * as THREE from "three";
import { meters, type Meters, type ObjectId, type PropagationState } from "orbit-engine";
import type { SolarSystemScenario } from "../scenario/load-solar-system.js";
import type { OrbitPath } from "../simulation/path-sampling.js";
import {
  adaptiveProjectedRadiusCssPixels,
  DEFAULT_ADAPTIVE_BODY_SIZE_POLICY,
  physicalProjectedRadiusCssPixels,
  sceneRadiusForProjectedCssPixels,
  separationBoundedProjectedRadiusCssPixels,
} from "./adaptive-body-size.js";
import { OrbitRenderer } from "./orbit-renderer.js";
import { metersToSceneUnits, positionToSceneUnits, radiusToSceneUnits, type RadiusMode } from "./render-space.js";

interface SceneBody {
  readonly objectId: ObjectId;
  readonly centralBody?: ObjectId;
  readonly physicalRadiusMeters: Meters;
  readonly physicalRadiusSceneUnits: number;
  readonly mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
}

export interface SolarSystemSceneOptions {
  readonly onSelect?: (objectId: ObjectId) => void;
}

interface ProjectedBody {
  readonly depth: number;
  readonly centerX: number;
  readonly centerY: number;
  readonly physicalRadiusCssPx: number;
}

/**
 * Presentation-only scene graph. Body positions are always copied from the
 * public engine state snapshots supplied to update(); this class never steps
 * or derives orbital motion.
 */
export class SolarSystemScene {
  readonly #scene: THREE.Scene;
  readonly #bodies = new Map<ObjectId, SceneBody>();
  readonly #childrenByCentralBody = new Map<ObjectId, readonly ObjectId[]>();
  readonly #orbitRenderer: OrbitRenderer;
  readonly #states = new Map<ObjectId, PropagationState>();
  readonly #onSelect?: (objectId: ObjectId) => void;
  readonly #selectionHalo: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  #radiusMode: RadiusMode = "adaptive";
  #selected?: ObjectId;

  constructor(scene: THREE.Scene, scenario: SolarSystemScenario, options: SolarSystemSceneOptions = {}) {
    this.#scene = scene;
    this.#onSelect = options.onSelect;
    this.#orbitRenderer = new OrbitRenderer(scene);

    const children = new Map<ObjectId, ObjectId[]>();
    for (const entry of scenario.bodies) {
      const radius = entry.definition.properties.physicalRadius;
      if (radius === undefined) throw new TypeError(`Scenario body ${entry.definition.id} has no physical radius`);
      const physicalRadiusMeters = meters(radius);
      const physicalRadiusSceneUnits = metersToSceneUnits(physicalRadiusMeters);
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(1, 24, 16),
        new THREE.MeshBasicMaterial({ color: entry.definition.display.color }),
      );
      mesh.name = entry.definition.name;
      mesh.userData.objectId = entry.definition.id;
      mesh.userData.objectType = entry.definition.type;
      mesh.scale.setScalar(physicalRadiusSceneUnits);
      this.#scene.add(mesh);
      this.#bodies.set(entry.definition.id, {
        objectId: entry.definition.id,
        centralBody: entry.definition.centralBody,
        physicalRadiusMeters,
        physicalRadiusSceneUnits,
        mesh,
      });
      if (entry.definition.centralBody !== undefined) {
        const values = children.get(entry.definition.centralBody) ?? [];
        values.push(entry.definition.id);
        children.set(entry.definition.centralBody, values);
      }
    }
    for (const [centralBody, values] of children) {
      this.#childrenByCentralBody.set(centralBody, Object.freeze([...values]));
    }

    this.#selectionHalo = new THREE.Mesh(
      new THREE.RingGeometry(1.25, 1.55, 40),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.9,
        depthTest: false,
        side: THREE.DoubleSide,
      }),
    );
    this.#selectionHalo.name = "Selected body halo";
    this.#selectionHalo.renderOrder = 100;
    this.#selectionHalo.visible = false;
    this.#scene.add(this.#selectionHalo);
  }

  setRadiusMode(mode: RadiusMode): void {
    if (mode !== "physical" && mode !== "adaptive") throw new RangeError(`Unknown radius mode: ${String(mode)}`);
    this.#radiusMode = mode;
    if (mode === "physical") {
      for (const body of this.#bodies.values()) body.mesh.scale.setScalar(body.physicalRadiusSceneUnits);
    }
  }

  radiusMode(): RadiusMode {
    return this.#radiusMode;
  }

  setSelected(objectId: ObjectId | undefined): void {
    if (objectId !== undefined && !this.#bodies.has(objectId)) {
      throw new RangeError(`Unknown scenario body: ${objectId}`);
    }
    this.#selected = objectId;
    this.#selectionHalo.visible = objectId !== undefined;
    this.#orbitRenderer.setSelected(objectId);
  }

  update(states: readonly PropagationState[], objectIds?: readonly ObjectId[]): void {
    const ids = objectIds ?? [...this.#bodies.keys()];
    if (states.length !== ids.length) {
      throw new RangeError(`Expected equal state/object-id counts, received ${states.length}/${ids.length}`);
    }
    for (let index = 0; index < ids.length; index += 1) {
      const objectId = ids[index];
      const state = states[index];
      if (objectId === undefined || state === undefined) throw new RangeError("Scenario state index is out of range");
      const body = this.#bodies.get(objectId);
      if (body === undefined) continue;
      const position = positionToSceneUnits(state.position);
      body.mesh.position.set(position.x, position.y, position.z);
      this.#states.set(objectId, state);
    }
    this.#orbitRenderer.updateBodyPositions(new Map(
      [...this.#bodies].map(([objectId, body]) => [objectId, body.mesh.position.clone()]),
    ));
  }

  /** Re-evaluate camera-dependent presentation without changing physical state. */
  updatePresentation(camera: THREE.PerspectiveCamera, viewportWidthCssPx: number, viewportHeightCssPx: number): void {
    if (!Number.isFinite(viewportWidthCssPx) || viewportWidthCssPx <= 0
        || !Number.isFinite(viewportHeightCssPx) || viewportHeightCssPx <= 0) return;
    camera.updateMatrixWorld();
    const projected = new Map<ObjectId, ProjectedBody>();
    const verticalFovRadians = THREE.MathUtils.degToRad(camera.fov);

    for (const [objectId, body] of this.#bodies) {
      const cameraSpace = body.mesh.position.clone().applyMatrix4(camera.matrixWorldInverse);
      const depth = -cameraSpace.z;
      if (!Number.isFinite(depth) || depth <= 0) continue;
      const ndc = body.mesh.position.clone().project(camera);
      const physicalRadiusCssPx = physicalProjectedRadiusCssPixels(
        body.physicalRadiusSceneUnits,
        depth,
        verticalFovRadians,
        viewportHeightCssPx,
      );
      projected.set(objectId, {
        depth,
        centerX: (ndc.x * 0.5 + 0.5) * viewportWidthCssPx,
        centerY: (-ndc.y * 0.5 + 0.5) * viewportHeightCssPx,
        physicalRadiusCssPx,
      });
    }

    for (const [objectId, body] of this.#bodies) {
      const projection = projected.get(objectId);
      if (this.#radiusMode === "physical" || projection === undefined) {
        body.mesh.scale.setScalar(radiusToSceneUnits({
          mode: "physical",
          physicalRadiusMeters: body.physicalRadiusMeters,
        }));
        continue;
      }
      const enhanced = adaptiveProjectedRadiusCssPixels(projection.physicalRadiusCssPx);
      const nearestNeighbor = this.#nearestRelevantNeighborDistance(objectId, projection, projected);
      const bounded = separationBoundedProjectedRadiusCssPixels(
        projection.physicalRadiusCssPx,
        enhanced,
        nearestNeighbor,
        DEFAULT_ADAPTIVE_BODY_SIZE_POLICY.separationFraction,
      );
      const sceneRadius = sceneRadiusForProjectedCssPixels(
        bounded,
        projection.depth,
        verticalFovRadians,
        viewportHeightCssPx,
      );
      body.mesh.scale.setScalar(sceneRadius);
    }

    const selectedBody = this.#selected === undefined ? undefined : this.#bodies.get(this.#selected);
    if (selectedBody === undefined) {
      this.#selectionHalo.visible = false;
      return;
    }
    this.#selectionHalo.visible = true;
    this.#selectionHalo.position.copy(selectedBody.mesh.position);
    this.#selectionHalo.quaternion.copy(camera.quaternion);
    this.#selectionHalo.scale.setScalar(selectedBody.mesh.scale.x);
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
    const body = this.#bodies.get(path.objectId);
    if (body === undefined) throw new RangeError(`Unknown scenario body: ${path.objectId}`);
    const color = body.mesh.material.color.getHex();
    this.#orbitRenderer.setPath(path, color);
  }

  clearPath(objectId: ObjectId): void {
    this.#orbitRenderer.clearPath(objectId);
  }

  clearPaths(): void {
    this.#orbitRenderer.clearPaths();
  }

  pathCount(): number {
    return this.#orbitRenderer.pathCount();
  }

  setOrbitsVisible(visible: boolean): void {
    this.#orbitRenderer.setVisible(visible);
  }

  orbitsVisible(): boolean {
    return this.#orbitRenderer.isVisible();
  }

  selectedOrbitActive(): boolean {
    const selected = this.#selected;
    return selected !== undefined && this.#orbitRenderer.hasPath(selected);
  }

  meshFor(objectId: ObjectId): THREE.Mesh | undefined {
    return this.#bodies.get(objectId)?.mesh;
  }

  selectedObjectId(): ObjectId | undefined {
    return this.#selected;
  }

  selectionHalo(): THREE.Mesh {
    return this.#selectionHalo;
  }

  dispose(): void {
    this.#orbitRenderer.dispose();
    for (const body of this.#bodies.values()) {
      this.#scene.remove(body.mesh);
      body.mesh.geometry.dispose();
      body.mesh.material.dispose();
    }
    this.#scene.remove(this.#selectionHalo);
    this.#selectionHalo.geometry.dispose();
    this.#selectionHalo.material.dispose();
    this.#bodies.clear();
    this.#states.clear();
  }

  selectFromPointer(normalizedDeviceX: number, normalizedDeviceY: number, camera: THREE.Camera): ObjectId | undefined {
    const objectId = this.pick(normalizedDeviceX, normalizedDeviceY, camera);
    if (objectId === undefined) return undefined;
    this.setSelected(objectId);
    this.#onSelect?.(objectId);
    return objectId;
  }

  #nearestRelevantNeighborDistance(
    objectId: ObjectId,
    projection: ProjectedBody,
    projected: ReadonlyMap<ObjectId, ProjectedBody>,
  ): number | undefined {
    const body = this.#bodies.get(objectId);
    if (body === undefined || body.centralBody === undefined) return undefined;
    const candidates = new Set<ObjectId>([body.centralBody]);
    for (const sibling of this.#childrenByCentralBody.get(body.centralBody) ?? []) {
      if (sibling !== objectId) candidates.add(sibling);
    }
    let nearest = Number.POSITIVE_INFINITY;
    for (const candidateId of candidates) {
      const candidate = projected.get(candidateId);
      if (candidate === undefined) continue;
      nearest = Math.min(nearest, Math.hypot(
        projection.centerX - candidate.centerX,
        projection.centerY - candidate.centerY,
      ));
    }
    return Number.isFinite(nearest) ? nearest : undefined;
  }
}
