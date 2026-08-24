import * as THREE from "three";
import type { ObjectId } from "orbit-engine";
import {
  blackbodyTemperatureToLinearRgb,
  deriveSurfaceReflectance,
  resolveAtmosphereOptics,
  resolveStellarIllumination,
  validateCelestialAppearance,
  type AtmosphereOptics,
  type StellarEmitter,
  type StellarIllumination,
} from "./presentation.js";
import { createRenderSpaceConfig, transformSnapshotDirectionToRenderSpace, transformSnapshotPositionToSceneUnits, type RenderSpaceConfig, type RenderVector3 } from "./render-space.js";
import { createCelestialRenderSnapshot, type BodyRepresentation, type CelestialBodyRenderState, type CelestialRenderSnapshot } from "./snapshot.js";

const MAX_LIGHTS = 4;
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
uniform bool uUseTexture;
uniform sampler2D uSurfaceMap;
uniform int uLightCount;
uniform vec3 uLightDirections[${MAX_LIGHTS}];
uniform vec3 uLightColors[${MAX_LIGHTS}];
uniform float uLightIntensity[${MAX_LIGHTS}];
varying vec3 vWorldNormal;
varying vec2 vUv;
void main() {
  vec3 base = uBaseColor;
  if (uUseTexture) base *= texture2D(uSurfaceMap, vUv).rgb;
  vec3 incident = vec3(0.0);
  vec3 normal = normalize(vWorldNormal);
  for (int index = 0; index < ${MAX_LIGHTS}; index += 1) {
    if (index >= uLightCount) break;
    incident += uLightColors[index] * uLightIntensity[index]
      * max(dot(normal, normalize(uLightDirections[index])), 0.0);
  }
  gl_FragColor = vec4(base * incident + uEmissionColor * uEmissionStrength, 1.0);
}`;

const ATMOSPHERE_VERTEX_SHADER = `
varying vec3 vWorldPosition;
varying vec3 vWorldNormal;
void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPosition.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const ATMOSPHERE_FRAGMENT_SHADER = `
uniform vec3 uBodyCenter;
uniform vec3 uCameraPosition;
uniform float uBodyRadius;
uniform float uShellRadius;
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
varying vec3 vWorldNormal;
void main() {
  float shellThickness = max(uShellRadius - uBodyRadius, 0.000001);
  float radialDistance = distance(vWorldPosition, uBodyCenter);
  if (radialDistance < uBodyRadius) discard;
  float altitude = clamp((radialDistance - uBodyRadius) / shellThickness, 0.0, 1.0);
  float viewDensity = 0.0;
  vec3 source = vec3(0.0);
  vec3 normal = normalize(vWorldNormal);
  vec3 viewDirection = normalize(uCameraPosition - vWorldPosition);
  float viewCosine = dot(normal, viewDirection);
  float rayleighPhase = 0.75 * (1.0 + viewCosine * viewCosine);
  float denominator = max(1.0 + uMieAnisotropy * uMieAnisotropy - 2.0 * uMieAnisotropy * viewCosine, 0.0001);
  float miePhase = (1.0 - uMieAnisotropy * uMieAnisotropy) / (4.0 * 3.14159265 * pow(denominator, 1.5));
  for (int sampleIndex = 0; sampleIndex < 8; sampleIndex += 1) {
    float sampleAltitude = clamp(altitude + (float(sampleIndex) - 3.5) * 0.08, 0.0, 1.0);
    float density = exp(-4.0 * sampleAltitude) * (1.0 - sampleAltitude);
    viewDensity += density * 0.125;
    for (int lightIndex = 0; lightIndex < ${MAX_LIGHTS}; lightIndex += 1) {
      if (lightIndex >= uLightCount) break;
      float lightCosine = max(dot(normal, normalize(uLightDirections[lightIndex])), 0.0);
      vec3 scattering = uRayleighScattering * rayleighPhase + uMieScattering * miePhase;
      source += scattering * uLightColors[lightIndex] * uLightIntensity[lightIndex] * lightCosine * density * 0.125;
    }
  }
  float opticalDepth = max(uReferenceVerticalOpticalDepth, 0.0) * viewDensity;
  vec3 transmitted = exp(-uAbsorption * opticalDepth);
  vec3 color = source * transmitted;
  float alpha = clamp(max(max(color.r, color.g), color.b) + opticalDepth * 0.08, 0.0, 0.9);
  gl_FragColor = vec4(color, alpha);
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
}

export interface CelestialSystemViewContext {
  readonly cameraPositionSceneUnits?: RenderVector3;
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
  readonly atmosphereCount: number;
  readonly packageOwnedResourceCount: number;
  readonly committedSnapshotFingerprint?: string;
  readonly lastFailure?: VisualFailure;
}

export interface CelestialSystemViewUpdateResult {
  readonly committed: boolean;
  readonly snapshotFingerprint?: string;
  readonly diagnostics: CelestialSystemViewDiagnostics;
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
}

function finite(name: string, value: number): void {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
}

function sceneRadius(body: CelestialBodyRenderState, renderSpace: RenderSpaceConfig): number {
  const radius = body.physicalRadiusMeters;
  if (radius === undefined || radius <= 0) throw new RangeError(`body ${body.objectId} requires a positive physical radius for sphere resources`);
  return radius / renderSpace.metersPerSceneUnit;
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

function atmosphereShellRadius(body: CelestialBodyRenderState, renderSpace: RenderSpaceConfig): number {
  const radius = sceneRadius(body, renderSpace);
  const scaleHeight = body.appearance?.atmosphere?.scaleHeightMeters ?? 0;
  return radius + Math.max(scaleHeight * 4 / renderSpace.metersPerSceneUnit, radius * 0.01);
}

function createAtmosphereMaterial(
  optics: AtmosphereOptics,
  bodyRadiusSceneUnits: number,
  shellRadiusSceneUnits: number,
  bodyCenter: RenderVector3,
  cameraPosition: RenderVector3,
): THREE.ShaderMaterial {
  const uniforms = createLightUniforms();
  return new THREE.ShaderMaterial({
    uniforms: {
      ...uniforms,
      uBodyCenter: { value: new THREE.Vector3(bodyCenter.x, bodyCenter.y, bodyCenter.z) },
      uCameraPosition: { value: new THREE.Vector3(cameraPosition.x, cameraPosition.y, cameraPosition.z) },
      uBodyRadius: { value: bodyRadiusSceneUnits },
      uShellRadius: { value: shellRadiusSceneUnits },
      uRayleighScattering: { value: new THREE.Vector3(optics.rayleighScattering.r, optics.rayleighScattering.g, optics.rayleighScattering.b) },
      uMieScattering: { value: new THREE.Vector3(optics.mieScattering.r, optics.mieScattering.g, optics.mieScattering.b) },
      uAbsorption: { value: new THREE.Vector3(optics.absorption.r, optics.absorption.g, optics.absorption.b) },
      uReferenceVerticalOpticalDepth: { value: optics.referenceVerticalOpticalDepth },
      uMieAnisotropy: { value: optics.mieAnisotropy },
    },
    vertexShader: ATMOSPHERE_VERTEX_SHADER,
    fragmentShader: ATMOSPHERE_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
    blending: THREE.NormalBlending,
    lights: false,
    toneMapped: true,
  });
}

function isSameResourceShape(resource: BodyResources | undefined, body: CelestialBodyRenderState): boolean {
  return resource !== undefined
    && resource.representation === (body.representation ?? "sphere")
    && resource.hasAtmosphere === (resource.representation === "sphere" && resolveAtmosphereOptics(body.appearance) !== undefined)
    && resource.hasStellarEmission === (body.appearance?.stellarEmission !== undefined);
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
  readonly #surfaceTextureProvider?: SurfaceTextureProvider;
  readonly #resources = new Map<ObjectId, BodyResources>();
  #lastSnapshot?: CelestialRenderSnapshot;
  #lastFailure?: VisualFailure;
  #disposed = false;

  constructor(options: CelestialSystemViewOptions = {}) {
    this.#renderSpace = createRenderSpaceConfig(options.configuration?.renderSpace);
    this.#fallbackAccentColor = options.configuration?.fallbackAccentColor ?? 0x808080;
    this.#maxStellarContributors = options.configuration?.maxStellarContributors ?? 4;
    if (!Number.isSafeInteger(this.#maxStellarContributors) || this.#maxStellarContributors < 1) throw new RangeError("maxStellarContributors must be a positive safe integer");
    if (options.configuration?.fallbackAccentColor !== undefined && (!Number.isSafeInteger(options.configuration.fallbackAccentColor) || options.configuration.fallbackAccentColor < 0 || options.configuration.fallbackAccentColor > 0xffffff)) throw new RangeError("fallbackAccentColor must be a 24-bit integer");
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

  diagnostics(): CelestialSystemViewDiagnostics {
    let sphereCount = 0;
    let atmosphereCount = 0;
    let packageOwnedResourceCount = 0;
    for (const resource of this.#resources.values()) {
      if (resource.surface !== undefined) sphereCount += 1;
      if (resource.atmosphere !== undefined) atmosphereCount += 1;
      packageOwnedResourceCount += 1 + (resource.surface !== undefined ? 2 : 0) + (resource.emission !== undefined ? 2 : 0) + (resource.atmosphere !== undefined ? 2 : 0);
      if (resource.surfaceTexture?.ownership === "package") packageOwnedResourceCount += 1;
    }
    return Object.freeze({
      disposed: this.#disposed,
      bodyCount: this.#resources.size,
      sphereCount,
      atmosphereCount,
      packageOwnedResourceCount,
      ...(this.#lastSnapshot === undefined ? {} : { committedSnapshotFingerprint: this.#lastSnapshot.fingerprint }),
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
      snapshot = createCelestialRenderSnapshot(snapshotInput);
      if (context.cameraPositionSceneUnits !== undefined) {
        finite("cameraPositionSceneUnits.x", context.cameraPositionSceneUnits.x);
        finite("cameraPositionSceneUnits.y", context.cameraPositionSceneUnits.y);
        finite("cameraPositionSceneUnits.z", context.cameraPositionSceneUnits.z);
      }
      const prepared = this.#prepare(snapshot);
      this.#commit(prepared, context);
      this.#lastFailure = undefined;
      return Object.freeze({ committed: true, snapshotFingerprint: snapshot.fingerprint, diagnostics: this.diagnostics() });
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
    this.#resources.clear();
    this.#root.clear();
    this.#lastSnapshot = undefined;
  }

  #prepare(snapshot: CelestialRenderSnapshot): PreparedUpdate {
    const next = new Map<ObjectId, BodyResources>();
    const created: BodyResources[] = [];
    try {
      for (const body of snapshot.bodies) {
        validateCelestialAppearance(body.appearance, body.objectId);
        if ((body.representation ?? "sphere") === "sphere") sceneRadius(body, this.#renderSpace);
        const existing = this.#resources.get(body.objectId);
        if (isSameResourceShape(existing, body)) {
          next.set(body.objectId, existing!);
          continue;
        }
        const resource = this.#createBodyResources(body);
        next.set(body.objectId, resource);
        created.push(resource);
      }
      const emitters = snapshot.bodies.map(emitterForBody).filter((emitter): emitter is StellarEmitter => emitter !== undefined);
      const illuminations = new Map<ObjectId, StellarIllumination>();
      for (const body of snapshot.bodies) {
        if (body.representation === "hidden" || body.representation === "marker") continue;
        const bodyEmitters = emitters.filter((emitter) => emitter.objectId !== body.objectId);
        illuminations.set(body.objectId, resolveStellarIllumination(body.positionRelativeToOriginMeters, bodyEmitters, { maxStellarContributors: this.#maxStellarContributors }));
      }
      return { snapshot, bodies: next, created, illuminations };
    } catch (error) {
      const disposedTextures = new Set<THREE.Texture>();
      for (const resource of created) disposeBodyResources(resource, new Set(), disposedTextures);
      throw error;
    }
  }

  #createBodyResources(body: CelestialBodyRenderState): BodyResources {
    const representation = body.representation ?? "sphere";
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

    for (const body of prepared.snapshot.bodies) {
      const resource = nextResources.get(body.objectId)!;
      const scenePosition = transformSnapshotPositionToSceneUnits(body.positionRelativeToOriginMeters, this.#renderSpace);
      resource.anchor.position.set(scenePosition.x, scenePosition.y, scenePosition.z);
      resource.anchor.visible = (body.representation ?? "sphere") !== "hidden";
      if (resource.surface !== undefined) {
        resource.surface.scale.setScalar(sceneRadius(body, this.#renderSpace));
        updateSurfaceMaterialAppearance(resource.surface.material, body);
        const illumination = prepared.illuminations.get(body.objectId) ?? resolveStellarIllumination(body.positionRelativeToOriginMeters, [], { maxStellarContributors: this.#maxStellarContributors });
        setLightUniforms(resource.surface.material, illumination, this.#renderSpace);
      }
      if (resource.emission !== undefined) {
        resource.emission.scale.setScalar(sceneRadius(body, this.#renderSpace) * 1.04);
        updateSurfaceMaterialAppearance(resource.emission.material, body, true);
      }
      if (resource.atmosphere !== undefined) {
        const optics = resolveAtmosphereOptics(body.appearance);
        if (optics === undefined) throw new Error(`atmosphere resource for ${body.objectId} has no resolved optics`);
        const illumination = prepared.illuminations.get(body.objectId) ?? resolveStellarIllumination(body.positionRelativeToOriginMeters, [], { maxStellarContributors: this.#maxStellarContributors });
        setLightUniforms(resource.atmosphere.material, illumination, this.#renderSpace);
        const center = resource.anchor.position;
        const cameraPosition = context.cameraPositionSceneUnits ?? { x: center.x, y: center.y, z: center.z + 1 };
        const centerUniform = resource.atmosphere.material.uniforms.uBodyCenter!.value as THREE.Vector3;
        const cameraUniform = resource.atmosphere.material.uniforms.uCameraPosition!.value as THREE.Vector3;
        centerUniform.set(center.x, center.y, center.z);
        cameraUniform.set(cameraPosition.x, cameraPosition.y, cameraPosition.z);
        const rayleigh = resource.atmosphere.material.uniforms.uRayleighScattering!.value as THREE.Vector3;
        const mie = resource.atmosphere.material.uniforms.uMieScattering!.value as THREE.Vector3;
        const absorption = resource.atmosphere.material.uniforms.uAbsorption!.value as THREE.Vector3;
        rayleigh.set(optics.rayleighScattering.r, optics.rayleighScattering.g, optics.rayleighScattering.b);
        mie.set(optics.mieScattering.r, optics.mieScattering.g, optics.mieScattering.b);
        absorption.set(optics.absorption.r, optics.absorption.g, optics.absorption.b);
        resource.atmosphere.material.uniforms.uReferenceVerticalOpticalDepth!.value = optics.referenceVerticalOpticalDepth;
        resource.atmosphere.material.uniforms.uMieAnisotropy!.value = optics.mieAnisotropy;
      }
    }
    this.#lastSnapshot = prepared.snapshot;
  }
}
