import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import {
  MAX_DISPLAY_EXPOSURE,
  MIN_DISPLAY_EXPOSURE,
} from "orbit-engine-three/presentation";

const DEFAULT_DISPLAY_EXPOSURE = 1;
const DISPLAY_TONE_MAPPING_MODE = "ACESFilmic" as const;
const SCENE_UP_VECTOR = Object.freeze({ x: 0, y: 0, z: 1 });
const BLOOM_COMPOSER_PIXEL_RATIO = 0.5;
const BLOOM_STRENGTH = 0.16;
const BLOOM_RADIUS = 0.75;
const BLOOM_THRESHOLD = 0.72;

export class WebGL2UnavailableError extends Error {
  constructor() {
    super("This demo requires WebGL 2, which is not available in this browser.");
    this.name = "WebGL2UnavailableError";
  }
}

export interface RenderShell {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly controls: OrbitControls;
  readonly toneMappingMode: typeof DISPLAY_TONE_MAPPING_MODE;
  render(): void;
  setDisplayExposure(exposure: number): void;
  centerOn(
    target: THREE.Vector3,
    preferredDistance?: number,
    viewDirection?: Readonly<{ readonly x: number; readonly y: number; readonly z: number }>,
  ): void;
  resize(width: number, height: number): void;
  dispose(): void;
}

export const DEFAULT_CAMERA_NEAR = 0.01;
export const DEFAULT_CAMERA_FAR = 10_000;
export const CAMERA_FAR_HEADROOM = 4;
export const MAX_CAMERA_FAR = Number.MAX_VALUE / 2;

export function cameraFarForDistance(distance: number): number {
  if (!Number.isFinite(distance) || distance < 0) {
    throw new RangeError("Camera distance must be a finite non-negative number");
  }
  return Math.max(DEFAULT_CAMERA_FAR, Math.min(MAX_CAMERA_FAR, distance * CAMERA_FAR_HEADROOM));
}

export function updateCameraClipPlanes(
  camera: THREE.PerspectiveCamera,
  target: THREE.Vector3,
): boolean {
  const distance = Math.hypot(
    camera.position.x - target.x,
    camera.position.y - target.y,
    camera.position.z - target.z,
  );
  if (!Number.isFinite(distance)) return false;
  const far = cameraFarForDistance(distance);
  // Keep compact local systems visible while retaining a conservative near
  // plane at Solar-System scale. This is presentation-only clipping policy.
  const near = Math.min(
    DEFAULT_CAMERA_NEAR,
    Math.max(Number.EPSILON, distance / 100),
    far / 2,
  );
  if (camera.near === near && camera.far === far) return false;
  camera.near = near;
  camera.far = far;
  camera.updateProjectionMatrix();
  return true;
}

/** Translate the view while preserving the camera's orbit offset and orientation. */
export function translateViewTo(camera: THREE.Camera, currentTarget: THREE.Vector3, nextTarget: THREE.Vector3): void {
  camera.position.add(nextTarget.clone().sub(currentTarget));
  currentTarget.copy(nextTarget);
}

export function isWebGL2Available(canvas: HTMLCanvasElement): boolean {
  return canvas.getContext("webgl2") !== null;
}

export function createRenderShell(canvas: HTMLCanvasElement): RenderShell {
  if (!isWebGL2Available(canvas)) throw new WebGL2UnavailableError();

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050914);
  const camera = new THREE.PerspectiveCamera(45, 1, DEFAULT_CAMERA_NEAR, DEFAULT_CAMERA_FAR);
  camera.position.set(0, -30, 18);
  camera.up.set(SCENE_UP_VECTOR.x, SCENE_UP_VECTOR.y, SCENE_UP_VECTOR.z);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = DEFAULT_DISPLAY_EXPOSURE;
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.update();
  updateCameraClipPlanes(camera, controls.target);

  // Atmosphere shells are marked by orbit-engine-three at their source. The
  // bloom composer temporarily hides every other renderable, so guides,
  // selection rings, cloud overlays and body surfaces can never contribute to
  // the halo. The bloom composer renders at half resolution and UnrealBloom's
  // fixed mip chain supplies the bounded low-frequency falloff.
  const bloomComposer = new EffectComposer(renderer);
  bloomComposer.setPixelRatio(BLOOM_COMPOSER_PIXEL_RATIO);
  bloomComposer.renderToScreen = false;
  bloomComposer.addPass(new RenderPass(scene, camera));
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(512, 512), BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD);
  bloomComposer.addPass(bloomPass);

  const finalComposer = new EffectComposer(renderer);
  const finalScenePass = new RenderPass(scene, camera);
  finalComposer.addPass(finalScenePass);
  const finalPass = new ShaderPass(new THREE.ShaderMaterial({
    uniforms: {
      tBase: { value: null },
      tBloom: { value: bloomComposer.renderTarget2.texture },
    },
    vertexShader: `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`,
    fragmentShader: `
uniform sampler2D tBase;
uniform sampler2D tBloom;
varying vec2 vUv;
void main() {
  gl_FragColor = texture2D(tBase, vUv) + texture2D(tBloom, vUv);
}
`,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  }), "tBase");
  finalComposer.addPass(finalPass);

  function isRenderable(object: THREE.Object3D): boolean {
    const candidate = object as THREE.Object3D & {
      readonly isMesh?: boolean;
      readonly isLine?: boolean;
      readonly isPoints?: boolean;
      readonly isSprite?: boolean;
    };
    return candidate.isMesh === true || candidate.isLine === true || candidate.isPoints === true || candidate.isSprite === true;
  }

  function render(): void {
    const hidden = new Map<THREE.Object3D, boolean>();
    scene.traverse((object) => {
      if (!isRenderable(object) || object.userData.atmosphereBloomSource === true) return;
      hidden.set(object, object.visible);
      object.visible = false;
    });
    const previousBackground = scene.background;
    scene.background = null;
    try {
      bloomComposer.render();
    } finally {
      scene.background = previousBackground;
      for (const [object, visible] of hidden) object.visible = visible;
    }
    finalComposer.render();
  }

  function resize(width: number, height: number): void {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    bloomComposer.setSize(width, height);
    finalComposer.setSize(width, height);
  }

  function dispose(): void {
    controls.dispose();
    bloomPass.dispose();
    bloomComposer.dispose();
    finalPass.dispose();
    finalComposer.dispose();
    renderer.dispose();
    scene.clear();
  }

  function centerOn(
    target: THREE.Vector3,
    preferredDistance?: number,
    viewDirection?: Readonly<{ readonly x: number; readonly y: number; readonly z: number }>,
  ): void {
    const nextTarget = target.clone();
    if (preferredDistance === undefined) {
      translateViewTo(camera, controls.target, nextTarget);
    } else {
      if (!Number.isFinite(preferredDistance) || preferredDistance <= 0) {
        throw new RangeError("Preferred camera distance must be finite and positive");
      }
      const offset = camera.position.clone().sub(controls.target);
      const direction = viewDirection === undefined
        ? offset.lengthSq() > Number.EPSILON
          ? offset.normalize()
          : new THREE.Vector3(0, -1, 0.6).normalize()
        : new THREE.Vector3(viewDirection.x, viewDirection.y, viewDirection.z).normalize();
      if (direction.lengthSq() <= Number.EPSILON) throw new RangeError("View direction must be non-zero");
      camera.position.copy(nextTarget).addScaledVector(direction, preferredDistance);
      controls.target.copy(nextTarget);
    }
    controls.update();
    updateCameraClipPlanes(camera, controls.target);
  }

  function setDisplayExposure(exposure: number): void {
    if (!Number.isFinite(exposure) || exposure < MIN_DISPLAY_EXPOSURE || exposure > MAX_DISPLAY_EXPOSURE) {
      throw new RangeError(`Display exposure must be finite and within [${MIN_DISPLAY_EXPOSURE}, ${MAX_DISPLAY_EXPOSURE}]`);
    }
    renderer.toneMappingExposure = exposure;
  }

  return {
    scene,
    camera,
    renderer,
    controls,
    toneMappingMode: DISPLAY_TONE_MAPPING_MODE,
    render,
    setDisplayExposure,
    centerOn,
    resize,
    dispose,
  };
}

export interface AnimationLoop {
  readonly running: boolean;
  start(): void;
  stop(): void;
}

export function createAnimationLoop(callback: (timestampMilliseconds: number) => void): AnimationLoop {
  let running = false;
  let frameHandle: number | undefined;

  const frame = (timestampMilliseconds: number): void => {
    if (!running) return;
    callback(timestampMilliseconds);
    frameHandle = requestAnimationFrame(frame);
  };

  return {
    get running() {
      return running;
    },
    start() {
      if (running) return;
      running = true;
      frameHandle = requestAnimationFrame(frame);
    },
    stop() {
      if (!running) return;
      running = false;
      if (frameHandle !== undefined) cancelAnimationFrame(frameHandle);
      frameHandle = undefined;
    },
  };
}
