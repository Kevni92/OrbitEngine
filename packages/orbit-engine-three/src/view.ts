import * as THREE from "three";
import type { ObjectId } from "orbit-engine";
import {
  blackbodyTemperatureToLinearRgb,
  deriveSurfaceReflectance,
  resolveAtmosphereOptics,
  resolveStellarIllumination,
  inspectionFillContribution,
  validateCelestialAppearance,
  type AtmosphereOptics,
  type LightingMode,
  type StellarEmitter,
  type StellarIllumination,
} from "./presentation.js";
import { createRenderSpaceConfig, transformSnapshotDirectionToRenderSpace, transformSnapshotPositionToSceneUnits, type RenderSpaceConfig, type RenderVector3 } from "./render-space.js";
import { createCelestialRenderSnapshot, type BodyRepresentation, type CelestialBodyRenderState, type CelestialRenderSnapshot } from "./snapshot.js";
import { BatchedMarkerLayer, type BatchedMarkerLayerOptions, type MarkerRenderEntry } from "./markers.js";
import { createRepresentationPolicy, resolveRepresentationDecisions, type RepresentationDecision, type RepresentationPolicy, type RepresentationPolicyConfiguration } from "./lod.js";
import { createAdaptiveSizingConfiguration, resolveBodySizing, type AdaptiveSizingConfiguration, type BodyProjectionMetrics, type BodySizingResult, type RadiusMode } from "./sizing.js";
import { OrbitPathRenderer, type OrbitPathRendererOptions, type OrbitPathRendererWorkDiagnostics, type OrbitPathStyle } from "./orbit-renderer.js";
import { SelectionIndicator, type SelectionIndicatorOptions } from "./selection.js";
import { applyTexturedBodyPoleAlignment } from "./texture-orientation.js";
import { normalizeAtmosphereOpticsForTransport } from "./presentation/atmosphere-math.js";

const MAX_LIGHTS = 4;
const ATMOSPHERE_PHYSICAL_EXTENT_SCALE_HEIGHTS = 4;
const ATMOSPHERE_RIM_THICKNESS_PIXELS = 4;
const ATMOSPHERE_MAX_RIM_FRACTION = 0.08;
// Presentation gains stay shared across every body. Semantic optics determine
// body-specific color/strength; the renderer must not contain planet-specific
// gain branches or a different photometric scale for cloud-deck planets.
const ATMOSPHERE_SCATTERING_DISPLAY_GAIN = 3.5;
const ATMOSPHERE_SURFACE_COMPOSITE_DISPLAY_GAIN = 0.55;
const SURFACE_RADIANCE_DISPLAY_GAIN = 2.0;
const ATMOSPHERE_VIEW_SAMPLES = 8;
const ATMOSPHERE_LIGHT_SAMPLES = 2;
const SURFACE_VERTEX_SHADER = `
varying vec3 vWorldNormal;
varying vec2 vUv;
void main() {
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SURFACE_FRAGMENT_SHADER = `
uniform vec3 uBaseColor;
uniform vec3 uEmissionColor;
uniform float uEmissionStrength;
uniform float uInspectionFill;
uniform float uSurfaceRadianceDisplayGain;
uniform bool uUseTexture;
uniform sampler2D uSurfaceMap;
uniform int uLightCount;
uniform vec3 uLightDirections[${MAX_LIGHTS}];
uniform vec3 uLightColors[${MAX_LIGHTS}];
uniform float uLightIntensity[${MAX_LIGHTS}];
varying vec3 vWorldNormal;
varying vec2 vUv;
const vec3 LINEAR_LUMINANCE = vec3(0.2126, 0.7152, 0.0722);
void main() {
  vec3 base = uBaseColor;
  if (uUseTexture) {
    vec3 textureColor = texture2D(uSurfaceMap, vUv).rgb;
    float textureLuminance = max(dot(textureColor, LINEAR_LUMINANCE), 0.0001);
    float semanticLuminance = max(dot(uBaseColor, LINEAR_LUMINANCE), 0.0001);
    // Source texture exposure is asset-dependent and must not become the
    // body's absolute reflectance. Preserve bounded chroma/detail while the
    // semantic appearance contract owns disk luminance.
    vec3 textureChroma = clamp(textureColor / textureLuminance, vec3(0.35), vec3(2.85));
    float textureDetail = mix(0.72, 1.28, smoothstep(0.03, 0.85, textureLuminance));
    base = textureChroma * semanticLuminance * textureDetail;
  }
  vec3 incident = vec3(0.0);
  vec3 normal = normalize(vWorldNormal);
  for (int index = 0; index < ${MAX_LIGHTS}; index += 1) {
    if (index >= uLightCount) break;
    incident += uLightColors[index] * uLightIntensity[index]
      * max(dot(normal, normalize(uLightDirections[index])), 0.0);
  }
  // Enhanced inspection light is an emissive presentation assist. Keep it
  // independent of a dark planet texture so a low-albedo map cannot cancel
  // the bounded readability contribution.
  vec3 radiance = (base * incident + vec3(uInspectionFill)) * uSurfaceRadianceDisplayGain;
  gl_FragColor = vec4(radiance + uEmissionColor * uEmissionStrength, 1.0);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`;

const ATMOSPHERE_VERTEX_SHADER = `
varying vec3 vWorldPosition;
void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPosition.xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const ATMOSPHERE_FRAGMENT_SHADER = `
uniform vec3 uBodyCenter;
uniform vec3 uCameraPosition;
uniform float uBodyRadius;
uniform float uShellRadius;
uniform float uPhysicalExtentScaleHeights;
uniform vec3 uRayleighScattering;
uniform vec3 uMieScattering;
uniform vec3 uAbsorption;
uniform float uReferenceVerticalOpticalDepth;
uniform float uMieAnisotropy;
uniform int uLightCount;
uniform vec3 uLightDirections[${MAX_LIGHTS}];
uniform vec3 uLightColors[${MAX_LIGHTS}];
uniform float uLightIntensity[${MAX_LIGHTS}];
varying vec3 vWorldPosition;
const int VIEW_SAMPLES = ${ATMOSPHERE_VIEW_SAMPLES};
const int LIGHT_SAMPLES = ${ATMOSPHERE_LIGHT_SAMPLES};
const float PI = 3.14159265359;
const float EPSILON = 0.000001;
const float DISPLAY_GAIN = ${ATMOSPHERE_SCATTERING_DISPLAY_GAIN.toFixed(2)};
const float LIMB_DISPLAY_GAIN = 1.7;

float rayleighPhase(float cosine) {
  return 3.0 * (1.0 + cosine * cosine) / (16.0 * PI);
}

float miePhase(float cosine, float anisotropy) {
  float g2 = anisotropy * anisotropy;
  float denominator = max(0.0001, pow(1.0 + g2 - 2.0 * anisotropy * cosine, 1.5));
  return (1.0 - g2) / (4.0 * PI * denominator);
}

vec2 raySphereInterval(vec3 rayOrigin, vec3 rayDirection, float sphereRadius) {
  vec3 offset = rayOrigin - uBodyCenter;
  float b = dot(offset, rayDirection);
  float c = dot(offset, offset) - sphereRadius * sphereRadius;
  float discriminant = b * b - c;
  if (discriminant < 0.0) return vec2(1.0, -1.0);
  float root = sqrt(discriminant);
  return vec2(-b - root, -b + root);
}

float atmosphereDensity(vec3 position) {
  float presentationThickness = max(uShellRadius - uBodyRadius, EPSILON);
  float radialDistance = length(position - uBodyCenter);
  float altitudeFraction = clamp((radialDistance - uBodyRadius) / presentationThickness, 0.0, 1.0);
  return exp(-altitudeFraction * uPhysicalExtentScaleHeights);
}

float normalizedVerticalDensityIntegral() {
  return max(1.0 - exp(-uPhysicalExtentScaleHeights), EPSILON);
}

vec3 integrateLightTransmittance(vec3 samplePosition, vec3 lightDirection) {
  vec2 lightInterval = raySphereInterval(samplePosition, lightDirection, uShellRadius);
  float lightStart = max(0.0, lightInterval.x);
  float lightEnd = lightInterval.y;
  if (lightEnd <= lightStart) return vec3(0.0);

  // A direct stellar ray that enters the opaque body cannot illuminate this
  // sample. The body intersection is analytic; only the bounded atmosphere
  // segment is sampled below.
  vec2 bodyInterval = raySphereInterval(samplePosition, lightDirection, uBodyRadius);
  if (bodyInterval.y >= bodyInterval.x && bodyInterval.x >= 0.0 && bodyInterval.x < lightEnd) {
    return vec3(0.0);
  }

  float lightSegmentLength = lightEnd - lightStart;
  float presentationThickness = max(uShellRadius - uBodyRadius, EPSILON);
  float lightSampleLengthScaleHeights = lightSegmentLength / presentationThickness * uPhysicalExtentScaleHeights;
  float integratedLightDensityScaleHeights = 0.0;
  for (int lightSampleIndex = 0; lightSampleIndex < LIGHT_SAMPLES; lightSampleIndex++) {
    float sampleFraction = (float(lightSampleIndex) + 0.5) / float(LIGHT_SAMPLES);
    vec3 lightSamplePosition = samplePosition + lightDirection * (lightStart + lightSegmentLength * sampleFraction);
    integratedLightDensityScaleHeights += atmosphereDensity(lightSamplePosition) * lightSampleLengthScaleHeights;
  }

  vec3 extinction = uRayleighScattering + uMieScattering + uAbsorption;
  vec3 lightOpticalDepth = extinction * uReferenceVerticalOpticalDepth
    * integratedLightDensityScaleHeights / normalizedVerticalDensityIntegral();
  return exp(-lightOpticalDepth);
}

void main() {
  // Three supplies cameraPosition in world space for ShaderMaterial. Using
  // the renderer-owned value keeps camera fixtures and shell sampling in the
  // same space even when the view is nested below a consumer scene root.
  vec3 rayOrigin = cameraPosition;
  vec3 rayDirection = normalize(vWorldPosition - rayOrigin);
  vec2 atmosphereInterval = raySphereInterval(rayOrigin, rayDirection, uShellRadius);
  float segmentStart = max(0.0, atmosphereInterval.x);
  float segmentEnd = atmosphereInterval.y;
  if (segmentEnd <= segmentStart) discard;

  vec2 bodyInterval = raySphereInterval(rayOrigin, rayDirection, uBodyRadius);
  bool bodyIntersectsView = false;
  if (bodyInterval.y >= bodyInterval.x && bodyInterval.x > segmentStart) {
    // The opaque surface truncates the view path, but the integrated
    // front-side atmosphere still has to be composited over that surface.
    segmentEnd = min(segmentEnd, bodyInterval.x);
    bodyIntersectsView = true;
  }
  if (segmentEnd <= segmentStart) discard;

  float presentationThickness = max(uShellRadius - uBodyRadius, EPSILON);
  float segmentLength = segmentEnd - segmentStart;
  float sampleLength = segmentLength / float(VIEW_SAMPLES);
  float sampleLengthScaleHeights = sampleLength / presentationThickness * uPhysicalExtentScaleHeights;
  float verticalIntegral = normalizedVerticalDensityIntegral();
  float integratedDensityScaleHeights = 0.0;
  vec3 integratedScattering = vec3(0.0);
  vec3 viewDirection = -rayDirection;
  vec3 extinction = uRayleighScattering + uMieScattering + uAbsorption;

  for (int sampleIndex = 0; sampleIndex < VIEW_SAMPLES; sampleIndex++) {
    float sampleFraction = (float(sampleIndex) + 0.5) / float(VIEW_SAMPLES);
    float distanceAlongRay = segmentStart + segmentLength * sampleFraction;
    vec3 samplePosition = rayOrigin + rayDirection * distanceAlongRay;
    vec3 fromCenter = samplePosition - uBodyCenter;
    float radialDistance = length(fromCenter);
    float altitudeFraction = clamp((radialDistance - uBodyRadius) / presentationThickness, 0.0, 1.0);
    float altitudeScaleHeights = altitudeFraction * uPhysicalExtentScaleHeights;
    float density = exp(-altitudeScaleHeights);
    float sampleColumn = density * sampleLengthScaleHeights;
    integratedDensityScaleHeights += sampleColumn;
    float viewOpticalDepthAtSample = uReferenceVerticalOpticalDepth
      * (integratedDensityScaleHeights - sampleColumn * 0.5) / verticalIntegral;
    vec3 viewTransmittance = exp(-extinction * viewOpticalDepthAtSample);
    // The calibrated reference optical depth belongs to the view/light
    // transmittance and compositing alpha. It must not also scale this source
    // column or optically thin brightness becomes proportional to it twice.
    vec3 viewScatteringWeight = vec3(sampleColumn / verticalIntegral);

    for (int lightIndex = 0; lightIndex < ${MAX_LIGHTS}; lightIndex++) {
      if (lightIndex >= uLightCount) break;
      vec3 lightDirection = normalize(uLightDirections[lightIndex]);
      vec3 lightTransmittance = integrateLightTransmittance(samplePosition, lightDirection);
      // uLightDirections points from the sample toward the emitter, while the
      // scattering phase uses the incoming photon direction. The photon travels
      // from the emitter to the sample, so the direction must be negated here.
      float phaseCosine = dot(viewDirection, -lightDirection);
      vec3 scatteringSource = uRayleighScattering * rayleighPhase(phaseCosine)
        + uMieScattering * miePhase(phaseCosine, uMieAnisotropy);
      integratedScattering += scatteringSource
        * uLightColors[lightIndex]
        * uLightIntensity[lightIndex]
        * lightTransmittance
        * viewTransmittance
        * viewScatteringWeight;
    }
  }

  float densityPath = integratedDensityScaleHeights / verticalIntegral;
  float viewOpticalDepth = uReferenceVerticalOpticalDepth * densityPath;
  // A body hit only limits the integrated path to the front shell. Its
  // atmosphere remains visible over the already-rendered opaque surface.
  float alpha = clamp(1.0 - exp(-viewOpticalDepth), 0.0, 0.94);
  float limbGain = mix(1.0, LIMB_DISPLAY_GAIN, smoothstep(1.0, 4.0, densityPath));
  // Keep the physically integrated limb bright enough to bloom, while the
  // front-side contribution over an opaque surface stays bounded.
  float displayGain = bodyIntersectsView ? ${ATMOSPHERE_SURFACE_COMPOSITE_DISPLAY_GAIN.toFixed(2)} : DISPLAY_GAIN;
  vec3 radiance = integratedScattering * displayGain * limbGain;
  gl_FragColor = vec4(radiance * alpha, alpha);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`;

export interface SurfaceTextureResource {
  readonly texture: THREE.Texture;
  readonly ownership?: "caller" | "package";
}

export type SurfaceTextureProvider = (body: CelestialBodyRenderState) => SurfaceTextureResource | undefined;

export interface CelestialSystemViewConfiguration {
  readonly renderSpace?: Partial<RenderSpaceConfig>;
  readonly fallbackAccentColor?: number;
  readonly maxStellarContributors?: number;
  readonly radiusMode?: RadiusMode;
  readonly adaptiveSizing?: Partial<AdaptiveSizingConfiguration>;
  readonly representationPolicy?: RepresentationPolicy | Partial<RepresentationPolicyConfiguration>;
  readonly markerLayer?: BatchedMarkerLayerOptions;
  readonly orbitPaths?: OrbitPathRendererOptions;
  readonly selectionIndicator?: SelectionIndicatorOptions;
}

export interface CelestialSystemViewContext {
  readonly cameraPositionSceneUnits?: RenderVector3;
  readonly camera?: THREE.Camera;
  readonly viewportWidthCssPixels?: number;
  readonly viewportHeightCssPixels?: number;
  readonly selectedObjectIds?: ReadonlySet<ObjectId>;
  readonly selectedObjectId?: ObjectId;
  readonly focusedObjectId?: ObjectId;
  readonly contextPriorityObjectIds?: ReadonlySet<ObjectId>;
  readonly radiusMode?: RadiusMode;
  readonly orbitVisible?: boolean;
  readonly orbitStyle?: OrbitPathStyle;
  readonly orbitStyleByObjectId?: ReadonlyMap<ObjectId, OrbitPathStyle>;
  readonly lightingMode?: LightingMode;
}

export interface CelestialSystemViewOptions {
  readonly configuration?: CelestialSystemViewConfiguration;
  readonly surfaceTextureProvider?: SurfaceTextureProvider;
}

export interface VisualFailure {
  readonly code: "invalidSnapshot" | "resourceAllocation" | "disposed";
  readonly message: string;
  readonly objectId?: ObjectId;
  readonly snapshotFingerprint?: string;
}

export interface CelestialSystemViewDiagnostics {
  readonly disposed: boolean;
  readonly bodyCount: number;
  readonly sphereCount: number;
  readonly markerCount: number;
  readonly hiddenCount: number;
  readonly atmosphereCount: number;
  readonly packageOwnedResourceCount: number;
  readonly committedSnapshotFingerprint?: string;
  readonly orbitWork?: OrbitPathRendererWorkDiagnostics;
  readonly lastFailure?: VisualFailure;
}

export interface CelestialSystemViewUpdateResult {
  readonly committed: boolean;
  readonly snapshotFingerprint?: string;
  readonly diagnostics: CelestialSystemViewDiagnostics;
}

export interface CelestialPickResult {
  readonly objectId: ObjectId;
  readonly representation: BodyRepresentation | "orbit";
  readonly distance?: number;
  readonly screenDistancePixels?: number;
}

interface BodyResources {
  readonly objectId: ObjectId;
  readonly anchor: THREE.Group;
  readonly representation: BodyRepresentation;
  readonly hasAtmosphere: boolean;
  readonly hasStellarEmission: boolean;
  readonly surface?: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  readonly emission?: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  readonly atmosphere?: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  readonly surfaceTexture?: SurfaceTextureResource;
}

interface PreparedUpdate {
  readonly snapshot: CelestialRenderSnapshot;
  readonly bodies: Map<ObjectId, BodyResources>;
  readonly created: readonly BodyResources[];
  readonly illuminations: ReadonlyMap<ObjectId, StellarIllumination>;
  readonly decisions: ReadonlyMap<ObjectId, RepresentationDecision>;
  readonly markerEntries: readonly MarkerRenderEntry[];
}

function finite(name: string, value: number): void {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
}

function sceneRadius(body: CelestialBodyRenderState, renderSpace: RenderSpaceConfig): number {
  const radius = body.physicalRadiusMeters;
  if (radius === undefined || radius <= 0) throw new RangeError(`body ${body.objectId} requires a positive physical radius for sphere resources`);
  return radius / renderSpace.metersPerSceneUnit;
}

function cameraProjectionMetrics(position: RenderVector3, camera: THREE.Camera, viewportWidthCssPixels: number, viewportHeightCssPixels: number, physicalRadiusSceneUnits = 0): BodyProjectionMetrics {
  if (!Number.isFinite(viewportWidthCssPixels) || viewportWidthCssPixels <= 0 || !Number.isFinite(viewportHeightCssPixels) || viewportHeightCssPixels <= 0) {
    throw new RangeError("presentation viewport must be finite and positive");
  }
  camera.updateMatrixWorld(true);
  const worldPosition = new THREE.Vector3(position.x, position.y, position.z);
  const cameraWorldPosition = camera.getWorldPosition(new THREE.Vector3());
  const cameraSpace = worldPosition.clone().applyMatrix4(camera.matrixWorldInverse);
  const perspective = camera instanceof THREE.PerspectiveCamera;
  const insideBody = physicalRadiusSceneUnits > 0 && cameraWorldPosition.distanceTo(worldPosition) <= physicalRadiusSceneUnits;
  const distance = cameraWorldPosition.distanceTo(worldPosition);
  const cameraDepth = perspective ? (insideBody ? physicalRadiusSceneUnits : -cameraSpace.z) : 1;
  // Physical marker sizing remains useful for bodies behind the camera, but
  // keeps the true view-space depth whenever the body is in front of it.
  const depth = perspective
    ? Math.max(insideBody || cameraDepth <= 0 ? (insideBody ? physicalRadiusSceneUnits : distance) : cameraDepth, Number.EPSILON)
    : 1;
  const projectionScaleY = Math.abs(camera.projectionMatrix.elements[5] ?? 0);
  const verticalFieldOfViewRadians = perspective
    ? THREE.MathUtils.degToRad(camera.fov)
    : projectionScaleY > 0 ? 2 * Math.atan(1 / projectionScaleY) : 1;
  const ndc = worldPosition.clone().project(camera);
  const projectable = insideBody || (Number.isFinite(depth) && depth > 0
    && Number.isFinite(ndc.x) && Number.isFinite(ndc.y) && Number.isFinite(ndc.z));
  const centerScreenPixels = insideBody
    ? { x: viewportWidthCssPixels / 2, y: viewportHeightCssPixels / 2 }
    : { x: (ndc.x * 0.5 + 0.5) * viewportWidthCssPixels, y: (-ndc.y * 0.5 + 0.5) * viewportHeightCssPixels };
  return Object.freeze({
    projectable,
    cameraDepthSceneUnits: depth,
    verticalFieldOfViewRadians,
    viewportHeightCssPixels,
    centerScreenPixels: Object.freeze(centerScreenPixels),
  });
}

function relatedBodies(left: CelestialBodyRenderState, right: CelestialBodyRenderState): boolean {
  return left.parentId === right.parentId
    || left.parentId === right.objectId
    || right.parentId === left.objectId;
}

function nearestSeparations(
  bodies: readonly CelestialBodyRenderState[],
  projections: ReadonlyMap<ObjectId, BodyProjectionMetrics>,
): ReadonlyMap<ObjectId, number> {
  const entries = bodies
    .map((body) => ({ body, projection: projections.get(body.objectId) }))
    .filter((entry): entry is { body: CelestialBodyRenderState; projection: BodyProjectionMetrics } => entry.projection?.projectable === true && entry.projection.centerScreenPixels !== undefined)
    .sort((left, right) => {
      const leftId = BigInt(left.body.objectId);
      const rightId = BigInt(right.body.objectId);
      return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
    });
  const cellSize = 32;
  const buckets = new Map<string, typeof entries>();
  const keyFor = (point: { readonly x: number; readonly y: number }): string => `${Math.floor(point.x / cellSize)},${Math.floor(point.y / cellSize)}`;
  entries.forEach((entry) => {
    const key = keyFor(entry.projection.centerScreenPixels!);
    const bucket = buckets.get(key);
    if (bucket === undefined) buckets.set(key, [entry]);
    else bucket.push(entry);
  });
  const denseBuckets = new Set([...buckets.entries()].filter(([, bucket]) => bucket.length > 64).map(([key]) => key));
  const result = new Map<ObjectId, number>();
  entries.forEach((entry) => {
    const point = entry.projection.centerScreenPixels!;
    const cellX = Math.floor(point.x / cellSize);
    const cellY = Math.floor(point.y / cellSize);
    let nearest = Number.POSITIVE_INFINITY;
    let dense = false;
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        const key = `${cellX + offsetX},${cellY + offsetY}`;
        if (denseBuckets.has(key)) {
          dense = true;
          continue;
        }
        for (const candidate of buckets.get(key) ?? []) {
          if (candidate.body.objectId === entry.body.objectId || !relatedBodies(entry.body, candidate.body)) continue;
          const candidatePoint = candidate.projection.centerScreenPixels!;
          nearest = Math.min(nearest, Math.hypot(point.x - candidatePoint.x, point.y - candidatePoint.y));
        }
      }
    }
    if (dense) result.set(entry.body.objectId, 0);
    else if (nearest !== Number.POSITIVE_INFINITY) result.set(entry.body.objectId, nearest);
  });
  return result;
}

function setLightUniforms(material: THREE.ShaderMaterial, illumination: StellarIllumination, renderSpace: RenderSpaceConfig): void {
  const directions = material.uniforms.uLightDirections!.value as THREE.Vector3[];
  const colors = material.uniforms.uLightColors!.value as THREE.Color[];
  const intensities = material.uniforms.uLightIntensity!.value as number[];
  material.uniforms.uLightCount!.value = illumination.contributions.length;
  for (let index = 0; index < MAX_LIGHTS; index += 1) {
    const contribution = illumination.contributions[index];
    if (contribution === undefined) {
      directions[index]!.set(0, 1, 0);
      colors[index]!.setRGB(0, 0, 0);
      intensities[index] = 0;
      continue;
    }
    const direction = transformSnapshotDirectionToRenderSpace(contribution.directionToEmitter, renderSpace);
    directions[index]!.set(direction.x, direction.y, direction.z);
    colors[index]!.setRGB(contribution.linearChromaticity.r, contribution.linearChromaticity.g, contribution.linearChromaticity.b);
    intensities[index] = contribution.exposureMappedIrradiance;
  }
}

function createLightUniforms(): Record<string, THREE.IUniform> {
  return {
    uLightCount: { value: 0 },
    uLightDirections: { value: Array.from({ length: MAX_LIGHTS }, () => new THREE.Vector3(0, 1, 0)) },
    uLightColors: { value: Array.from({ length: MAX_LIGHTS }, () => new THREE.Color(0, 0, 0)) },
    uLightIntensity: { value: Array.from({ length: MAX_LIGHTS }, () => 0) },
  };
}

function createSurfaceMaterial(body: CelestialBodyRenderState, texture: SurfaceTextureResource | undefined): THREE.ShaderMaterial {
  const isEmitter = body.appearance?.stellarEmission !== undefined;
  const emission = isEmitter ? blackbodyTemperatureToLinearRgb(body.appearance!.stellarEmission!.effectiveTemperatureKelvin) : { r: 0, g: 0, b: 0 };
  const reflectance = isEmitter
    ? emission
    : deriveSurfaceReflectance(body.appearance, body.accentColor ?? 0x808080).linearReflectance;
  const uniforms = createLightUniforms();
  return new THREE.ShaderMaterial({
    uniforms: {
      ...uniforms,
      uBaseColor: { value: new THREE.Color(reflectance.r, reflectance.g, reflectance.b) },
      uEmissionColor: { value: new THREE.Color(emission.r, emission.g, emission.b) },
      uEmissionStrength: { value: isEmitter ? 1 : 0 },
      uInspectionFill: { value: 0 },
      uSurfaceRadianceDisplayGain: { value: SURFACE_RADIANCE_DISPLAY_GAIN },
      uUseTexture: { value: texture !== undefined },
      uSurfaceMap: { value: texture?.texture ?? null },
    },
    vertexShader: SURFACE_VERTEX_SHADER,
    fragmentShader: SURFACE_FRAGMENT_SHADER,
    lights: false,
    transparent: false,
    toneMapped: true,
  });
}

function updateSurfaceMaterialAppearance(material: THREE.ShaderMaterial, body: CelestialBodyRenderState, emissionGlow = false): void {
  const isEmitter = body.appearance?.stellarEmission !== undefined;
  const emission = isEmitter ? blackbodyTemperatureToLinearRgb(body.appearance!.stellarEmission!.effectiveTemperatureKelvin) : { r: 0, g: 0, b: 0 };
  const reflectance = isEmitter
    ? emission
    : deriveSurfaceReflectance(body.appearance, body.accentColor ?? 0x808080).linearReflectance;
  const baseColor = material.uniforms.uBaseColor!.value as THREE.Color;
  const emissionColor = material.uniforms.uEmissionColor!.value as THREE.Color;
  baseColor.setRGB(emissionGlow ? 0 : reflectance.r, emissionGlow ? 0 : reflectance.g, emissionGlow ? 0 : reflectance.b);
  emissionColor.setRGB(emission.r, emission.g, emission.b);
  material.uniforms.uEmissionStrength!.value = emissionGlow ? 0.22 : isEmitter ? 1 : 0;
}

function atmosphereShellRadius(
  body: CelestialBodyRenderState,
  renderSpace: RenderSpaceConfig,
  presentedRadius = sceneRadius(body, renderSpace),
  projectedRadiusPixels = 0,
): number {
  const radius = presentedRadius;
  const scaleHeight = body.appearance?.atmosphere?.scaleHeightMeters ?? 0;
  const physicalRadius = sceneRadius(body, renderSpace);
  const physicalThickness = radius * (scaleHeight * ATMOSPHERE_PHYSICAL_EXTENT_SCALE_HEIGHTS / renderSpace.metersPerSceneUnit) / physicalRadius;
  if (projectedRadiusPixels > 0 && radius > 0) {
    const pixelsPerSceneUnit = projectedRadiusPixels / radius;
    const minimumReadableThickness = ATMOSPHERE_RIM_THICKNESS_PIXELS / Math.max(pixelsPerSceneUnit, Number.EPSILON);
    const maximumPresentationThickness = radius * ATMOSPHERE_MAX_RIM_FRACTION;
    return radius + Math.min(
      maximumPresentationThickness,
      Math.max(physicalThickness, minimumReadableThickness),
    );
  }
  return radius + Math.max(physicalThickness, radius * 0.01);
}

function createAtmosphereMaterial(
  optics: AtmosphereOptics,
  bodyRadiusSceneUnits: number,
  shellRadiusSceneUnits: number,
  bodyCenter: RenderVector3,
  cameraPosition: RenderVector3,
): THREE.ShaderMaterial {
  const uniforms = createLightUniforms();
  const transport = normalizeAtmosphereOpticsForTransport(optics);
  return new THREE.ShaderMaterial({
    uniforms: {
      ...uniforms,
      uBodyCenter: { value: new THREE.Vector3(bodyCenter.x, bodyCenter.y, bodyCenter.z) },
      uCameraPosition: { value: new THREE.Vector3(cameraPosition.x, cameraPosition.y, cameraPosition.z) },
      uBodyRadius: { value: bodyRadiusSceneUnits },
      uShellRadius: { value: shellRadiusSceneUnits },
      uPhysicalExtentScaleHeights: { value: 4 },
      uRayleighScattering: { value: new THREE.Vector3(transport.rayleighScattering.r, transport.rayleighScattering.g, transport.rayleighScattering.b) },
      uMieScattering: { value: new THREE.Vector3(transport.mieScattering.r, transport.mieScattering.g, transport.mieScattering.b) },
      uAbsorption: { value: new THREE.Vector3(transport.absorption.r, transport.absorption.g, transport.absorption.b) },
      uReferenceVerticalOpticalDepth: { value: optics.referenceVerticalOpticalDepth },
      uMieAnisotropy: { value: optics.mieAnisotropy },
    },
    vertexShader: ATMOSPHERE_VERTEX_SHADER,
    fragmentShader: ATMOSPHERE_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
    // Scattering is an emitted radiance contribution. Additive compositing
    // keeps a dark front-side shell from attenuating an already-lit surface
    // (especially the bounded Enhanced inspection fill).
    blending: THREE.AdditiveBlending,
    lights: false,
    toneMapped: true,
    premultipliedAlpha: true,
  });
}

function isSameResourceShape(
  resource: BodyResources | undefined,
  body: CelestialBodyRenderState,
  surfaceTexture: SurfaceTextureResource | undefined,
  representation: BodyRepresentation,
): boolean {
  return resource !== undefined
    && resource.representation === representation
    && resource.hasAtmosphere === (representation === "sphere" && resolveAtmosphereOptics(body.appearance) !== undefined)
    && resource.hasStellarEmission === (body.appearance?.stellarEmission !== undefined)
    && resource.surfaceTexture?.texture === surfaceTexture?.texture;
}

function disposeMaterial(material: THREE.Material): void {
  material.dispose();
}

function disposeBodyResources(resources: BodyResources, preservedTextures: ReadonlySet<THREE.Texture> = new Set(), disposedTextures: Set<THREE.Texture> = new Set()): void {
  resources.anchor.removeFromParent();
  if (resources.surface !== undefined) {
    resources.surface.geometry.dispose();
    disposeMaterial(resources.surface.material);
  }
  if (resources.emission !== undefined) {
    resources.emission.geometry.dispose();
    disposeMaterial(resources.emission.material);
  }
  if (resources.atmosphere !== undefined) {
    resources.atmosphere.geometry.dispose();
    disposeMaterial(resources.atmosphere.material);
  }
  if (resources.surfaceTexture?.ownership === "package" && !preservedTextures.has(resources.surfaceTexture.texture) && !disposedTextures.has(resources.surfaceTexture.texture)) {
    resources.surfaceTexture.texture.dispose();
    disposedTextures.add(resources.surfaceTexture.texture);
  }
}

function emitterForBody(body: CelestialBodyRenderState): StellarEmitter | undefined {
  const emission = body.appearance?.stellarEmission;
  if (emission === undefined) return undefined;
  return {
    objectId: body.objectId,
    position: body.positionRelativeToOriginMeters,
    effectiveTemperatureKelvin: emission.effectiveTemperatureKelvin,
    luminosityWatts: emission.luminosityWatts,
  };
}

export class CelestialSystemView {
  readonly #root = new THREE.Group();
  readonly #renderSpace: RenderSpaceConfig;
  readonly #fallbackAccentColor: number;
  readonly #maxStellarContributors: number;
  readonly #radiusMode: RadiusMode;
  readonly #adaptiveSizing: AdaptiveSizingConfiguration;
  readonly #representationPolicy: RepresentationPolicy;
  readonly #markerLayerOptions: BatchedMarkerLayerOptions;
  readonly #orbitRendererOptions?: OrbitPathRendererOptions;
  readonly #selectionIndicatorOptions?: SelectionIndicatorOptions;
  readonly #surfaceTextureProvider?: SurfaceTextureProvider;
  readonly #resources = new Map<ObjectId, BodyResources>();
  readonly #representations = new Map<ObjectId, BodyRepresentation>();
  #markerLayer?: BatchedMarkerLayer;
  #orbitRenderer?: OrbitPathRenderer;
  #selectionIndicator?: SelectionIndicator;
  #lastSnapshot?: CelestialRenderSnapshot;
  #lastFailure?: VisualFailure;
  #disposed = false;

  constructor(options: CelestialSystemViewOptions = {}) {
    this.#renderSpace = createRenderSpaceConfig(options.configuration?.renderSpace);
    this.#fallbackAccentColor = options.configuration?.fallbackAccentColor ?? 0x808080;
    this.#maxStellarContributors = options.configuration?.maxStellarContributors ?? 4;
    if (!Number.isSafeInteger(this.#maxStellarContributors) || this.#maxStellarContributors < 1) throw new RangeError("maxStellarContributors must be a positive safe integer");
    if (options.configuration?.fallbackAccentColor !== undefined && (!Number.isSafeInteger(options.configuration.fallbackAccentColor) || options.configuration.fallbackAccentColor < 0 || options.configuration.fallbackAccentColor > 0xffffff)) throw new RangeError("fallbackAccentColor must be a 24-bit integer");
    this.#radiusMode = options.configuration?.radiusMode ?? "adaptive";
    this.#adaptiveSizing = createAdaptiveSizingConfiguration(options.configuration?.adaptiveSizing);
    this.#representationPolicy = options.configuration?.representationPolicy === undefined
      ? createRepresentationPolicy()
      : "resolve" in options.configuration.representationPolicy
        ? options.configuration.representationPolicy
        : createRepresentationPolicy(options.configuration.representationPolicy);
    this.#markerLayerOptions = Object.freeze({ ...(options.configuration?.markerLayer ?? {}) });
    this.#orbitRendererOptions = options.configuration?.orbitPaths === undefined
      ? undefined
      : Object.freeze({ ...options.configuration.orbitPaths, renderSpace: this.#renderSpace });
    this.#selectionIndicatorOptions = options.configuration?.selectionIndicator === undefined
      ? undefined
      : Object.freeze({ ...options.configuration.selectionIndicator });
    this.#surfaceTextureProvider = options.surfaceTextureProvider;
    this.#root.name = "orbit-engine-three celestial system root";
  }

  get root(): THREE.Group {
    return this.#root;
  }

  get renderSpace(): RenderSpaceConfig {
    return this.#renderSpace;
  }

  bodyAnchor(objectId: ObjectId): THREE.Group | undefined {
    return this.#resources.get(objectId)?.anchor;
  }

  representationFor(objectId: ObjectId): BodyRepresentation | undefined {
    return this.#representations.get(objectId);
  }

  pick(normalizedDeviceX: number, normalizedDeviceY: number, camera: THREE.Camera, viewportWidthCssPixels?: number, viewportHeightCssPixels?: number): CelestialPickResult | undefined {
    if (this.#disposed) return undefined;
    this.#root.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(normalizedDeviceX, normalizedDeviceY), camera);
    const sphereMeshes = [...this.#resources.values()]
      .map((resource) => resource.surface)
      .filter((surface): surface is NonNullable<BodyResources["surface"]> => surface !== undefined && surface.visible);
    const sphereHit = raycaster.intersectObjects(sphereMeshes, false)[0];
    const sphereResult = sphereHit === undefined ? undefined : {
      objectId: sphereHit.object.userData.objectId as ObjectId,
      representation: "sphere" as const,
      distance: sphereHit.distance,
    };
    let best: CelestialPickResult | undefined = sphereResult;
    const markerHit = this.#markerLayer?.pick(normalizedDeviceX, normalizedDeviceY, camera, viewportWidthCssPixels, viewportHeightCssPixels);
    if (markerHit !== undefined) {
      const markerPosition = this.#markerLayer!.worldPositionFor(markerHit.objectId);
      if (markerPosition !== undefined) {
        const markerDistance = camera.getWorldPosition(new THREE.Vector3()).distanceTo(markerPosition);
        if (best === undefined || markerDistance < (best.distance ?? Number.POSITIVE_INFINITY) + 1e-7) {
          best = Object.freeze({ objectId: markerHit.objectId, representation: "marker", distance: markerDistance, screenDistancePixels: markerHit.screenDistancePixels });
        }
      }
    }
    const orbitHit = this.#orbitRenderer?.pick(normalizedDeviceX, normalizedDeviceY, camera, viewportHeightCssPixels);
    if (orbitHit !== undefined && (best === undefined || orbitHit.distance < (best.distance ?? Number.POSITIVE_INFINITY))) best = orbitHit;
    return best;
  }

  diagnostics(): CelestialSystemViewDiagnostics {
    let sphereCount = 0;
    let markerCount = 0;
    let hiddenCount = 0;
    let atmosphereCount = 0;
    let packageOwnedResourceCount = 0;
    for (const resource of this.#resources.values()) {
      if (resource.surface !== undefined) sphereCount += 1;
      if (resource.representation === "marker") markerCount += 1;
      if (resource.representation === "hidden") hiddenCount += 1;
      if (resource.atmosphere !== undefined) atmosphereCount += 1;
      packageOwnedResourceCount += 1 + (resource.surface !== undefined ? 2 : 0) + (resource.emission !== undefined ? 2 : 0) + (resource.atmosphere !== undefined ? 2 : 0);
      if (resource.surfaceTexture?.ownership === "package") packageOwnedResourceCount += 1;
    }
    if (this.#markerLayer !== undefined) packageOwnedResourceCount += 3;
    if (this.#orbitRenderer !== undefined) packageOwnedResourceCount += 3 * this.#orbitRenderer.pathCount();
    if (this.#selectionIndicator !== undefined) packageOwnedResourceCount += 2;
    return Object.freeze({
      disposed: this.#disposed,
      bodyCount: this.#resources.size,
      sphereCount,
      markerCount,
      hiddenCount,
      atmosphereCount,
      packageOwnedResourceCount,
      ...(this.#lastSnapshot === undefined ? {} : { committedSnapshotFingerprint: this.#lastSnapshot.fingerprint }),
      ...(this.#orbitRenderer === undefined ? {} : { orbitWork: this.#orbitRenderer.workDiagnostics() }),
      ...(this.#lastFailure === undefined ? {} : { lastFailure: this.#lastFailure }),
    });
  }

  update(snapshotInput: CelestialRenderSnapshot, context: CelestialSystemViewContext = {}): CelestialSystemViewUpdateResult {
    if (this.#disposed) {
      this.#lastFailure = Object.freeze({ code: "disposed", message: "view has already been disposed" });
      return Object.freeze({ committed: false, diagnostics: this.diagnostics() });
    }
    let snapshot: CelestialRenderSnapshot;
    try {
      snapshot = snapshotInput === this.#lastSnapshot
        ? snapshotInput
        : createCelestialRenderSnapshot(snapshotInput);
      if (context.cameraPositionSceneUnits !== undefined) {
        finite("cameraPositionSceneUnits.x", context.cameraPositionSceneUnits.x);
        finite("cameraPositionSceneUnits.y", context.cameraPositionSceneUnits.y);
        finite("cameraPositionSceneUnits.z", context.cameraPositionSceneUnits.z);
      }
      const presentation = this.#resolvePresentation(snapshot, context);
      const prepared = this.#prepare(presentation.snapshot, presentation.decisions);
      this.#commit(prepared, context);
      this.#lastFailure = undefined;
      return Object.freeze({ committed: true, snapshotFingerprint: presentation.snapshot.fingerprint, diagnostics: this.diagnostics() });
    } catch (error) {
      const failure = Object.freeze({
        code: snapshotInput?.fingerprint === undefined ? "invalidSnapshot" : "resourceAllocation",
        message: error instanceof Error ? error.message : String(error),
        ...(snapshotInput?.fingerprint === undefined ? {} : { snapshotFingerprint: snapshotInput.fingerprint }),
      }) as VisualFailure;
      this.#lastFailure = failure;
      return Object.freeze({ committed: false, diagnostics: this.diagnostics() });
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    const disposedTextures = new Set<THREE.Texture>();
    for (const resource of this.#resources.values()) disposeBodyResources(resource, new Set(), disposedTextures);
    this.#markerLayer?.dispose();
    this.#markerLayer = undefined;
    this.#orbitRenderer?.dispose();
    this.#orbitRenderer = undefined;
    this.#selectionIndicator?.dispose();
    this.#selectionIndicator = undefined;
    this.#resources.clear();
    this.#representations.clear();
    this.#root.clear();
    this.#lastSnapshot = undefined;
  }

  #resolvePresentation(snapshot: CelestialRenderSnapshot, context: CelestialSystemViewContext): {
    readonly snapshot: CelestialRenderSnapshot;
    readonly decisions: ReadonlyMap<ObjectId, RepresentationDecision>;
  } {
    const camera = context.camera;
    const hasCamera = camera !== undefined;
    const viewportHeight = context.viewportHeightCssPixels ?? 1_000;
    const viewportWidth = context.viewportWidthCssPixels
      ?? (camera instanceof THREE.PerspectiveCamera ? viewportHeight * Math.max(camera.aspect, Number.EPSILON) : viewportHeight);
    const radiusMode = context.radiusMode ?? this.#radiusMode;
    if (radiusMode !== "physical" && radiusMode !== "adaptive") throw new RangeError(`Unknown radius mode: ${String(radiusMode)}`);
    const projections = new Map<ObjectId, BodyProjectionMetrics>();
    const sizingById = new Map<ObjectId, BodySizingResult>();
    for (const body of snapshot.bodies) {
      const scenePosition = transformSnapshotPositionToSceneUnits(body.positionRelativeToOriginMeters, this.#renderSpace);
      const projection = hasCamera
        ? cameraProjectionMetrics(scenePosition, camera, viewportWidth, viewportHeight, body.physicalRadiusMeters === undefined ? 0 : body.physicalRadiusMeters / this.#renderSpace.metersPerSceneUnit)
        : Object.freeze({ projectable: true, cameraDepthSceneUnits: 1, verticalFieldOfViewRadians: 1, viewportHeightCssPixels: 1 });
      projections.set(body.objectId, projection);
    }
    const separations = hasCamera ? nearestSeparations(snapshot.bodies, projections) : new Map<ObjectId, number>();
    for (const body of snapshot.bodies) {
      const projection = projections.get(body.objectId)!;
      const nearest = separations.get(body.objectId);
      const finalProjection = nearest === undefined ? projection : Object.freeze({ ...projection, nearestLocalSeparationPixels: nearest });
      sizingById.set(body.objectId, resolveBodySizing({
        physicalRadiusMeters: body.physicalRadiusMeters,
        metersPerSceneUnit: this.#renderSpace.metersPerSceneUnit,
        radiusMode: hasCamera ? radiusMode : "physical",
        projection: finalProjection,
        configuration: this.#adaptiveSizing,
      }));
    }
    if (!hasCamera) {
      const decisions = new Map<ObjectId, RepresentationDecision>();
      for (const body of snapshot.bodies) {
        const sizing = sizingById.get(body.objectId)!;
        decisions.set(body.objectId, Object.freeze({
          objectId: body.objectId,
          representation: body.representation ?? "sphere",
          sizing,
          hierarchyEligible: true,
          selected: false,
          focused: false,
        }));
      }
      return { snapshot, decisions };
    }
    const decisions = resolveRepresentationDecisions({
      bodies: snapshot.bodies,
      sizingById,
      previousRepresentations: this.#representations,
      selectedObjectIds: context.selectedObjectIds,
      focusedObjectId: context.focusedObjectId,
      contextPriorityObjectIds: context.contextPriorityObjectIds,
      policy: this.#representationPolicy,
    });
    return { snapshot, decisions };
  }

  #prepare(snapshot: CelestialRenderSnapshot, decisions: ReadonlyMap<ObjectId, RepresentationDecision>): PreparedUpdate {
    const next = new Map<ObjectId, BodyResources>();
    const created: BodyResources[] = [];
    const markerEntries: MarkerRenderEntry[] = [];
    try {
      for (const body of snapshot.bodies) {
        validateCelestialAppearance(body.appearance, body.objectId);
        const decision = decisions.get(body.objectId);
        if (decision === undefined) throw new RangeError(`Missing representation decision for ${body.objectId}`);
        if (decision.representation === "sphere") sceneRadius(body, this.#renderSpace);
        if (decision.representation === "marker") {
          const position = transformSnapshotPositionToSceneUnits(body.positionRelativeToOriginMeters, this.#renderSpace);
          markerEntries.push({ objectId: body.objectId, positionSceneUnits: position, sizePixels: decision.sizing.markerSizePixels, color: body.accentColor ?? this.#fallbackAccentColor });
        }
        const surfaceTexture = decision.representation === "sphere"
          ? this.#surfaceTextureProvider?.(body)
          : undefined;
        const existing = this.#resources.get(body.objectId);
        if (isSameResourceShape(existing, body, surfaceTexture, decision.representation)) {
          next.set(body.objectId, existing!);
          continue;
        }
        const resource = this.#createBodyResources(body, decision.representation);
        next.set(body.objectId, resource);
        created.push(resource);
      }
      const emitters = snapshot.bodies.map(emitterForBody).filter((emitter): emitter is StellarEmitter => emitter !== undefined);
      const illuminations = new Map<ObjectId, StellarIllumination>();
      for (const body of snapshot.bodies) {
        const decision = decisions.get(body.objectId);
        if (decision === undefined || decision.representation === "hidden" || decision.representation === "marker") continue;
        const bodyEmitters = emitters.filter((emitter) => emitter.objectId !== body.objectId);
        illuminations.set(body.objectId, resolveStellarIllumination(body.positionRelativeToOriginMeters, bodyEmitters, { maxStellarContributors: this.#maxStellarContributors }));
      }
      return { snapshot, bodies: next, created, illuminations, decisions, markerEntries: Object.freeze(markerEntries) };
    } catch (error) {
      const disposedTextures = new Set<THREE.Texture>();
      for (const resource of created) disposeBodyResources(resource, new Set(), disposedTextures);
      throw error;
    }
  }

  #createBodyResources(body: CelestialBodyRenderState, representation: BodyRepresentation): BodyResources {
    const anchor = new THREE.Group();
    anchor.name = `Celestial body ${body.objectId}`;
    anchor.userData.objectId = body.objectId;
    anchor.userData.parentId = body.parentId;
    let surface: BodyResources["surface"];
    let emission: BodyResources["emission"];
    let atmosphere: BodyResources["atmosphere"];
    let surfaceTexture: SurfaceTextureResource | undefined;
    try {
      if (representation === "sphere") {
        const radius = sceneRadius(body, this.#renderSpace);
        surfaceTexture = this.#surfaceTextureProvider?.(body);
        if (surfaceTexture !== undefined && !(surfaceTexture.texture instanceof THREE.Texture)) throw new TypeError(`surface texture provider returned an invalid texture for ${body.objectId}`);
        surface = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), createSurfaceMaterial(body, surfaceTexture));
        surface.name = `Celestial surface ${body.objectId}`;
        surface.userData.objectId = body.objectId;
        surface.userData.representation = "sphere";
        applyTexturedBodyPoleAlignment(surface);
        surface.scale.setScalar(radius);
        anchor.add(surface);
        if (body.appearance?.stellarEmission !== undefined) {
          const emissionMaterial = createSurfaceMaterial(body, undefined);
          emissionMaterial.uniforms.uBaseColor!.value.setRGB(0, 0, 0);
          emissionMaterial.uniforms.uEmissionStrength!.value = 0.22;
          emissionMaterial.transparent = true;
          emissionMaterial.depthWrite = false;
          emissionMaterial.side = THREE.BackSide;
          emissionMaterial.blending = THREE.AdditiveBlending;
          emission = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), emissionMaterial);
          emission.name = `Stellar emission glow ${body.objectId}`;
          emission.userData.objectId = body.objectId;
          emission.scale.setScalar(radius * 1.04);
          emission.renderOrder = 3;
          anchor.add(emission);
        }
        const optics = resolveAtmosphereOptics(body.appearance);
        if (optics !== undefined) {
          const shellRadius = atmosphereShellRadius(body, this.#renderSpace);
          const center = transformSnapshotPositionToSceneUnits(body.positionRelativeToOriginMeters, this.#renderSpace);
          const camera = { x: center.x, y: center.y, z: center.z + Math.max(shellRadius * 2, 1) };
          atmosphere = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), createAtmosphereMaterial(optics, radius, shellRadius, center, camera));
          atmosphere.name = `Atmosphere shell ${body.objectId}`;
          atmosphere.userData.objectId = body.objectId;
          // The demo's selective post-process may use this actual shell
          // radiance as its only bloom source. Keep the marker presentation
          // local to the mesh so consumer-side guides and surfaces cannot
          // accidentally enter the glow pass.
          atmosphere.userData.atmosphereBloomSource = true;
          atmosphere.scale.setScalar(shellRadius);
          atmosphere.renderOrder = 2;
          anchor.add(atmosphere);
        }
      }
      return {
        objectId: body.objectId,
        anchor,
        representation,
        hasAtmosphere: atmosphere !== undefined,
        hasStellarEmission: body.appearance?.stellarEmission !== undefined,
        ...(surface === undefined ? {} : { surface }),
        ...(emission === undefined ? {} : { emission }),
        ...(atmosphere === undefined ? {} : { atmosphere }),
        ...(surfaceTexture === undefined ? {} : { surfaceTexture }),
      };
    } catch (error) {
      const partial: BodyResources = {
        objectId: body.objectId,
        anchor,
        representation,
        hasAtmosphere: atmosphere !== undefined,
        hasStellarEmission: body.appearance?.stellarEmission !== undefined,
        ...(surface === undefined ? {} : { surface }),
        ...(emission === undefined ? {} : { emission }),
        ...(atmosphere === undefined ? {} : { atmosphere }),
        ...(surfaceTexture === undefined ? {} : { surfaceTexture }),
      };
      disposeBodyResources(partial);
      throw error;
    }
  }

  #commit(prepared: PreparedUpdate, context: CelestialSystemViewContext): void {
    const oldResources = this.#resources;
    const nextResources = prepared.bodies;
    const preservedTextures = new Set<THREE.Texture>();
    for (const resource of nextResources.values()) {
      if (resource.surfaceTexture !== undefined) preservedTextures.add(resource.surfaceTexture.texture);
    }
    const disposedTextures = new Set<THREE.Texture>();
    for (const [objectId, resource] of oldResources) {
      if (nextResources.get(objectId) === resource) continue;
      disposeBodyResources(resource, preservedTextures, disposedTextures);
    }
    for (const resource of prepared.created) this.#root.add(resource.anchor);
    this.#resources.clear();
    for (const [objectId, resource] of nextResources) this.#resources.set(objectId, resource);

    if (prepared.markerEntries.length > 0 || this.#markerLayer !== undefined) {
      if (this.#markerLayer === undefined) this.#markerLayer = new BatchedMarkerLayer(this.#root, this.#markerLayerOptions);
      this.#markerLayer.setEntries(prepared.markerEntries);
    }

    for (const body of prepared.snapshot.bodies) {
      const resource = nextResources.get(body.objectId)!;
      const decision = prepared.decisions.get(body.objectId)!;
      const scenePosition = transformSnapshotPositionToSceneUnits(body.positionRelativeToOriginMeters, this.#renderSpace);
      resource.anchor.position.set(scenePosition.x, scenePosition.y, scenePosition.z);
      resource.anchor.visible = decision.representation === "sphere";
      if (resource.surface !== undefined) {
        const presentedRadius = decision.sizing.presentedRadiusSceneUnits || sceneRadius(body, this.#renderSpace);
        resource.surface.scale.setScalar(presentedRadius);
        updateSurfaceMaterialAppearance(resource.surface.material, body);
        const illumination = prepared.illuminations.get(body.objectId) ?? resolveStellarIllumination(body.positionRelativeToOriginMeters, [], { maxStellarContributors: this.#maxStellarContributors });
        setLightUniforms(resource.surface.material, illumination, this.#renderSpace);
        resource.surface.material.uniforms.uInspectionFill!.value = context.lightingMode === undefined
          ? 0
          : inspectionFillContribution(context.lightingMode) * (
            context.selectedObjectId === body.objectId || context.focusedObjectId === body.objectId ? 1 : 0
          );
      }
      if (resource.emission !== undefined) {
        const presentedRadius = decision.sizing.presentedRadiusSceneUnits || sceneRadius(body, this.#renderSpace);
        resource.emission.scale.setScalar(presentedRadius * 1.04);
        updateSurfaceMaterialAppearance(resource.emission.material, body, true);
      }
      if (resource.atmosphere !== undefined) {
        const optics = resolveAtmosphereOptics(body.appearance);
        if (optics === undefined) throw new Error(`atmosphere resource for ${body.objectId} has no resolved optics`);
        const transport = normalizeAtmosphereOpticsForTransport(optics);
        const illumination = prepared.illuminations.get(body.objectId) ?? resolveStellarIllumination(body.positionRelativeToOriginMeters, [], { maxStellarContributors: this.#maxStellarContributors });
        setLightUniforms(resource.atmosphere.material, illumination, this.#renderSpace);
        const presentedRadius = decision.sizing.presentedRadiusSceneUnits || sceneRadius(body, this.#renderSpace);
        const shellRadius = atmosphereShellRadius(body, this.#renderSpace, presentedRadius, decision.sizing.presentedRadiusPixels);
        resource.atmosphere.scale.setScalar(shellRadius);
        const center = resource.anchor.position;
        const cameraPosition = context.cameraPositionSceneUnits ?? { x: center.x, y: center.y, z: center.z + 1 };
        const centerUniform = resource.atmosphere.material.uniforms.uBodyCenter!.value as THREE.Vector3;
        const cameraUniform = resource.atmosphere.material.uniforms.uCameraPosition!.value as THREE.Vector3;
        centerUniform.set(center.x, center.y, center.z);
        cameraUniform.set(cameraPosition.x, cameraPosition.y, cameraPosition.z);
        const rayleigh = resource.atmosphere.material.uniforms.uRayleighScattering!.value as THREE.Vector3;
        const mie = resource.atmosphere.material.uniforms.uMieScattering!.value as THREE.Vector3;
        const absorption = resource.atmosphere.material.uniforms.uAbsorption!.value as THREE.Vector3;
        resource.atmosphere.material.uniforms.uBodyRadius!.value = presentedRadius;
        resource.atmosphere.material.uniforms.uShellRadius!.value = shellRadius;
        rayleigh.set(transport.rayleighScattering.r, transport.rayleighScattering.g, transport.rayleighScattering.b);
        mie.set(transport.mieScattering.r, transport.mieScattering.g, transport.mieScattering.b);
        absorption.set(transport.absorption.r, transport.absorption.g, transport.absorption.b);
        resource.atmosphere.material.uniforms.uReferenceVerticalOpticalDepth!.value = optics.referenceVerticalOpticalDepth;
        resource.atmosphere.material.uniforms.uMieAnisotropy!.value = optics.mieAnisotropy;
      }
    }
    const selectedObjectId = context.selectedObjectId
      ?? (context.selectedObjectIds?.size === 1 ? [...context.selectedObjectIds][0] : undefined);
    if (prepared.snapshot.orbitPaths !== undefined || this.#orbitRenderer !== undefined) {
      if (this.#orbitRenderer === undefined && (prepared.snapshot.orbitPaths?.length ?? 0) > 0) {
        this.#orbitRenderer = new OrbitPathRenderer(this.#root, this.#orbitRendererOptions ?? { renderSpace: this.#renderSpace });
      }
      if (this.#orbitRenderer !== undefined) {
        if (prepared.snapshot.orbitPaths !== undefined) {
          if (context.orbitStyle === undefined && context.orbitStyleByObjectId === undefined) this.#orbitRenderer.setPaths(prepared.snapshot.orbitPaths);
          else if (context.orbitStyleByObjectId !== undefined) this.#orbitRenderer.setPaths(prepared.snapshot.orbitPaths, context.orbitStyleByObjectId);
          else {
            this.#orbitRenderer.clearPaths();
            for (const path of prepared.snapshot.orbitPaths) this.#orbitRenderer.setPath(path, context.orbitStyle);
          }
        }
        const positions = new Map<ObjectId, RenderVector3>();
        for (const body of prepared.snapshot.bodies) positions.set(body.objectId, transformSnapshotPositionToSceneUnits(body.positionRelativeToOriginMeters, this.#renderSpace));
        this.#orbitRenderer.updateBodyPositions(positions);
        this.#orbitRenderer.setSelected(selectedObjectId);
        this.#orbitRenderer.setVisible(context.orbitVisible ?? true);
        for (const [objectId, decision] of prepared.decisions) this.#orbitRenderer.setBodyRepresentation(objectId, decision.representation !== "hidden");
      }
    }
    if (selectedObjectId !== undefined && context.camera !== undefined) {
      const body = prepared.snapshot.bodies.find((candidate) => candidate.objectId === selectedObjectId);
      const decision = prepared.decisions.get(selectedObjectId);
      if (body !== undefined && decision !== undefined) {
        if (this.#selectionIndicator === undefined) this.#selectionIndicator = new SelectionIndicator(this.#root, this.#selectionIndicatorOptions);
        const position = transformSnapshotPositionToSceneUnits(body.positionRelativeToOriginMeters, this.#renderSpace);
        const radiusPixels = decision.representation === "marker"
          ? Math.max(decision.sizing.presentedRadiusPixels, decision.sizing.markerSizePixels / 2)
          : decision.sizing.presentedRadiusPixels;
        this.#selectionIndicator.update({ objectId: selectedObjectId, positionSceneUnits: position, bodyRadiusPixels: radiusPixels }, context.camera, context.viewportHeightCssPixels ?? 1_000);
      } else {
        this.#selectionIndicator?.hide();
      }
    } else {
      this.#selectionIndicator?.hide();
    }
    this.#representations.clear();
    for (const [objectId, decision] of prepared.decisions) this.#representations.set(objectId, decision.representation);
    this.#lastSnapshot = prepared.snapshot;
  }
}
