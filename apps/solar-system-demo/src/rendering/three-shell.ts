import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { SCENE_UP_VECTOR } from "./render-space.js";

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
  centerOn(target: THREE.Vector3): void;
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
  const currentNear = Number.isFinite(camera.near) && camera.near > 0
    ? camera.near
    : DEFAULT_CAMERA_NEAR;
  const near = Math.min(Math.max(currentNear, Number.EPSILON), far / 2);
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
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.update();
  updateCameraClipPlanes(camera, controls.target);

  function resize(width: number, height: number): void {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  }

  function dispose(): void {
    controls.dispose();
    renderer.dispose();
    scene.clear();
  }

  function centerOn(target: THREE.Vector3): void {
    translateViewTo(camera, controls.target, target);
    controls.update();
    updateCameraClipPlanes(camera, controls.target);
  }

  return { scene, camera, renderer, controls, centerOn, resize, dispose };
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
