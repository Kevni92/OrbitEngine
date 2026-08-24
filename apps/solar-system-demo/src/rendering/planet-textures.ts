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
