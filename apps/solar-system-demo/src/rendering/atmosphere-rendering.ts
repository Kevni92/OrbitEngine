import * as THREE from "three";
import type { ObjectId } from "orbit-engine";
import {
  opticalGas,
  type AtmosphereAppearance,
  type CelestialAppearance,
  type LinearRgb,
} from "../scenario/celestial-appearance.js";
import type { RegisteredScenarioBody } from "../scenario/load-solar-system.js";
import type { RepresentationLevel } from "./representation-lod.js";
import { projectedRadiusPixels } from "./adaptive-sizing.js";
import { METERS_TO_SCENE_UNITS, positionToSceneUnits } from "./render-space.js";
import type { StellarIlluminationSet } from "./celestial-appearance-rendering.js";

export const ATMOSPHERE_VIEW_SAMPLES = 8;
export const ATMOSPHERE_ENTER_DIAMETER_PIXELS = 12;
export const ATMOSPHERE_EXIT_DIAMETER_PIXELS = 10;
export const ATMOSPHERE_RIM_THICKNESS_CSS_PIXELS = 1.5;
export const ATMOSPHERE_MAX_RIM_FRACTION = 0.08;

export interface ResolvedAtmosphereOptics {
  readonly rayleighScattering: LinearRgb;
  readonly mieScattering: LinearRgb;
  readonly absorption: LinearRgb;
  readonly referenceVerticalOpticalDepth: number;
  readonly mieAnisotropy: number;
  readonly source: "explicit" | "gas-library" | "zero-fallback";
}

export interface AtmosphereLodState {
  readonly enabled: boolean;
  readonly projectedDiameterPixels: number;
}

export interface AtmosphereDiagnostics {
  readonly bodyId: ObjectId;
  readonly resourcesAllocated: boolean;
  readonly visible: boolean;
  readonly projectedDiameterPixels: number;
  readonly presentationThicknessSceneUnits?: number;
  readonly viewSampleCount: number;
  readonly opticalSource?: ResolvedAtmosphereOptics["source"];
}

interface AtmosphereShellRecord {
  readonly bodyId: ObjectId;
  readonly mesh: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  readonly material: THREE.ShaderMaterial;
  readonly lightCount: number;
  presentationThicknessSceneUnits: number;
  projectedDiameterPixels: number;
  opticalSource: ResolvedAtmosphereOptics["source"];
}

const ZERO_RGB: LinearRgb = Object.freeze({ r: 0, g: 0, b: 0 });

function addRgb(left: LinearRgb, right: LinearRgb): LinearRgb {
  return { r: left.r + right.r, g: left.g + right.g, b: left.b + right.b };
}

function scaleRgb(value: LinearRgb, scale: number): LinearRgb {
  return { r: value.r * scale, g: value.g * scale, b: value.b * scale };
}

function nonNegativeRgb(value: LinearRgb): LinearRgb {
  return { r: Math.max(0, value.r), g: Math.max(0, value.g), b: Math.max(0, value.b) };
}

export function resolveAtmosphereOptics(appearance: CelestialAppearance | undefined): ResolvedAtmosphereOptics | undefined {
  const atmosphere = appearance?.atmosphere;
  if (atmosphere === undefined) return undefined;
  if (atmosphere.optics !== undefined) {
    const haze = atmosphere.haze;
    const mieScattering = haze?.calibratedScattering === undefined
      ? atmosphere.optics.mieScattering
      : addRgb(atmosphere.optics.mieScattering, haze.calibratedScattering);
    const absorption = haze?.calibratedAbsorption === undefined
      ? atmosphere.optics.absorption
      : addRgb(atmosphere.optics.absorption, haze.calibratedAbsorption);
    return Object.freeze({
      rayleighScattering: atmosphere.optics.rayleighScattering,
      mieScattering: nonNegativeRgb(mieScattering),
      absorption: nonNegativeRgb(absorption),
      referenceVerticalOpticalDepth: atmosphere.optics.referenceVerticalOpticalDepth
        + (haze?.opticalDepthContribution ?? 0),
      mieAnisotropy: haze?.mieAnisotropy ?? atmosphere.optics.mieAnisotropy,
      source: "explicit",
    });
  }

  let rayleigh = ZERO_RGB;
  let recognizedGasFraction = 0;
  for (const gas of atmosphere.gases) {
    const optical = opticalGas(gas.gasId);
    if (optical === undefined) continue;
    rayleigh = addRgb(rayleigh, scaleRgb(optical.rayleighScattering, gas.mixingRatio));
    recognizedGasFraction += gas.mixingRatio;
  }
  const haze = atmosphere.haze;
  const mie = haze?.calibratedScattering ?? ZERO_RGB;
  const absorption = haze?.calibratedAbsorption ?? ZERO_RGB;
  const hasOpticalInput = recognizedGasFraction > 0
    || haze?.calibratedScattering !== undefined
    || haze?.calibratedAbsorption !== undefined;
  return Object.freeze({
    rayleighScattering: rayleigh,
    mieScattering: mie,
    absorption,
    referenceVerticalOpticalDepth: Math.max(0, haze?.opticalDepthContribution ?? 0),
    mieAnisotropy: haze?.mieAnisotropy ?? -0.05,
    source: hasOpticalInput ? "gas-library" : "zero-fallback",
  });
}

export function atmosphereLodState(
  previousEnabled: boolean | undefined,
  projectedDiameterPixels: number,
  forceVisible: boolean,
): AtmosphereLodState {
  if (!Number.isFinite(projectedDiameterPixels) || projectedDiameterPixels < 0) {
    throw new RangeError("atmosphere projected diameter must be finite and non-negative");
  }
  const enabled = forceVisible || (previousEnabled === true
    ? projectedDiameterPixels >= ATMOSPHERE_EXIT_DIAMETER_PIXELS
    : projectedDiameterPixels >= ATMOSPHERE_ENTER_DIAMETER_PIXELS);
  return Object.freeze({ enabled, projectedDiameterPixels });
}

export function presentationAtmosphereThickness(
  physicalThicknessSceneUnits: number,
  presentedBodyRadiusSceneUnits: number,
  pixelsPerSceneUnit: number,
): number {
  if (![physicalThicknessSceneUnits, presentedBodyRadiusSceneUnits, pixelsPerSceneUnit].every(Number.isFinite)
      || physicalThicknessSceneUnits < 0 || presentedBodyRadiusSceneUnits <= 0 || pixelsPerSceneUnit <= 0) {
    throw new RangeError("atmosphere presentation dimensions must be finite and positive where required");
  }
  const physicalProjectedThickness = physicalThicknessSceneUnits * pixelsPerSceneUnit;
  const minimumReadableThickness = ATMOSPHERE_RIM_THICKNESS_CSS_PIXELS / pixelsPerSceneUnit;
  const maximumPresentationThickness = presentedBodyRadiusSceneUnits * ATMOSPHERE_MAX_RIM_FRACTION;
  return Math.min(
    maximumPresentationThickness,
    Math.max(physicalProjectedThickness, minimumReadableThickness),
  );
}

export const ATMOSPHERE_VERTEX_SHADER = `
varying vec3 vWorldPosition;

void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPosition.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

function atmosphereFragmentShader(lightCount: number): string {
  const shaderLightCount = Math.max(1, lightCount);
  return `
varying vec3 vWorldPosition;

uniform vec3 uBodyCenter;
uniform float uBodyRadius;
uniform float uScaleHeight;
uniform vec3 uRayleighScattering;
uniform vec3 uMieScattering;
uniform vec3 uAbsorption;
uniform float uReferenceVerticalOpticalDepth;
uniform float uMieAnisotropy;
uniform float uLightCount;
uniform vec3 uLightDirections[${shaderLightCount}];
uniform float uLightIrradiances[${shaderLightCount}];

const int VIEW_SAMPLES = ${ATMOSPHERE_VIEW_SAMPLES};
const float PI = 3.14159265359;

float rayleighPhase(float cosine) {
  return 3.0 * (1.0 + cosine * cosine) / (16.0 * PI);
}

float miePhase(float cosine, float anisotropy) {
  float g2 = anisotropy * anisotropy;
  float denominator = max(0.0001, pow(1.0 + g2 - 2.0 * anisotropy * cosine, 1.5));
  return (1.0 - g2) / (4.0 * PI * denominator);
}

void main() {
  vec3 fromCenter = vWorldPosition - uBodyCenter;
  float radius = max(length(fromCenter), uBodyRadius);
  vec3 surfaceNormal = normalize(fromCenter);
  vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
  float altitude = max(radius - uBodyRadius, 0.0);
  float density = exp(-altitude / max(uScaleHeight, 1.0));
  float viewDepth = 0.0;

  // Fixed-cost view integration. Light-path depth is analytic below; there
  // is intentionally no nested or adaptive raymarch in the default path.
  for (int sampleIndex = 0; sampleIndex < VIEW_SAMPLES; sampleIndex++) {
    float sampleFraction = (float(sampleIndex) + 0.5) / float(VIEW_SAMPLES);
    viewDepth += exp(-(altitude + sampleFraction * uScaleHeight) / max(uScaleHeight, 1.0));
  }
  float viewOpticalDepth = uReferenceVerticalOpticalDepth * density * viewDepth / float(VIEW_SAMPLES);
  vec3 scattering = vec3(0.0);
  for (int lightIndex = 0; lightIndex < ${shaderLightCount}; lightIndex++) {
    if (float(lightIndex) >= uLightCount) continue;
    vec3 lightDirection = normalize(uLightDirections[lightIndex]);
    float cosine = dot(surfaceNormal, lightDirection);
    float lightPathDepth = 1.0 / max(0.08, cosine + 0.08);
    float transmittance = exp(-(uAbsorption.r + uAbsorption.g + uAbsorption.b) / 3.0
      * viewOpticalDepth * lightPathDepth);
    float rayleigh = rayleighPhase(dot(viewDirection, lightDirection));
    float mie = miePhase(dot(viewDirection, lightDirection), uMieAnisotropy);
    vec3 source = uRayleighScattering * rayleigh + uMieScattering * mie;
    scattering += source * uLightIrradiances[lightIndex] * transmittance * max(0.0, cosine + 0.05);
  }
  float alpha = clamp(1.0 - exp(-viewOpticalDepth), 0.0, 0.92);
  gl_FragColor = vec4(scattering, alpha);
}
`;
}

function atmosphereMaterial(
  atmosphere: AtmosphereAppearance,
  optics: ResolvedAtmosphereOptics,
  bodyCenter: THREE.Vector3,
  bodyRadiusSceneUnits: number,
  scaleHeightSceneUnits: number,
  illumination: StellarIlluminationSet | undefined,
): { readonly material: THREE.ShaderMaterial; readonly lightCount: number } {
  const contributions = illumination?.contributions ?? [];
  const lightDirections = contributions.map((contribution) => {
    const direction = positionToSceneUnits(contribution.directionToEmitter);
    return new THREE.Vector3(direction.x, direction.y, direction.z).normalize();
  });
  const lightIrradiances = contributions.map((contribution) => contribution.exposureMappedIrradiance);
  const lightCount = contributions.length;
  const shaderLightCount = Math.max(1, lightCount);
  if (lightDirections.length === 0) lightDirections.push(new THREE.Vector3(0, 1, 0));
  if (lightIrradiances.length === 0) lightIrradiances.push(0);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uBodyCenter: { value: bodyCenter.clone() },
      uBodyRadius: { value: bodyRadiusSceneUnits },
      uScaleHeight: { value: scaleHeightSceneUnits },
      uRayleighScattering: { value: new THREE.Vector3(optics.rayleighScattering.r, optics.rayleighScattering.g, optics.rayleighScattering.b) },
      uMieScattering: { value: new THREE.Vector3(optics.mieScattering.r, optics.mieScattering.g, optics.mieScattering.b) },
      uAbsorption: { value: new THREE.Vector3(optics.absorption.r, optics.absorption.g, optics.absorption.b) },
      uReferenceVerticalOpticalDepth: { value: optics.referenceVerticalOpticalDepth },
      uMieAnisotropy: { value: optics.mieAnisotropy },
      uLightCount: { value: lightCount },
      uLightDirections: { value: lightDirections.slice(0, shaderLightCount) },
      uLightIrradiances: { value: lightIrradiances.slice(0, shaderLightCount) },
    },
    vertexShader: ATMOSPHERE_VERTEX_SHADER,
    fragmentShader: atmosphereFragmentShader(lightCount),
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    toneMapped: true,
  });
  void atmosphere;
  return { material, lightCount };
}

function setAtmosphereUniforms(
  material: THREE.ShaderMaterial,
  bodyCenter: THREE.Vector3,
  bodyRadiusSceneUnits: number,
  scaleHeightSceneUnits: number,
  optics: ResolvedAtmosphereOptics,
  illumination: StellarIlluminationSet | undefined,
): void {
  const directions = (illumination?.contributions ?? []).map((contribution) => {
    const direction = positionToSceneUnits(contribution.directionToEmitter);
    return new THREE.Vector3(direction.x, direction.y, direction.z).normalize();
  });
  const irradiances = (illumination?.contributions ?? []).map((contribution) => contribution.exposureMappedIrradiance);
  if (directions.length === 0) directions.push(new THREE.Vector3(0, 1, 0));
  if (irradiances.length === 0) irradiances.push(0);
  material.uniforms.uBodyCenter!.value.copy(bodyCenter);
  material.uniforms.uBodyRadius!.value = bodyRadiusSceneUnits;
  material.uniforms.uScaleHeight!.value = scaleHeightSceneUnits;
  material.uniforms.uRayleighScattering!.value.set(optics.rayleighScattering.r, optics.rayleighScattering.g, optics.rayleighScattering.b);
  material.uniforms.uMieScattering!.value.set(optics.mieScattering.r, optics.mieScattering.g, optics.mieScattering.b);
  material.uniforms.uAbsorption!.value.set(optics.absorption.r, optics.absorption.g, optics.absorption.b);
  material.uniforms.uReferenceVerticalOpticalDepth!.value = optics.referenceVerticalOpticalDepth;
  material.uniforms.uMieAnisotropy!.value = optics.mieAnisotropy;
  material.uniforms.uLightDirections!.value = directions;
  material.uniforms.uLightIrradiances!.value = irradiances;
  material.uniforms.uLightCount!.value = illumination?.contributions.length ?? 0;
}

export class AtmosphereShellManager {
  readonly #scene: THREE.Scene;
  readonly #geometry: THREE.SphereGeometry;
  readonly #shells = new Map<ObjectId, AtmosphereShellRecord>();
  readonly #enabledByBody = new Map<ObjectId, boolean>();

  constructor(scene: THREE.Scene) {
    this.#scene = scene;
    this.#geometry = new THREE.SphereGeometry(1, 32, 20);
  }

  update(
    entries: readonly RegisteredScenarioBody[],
    representations: ReadonlyMap<ObjectId, RepresentationLevel>,
    positions: ReadonlyMap<ObjectId, THREE.Vector3>,
    presentedRadii: ReadonlyMap<ObjectId, number>,
    camera: THREE.PerspectiveCamera | undefined,
    viewportHeightPixels: number,
    forcedBodies: ReadonlySet<ObjectId>,
    illuminationByBody: ReadonlyMap<ObjectId, StellarIlluminationSet>,
  ): void {
    const liveIds = new Set<ObjectId>();
    for (const entry of entries) {
      const bodyId = entry.definition.id;
      const atmosphere = entry.definition.appearance?.atmosphere;
      const position = positions.get(bodyId);
      const presentedRadius = presentedRadii.get(bodyId);
      const representation = representations.get(bodyId);
      if (atmosphere === undefined || position === undefined || presentedRadius === undefined
          || representation !== "sphere" || camera === undefined) {
        this.remove(bodyId);
        this.#enabledByBody.delete(bodyId);
        continue;
      }
      const physicalRadius = METERS_TO_SCENE_UNITS * (entry.record.properties.physicalRadius ?? entry.definition.properties.physicalRadius ?? 0);
      const distance = Math.max(camera.position.distanceTo(position), physicalRadius * 2, Number.EPSILON);
      const fieldOfView = camera.fov * Math.PI / 180;
      const projectedRadius = projectedRadiusPixels(physicalRadius, distance, fieldOfView, viewportHeightPixels);
      const projectedDiameter = projectedRadius * 2;
      const lod = atmosphereLodState(this.#enabledByBody.get(bodyId), projectedDiameter, forcedBodies.has(bodyId));
      this.#enabledByBody.set(bodyId, lod.enabled);
      if (!lod.enabled) {
        this.remove(bodyId);
        continue;
      }
      const optics = resolveAtmosphereOptics(entry.definition.appearance);
      if (optics === undefined) {
        this.remove(bodyId);
        continue;
      }
      const pixelsPerSceneUnit = Math.max(projectedRadius / Math.max(presentedRadius, Number.EPSILON), Number.EPSILON);
      const physicalThickness = Math.max(0, atmosphere.scaleHeightMeters * 4 * METERS_TO_SCENE_UNITS);
      const presentationThickness = presentationAtmosphereThickness(physicalThickness, presentedRadius, pixelsPerSceneUnit);
      const bodyCenter = position.clone();
      const illumination = illuminationByBody.get(bodyId);
      const current = this.#shells.get(bodyId);
      const lightCount = illumination?.contributions.length ?? 0;
      let shell = current;
      if (shell === undefined || shell.lightCount !== lightCount) {
        if (shell !== undefined) this.remove(bodyId);
        const materialResult = atmosphereMaterial(
          atmosphere,
          optics,
          bodyCenter,
          presentedRadius,
          atmosphere.scaleHeightMeters * METERS_TO_SCENE_UNITS,
          illumination,
        );
        const mesh = new THREE.Mesh(this.#geometry, materialResult.material);
        mesh.name = `Atmosphere ${bodyId}`;
        mesh.userData.objectId = bodyId;
        mesh.userData.objectType = "atmosphere";
        mesh.renderOrder = 2;
        this.#scene.add(mesh);
        shell = {
          bodyId,
          mesh,
          material: materialResult.material,
          lightCount: materialResult.lightCount,
          presentationThicknessSceneUnits: presentationThickness,
          projectedDiameterPixels: projectedDiameter,
          opticalSource: optics.source,
        };
        this.#shells.set(bodyId, shell);
      } else {
        setAtmosphereUniforms(shell.material, bodyCenter, presentedRadius, atmosphere.scaleHeightMeters * METERS_TO_SCENE_UNITS, optics, illumination);
        shell.presentationThicknessSceneUnits = presentationThickness;
        shell.projectedDiameterPixels = projectedDiameter;
        shell.opticalSource = optics.source;
      }
      shell.mesh.position.copy(position);
      shell.mesh.scale.setScalar(presentedRadius + presentationThickness);
      shell.mesh.visible = true;
      liveIds.add(bodyId);
    }
    for (const bodyId of [...this.#shells.keys()]) {
      if (!liveIds.has(bodyId)) this.remove(bodyId);
    }
  }

  diagnosticsFor(bodyId: ObjectId): AtmosphereDiagnostics {
    const shell = this.#shells.get(bodyId);
    return Object.freeze({
      bodyId,
      resourcesAllocated: shell !== undefined,
      visible: shell?.mesh.visible === true,
      projectedDiameterPixels: shell?.projectedDiameterPixels ?? 0,
      ...(shell === undefined ? {} : {
        presentationThicknessSceneUnits: shell.presentationThicknessSceneUnits,
        opticalSource: shell.opticalSource,
      }),
      viewSampleCount: ATMOSPHERE_VIEW_SAMPLES,
    });
  }

  resourceCount(): number {
    return this.#shells.size;
  }

  remove(bodyId: ObjectId): void {
    const shell = this.#shells.get(bodyId);
    if (shell === undefined) return;
    this.#scene.remove(shell.mesh);
    shell.material.dispose();
    this.#shells.delete(bodyId);
  }

  dispose(): void {
    for (const bodyId of [...this.#shells.keys()]) this.remove(bodyId);
    this.#geometry.dispose();
    this.#enabledByBody.clear();
  }
}
