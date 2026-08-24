import * as THREE from "three";
import type { ObjectId } from "orbit-engine";
import { projectedPixelsToSceneRadius } from "./sizing.js";
import type { RenderVector3 } from "./render-space.js";

export const DEFAULT_SELECTION_GAP_PIXELS = 2;
export const DEFAULT_SELECTION_THICKNESS_PIXELS = 1.25;
export const DEFAULT_SELECTION_COLOR = 0xbfe8ff;

export interface SelectionIndicatorPixelSizing {
  readonly innerRadiusPixels: number;
  readonly outerRadiusPixels: number;
  readonly innerRadiusRatio: number;
}

export interface SelectionIndicatorOptions {
  readonly gapPixels?: number;
  readonly thicknessPixels?: number;
  readonly color?: number;
  readonly opacity?: number;
}

export interface SelectionIndicatorTarget {
  readonly objectId: ObjectId;
  readonly positionSceneUnits: RenderVector3 | THREE.Vector3;
  readonly bodyRadiusPixels: number;
}

export interface SelectionIndicatorDiagnostics {
  readonly objectId?: ObjectId;
  readonly visible: boolean;
  readonly bodyRadiusPixels?: number;
  readonly outerRadiusPixels?: number;
}

function finite(name: string, value: number): void {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
}

function nonNegative(name: string, value: number): void {
  finite(name, value);
  if (value < 0) throw new RangeError(`${name} must be non-negative`);
}

function positive(name: string, value: number): void {
  finite(name, value);
  if (value <= 0) throw new RangeError(`${name} must be positive`);
}

function validateColor(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffff) throw new RangeError("Selection indicator color must be a 24-bit integer");
}

export function selectionIndicatorPixelSizing(
  bodyRadiusPixels: number,
  options: SelectionIndicatorOptions = {},
): SelectionIndicatorPixelSizing {
  nonNegative("bodyRadiusPixels", bodyRadiusPixels);
  const gapPixels = options.gapPixels ?? DEFAULT_SELECTION_GAP_PIXELS;
  const thicknessPixels = options.thicknessPixels ?? DEFAULT_SELECTION_THICKNESS_PIXELS;
  positive("gapPixels", gapPixels);
  positive("thicknessPixels", thicknessPixels);
  const innerRadiusPixels = bodyRadiusPixels + gapPixels;
  const outerRadiusPixels = innerRadiusPixels + thicknessPixels;
  return Object.freeze({
    innerRadiusPixels,
    outerRadiusPixels,
    innerRadiusRatio: innerRadiusPixels / outerRadiusPixels,
  });
}

const VERTEX_SHADER = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAGMENT_SHADER = `
uniform vec3 uColor;
uniform float uInnerRadius;
uniform float uOpacity;
varying vec2 vUv;
void main() {
  vec2 centered = vUv * 2.0 - vec2(1.0);
  float radius = length(centered);
  float feather = max(fwidth(radius), 0.002);
  float outerMask = 1.0 - smoothstep(1.0 - feather, 1.0 + feather, radius);
  float innerMask = smoothstep(uInnerRadius - feather, uInnerRadius + feather, radius);
  float alpha = outerMask * innerMask * uOpacity;
  if (alpha <= 0.001) discard;
  gl_FragColor = vec4(uColor, alpha);
}`;

export class SelectionIndicator {
  readonly #mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  readonly #options: Required<SelectionIndicatorOptions>;
  #target?: SelectionIndicatorTarget;

  constructor(parent: THREE.Object3D, options: SelectionIndicatorOptions = {}) {
    const color = options.color ?? DEFAULT_SELECTION_COLOR;
    const opacity = options.opacity ?? 0.9;
    validateColor(color);
    finite("opacity", opacity);
    if (opacity < 0 || opacity > 1) throw new RangeError("Selection indicator opacity must be in [0, 1]");
    this.#options = Object.freeze({
      gapPixels: options.gapPixels ?? DEFAULT_SELECTION_GAP_PIXELS,
      thicknessPixels: options.thicknessPixels ?? DEFAULT_SELECTION_THICKNESS_PIXELS,
      color,
      opacity,
    });
    selectionIndicatorPixelSizing(0, this.#options);
    const geometry = new THREE.PlaneGeometry(2, 2);
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(color) },
        uInnerRadius: { value: 0.8 },
        uOpacity: { value: opacity },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
    });
    this.#mesh = new THREE.Mesh(geometry, material);
    this.#mesh.name = "orbit-engine-three selection indicator";
    this.#mesh.userData.representation = "selection-indicator";
    this.#mesh.renderOrder = 20;
    this.#mesh.frustumCulled = false;
    this.#mesh.visible = false;
    parent.add(this.#mesh);
  }

  get mesh(): THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> {
    return this.#mesh;
  }

  get selectedObjectId(): ObjectId | undefined {
    return this.#target?.objectId;
  }

  diagnostics(): SelectionIndicatorDiagnostics {
    const sizing = this.#target === undefined ? undefined : selectionIndicatorPixelSizing(this.#target.bodyRadiusPixels, this.#options);
    return Object.freeze({
      ...(this.#target === undefined ? {} : { objectId: this.#target.objectId, bodyRadiusPixels: this.#target.bodyRadiusPixels }),
      visible: this.#mesh.visible,
      ...(sizing === undefined ? {} : { outerRadiusPixels: sizing.outerRadiusPixels }),
    });
  }

  update(
    target: SelectionIndicatorTarget,
    camera: THREE.Camera,
    viewportHeightCssPixels: number,
  ): void {
    positive("viewportHeightCssPixels", viewportHeightCssPixels);
    nonNegative("target.bodyRadiusPixels", target.bodyRadiusPixels);
    const position = target.positionSceneUnits instanceof THREE.Vector3
      ? target.positionSceneUnits.clone()
      : new THREE.Vector3(target.positionSceneUnits.x, target.positionSceneUnits.y, target.positionSceneUnits.z);
    const sizing = selectionIndicatorPixelSizing(target.bodyRadiusPixels, this.#options);
    camera.updateMatrixWorld(true);
    const cameraPosition = camera.getWorldPosition(new THREE.Vector3());
    const cameraDepth = Math.max(cameraPosition.distanceTo(position), Number.EPSILON);
    const perspective = camera instanceof THREE.PerspectiveCamera;
    const orthographic = camera instanceof THREE.OrthographicCamera ? camera : undefined;
    const fov = perspective
      ? THREE.MathUtils.degToRad(camera.fov)
      : 2 * Math.atan(1 / Math.max(Math.abs(camera.projectionMatrix.elements[5] ?? 0), Number.EPSILON));
    const outerRadiusSceneUnits = perspective
      ? projectedPixelsToSceneRadius(sizing.outerRadiusPixels, cameraDepth, fov, viewportHeightCssPixels)
      : sizing.outerRadiusPixels * Math.abs(((orthographic?.top ?? 1) - (orthographic?.bottom ?? -1)) / viewportHeightCssPixels);
    this.#target = Object.freeze({
      objectId: target.objectId,
      positionSceneUnits: Object.freeze({ x: position.x, y: position.y, z: position.z }),
      bodyRadiusPixels: target.bodyRadiusPixels,
    });
    this.#mesh.userData.objectId = target.objectId;
    this.#mesh.position.copy(position);
    this.#mesh.scale.setScalar(outerRadiusSceneUnits);
    this.#mesh.quaternion.copy(camera.quaternion);
    this.#mesh.material.uniforms.uInnerRadius!.value = sizing.innerRadiusRatio;
    this.#mesh.visible = true;
  }

  hide(): void {
    this.#mesh.visible = false;
  }

  clear(): void {
    this.#target = undefined;
    delete this.#mesh.userData.objectId;
    this.#mesh.visible = false;
  }

  dispose(): void {
    this.#mesh.parent?.remove(this.#mesh);
    this.#mesh.geometry.dispose();
    this.#mesh.material.dispose();
    this.#target = undefined;
    delete this.#mesh.userData.objectId;
  }
}

/** Backwards-compatible descriptive alias for consumers that call it a halo. */
export const SelectionHalo = SelectionIndicator;
