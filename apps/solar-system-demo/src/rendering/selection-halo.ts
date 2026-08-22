import * as THREE from "three";
import { projectedPixelsToSceneRadius } from "./adaptive-sizing.js";
import { SELECTION_HALO_RENDER_ORDER } from "./presentation-order.js";

export const SELECTION_HALO_GAP_PIXELS = 2;
export const SELECTION_HALO_THICKNESS_PIXELS = 1.25;

export interface SelectionHaloPixelSizing {
  readonly innerRadiusPixels: number;
  readonly outerRadiusPixels: number;
  readonly innerRadiusRatio: number;
}

export function selectionHaloPixelSizing(bodyRadiusPixels: number): SelectionHaloPixelSizing {
  if (!Number.isFinite(bodyRadiusPixels) || bodyRadiusPixels < 0) {
    throw new RangeError("Selection halo body radius must be finite and non-negative");
  }
  const innerRadiusPixels = bodyRadiusPixels + SELECTION_HALO_GAP_PIXELS;
  const outerRadiusPixels = innerRadiusPixels + SELECTION_HALO_THICKNESS_PIXELS;
  return Object.freeze({
    innerRadiusPixels,
    outerRadiusPixels,
    innerRadiusRatio: innerRadiusPixels / outerRadiusPixels,
  });
}

const HALO_VERTEX_SHADER = `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const HALO_FRAGMENT_SHADER = `
uniform float uInnerRadius;
varying vec2 vUv;

void main() {
  vec2 centered = vUv * 2.0 - vec2(1.0);
  float radius = length(centered);
  float feather = max(fwidth(radius), 0.002);
  float outerMask = 1.0 - smoothstep(1.0 - feather, 1.0 + feather, radius);
  float innerMask = smoothstep(uInnerRadius - feather, uInnerRadius + feather, radius);
  float alpha = outerMask * innerMask * 0.9;
  if (alpha <= 0.001) discard;
  gl_FragColor = vec4(vec3(1.0), alpha);
}
`;

/** Camera-facing, screen-space controlled selection indicator. */
export class SelectionHalo {
  readonly #mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;

  constructor(scene: THREE.Scene) {
    const geometry = new THREE.PlaneGeometry(2, 2);
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uInnerRadius: { value: 0.8 },
      },
      vertexShader: HALO_VERTEX_SHADER,
      fragmentShader: HALO_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
    this.#mesh = new THREE.Mesh(geometry, material);
    this.#mesh.name = "Selected body halo";
    this.#mesh.renderOrder = SELECTION_HALO_RENDER_ORDER;
    this.#mesh.frustumCulled = false;
    this.#mesh.visible = false;
    scene.add(this.#mesh);
  }

  get mesh(): THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> {
    return this.#mesh;
  }

  setPosition(position: THREE.Vector3): void {
    this.#mesh.position.copy(position);
  }

  hide(): void {
    this.#mesh.visible = false;
  }

  update(
    position: THREE.Vector3,
    bodyRadiusPixels: number,
    camera: THREE.PerspectiveCamera,
    viewportHeightPixels: number,
  ): void {
    if (!Number.isFinite(viewportHeightPixels) || viewportHeightPixels <= 0) {
      throw new RangeError("Selection halo viewport height must be finite and positive");
    }
    const distance = Math.max(camera.position.distanceTo(position), Number.EPSILON);
    const fieldOfView = camera.fov * Math.PI / 180;
    const sizing = selectionHaloPixelSizing(bodyRadiusPixels);
    const outerRadiusSceneUnits = projectedPixelsToSceneRadius(
      sizing.outerRadiusPixels,
      distance,
      fieldOfView,
      viewportHeightPixels,
    );
    this.#mesh.position.copy(position);
    this.#mesh.scale.setScalar(outerRadiusSceneUnits);
    this.#mesh.material.uniforms.uInnerRadius!.value = sizing.innerRadiusRatio;
    this.#mesh.lookAt(camera.position);
    this.#mesh.visible = true;
  }

  dispose(): void {
    this.#mesh.parent?.remove(this.#mesh);
    this.#mesh.geometry.dispose();
    this.#mesh.material.dispose();
  }
}
