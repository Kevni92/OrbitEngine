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
  resize(width: number, height: number): void;
  dispose(): void;
}

export function isWebGL2Available(canvas: HTMLCanvasElement): boolean {
  return canvas.getContext("webgl2") !== null;
}

export function createRenderShell(canvas: HTMLCanvasElement): RenderShell {
  if (!isWebGL2Available(canvas)) throw new WebGL2UnavailableError();

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050914);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 10_000);
  camera.position.set(0, -30, 18);
  camera.up.set(SCENE_UP_VECTOR.x, SCENE_UP_VECTOR.y, SCENE_UP_VECTOR.z);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.update();

  const axes = new THREE.AxesHelper(10);
  scene.add(axes);

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

  return { scene, camera, renderer, controls, resize, dispose };
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
