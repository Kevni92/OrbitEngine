import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import {
  MAX_DISPLAY_EXPOSURE,
  MIN_DISPLAY_EXPOSURE,
} from "orbit-engine-three/presentation";
import {
  DEFAULT_LIGHTING_INSPECTOR_TUNING,
  installLightingInspector,
  type LightingInspectorTuning,
} from "../ui/lighting-inspector.js";

const DEFAULT_DISPLAY_EXPOSURE = 1;
const DISPLAY_TONE_MAPPING_MODE = "ACESFilmic" as const;
const SCENE_UP_VECTOR = Object.freeze({ x: 0, y: 0, z: 1 });

// Bloom resolution stays fixed for predictable cost. All perceptual bloom
// controls are exposed through the runtime inspector instead of being hidden
// constants that require another rebuild for every visual iteration.
const BLOOM_COMPOSER_PIXEL_RATIO = 0.5;
const BLOOM_THRESHOLD = 0.0;
const ATMOSPHERE_SHADER_BASE_KEY = "orbitInspectorAtmosphereBaseFragmentShader";
const ATMOSPHERE_SHADER_TUNING_KEY = "orbitInspectorAtmosphereTuningSignature";

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

interface AtmosphereMaterialState {
  readonly material: THREE.ShaderMaterial;
  readonly rayleigh: THREE.Vector3;
  readonly mie: THREE.Vector3;
  readonly absorption: THREE.Vector3;
  readonly opticalDepth: number;
  readonly anisotropy: number;
}

function linearRgbLuminance(value: THREE.Vector3): number {
  return value.x * 0.2126 + value.y * 0.7152 + value.z * 0.0722;
}

function ensureAtmosphereShellBlending(material: THREE.ShaderMaterial): void {
  // The atmosphere shader already outputs premultiplied radiance + alpha.
  // Normal premultiplied-alpha compositing attenuates the underlying surface
  // while adding in-scattered light. Additive blending instead double-adds the
  // bright limb and drives coloured atmospheres toward white clipping.
  if (material.blending !== THREE.NormalBlending || material.premultipliedAlpha !== true) {
    material.blending = THREE.NormalBlending;
    material.premultipliedAlpha = true;
    material.needsUpdate = true;
  }
}

function applyAtmosphereShaderPresentationTuning(
  material: THREE.ShaderMaterial,
  tuning: LightingInspectorTuning,
): void {
  const data = material.userData as Record<string, unknown>;
  const storedBase = data[ATMOSPHERE_SHADER_BASE_KEY];
  const baseFragmentShader = typeof storedBase === "string" ? storedBase : material.fragmentShader;
  if (storedBase === undefined) data[ATMOSPHERE_SHADER_BASE_KEY] = baseFragmentShader;
  const signature = [
    tuning.atmosphereShellDisplayGain,
    tuning.atmosphereSurfaceCompositeGain,
    tuning.atmosphereLimbGain,
  ].map((value) => value.toFixed(4)).join(":");
  if (data[ATMOSPHERE_SHADER_TUNING_KEY] === signature) return;

  const patched = baseFragmentShader
    .replace(
      /const float DISPLAY_GAIN = [-+0-9.eE]+;/,
      `const float DISPLAY_GAIN = ${tuning.atmosphereShellDisplayGain.toFixed(4)};`,
    )
    .replace(
      /const float LIMB_DISPLAY_GAIN = [-+0-9.eE]+;/,
      `const float LIMB_DISPLAY_GAIN = ${tuning.atmosphereLimbGain.toFixed(4)};`,
    )
    .replace(
      /float displayGain = bodyIntersectsView \? [-+0-9.eE]+ : DISPLAY_GAIN;/,
      `float displayGain = bodyIntersectsView ? ${tuning.atmosphereSurfaceCompositeGain.toFixed(4)} : DISPLAY_GAIN;`,
    );
  material.fragmentShader = patched;
  material.needsUpdate = true;
  data[ATMOSPHERE_SHADER_TUNING_KEY] = signature;
}

function captureAtmosphereMaterial(material: THREE.ShaderMaterial): AtmosphereMaterialState | undefined {
  const rayleigh = material.uniforms.uRayleighScattering?.value;
  const mie = material.uniforms.uMieScattering?.value;
  const absorption = material.uniforms.uAbsorption?.value;
  const opticalDepth = material.uniforms.uReferenceVerticalOpticalDepth?.value;
  const anisotropy = material.uniforms.uMieAnisotropy?.value;
  if (!(rayleigh instanceof THREE.Vector3)
    || !(mie instanceof THREE.Vector3)
    || !(absorption instanceof THREE.Vector3)
    || typeof opticalDepth !== "number"
    || !Number.isFinite(opticalDepth)
    || typeof anisotropy !== "number"
    || !Number.isFinite(anisotropy)) {
    return undefined;
  }
  return {
    material,
    rayleigh: rayleigh.clone(),
    mie: mie.clone(),
    absorption: absorption.clone(),
    opticalDepth,
    anisotropy,
  };
}

function restoreAtmosphereMaterial(state: AtmosphereMaterialState): void {
  const rayleigh = state.material.uniforms.uRayleighScattering?.value;
  const mie = state.material.uniforms.uMieScattering?.value;
  const absorption = state.material.uniforms.uAbsorption?.value;
  if (rayleigh instanceof THREE.Vector3) rayleigh.copy(state.rayleigh);
  if (mie instanceof THREE.Vector3) mie.copy(state.mie);
  if (absorption instanceof THREE.Vector3) absorption.copy(state.absorption);
  if (state.material.uniforms.uReferenceVerticalOpticalDepth !== undefined) {
    state.material.uniforms.uReferenceVerticalOpticalDepth.value = state.opticalDepth;
  }
  if (state.material.uniforms.uMieAnisotropy !== undefined) {
    state.material.uniforms.uMieAnisotropy.value = state.anisotropy;
  }
}

function applyRuntimeAtmosphereTuning(
  material: THREE.ShaderMaterial,
  tuning: LightingInspectorTuning,
): AtmosphereMaterialState | undefined {
  const state = captureAtmosphereMaterial(material);
  if (state === undefined) return undefined;
  const rayleigh = material.uniforms.uRayleighScattering!.value as THREE.Vector3;
  const mie = material.uniforms.uMieScattering!.value as THREE.Vector3;
  const absorption = material.uniforms.uAbsorption!.value as THREE.Vector3;
  rayleigh.multiplyScalar(tuning.atmosphereRayleighGain);
  mie.multiplyScalar(tuning.atmosphereMieGain);
  absorption.multiplyScalar(tuning.atmosphereAbsorptionGain);
  material.uniforms.uReferenceVerticalOpticalDepth!.value = Math.max(
    0,
    state.opticalDepth * tuning.atmosphereOpticalDepthGain,
  );
  material.uniforms.uMieAnisotropy!.value = THREE.MathUtils.clamp(
    state.anisotropy * tuning.atmosphereAnisotropyScale,
    -0.95,
    0.95,
  );
  return state;
}

function prepareAtmosphereBloomMaterial(
  material: THREE.ShaderMaterial,
  tuning: LightingInspectorTuning,
): AtmosphereMaterialState | undefined {
  const state = captureAtmosphereMaterial(material);
  if (state === undefined) return undefined;
  const rayleigh = material.uniforms.uRayleighScattering!.value as THREE.Vector3;
  const mie = material.uniforms.uMieScattering!.value as THREE.Vector3;
  const mieLuminance = Math.max(linearRgbLuminance(mie), Number.EPSILON);
  const spectralContrast = THREE.MathUtils.clamp(Math.abs(mie.x - mie.z) / mieLuminance, 0, 1);
  const mieGain = 1 + tuning.bloomSourceMieChromaGain * spectralContrast;
  const rayleighGain = 1 - tuning.bloomSourceRayleighReduction * spectralContrast;

  // This modifies only the off-screen bloom source. The actual atmosphere shell
  // is restored before the base scene render, so physical transport diagnostics
  // and the visible in-shell scattering remain unchanged.
  rayleigh.multiplyScalar(Math.max(0, rayleighGain));
  mie.multiplyScalar(Math.max(0, mieGain));
  material.uniforms.uReferenceVerticalOpticalDepth!.value = Math.min(
    Math.max(state.opticalDepth, 0),
    tuning.bloomSourceOpticalDepthCap,
  );
  return state;
}

export function createRenderShell(canvas: HTMLCanvasElement): RenderShell {
  if (!isWebGL2Available(canvas)) throw new WebGL2UnavailableError();

  const scene = new THREE.Scene();
  // Space is a display reference, not scene radiance. A non-zero background
  // would be amplified by the focused body's photographic exposure and turn
  // blue/gray at Jupiter, Saturn and beyond. Keep it exactly black so focus
  // exposure only changes actual rendered radiance.
  scene.background = new THREE.Color(0x000000);
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

  let tuning: LightingInspectorTuning = { ...DEFAULT_LIGHTING_INSPECTOR_TUNING };
  let resolvedDisplayExposure = DEFAULT_DISPLAY_EXPOSURE;

  // Atmosphere shells are marked by orbit-engine-three at their source. The
  // bloom composer temporarily hides every other renderable, so guides,
  // selection indicators, cloud overlays and body surfaces can never
  // contribute to the halo.
  const bloomComposer = new EffectComposer(renderer);
  bloomComposer.setPixelRatio(BLOOM_COMPOSER_PIXEL_RATIO);
  bloomComposer.renderToScreen = false;
  bloomComposer.addPass(new RenderPass(scene, camera));
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(512, 512),
    tuning.bloomStrength,
    tuning.bloomRadius,
    BLOOM_THRESHOLD,
  );
  bloomComposer.addPass(bloomPass);

  const finalComposer = new EffectComposer(renderer);
  const finalScenePass = new RenderPass(scene, camera);
  finalComposer.addPass(finalScenePass);

  // Base radiance and selective atmosphere bloom stay in the same linear HDR
  // domain. Exposure, ACES and sRGB happen exactly once in OutputPass.
  const finalPass = new ShaderPass(new THREE.ShaderMaterial({
    uniforms: {
      tBase: { value: null },
      tBloom: { value: bloomComposer.renderTarget2.texture },
      uBloomCompositeGain: { value: tuning.bloomCompositeGain },
      uBloomSurfaceWeight: { value: tuning.bloomSurfaceWeight },
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
uniform float uBloomCompositeGain;
uniform float uBloomSurfaceWeight;
varying vec2 vUv;
const vec3 LINEAR_LUMINANCE = vec3(0.2126, 0.7152, 0.0722);
void main() {
  vec4 base = texture2D(tBase, vUv);
  vec3 bloom = texture2D(tBloom, vUv).rgb * uBloomCompositeGain;
  float baseLuminance = max(dot(base.rgb, LINEAR_LUMINANCE), 0.0);
  float exteriorWeight = 1.0 - smoothstep(0.04, 0.20, baseLuminance);
  float bloomWeight = mix(uBloomSurfaceWeight, 1.0, exteriorWeight);
  gl_FragColor = vec4(base.rgb + bloom * bloomWeight, base.a);
}
`,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  }), "tBase");
  finalComposer.addPass(finalPass);

  // EffectComposer renders preceding passes into offscreen targets, where the
  // renderer intentionally does not apply its final tone mapping. OutputPass is
  // therefore the single authoritative display transform.
  const outputPass = new OutputPass();
  finalComposer.addPass(outputPass);

  function applyDisplayExposure(): void {
    renderer.toneMappingExposure = THREE.MathUtils.clamp(
      resolvedDisplayExposure * tuning.exposureMultiplier,
      MIN_DISPLAY_EXPOSURE,
      MAX_DISPLAY_EXPOSURE,
    );
  }

  function applyInspectorTuning(next: LightingInspectorTuning): void {
    tuning = { ...next };
    bloomPass.strength = tuning.bloomStrength;
    bloomPass.radius = tuning.bloomRadius;
    finalPass.material.uniforms.uBloomCompositeGain!.value = tuning.bloomCompositeGain;
    finalPass.material.uniforms.uBloomSurfaceWeight!.value = tuning.bloomSurfaceWeight;
    applyDisplayExposure();
  }

  const lightingInspector = installLightingInspector(applyInspectorTuning);

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
    const runtimeAtmosphereStates: AtmosphereMaterialState[] = [];
    const bloomAtmosphereStates: AtmosphereMaterialState[] = [];

    scene.traverse((object) => {
      if (!isRenderable(object)) return;
      const material = (object as THREE.Mesh).material;
      if (material instanceof THREE.ShaderMaterial) {
        if (material.uniforms.uSurfaceRadianceDisplayGain !== undefined) {
          material.uniforms.uSurfaceRadianceDisplayGain.value = tuning.surfaceRadianceGain;
        }
        if (object.userData.atmosphereBloomSource === true) {
          ensureAtmosphereShellBlending(material);
          applyAtmosphereShaderPresentationTuning(material, tuning);
          const runtimeState = applyRuntimeAtmosphereTuning(material, tuning);
          if (runtimeState !== undefined) runtimeAtmosphereStates.push(runtimeState);
          const bloomState = prepareAtmosphereBloomMaterial(material, tuning);
          if (bloomState !== undefined) bloomAtmosphereStates.push(bloomState);
          return;
        }
      }
      hidden.set(object, object.visible);
      object.visible = false;
    });

    const previousBackground = scene.background;
    scene.background = null;
    try {
      try {
        bloomComposer.render();
      } finally {
        scene.background = previousBackground;
        for (const state of bloomAtmosphereStates) restoreAtmosphereMaterial(state);
        for (const [object, visible] of hidden) object.visible = visible;
      }
      finalComposer.render();
    } finally {
      for (const state of runtimeAtmosphereStates) restoreAtmosphereMaterial(state);
    }
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
    lightingInspector.dispose();
    controls.dispose();
    bloomPass.dispose();
    bloomComposer.dispose();
    finalPass.dispose();
    outputPass.dispose();
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
    resolvedDisplayExposure = exposure;
    applyDisplayExposure();
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
