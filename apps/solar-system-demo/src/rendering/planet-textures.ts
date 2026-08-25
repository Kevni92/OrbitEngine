import * as THREE from "three";
import type { PlanetTextureAsset } from "../scenario/planet-texture-registry.js";

export interface PlanetTextureResourceDiagnostics {
  readonly activeResourceCount: number;
  readonly pendingResourceCount: number;
  readonly activeReferenceCount: number;
  readonly loadRequestCount: number;
}

interface TextureRecord {
  readonly asset: PlanetTextureAsset;
  references: number;
  pending: boolean;
  texture?: THREE.Texture;
  listeners: Set<(texture: THREE.Texture) => void>;
}

export interface PlanetTextureLoader {
  load(
    url: string,
    onLoad: (texture: THREE.Texture) => void,
    onProgress?: (event: ProgressEvent<EventTarget>) => void,
    onError?: (error: unknown) => void,
  ): THREE.Texture;
}

export interface PlanetTextureResourceManagerOptions {
  readonly loader?: PlanetTextureLoader;
  readonly maxAnisotropy?: number;
  readonly canLoad?: boolean;
}

export interface PlanetTextureLease {
  readonly assetKey: string;
  release(): void;
}

function assetUrl(fileName: string): string {
  if (typeof document === "undefined") return `assets/planet-textures/${fileName}`;
  return new URL(`assets/planet-textures/${fileName}`, document.baseURI).href;
}

/**
 * Renderer-owned, reference-counted texture cache. It starts no browser
 * requests until a body is promoted to sphere LOD and disposes the texture
 * after the final lease is released.
 */
export class PlanetTextureResourceManager {
  readonly #records = new Map<string, TextureRecord>();
  readonly #loader?: PlanetTextureLoader;
  readonly #maxAnisotropy: number;
  readonly #canLoad: boolean;
  #loadRequestCount = 0;

  constructor(options: PlanetTextureResourceManagerOptions = {}) {
    this.#canLoad = options.canLoad ?? (typeof document !== "undefined" && typeof Image !== "undefined");
    this.#loader = options.loader ?? (this.#canLoad ? new THREE.TextureLoader() : undefined);
    this.#maxAnisotropy = Math.max(1, Math.min(4, Math.floor(options.maxAnisotropy ?? 4)));
  }

  acquire(asset: PlanetTextureAsset, onLoad: (texture: THREE.Texture) => void): PlanetTextureLease {
    let record = this.#records.get(asset.key);
    if (record === undefined) {
      record = { asset, references: 0, pending: false, listeners: new Set() };
      this.#records.set(asset.key, record);
    }
    record.references += 1;
    let released = false;
    record.listeners.add(onLoad);
    if (record.texture !== undefined) {
      onLoad(record.texture);
    } else if (!record.pending && this.#canLoad && this.#loader !== undefined) {
      record.pending = true;
      this.#loadRequestCount += 1;
      this.#loader.load(
        assetUrl(asset.fileName),
        (texture) => this.#resolve(asset.key, texture),
        undefined,
        () => this.#reject(asset.key),
      );
    }
    return {
      assetKey: asset.key,
      release: () => {
        if (released) return;
        released = true;
        record!.listeners.delete(onLoad);
        this.#release(asset.key);
      },
    };
  }

  diagnostics(): PlanetTextureResourceDiagnostics {
    let pendingResourceCount = 0;
    let activeReferenceCount = 0;
    for (const record of this.#records.values()) {
      if (record.pending) pendingResourceCount += 1;
      activeReferenceCount += record.references;
    }
    return Object.freeze({
      activeResourceCount: this.#records.size,
      pendingResourceCount,
      activeReferenceCount,
      loadRequestCount: this.#loadRequestCount,
    });
  }

  dispose(): void {
    for (const record of this.#records.values()) record.texture?.dispose();
    this.#records.clear();
    this.#loadRequestCount = 0;
  }

  #resolve(assetKey: string, texture: THREE.Texture): void {
    const record = this.#records.get(assetKey);
    if (record === undefined || record.references === 0) {
      texture.dispose();
      if (record !== undefined) this.#records.delete(assetKey);
      return;
    }
    record.pending = false;
    record.texture = texture;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = this.#maxAnisotropy;
    texture.needsUpdate = true;
    for (const listener of record.listeners) listener(texture);
  }

  #reject(assetKey: string): void {
    const record = this.#records.get(assetKey);
    if (record === undefined) return;
    record.pending = false;
    if (record.references === 0) this.#records.delete(assetKey);
  }

  #release(assetKey: string): void {
    const record = this.#records.get(assetKey);
    if (record === undefined) return;
    record.references = Math.max(0, record.references - 1);
    if (record.references > 0) return;
    record.texture?.dispose();
    this.#records.delete(assetKey);
  }
}

export function createEarthNightLightsMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: null },
      uLightDirection: { value: new THREE.Vector3(0, 1, 0) },
      uIntensity: { value: 1.25 },
    },
    vertexShader: `
varying vec2 vUv;
varying vec3 vWorldNormal;

void main() {
  vUv = uv;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`,
    fragmentShader: `
uniform sampler2D uMap;
uniform vec3 uLightDirection;
uniform float uIntensity;
varying vec2 vUv;
varying vec3 vWorldNormal;

void main() {
  vec3 map = texture2D(uMap, vUv).rgb;
  float night = smoothstep(0.12, 0.42, -dot(normalize(vWorldNormal), normalize(uLightDirection)));
  float luminance = dot(map, vec3(0.299, 0.587, 0.114));
  float alpha = luminance * night * uIntensity;
  gl_FragColor = vec4(map * night * uIntensity, alpha);
}
`,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    toneMapped: true,
  });
}

const PLANET_CLOUD_LIGHT_COUNT = 4;
const PLANET_LAYER_RADIANCE_DISPLAY_GAIN = 2.4;

/**
 * Render a texture-backed cloud shell from the same direct stellar lighting
 * contract as the companion surface material. The source JPEG is a coverage
 * map, so its luminance becomes both cloud coverage and cloud radiance while
 * the texture alpha remains part of the final opacity calculation.
 */
export function createPlanetCloudMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: null },
      uOpacity: { value: 0.88 },
      uRadianceDisplayGain: { value: PLANET_LAYER_RADIANCE_DISPLAY_GAIN },
      uLightCount: { value: 0 },
      uLightDirections: { value: Array.from({ length: PLANET_CLOUD_LIGHT_COUNT }, () => new THREE.Vector3(0, 1, 0)) },
      uLightColors: { value: Array.from({ length: PLANET_CLOUD_LIGHT_COUNT }, () => new THREE.Color(0, 0, 0)) },
      uLightIntensity: { value: Array.from({ length: PLANET_CLOUD_LIGHT_COUNT }, () => 0) },
    },
    vertexShader: `
varying vec2 vUv;
varying vec3 vWorldNormal;

void main() {
  vUv = uv;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`,
    fragmentShader: `
uniform sampler2D uMap;
uniform float uOpacity;
uniform float uRadianceDisplayGain;
uniform int uLightCount;
uniform vec3 uLightDirections[${PLANET_CLOUD_LIGHT_COUNT}];
uniform vec3 uLightColors[${PLANET_CLOUD_LIGHT_COUNT}];
uniform float uLightIntensity[${PLANET_CLOUD_LIGHT_COUNT}];
varying vec2 vUv;
varying vec3 vWorldNormal;

void main() {
  vec4 mapSample = texture2D(uMap, vUv);
  float mapLuminance = dot(mapSample.rgb, vec3(0.299, 0.587, 0.114));
  float coverage = smoothstep(0.06, 0.28, mapLuminance);
  vec3 normal = normalize(vWorldNormal);
  vec3 incident = vec3(0.0);
  float directVisibility = 0.0;
  for (int index = 0; index < ${PLANET_CLOUD_LIGHT_COUNT}; index += 1) {
    if (index >= uLightCount) break;
    float visibility = max(dot(normal, normalize(uLightDirections[index])), 0.0);
    directVisibility = max(directVisibility, visibility);
    incident += uLightColors[index] * uLightIntensity[index] * visibility;
  }
  float alpha = mapSample.a * coverage * uOpacity * directVisibility;
  if (alpha <= 0.001) discard;
  vec3 radiance = vec3(mapLuminance) * incident * alpha * uRadianceDisplayGain;
  gl_FragColor = vec4(radiance, alpha);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}
`,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.NormalBlending,
    toneMapped: true,
    premultipliedAlpha: true,
  });
}
