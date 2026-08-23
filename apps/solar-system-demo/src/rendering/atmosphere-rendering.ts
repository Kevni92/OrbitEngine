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
import type { StellarIlluminationSet } from "./celestial-appearance-rendering.js";

export const ATMOSPHERE_VIEW_SAMPLES = 8;
export const ATMOSPHERE_ENTER_DIAMETER_PIXELS = 12;
export const ATMOSPHERE_EXIT_DIAMETER_PIXELS = 10;
export const ATMOSPHERE_RIM_THICKNESS_CSS_PIXELS = 4;
export const ATMOSPHERE_MAX_RIM_FRACTION = 0.08;
export const ATMOSPHERE_PHYSICAL_EXTENT_SCALE_HEIGHTS = 4;
export const ATMOSPHERE_SCATTERING_DISPLAY_GAIN = 25;
export const ATMOSPHERE_LIMB_DISPLAY_GAIN = 1.7;

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
  readonly physicalExtentScaleHeights: number;
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
  physicalPresentationThicknessSceneUnits: number,
  presentedBodyRadiusSceneUnits: number,
  pixelsPerSceneUnit: number,
): number {
  if (![physicalPresentationThicknessSceneUnits, presentedBodyRadiusSceneUnits, pixelsPerSceneUnit].every(Number.isFinite)
      || physicalPresentationThicknessSceneUnits < 0 || presentedBodyRadiusSceneUnits <= 0 || pixelsPerSceneUnit <= 0) {
    throw new RangeError("atmosphere presentation dimensions must be finite and positive where required");
  }
  const physicalProjectedThickness = physicalPresentationThicknessSceneUnits * pixelsPerSceneUnit;
  const minimumReadableThickness = ATMOSPHERE_RIM_THICKNESS_CSS_PIXELS / pixelsPerSceneUnit;
  const maximumPresentationThickness = presentedBodyRadiusSceneUnits * ATMOSPHERE_MAX_RIM_FRACTION;
  return Math.min(
    maximumPresentationThickness,
    Math.max(physicalProjectedThickness, minimumReadableThickness),
  );
}

export function presentationAltitudeScaleHeights(
  radialDistanceSceneUnits: number,
  bodyRadiusSceneUnits: number,
  atmosphereRadiusSceneUnits: number,
  physicalExtentScaleHeights = ATMOSPHERE_PHYSICAL_EXTENT_SCALE_HEIGHTS,
): number {
  if (![radialDistanceSceneUnits, bodyRadiusSceneUnits, atmosphereRadiusSceneUnits, physicalExtentScaleHeights].every(Number.isFinite)
      || bodyRadiusSceneUnits <= 0 || atmosphereRadiusSceneUnits <= bodyRadiusSceneUnits || physicalExtentScaleHeights <= 0) {
    throw new RangeError("atmosphere altitude mapping dimensions must be finite and positive");
  }
  const fraction = Math.min(1, Math.max(0,
    (radialDistanceSceneUnits - bodyRadiusSceneUnits) / (atmosphereRadiusSceneUnits - bodyRadiusSceneUnits),
  ));
  return fraction * physicalExtentScaleHeights;
}

export function atmosphereViewPathLength(
  bodyRadiusSceneUnits: number,
  atmosphereRadiusSceneUnits: number,
  impactParameterSceneUnits: number,
): number {
  if (![bodyRadiusSceneUnits, atmosphereRadiusSceneUnits, impactParameterSceneUnits].every(Number.isFinite)
      || bodyRadiusSceneUnits <= 0 || atmosphereRadiusSceneUnits <= bodyRadiusSceneUnits || impactParameterSceneUnits < 0) {
    throw new RangeError("atmosphere path dimensions must be finite and positive");
  }
  if (impactParameterSceneUnits >= atmosphereRadiusSceneUnits) return 0;
  const atmosphereHalfChord = Math.sqrt(Math.max(0,
    atmosphereRadiusSceneUnits ** 2 - impactParameterSceneUnits ** 2,
  ));
  if (impactParameterSceneUnits >= bodyRadiusSceneUnits) return atmosphereHalfChord * 2;
  const bodyHalfChord = Math.sqrt(Math.max(0,
    bodyRadiusSceneUnits ** 2 - impactParameterSceneUnits ** 2,
  ));
  return atmosphereHalfChord - bodyHalfChord;
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
uniform float uAtmosphereRadius;
uniform float uPhysicalExtentScaleHeights;
uniform vec3 uRayleighScattering;
uniform vec3 uMieScattering;
uniform vec3 uAbsorption;
uniform float uReferenceVerticalOpticalDepth;
uniform float uMieAnisotropy;
uniform float uLightCount;
uniform vec3 uLightDirections[${shaderLightCount}];
uniform vec3 uLightChromaticities[${shaderLightCount}];
uniform float uLightIrradiances[${shaderLightCount}];

const int VIEW_SAMPLES = ${ATMOSPHERE_VIEW_SAMPLES};
const float PI = 3.14159265359;
const float EPSILON = 0.000001;
const float DISPLAY_GAIN = ${ATMOSPHERE_SCATTERING_DISPLAY_GAIN.toFixed(2)};
const float LIMB_DISPLAY_GAIN = ${ATMOSPHERE_LIMB_DISPLAY_GAIN.toFixed(2)};
const vec3 DISPLAY_CHROMATICITY = vec3(0.20, 0.60, 3.00);

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

void main() {
  vec3 rayOrigin = cameraPosition;
  vec3 rayDirection = normalize(vWorldPosition - cameraPosition);
  vec2 atmosphereInterval = raySphereInterval(rayOrigin, rayDirection, uAtmosphereRadius);
  float segmentStart = max(0.0, atmosphereInterval.x);
  float segmentEnd = atmosphereInterval.y;
  if (segmentEnd <= segmentStart) discard;

  vec2 bodyInterval = raySphereInterval(rayOrigin, rayDirection, uBodyRadius);
  if (bodyInterval.y >= bodyInterval.x && bodyInterval.x > segmentStart) {
    segmentEnd = min(segmentEnd, bodyInterval.x);
  }
  if (segmentEnd <= segmentStart) discard;

  float presentationThickness = max(uAtmosphereRadius - uBodyRadius, EPSILON);
  float segmentLength = segmentEnd - segmentStart;
  float sampleLength = segmentLength / float(VIEW_SAMPLES);
  float sampleLengthScaleHeights = sampleLength / presentationThickness * uPhysicalExtentScaleHeights;
  float verticalIntegral = max(1.0 - exp(-uPhysicalExtentScaleHeights), EPSILON);
  float integratedDensityScaleHeights = 0.0;
  vec3 integratedScattering = vec3(0.0);
  vec3 viewDirection = -rayDirection;

  // Fixed-cost view integration. The light path is an analytic local-depth
  // approximation; there is no nested or adaptive light raymarch.
  for (int sampleIndex = 0; sampleIndex < VIEW_SAMPLES; sampleIndex++) {
    float sampleFraction = (float(sampleIndex) + 0.5) / float(VIEW_SAMPLES);
    float distanceAlongRay = segmentStart + segmentLength * sampleFraction;
    vec3 samplePosition = rayOrigin + rayDirection * distanceAlongRay;
    vec3 fromCenter = samplePosition - uBodyCenter;
    float radialDistance = length(fromCenter);
    vec3 localNormal = normalize(fromCenter);
    float altitudeFraction = clamp((radialDistance - uBodyRadius) / presentationThickness, 0.0, 1.0);
    float altitudeScaleHeights = altitudeFraction * uPhysicalExtentScaleHeights;
    float density = exp(-altitudeScaleHeights);
    float sampleColumn = density * sampleLengthScaleHeights;
    integratedDensityScaleHeights += sampleColumn;

    for (int lightIndex = 0; lightIndex < ${shaderLightCount}; lightIndex++) {
      if (float(lightIndex) >= uLightCount) continue;
      vec3 lightDirection = normalize(uLightDirections[lightIndex]);
      float lightZenithCosine = dot(localNormal, lightDirection);
      float dayFactor = smoothstep(-0.18, 0.08, lightZenithCosine);
      if (dayFactor <= 0.0001) continue;
      float lightPathFactor = 1.0 / max(0.12, lightZenithCosine + 0.20);
      float verticalDepthAboveSample = uReferenceVerticalOpticalDepth * exp(-altitudeScaleHeights);
      float absorptionMean = (uAbsorption.r + uAbsorption.g + uAbsorption.b) / 3.0;
      float transmittance = exp(-absorptionMean * verticalDepthAboveSample * lightPathFactor);
      float phaseCosine = dot(viewDirection, lightDirection);
      vec3 scatteringSource = uRayleighScattering * rayleighPhase(phaseCosine) * 4.0
        + uMieScattering * miePhase(phaseCosine, uMieAnisotropy) * 0.3;
      scatteringSource *= DISPLAY_CHROMATICITY;
      integratedScattering += scatteringSource
        * uLightChromaticities[lightIndex]
        * uLightIrradiances[lightIndex]
        * transmittance
        * dayFactor
        * sampleColumn / verticalIntegral;
    }
  }

  float densityPath = integratedDensityScaleHeights / verticalIntegral;
  float viewOpticalDepth = uReferenceVerticalOpticalDepth * densityPath;
  float alpha = clamp(1.0 - exp(-viewOpticalDepth), 0.0, 0.94);
  float limbGain = mix(1.0, LIMB_DISPLAY_GAIN, smoothstep(1.0, 4.0, densityPath));
  vec3 radiance = integratedScattering * DISPLAY_GAIN * limbGain;
  radiance = radiance / (vec3(1.0) + radiance);
  // The material uses premultiplied-alpha blending. Emit premultiplied
  // scattering so the transparent shell preserves the background instead of
  // darkening it wherever the integrated source is below the clear color.
  gl_FragColor = vec4(radiance * alpha, alpha);
}
`;
}

function lightUniformValues(illumination: StellarIlluminationSet | undefined): {
  readonly directions: THREE.Vector3[];
  readonly chromaticities: THREE.Vector3[];
  readonly irradiances: number[];
  readonly lightCount: number;
} {
  const contributions = illumination?.contributions ?? [];
  const directions = contributions.map((contribution) => new THREE.Vector3(
    contribution.directionToEmitter.x,
    contribution.directionToEmitter.y,
    contribution.directionToEmitter.z,
  ).normalize());
  const chromaticities = contributions.map((contribution) => new THREE.Vector3(
    contribution.linearChromaticity.r,
    contribution.linearChromaticity.g,
    contribution.linearChromaticity.b,
  ));
  const irradiances = contributions.map((contribution) => contribution.exposureMappedIrradiance);
  const lightCount = contributions.length;
  if (directions.length === 0) directions.push(new THREE.Vector3(0, 1, 0));
  if (chromaticities.length === 0) chromaticities.push(new THREE.Vector3(1, 1, 1));
  if (irradiances.length === 0) irradiances.push(0);
  return { directions, chromaticities, irradiances, lightCount };
}

function atmosphereMaterial(
  atmosphere: AtmosphereAppearance,
  optics: ResolvedAtmosphereOptics,
  bodyCenter: THREE.Vector3,
  bodyRadiusSceneUnits: number,
  atmosphereRadiusSceneUnits: number,
  illumination: StellarIlluminationSet | undefined,
): { readonly material: THREE.ShaderMaterial; readonly lightCount: number } {
  const lights = lightUniformValues(illumination);
  const shaderLightCount = Math.max(1, lights.lightCount);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uBodyCenter: { value: bodyCenter.clone() },
      uBodyRadius: { value: bodyRadiusSceneUnits },
      uAtmosphereRadius: { value: atmosphereRadiusSceneUnits },
      uPhysicalExtentScaleHeights: { value: ATMOSPHERE_PHYSICAL_EXTENT_SCALE_HEIGHTS },
      uRayleighScattering: { value: new THREE.Vector3(optics.rayleighScattering.r, optics.rayleighScattering.g, optics.rayleighScattering.b) },
      uMieScattering: { value: new THREE.Vector3(optics.mieScattering.r, optics.mieScattering.g, optics.mieScattering.b) },
      uAbsorption: { value: new THREE.Vector3(optics.absorption.r, optics.absorption.g, optics.absorption.b) },
      uReferenceVerticalOpticalDepth: { value: optics.referenceVerticalOpticalDepth },
      uMieAnisotropy: { value: optics.mieAnisotropy },
      uLightCount: { value: lights.lightCount },
      uLightDirections: { value: lights.directions.slice(0, shaderLightCount) },
      uLightChromaticities: { value: lights.chromaticities.slice(0, shaderLightCount) },
      uLightIrradiances: { value: lights.irradiances.slice(0, shaderLightCount) },
    },
    vertexShader: ATMOSPHERE_VERTEX_SHADER,
    fragmentShader: atmosphereFragmentShader(lights.lightCount),
    transparent: true,
    premultipliedAlpha: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.FrontSide,
    blending: THREE.NormalBlending,
    toneMapped: true,
  });
  void atmosphere;
  return { material, lightCount: lights.lightCount };
}

function setAtmosphereUniforms(
  material: THREE.ShaderMaterial,
  bodyCenter: THREE.Vector3,
  bodyRadiusSceneUnits: number,
  atmosphereRadiusSceneUnits: number,
  optics: ResolvedAtmosphereOptics,
  illumination: StellarIlluminationSet | undefined,
): void {
  const lights = lightUniformValues(illumination);
  material.uniforms.uBodyCenter!.value.copy(bodyCenter);
  material.uniforms.uBodyRadius!.value = bodyRadiusSceneUnits;
  material.uniforms.uAtmosphereRadius!.value = atmosphereRadiusSceneUnits;
  material.uniforms.uPhysicalExtentScaleHeights!.value = ATMOSPHERE_PHYSICAL_EXTENT_SCALE_HEIGHTS;
  material.uniforms.uRayleighScattering!.value.set(optics.rayleighScattering.r, optics.rayleighScattering.g, optics.rayleighScattering.b);
  material.uniforms.uMieScattering!.value.set(optics.mieScattering.r, optics.mieScattering.g, optics.mieScattering.b);
  material.uniforms.uAbsorption!.value.set(optics.absorption.r, optics.absorption.g, optics.absorption.b);
  material.uniforms.uReferenceVerticalOpticalDepth!.value = optics.referenceVerticalOpticalDepth;
  material.uniforms.uMieAnisotropy!.value = optics.mieAnisotropy;
  material.uniforms.uLightDirections!.value = lights.directions;
  material.uniforms.uLightChromaticities!.value = lights.chromaticities;
  material.uniforms.uLightIrradiances!.value = lights.irradiances;
  material.uniforms.uLightCount!.value = lights.lightCount;
}

export class AtmosphereShellManager {
  readonly #scene: THREE.Scene;
  readonly #geometry: THREE.SphereGeometry;
  readonly #shells = new Map<ObjectId, AtmosphereShellRecord>();
  readonly #enabledByBody = new Map<ObjectId, boolean>();

  constructor(scene: THREE.Scene) {
    this.#scene = scene;
    this.#geometry = new THREE.SphereGeometry(1, 40, 28);
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

      const physicalRadiusMeters = entry.record.properties.physicalRadius
        ?? entry.definition.properties.physicalRadius
        ?? 0;
      if (physicalRadiusMeters <= 0) {
        this.remove(bodyId);
        this.#enabledByBody.delete(bodyId);
        continue;
      }
      const distance = Math.max(camera.position.distanceTo(position), presentedRadius * 2, Number.EPSILON);
      const fieldOfView = camera.fov * Math.PI / 180;
      const projectedRadius = projectedRadiusPixels(presentedRadius, distance, fieldOfView, viewportHeightPixels);
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
      const physicalExtentMeters = atmosphere.scaleHeightMeters * ATMOSPHERE_PHYSICAL_EXTENT_SCALE_HEIGHTS;
      const physicalPresentationThickness = presentedRadius * physicalExtentMeters / physicalRadiusMeters;
      const presentationThickness = presentationAtmosphereThickness(
        physicalPresentationThickness,
        presentedRadius,
        pixelsPerSceneUnit,
      );
      const atmosphereRadius = presentedRadius + presentationThickness;
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
          atmosphereRadius,
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
        setAtmosphereUniforms(
          shell.material,
          bodyCenter,
          presentedRadius,
          atmosphereRadius,
          optics,
          illumination,
        );
        shell.presentationThicknessSceneUnits = presentationThickness;
        shell.projectedDiameterPixels = projectedDiameter;
        shell.opticalSource = optics.source;
      }
      shell.mesh.position.copy(position);
      shell.mesh.scale.setScalar(atmosphereRadius);
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
      physicalExtentScaleHeights: ATMOSPHERE_PHYSICAL_EXTENT_SCALE_HEIGHTS,
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
