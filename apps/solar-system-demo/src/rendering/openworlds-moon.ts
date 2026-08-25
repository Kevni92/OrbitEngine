import * as THREE from "three";
import { Planet } from "@funsoftware/planettech";

const HEIGHT_MAP_SIZE = 128;
const MOON_TERRAIN_ENTER_RADIUS_MULTIPLIER = 18;
const MOON_TERRAIN_EXIT_RADIUS_MULTIPLIER = 24;
const MOON_TERRAIN_LEVELS = 1;
const MOON_TERRAIN_RESOLUTION = 48;
const MOON_TERRAIN_CLOSE_RESOLUTION = 192;
const MOON_TERRAIN_NEAR_RESOLUTION = 320;
const MOON_TERRAIN_CLOSE_RADIUS_MULTIPLIER = 8;
const MOON_TERRAIN_NEAR_RADIUS_MULTIPLIER = 4.25;
const MOON_TERRAIN_DISPLACEMENT_FRACTION = 0.14;

export interface OpenWorldsMoonDiagnostics {
  readonly initialized: boolean;
  readonly active: boolean;
  readonly source: "OpenWorlds fork b1fe8ae + representative lunar height cube";
  readonly threeVersion: string;
  readonly radiusSceneUnits: number;
  readonly displacementSceneUnits: number;
  readonly cameraDistanceSceneUnits: number;
  readonly enterDistanceSceneUnits: number;
  readonly exitDistanceSceneUnits: number;
  readonly visibleMeshCount: number;
  readonly visibleTriangleCount: number;
  readonly lodLevel: "coarse" | "close" | "near";
  readonly heightMapBytes: number;
  readonly geometryBytes: number;
  readonly position: Readonly<{ x: number; y: number; z: number }>;
  readonly orientation: Readonly<{ w: number; x: number; y: number; z: number }>;
  readonly instant?: Readonly<{ seconds: number; nanoseconds: number }>;
}

interface OpenWorldsMoonUpdate {
  readonly camera: THREE.Camera;
  readonly position: THREE.Vector3;
  readonly orientation: THREE.Quaternion;
  readonly directionToSun?: THREE.Vector3;
  readonly radiusSceneUnits: number;
  readonly instant: Readonly<{ seconds: number; nanoseconds: number }>;
}

const LUNAR_HEIGHT_GLSL = `
float openWorldsHash(vec3 value) {
  value = fract(value * 0.3183099 + vec3(0.17, 0.31, 0.47));
  value *= 17.0;
  return fract(value.x * value.y * value.z * (value.x + value.y + value.z));
}

float openWorldsNoise(vec3 value) {
  vec3 cell = floor(value);
  vec3 fraction = fract(value);
  fraction = fraction * fraction * (3.0 - 2.0 * fraction);
  float c000 = openWorldsHash(cell + vec3(0.0, 0.0, 0.0));
  float c100 = openWorldsHash(cell + vec3(1.0, 0.0, 0.0));
  float c010 = openWorldsHash(cell + vec3(0.0, 1.0, 0.0));
  float c110 = openWorldsHash(cell + vec3(1.0, 1.0, 0.0));
  float c001 = openWorldsHash(cell + vec3(0.0, 0.0, 1.0));
  float c101 = openWorldsHash(cell + vec3(1.0, 0.0, 1.0));
  float c011 = openWorldsHash(cell + vec3(0.0, 1.0, 1.0));
  float c111 = openWorldsHash(cell + vec3(1.0, 1.0, 1.0));
  float x00 = mix(c000, c100, fraction.x);
  float x10 = mix(c010, c110, fraction.x);
  float x01 = mix(c001, c101, fraction.x);
  float x11 = mix(c011, c111, fraction.x);
  return mix(mix(x00, x10, fraction.y), mix(x01, x11, fraction.y), fraction.z);
}

float openWorldsFbm(vec3 value) {
  float result = 0.0;
  float amplitude = 0.5;
  for (int octave = 0; octave < 4; octave++) {
    result += openWorldsNoise(value) * amplitude;
    value = value * 2.03 + vec3(11.7, 3.1, 7.9);
    amplitude *= 0.5;
  }
  return result;
}

void openWorldsApplyCrater(inout float value, vec3 direction, vec3 center, float radius, float depth) {
  float craterDistance = acos(clamp(dot(direction, normalize(center)), -1.0, 1.0));
  value -= depth * exp(-pow(craterDistance / radius, 2.0) * 2.6);
  value += depth * 0.34 * exp(-pow((craterDistance - radius * 1.05) / (radius * 0.22), 2.0));
}

float openWorldsLunarHeight(vec3 direction) {
  float value = 0.46
    + (openWorldsFbm(direction * 5.5) - 0.5) * 0.10
    + (openWorldsNoise(direction * 26.0) - 0.5) * 0.035;
  openWorldsApplyCrater(value, direction, vec3(0.18, 0.36, 0.92), 0.17, 0.24);
  openWorldsApplyCrater(value, direction, vec3(-0.62, 0.24, 0.74), 0.12, 0.18);
  openWorldsApplyCrater(value, direction, vec3(0.45, -0.62, 0.64), 0.085, 0.14);
  openWorldsApplyCrater(value, direction, vec3(-0.28, -0.78, -0.56), 0.052, 0.10);
  openWorldsApplyCrater(value, direction, vec3(0.72, 0.56, -0.41), 0.038, 0.075);
  openWorldsApplyCrater(value, direction, vec3(-0.82, -0.26, 0.43), 0.03, 0.06);
  openWorldsApplyCrater(value, direction, vec3(0.0, 0.0, 1.0), 0.20, 0.20);
  openWorldsApplyCrater(value, direction, vec3(0.66, 0.12, 0.74), 0.10, 0.13);
  openWorldsApplyCrater(value, direction, vec3(-0.48, 0.52, 0.71), 0.09, 0.11);
  openWorldsApplyCrater(value, direction, vec3(0.12, -0.38, 0.91), 0.065, 0.08);
  openWorldsApplyCrater(value, direction, vec3(-0.70, -0.60, 0.25), 0.05, 0.07);
  openWorldsApplyCrater(value, direction, vec3(0.86, -0.28, -0.42), 0.04, 0.06);

  return clamp(value, 0.0, 1.0);
}

float openWorldsTerrainHeight(vec3 direction) {
  float detailScale = max(openWorldsDetailScale, 1.0);
  float value = openWorldsLunarHeight(direction);
  value += (openWorldsNoise(direction * (82.0 * detailScale)) - 0.5) * 0.045 * (detailScale - 1.0);
  return clamp(value, 0.0, 1.0);
}
`;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function hash3(x: number, y: number, z: number): number {
  const value = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return value - Math.floor(value);
}

function smoothNoise(direction: THREE.Vector3, scale: number): number {
  const x = direction.x * scale;
  const y = direction.y * scale;
  const z = direction.z * scale;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const sz = fz * fz * (3 - 2 * fz);
  const x00 = THREE.MathUtils.lerp(hash3(ix, iy, iz), hash3(ix + 1, iy, iz), sx);
  const x10 = THREE.MathUtils.lerp(hash3(ix, iy + 1, iz), hash3(ix + 1, iy + 1, iz), sx);
  const x01 = THREE.MathUtils.lerp(hash3(ix, iy, iz + 1), hash3(ix + 1, iy, iz + 1), sx);
  const x11 = THREE.MathUtils.lerp(hash3(ix, iy + 1, iz + 1), hash3(ix + 1, iy + 1, iz + 1), sx);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(x00, x10, sy), THREE.MathUtils.lerp(x01, x11, sy), sz);
}

function fractalNoise(direction: THREE.Vector3): number {
  const sample = direction.clone();
  let result = 0;
  let amplitude = 0.5;
  for (let octave = 0; octave < 4; octave += 1) {
    result += smoothNoise(sample, 5.5) * amplitude;
    sample.multiplyScalar(2.03).add(new THREE.Vector3(11.7, 3.1, 7.9));
    amplitude *= 0.5;
  }
  return result;
}

const CRATER_CENTERS = [
  { direction: new THREE.Vector3(0.18, 0.36, 0.92).normalize(), radius: 0.17, depth: 0.24 },
  { direction: new THREE.Vector3(-0.62, 0.24, 0.74).normalize(), radius: 0.12, depth: 0.18 },
  { direction: new THREE.Vector3(0.45, -0.62, 0.64).normalize(), radius: 0.085, depth: 0.14 },
  { direction: new THREE.Vector3(-0.28, -0.78, -0.56).normalize(), radius: 0.052, depth: 0.10 },
  { direction: new THREE.Vector3(0.72, 0.56, -0.41).normalize(), radius: 0.038, depth: 0.075 },
  { direction: new THREE.Vector3(-0.82, -0.26, 0.43).normalize(), radius: 0.03, depth: 0.06 },
  { direction: new THREE.Vector3(0, 0, 1).normalize(), radius: 0.20, depth: 0.20 },
  { direction: new THREE.Vector3(0.66, 0.12, 0.74).normalize(), radius: 0.10, depth: 0.13 },
  { direction: new THREE.Vector3(-0.48, 0.52, 0.71).normalize(), radius: 0.09, depth: 0.11 },
  { direction: new THREE.Vector3(0.12, -0.38, 0.91).normalize(), radius: 0.065, depth: 0.08 },
  { direction: new THREE.Vector3(-0.70, -0.60, 0.25).normalize(), radius: 0.05, depth: 0.07 },
  { direction: new THREE.Vector3(0.86, -0.28, -0.42).normalize(), radius: 0.04, depth: 0.06 },
];

function craterHeight(direction: THREE.Vector3): number {
  let value = 0.46 + (fractalNoise(direction) - 0.5) * 0.10 + (smoothNoise(direction, 26) - 0.5) * 0.035;
  for (const crater of CRATER_CENTERS) {
    const distance = Math.acos(clamp01((direction.dot(crater.direction) + 1) / 2) * 2 - 1);
    const bowl = Math.exp(-((distance / crater.radius) ** 2) * 2.6);
    const rim = Math.exp(-(((distance - crater.radius * 1.05) / (crater.radius * 0.22)) ** 2));
    value -= crater.depth * bowl;
    value += crater.depth * 0.34 * rim;
  }
  return clamp01(value);
}

function cubeFaceDirection(face: number, u: number, v: number, target: THREE.Vector3): THREE.Vector3 {
  const x = u * 2 - 1;
  const y = v * 2 - 1;
  switch (face) {
    case 0: return target.set(1, y, x).normalize();
    case 1: return target.set(-1, y, -x).normalize();
    case 2: return target.set(-x, 1, -y).normalize();
    case 3: return target.set(-x, -1, y).normalize();
    case 4: return target.set(-x, y, 1).normalize();
    default: return target.set(x, y, -1).normalize();
  }
}

function createHeightCubeTexture(): THREE.CubeTexture {
  const faces: THREE.DataTexture[] = [];
  const direction = new THREE.Vector3();
  for (let face = 0; face < 6; face += 1) {
    const pixels = new Uint8Array(HEIGHT_MAP_SIZE * HEIGHT_MAP_SIZE * 4);
    for (let y = 0; y < HEIGHT_MAP_SIZE; y += 1) {
      for (let x = 0; x < HEIGHT_MAP_SIZE; x += 1) {
        const value = Math.round(craterHeight(cubeFaceDirection(
          face,
          (x + 0.5) / HEIGHT_MAP_SIZE,
          (y + 0.5) / HEIGHT_MAP_SIZE,
          direction,
        )) * 255);
        const offset = (y * HEIGHT_MAP_SIZE + x) * 4;
        pixels[offset] = value;
        pixels[offset + 1] = value;
        pixels[offset + 2] = value;
        pixels[offset + 3] = 255;
      }
    }
    const faceTexture = new THREE.DataTexture(pixels, HEIGHT_MAP_SIZE, HEIGHT_MAP_SIZE, THREE.RGBAFormat);
    faceTexture.needsUpdate = true;
    faces.push(faceTexture);
  }
  const texture = new THREE.CubeTexture(faces);
  texture.name = "Representative lunar crater height cube";
  texture.colorSpace = THREE.NoColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function createTerrainMaterial(heightTexture: THREE.CubeTexture, displacementSceneUnits: number): THREE.MeshPhongMaterial {
  const material = new THREE.MeshPhongMaterial({
    color: 0x9ca1aa,
    emissive: 0x000000,
    emissiveIntensity: 0,
    shininess: 3,
    specular: 0x15171c,
    side: THREE.FrontSide,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.openWorldsHeightMap = { value: heightTexture };
    shader.uniforms.openWorldsDisplacement = { value: displacementSceneUnits };
    shader.uniforms.openWorldsDetailScale = { value: material.userData.openWorldsDetailScale ?? 1 };
    material.userData.openWorldsDetailScaleUniform = shader.uniforms.openWorldsDetailScale;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
uniform samplerCube openWorldsHeightMap;
uniform float openWorldsDisplacement;
uniform float openWorldsDetailScale;
varying vec3 vOpenWorldsTerrainDirection;
${LUNAR_HEIGHT_GLSL}`,
      )
      .replace(
        "#include <beginnormal_vertex>",
        `
          vec3 objectNormal = vec3( normal );
          vec3 terrainNormalDirection = normalize(position);
          vec3 terrainNormalAxis = abs(terrainNormalDirection.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
          vec3 terrainNormalTangent = normalize(cross(terrainNormalAxis, terrainNormalDirection));
          vec3 terrainNormalBitangent = normalize(cross(terrainNormalDirection, terrainNormalTangent));
          float terrainNormalHeight = mix(openWorldsTerrainHeight(terrainNormalDirection), texture(openWorldsHeightMap, terrainNormalDirection).r, 0.08);
          float terrainNormalEpsilon = 0.035;
          float terrainNormalTangentHeight = mix(openWorldsTerrainHeight(normalize(terrainNormalDirection + terrainNormalTangent * terrainNormalEpsilon)), texture(openWorldsHeightMap, normalize(terrainNormalDirection + terrainNormalTangent * terrainNormalEpsilon)).r, 0.08);
          float terrainNormalTangentBackHeight = mix(openWorldsTerrainHeight(normalize(terrainNormalDirection - terrainNormalTangent * terrainNormalEpsilon)), texture(openWorldsHeightMap, normalize(terrainNormalDirection - terrainNormalTangent * terrainNormalEpsilon)).r, 0.08);
          float terrainNormalBitangentHeight = mix(openWorldsTerrainHeight(normalize(terrainNormalDirection + terrainNormalBitangent * terrainNormalEpsilon)), texture(openWorldsHeightMap, normalize(terrainNormalDirection + terrainNormalBitangent * terrainNormalEpsilon)).r, 0.08);
          float terrainNormalBitangentBackHeight = mix(openWorldsTerrainHeight(normalize(terrainNormalDirection - terrainNormalBitangent * terrainNormalEpsilon)), texture(openWorldsHeightMap, normalize(terrainNormalDirection - terrainNormalBitangent * terrainNormalEpsilon)).r, 0.08);
          objectNormal = normalize(objectNormal
            - terrainNormalTangent * ((terrainNormalTangentHeight - terrainNormalTangentBackHeight) * openWorldsDisplacement / (2.0 * terrainNormalEpsilon))
            - terrainNormalBitangent * ((terrainNormalBitangentHeight - terrainNormalBitangentBackHeight) * openWorldsDisplacement / (2.0 * terrainNormalEpsilon)));
        `,
      )
      .replace(
        "#include <begin_vertex>",
        `
          vec3 terrainDirection = normalize(position);
          vOpenWorldsTerrainDirection = terrainDirection;
          float terrainHeight = mix(openWorldsTerrainHeight(terrainDirection), texture(openWorldsHeightMap, terrainDirection).r, 0.08);
          vec3 transformed = position + terrainDirection * ((terrainHeight - 0.5) * openWorldsDisplacement);
        `,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
uniform samplerCube openWorldsHeightMap;
uniform float openWorldsDetailScale;
varying vec3 vOpenWorldsTerrainDirection;
${LUNAR_HEIGHT_GLSL}`,
      )
      .replace(
        "#include <color_fragment>",
        `
          #include <color_fragment>
          vec3 terrainColorDirection = normalize(vOpenWorldsTerrainDirection);
          float terrainColorHeight = mix(openWorldsTerrainHeight(terrainColorDirection), texture(openWorldsHeightMap, terrainColorDirection).r, 0.08);
          float terrainRockNoise = openWorldsFbm(terrainColorDirection * (18.0 * openWorldsDetailScale));
          float terrainMicroNoise = openWorldsNoise(terrainColorDirection * (82.0 * openWorldsDetailScale));
          float terrainCraterShade = smoothstep(0.28, 0.58, terrainColorHeight);
          vec3 lunarAlbedo = mix(vec3(0.72, 0.74, 0.78), vec3(1.04, 1.01, 0.96), terrainCraterShade);
          lunarAlbedo *= mix(0.88, 1.08, terrainRockNoise);
          lunarAlbedo *= mix(0.84, 1.16, terrainMicroNoise);
          diffuseColor.rgb *= lunarAlbedo;
        `,
      );
    material.userData.openWorldsShader = shader;
  };
  material.customProgramCacheKey = () => "orbit-engine-openworlds-moon-terrain-v2";
  return material;
}

function identityQuaternion(): THREE.Quaternion {
  return new THREE.Quaternion();
}

export class OpenWorldsMoonRenderer {
  readonly #root = new THREE.Group();
  readonly #heightTexture: THREE.CubeTexture;
  readonly #ambientLight: THREE.AmbientLight;
  readonly #directionalLight: THREE.DirectionalLight;
  readonly #directionalTarget: THREE.Object3D;
  #coarsePlanet: Planet | undefined;
  #closePlanet: Planet | undefined;
  #nearPlanet: Planet | undefined;
  #activePlanet: Planet | undefined;
  #activeLod: "coarse" | "close" | "near" = "coarse";
  #material: THREE.MeshPhongMaterial | undefined;
  #radiusSceneUnits = 0;
  #displacementSceneUnits = 0;
  #active = false;
  #initialized = false;
  #cameraDistanceSceneUnits = Number.POSITIVE_INFINITY;
  #position = new THREE.Vector3();
  #orientation = identityQuaternion();
  #instant: Readonly<{ seconds: number; nanoseconds: number }> | undefined;

  constructor(scene: THREE.Scene) {
    this.#root.name = "OpenWorlds Moon terrain (Spike #240)";
    this.#root.visible = false;
    this.#heightTexture = createHeightCubeTexture();
    this.#ambientLight = new THREE.AmbientLight(0x767b88, 0.08);
    this.#directionalLight = new THREE.DirectionalLight(0xfff2d6, 2.1);
    this.#directionalLight.position.set(3, -4, 5);
    this.#directionalTarget = new THREE.Object3D();
    this.#directionalTarget.position.set(0, 0, 0);
    this.#root.add(this.#ambientLight, this.#directionalLight, this.#directionalTarget);
    this.#directionalLight.target = this.#directionalTarget;
    scene.add(this.#root);
  }

  update(value: OpenWorldsMoonUpdate): boolean {
    if (!Number.isFinite(value.radiusSceneUnits) || value.radiusSceneUnits <= 0) return false;
    this.#position.copy(value.position);
    this.#orientation.copy(value.orientation).normalize();
    this.#instant = Object.freeze({ ...value.instant });
    this.#root.position.copy(this.#position);
    this.#root.quaternion.copy(this.#orientation);
    if (value.directionToSun !== undefined && value.directionToSun.lengthSq() > Number.EPSILON) {
      const localDirectionToSun = value.directionToSun.clone()
        .normalize()
        .applyQuaternion(this.#root.quaternion.clone().invert());
      this.#directionalLight.position.copy(localDirectionToSun).multiplyScalar(5);
    }
    this.#cameraDistanceSceneUnits = value.camera.position.distanceTo(this.#position);
    if (!this.#initialized || Math.abs(this.#radiusSceneUnits - value.radiusSceneUnits) > Number.EPSILON) {
      this.#initialize(value.radiusSceneUnits);
    }
    const enterDistance = this.#radiusSceneUnits * MOON_TERRAIN_ENTER_RADIUS_MULTIPLIER;
    const exitDistance = this.#radiusSceneUnits * MOON_TERRAIN_EXIT_RADIUS_MULTIPLIER;
    this.#active = this.#active
      ? this.#cameraDistanceSceneUnits <= exitDistance
      : this.#cameraDistanceSceneUnits <= enterDistance;
    this.#root.visible = this.#active;
    if (this.#active && this.#activePlanet !== undefined) {
      const localCameraPosition = value.camera.position.clone()
        .sub(this.#root.position)
        .applyQuaternion(this.#root.quaternion.clone().invert());
      this.#activePlanet.primitive.update({ position: localCameraPosition });
    }
    this.#selectLod();
    return this.#active;
  }

  active(): boolean { return this.#active; }
  root(): THREE.Group { return this.#root; }

  diagnostics(): OpenWorldsMoonDiagnostics {
    let visibleMeshCount = 0;
    let visibleTriangleCount = 0;
    this.#activePlanet?.traverse((node) => {
      if (!(node instanceof THREE.Mesh) || !node.visible) return;
      visibleMeshCount += 1;
      const index = node.geometry.getIndex();
      visibleTriangleCount += (index?.count ?? node.geometry.getAttribute("position")?.count ?? 0) / 3;
    });
    return Object.freeze({
      initialized: this.#initialized,
      active: this.#active,
      source: "OpenWorlds fork b1fe8ae + representative lunar height cube",
      threeVersion: THREE.REVISION,
      radiusSceneUnits: this.#radiusSceneUnits,
      displacementSceneUnits: this.#displacementSceneUnits,
      cameraDistanceSceneUnits: this.#cameraDistanceSceneUnits,
      enterDistanceSceneUnits: this.#radiusSceneUnits * MOON_TERRAIN_ENTER_RADIUS_MULTIPLIER,
      exitDistanceSceneUnits: this.#radiusSceneUnits * MOON_TERRAIN_EXIT_RADIUS_MULTIPLIER,
      visibleMeshCount,
      visibleTriangleCount,
      lodLevel: this.#activeLod,
      heightMapBytes: HEIGHT_MAP_SIZE * HEIGHT_MAP_SIZE * 4 * 6,
      geometryBytes: visibleMeshCount * ((this.#activeLod === "near"
        ? MOON_TERRAIN_NEAR_RESOLUTION
        : this.#activeLod === "close" ? MOON_TERRAIN_CLOSE_RESOLUTION : MOON_TERRAIN_RESOLUTION) + 1) ** 2 * (3 + 3 + 2) * 4,
      position: Object.freeze({ x: this.#position.x, y: this.#position.y, z: this.#position.z }),
      orientation: Object.freeze({ w: this.#orientation.w, x: this.#orientation.x, y: this.#orientation.y, z: this.#orientation.z }),
      ...(this.#instant === undefined ? {} : { instant: this.#instant }),
    });
  }

  dispose(): void {
    this.#root.removeFromParent();
    this.#disposePlanet(this.#coarsePlanet);
    this.#disposePlanet(this.#closePlanet);
    this.#disposePlanet(this.#nearPlanet);
    this.#material?.dispose();
    this.#heightTexture.dispose();
    this.#root.clear();
    this.#coarsePlanet = undefined;
    this.#closePlanet = undefined;
    this.#nearPlanet = undefined;
    this.#activePlanet = undefined;
    this.#material = undefined;
    this.#initialized = false;
  }

  #initialize(radiusSceneUnits: number): void {
    this.#disposePlanet(this.#coarsePlanet);
    this.#disposePlanet(this.#closePlanet);
    this.#disposePlanet(this.#nearPlanet);
    this.#coarsePlanet = undefined;
    this.#closePlanet = undefined;
    this.#nearPlanet = undefined;
    this.#material?.dispose();
    this.#radiusSceneUnits = radiusSceneUnits;
    this.#displacementSceneUnits = radiusSceneUnits * MOON_TERRAIN_DISPLACEMENT_FRACTION;
    // OpenWorlds' normalized cube geometry adds one unit after multiplying by
    // its configured radius. Keep the fork in its native unit sphere and use
    // the parent scale for the OrbitEngine physical radius.
    this.#material = createTerrainMaterial(
      this.#heightTexture,
      MOON_TERRAIN_DISPLACEMENT_FRACTION * 2,
    );
    this.#coarsePlanet = this.#createPlanet(MOON_TERRAIN_RESOLUTION);
    this.#coarsePlanet.name = "OpenWorlds lunar terrain planet (coarse)";
    this.#coarsePlanet.visible = true;
    this.#activePlanet = this.#coarsePlanet;
    this.#activeLod = "coarse";
    this.#setDetailScale();
    this.#root.add(this.#coarsePlanet);
    this.#initialized = true;
  }

  #createPlanet(resolution: number): Planet {
    const planet = new Planet();
    planet.initSphere({
      offset: 0.8,
      levels: MOON_TERRAIN_LEVELS,
      size: 2,
      radius: 1,
      resolution,
      dimension: 1,
      useWorkers: false,
      material: this.#material,
    });
    planet.create();
    planet.scale.setScalar(this.#radiusSceneUnits / 2);
    return planet;
  }

  #selectLod(): void {
    if (this.#coarsePlanet === undefined) return;
    const nextLod = this.#cameraDistanceSceneUnits <= this.#radiusSceneUnits * MOON_TERRAIN_NEAR_RADIUS_MULTIPLIER
      ? "near"
      : this.#cameraDistanceSceneUnits <= this.#radiusSceneUnits * MOON_TERRAIN_CLOSE_RADIUS_MULTIPLIER
        ? "close"
        : "coarse";
    if ((nextLod === "close" || nextLod === "near") && this.#closePlanet === undefined) {
      this.#closePlanet = this.#createPlanet(MOON_TERRAIN_CLOSE_RESOLUTION);
      this.#closePlanet.name = "OpenWorlds lunar terrain planet (close)";
      this.#closePlanet.visible = false;
      this.#root.add(this.#closePlanet);
    }
    if (nextLod === "near" && this.#nearPlanet === undefined) {
      this.#nearPlanet = this.#createPlanet(MOON_TERRAIN_NEAR_RESOLUTION);
      this.#nearPlanet.name = "OpenWorlds lunar terrain planet (near)";
      this.#nearPlanet.visible = false;
      this.#root.add(this.#nearPlanet);
    }
    if (nextLod !== "coarse" && this.#closePlanet === undefined) return;
    if (nextLod === "near" && this.#nearPlanet === undefined) return;
    if (nextLod === this.#activeLod && this.#activePlanet !== undefined) return;
    this.#activeLod = nextLod;
    this.#activePlanet = nextLod === "near" ? this.#nearPlanet : nextLod === "close" ? this.#closePlanet : this.#coarsePlanet;
    this.#coarsePlanet.visible = nextLod === "coarse";
    if (this.#closePlanet !== undefined) this.#closePlanet.visible = nextLod === "close";
    if (this.#nearPlanet !== undefined) this.#nearPlanet.visible = nextLod === "near";
    this.#setDetailScale();
  }

  #setDetailScale(): void {
    const detailScale = this.#activeLod === "near" ? 1.8 : this.#activeLod === "close" ? 1.25 : 1;
    if (this.#material === undefined) return;
    this.#material.userData.openWorldsDetailScale = detailScale;
    const uniform = this.#material.userData.openWorldsDetailScaleUniform as { value: number } | undefined;
    if (uniform !== undefined) uniform.value = detailScale;
  }

  #disposePlanet(planet: Planet | undefined): void {
    if (planet === undefined) return;
    planet.traverse((node) => {
      if (node instanceof THREE.Mesh) node.geometry.dispose();
    });
    planet.removeFromParent();
  }
}
