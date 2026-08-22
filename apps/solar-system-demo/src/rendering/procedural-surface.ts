import * as THREE from "three";
import type { ObjectId } from "orbit-engine";
import {
  opticalMaterial,
  type CelestialAppearance,
  type CloudLayerAppearance,
  type LinearRgb,
} from "../scenario/celestial-appearance.js";
import { LINEAR_SRGB_LUMINANCE, linearRgbToSrgb } from "./celestial-appearance-rendering.js";

export const PROCEDURAL_SURFACE_WIDTH = 128;
export const PROCEDURAL_SURFACE_HEIGHT = 64;
export const PROCEDURAL_SURFACE_MAX_CHANNEL_SCALE = 1.65;
export const PROCEDURAL_SURFACE_MIN_CHANNEL_SCALE = 0.45;

export interface ProceduralSurfaceDiagnostics {
  readonly kind: "solidSurface" | "iceSurface" | "cloudDeck";
  readonly width: number;
  readonly height: number;
  readonly baseline: LinearRgb;
  readonly meanLinear: LinearRgb;
  readonly minLuminance: number;
  readonly maxLuminance: number;
  readonly hasCloudStructure: boolean;
}

export interface ProceduralSurfaceData extends ProceduralSurfaceDiagnostics {
  readonly pixels: Uint8Array;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function mix(left: number, right: number, amount: number): number {
  return left + (right - left) * amount;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / Math.max(edge1 - edge0, Number.EPSILON));
  return t * t * (3 - 2 * t);
}

function luminance(value: LinearRgb): number {
  return value.r * LINEAR_SRGB_LUMINANCE.r
    + value.g * LINEAR_SRGB_LUMINANCE.g
    + value.b * LINEAR_SRGB_LUMINANCE.b;
}

function normalizeToAlbedo(value: LinearRgb, visualAlbedo: number | undefined): LinearRgb {
  if (visualAlbedo === undefined) return value;
  const current = luminance(value);
  if (current <= Number.EPSILON) return value;
  const scale = visualAlbedo / current;
  return {
    r: value.r * scale,
    g: value.g * scale,
    b: value.b * scale,
  };
}

function cloudReflectance(cloud: CloudLayerAppearance, baseline: LinearRgb): LinearRgb {
  const calibrated = cloud.calibratedReflectance;
  const optical = opticalMaterial(cloud.materialId)?.linearReflectance;
  return normalizeToAlbedo(calibrated ?? optical ?? baseline, cloud.visualAlbedo);
}

function seedFromObjectId(objectId: ObjectId): number {
  const text = String(objectId);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function phase(seed: number, salt: number): number {
  let value = Math.imul(seed ^ salt, 0x45d9f3b);
  value ^= value >>> 16;
  value = Math.imul(value, 0x45d9f3b);
  value ^= value >>> 16;
  return (value >>> 0) / 0xffffffff * Math.PI * 2;
}

function baseVariation(
  kind: "solidSurface" | "iceSurface" | "cloudDeck",
  longitude: number,
  latitude: number,
  seed: number,
): number {
  const p0 = phase(seed, 0x9e3779b9);
  const p1 = phase(seed, 0x85ebca6b);
  const p2 = phase(seed, 0xc2b2ae35);
  if (kind === "cloudDeck") {
    const band = 0.62 * Math.sin(latitude * 13 + p0)
      + 0.25 * Math.sin(latitude * 31 + p1)
      + 0.13 * Math.sin(longitude * 4 + latitude * 8 + p2);
    return 1 + band * 0.19;
  }
  const mottle = 0.50 * Math.sin(longitude * 3 + p0) * Math.cos(latitude * 2 + p1)
    + 0.30 * Math.sin(longitude * 7 - latitude * 3 + p2)
    + 0.20 * Math.cos(longitude * 11 + latitude * 5 - p0);
  return 1 + mottle * (kind === "iceSurface" ? 0.11 : 0.17);
}

function cloudMask(
  longitude: number,
  latitude: number,
  seed: number,
  coverageFraction: number,
  layerIndex: number,
): number {
  const p0 = phase(seed, 0x27d4eb2d + layerIndex * 97);
  const p1 = phase(seed, 0x165667b1 + layerIndex * 131);
  const signal = (
    0.55 * Math.sin(longitude * 5 + latitude * 2 + p0)
    + 0.30 * Math.cos(longitude * 9 - latitude * 4 + p1)
    + 0.15 * Math.sin(longitude * 17 + latitude * 7 - p0)
  );
  const threshold = 1 - coverageFraction * 2;
  return smoothstep(threshold - 0.16, threshold + 0.16, signal);
}

function validateBaseline(baseline: LinearRgb): void {
  for (const [name, value] of Object.entries(baseline)) {
    if (!Number.isFinite(value) || value < 0) throw new RangeError(`surface baseline ${name} must be finite and non-negative`);
  }
}

export function generateProceduralSurfaceData(
  objectId: ObjectId,
  appearance: CelestialAppearance,
  baseline: LinearRgb,
  width = PROCEDURAL_SURFACE_WIDTH,
  height = PROCEDURAL_SURFACE_HEIGHT,
): ProceduralSurfaceData | undefined {
  const layer = appearance.visibleLayer;
  if (layer === undefined) return undefined;
  validateBaseline(baseline);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 4 || height < 2) {
    throw new RangeError("procedural surface dimensions must be safe positive integers");
  }

  const seed = seedFromObjectId(objectId);
  const linear = new Float64Array(width * height * 3);
  const cloudLayers = appearance.atmosphere?.cloudLayers ?? [];

  for (let y = 0; y < height; y += 1) {
    const v = (y + 0.5) / height;
    const latitude = (v - 0.5) * Math.PI;
    for (let x = 0; x < width; x += 1) {
      const u = (x + 0.5) / width;
      const longitude = (u - 0.5) * Math.PI * 2;
      const factor = baseVariation(layer.kind, longitude, latitude, seed);
      let r = baseline.r * factor;
      let g = baseline.g * factor;
      let b = baseline.b * factor;

      cloudLayers.forEach((cloud, layerIndex) => {
        if (cloud.coverageFraction <= 0 || cloud.opticalDepth <= 0) return;
        const cloudColor = cloudReflectance(cloud, baseline);
        const coverage = cloudMask(longitude, latitude, seed, cloud.coverageFraction, layerIndex);
        const opticalWeight = 1 - Math.exp(-Math.min(cloud.opticalDepth, 8) * 0.55);
        const amount = coverage * opticalWeight * 0.72;
        r = mix(r, cloudColor.r, amount);
        g = mix(g, cloudColor.g, amount);
        b = mix(b, cloudColor.b, amount);
      });

      const offset = (y * width + x) * 3;
      linear[offset] = clamp01(r);
      linear[offset + 1] = clamp01(g);
      linear[offset + 2] = clamp01(b);
    }
  }

  const means = [0, 0, 0];
  for (let index = 0; index < linear.length; index += 3) {
    means[0] += linear[index]!;
    means[1] += linear[index + 1]!;
    means[2] += linear[index + 2]!;
  }
  const pixelCount = width * height;
  means[0] /= pixelCount;
  means[1] /= pixelCount;
  means[2] /= pixelCount;
  const target = [baseline.r, baseline.g, baseline.b];
  const scales = means.map((mean, index) => {
    if (mean <= Number.EPSILON || target[index]! <= Number.EPSILON) return 1;
    return Math.min(PROCEDURAL_SURFACE_MAX_CHANNEL_SCALE, Math.max(PROCEDURAL_SURFACE_MIN_CHANNEL_SCALE, target[index]! / mean));
  });

  const pixels = new Uint8Array(pixelCount * 4);
  const finalMean = { r: 0, g: 0, b: 0 };
  let minLuminance = Number.POSITIVE_INFINITY;
  let maxLuminance = 0;
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const source = pixel * 3;
    const value = {
      r: clamp01(linear[source]! * scales[0]!),
      g: clamp01(linear[source + 1]! * scales[1]!),
      b: clamp01(linear[source + 2]! * scales[2]!),
    };
    finalMean.r += value.r;
    finalMean.g += value.g;
    finalMean.b += value.b;
    const valueLuminance = luminance(value);
    minLuminance = Math.min(minLuminance, valueLuminance);
    maxLuminance = Math.max(maxLuminance, valueLuminance);
    const srgb = linearRgbToSrgb(value);
    const targetOffset = pixel * 4;
    pixels[targetOffset] = Math.round(clamp01(srgb.r) * 255);
    pixels[targetOffset + 1] = Math.round(clamp01(srgb.g) * 255);
    pixels[targetOffset + 2] = Math.round(clamp01(srgb.b) * 255);
    pixels[targetOffset + 3] = 255;
  }
  finalMean.r /= pixelCount;
  finalMean.g /= pixelCount;
  finalMean.b /= pixelCount;

  return Object.freeze({
    kind: layer.kind,
    width,
    height,
    baseline: Object.freeze({ ...baseline }),
    meanLinear: Object.freeze(finalMean),
    minLuminance,
    maxLuminance,
    hasCloudStructure: cloudLayers.some((cloud) => cloud.coverageFraction > 0 && cloud.opticalDepth > 0),
    pixels,
  });
}

export function createProceduralSurfaceTexture(data: ProceduralSurfaceData): THREE.DataTexture {
  const texture = new THREE.DataTexture(
    data.pixels,
    data.width,
    data.height,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  texture.name = `Procedural celestial appearance ${data.kind}`;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}
