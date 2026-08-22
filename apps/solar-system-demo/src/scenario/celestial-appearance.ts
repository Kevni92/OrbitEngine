import type { ObjectId } from "orbit-engine";

export const CELESTIAL_APPEARANCE_SCHEMA_VERSION = "1.0" as const;
export const APPEARANCE_FRACTION_TOLERANCE = 1e-6;
export const STELLAR_TEMPERATURE_RANGE_KELVIN = Object.freeze({ min: 1_000, max: 50_000 });

export type VisibleLayerKind = "solidSurface" | "iceSurface" | "cloudDeck";
export type OpticalMaterialId = string;
export type GasSpeciesId = string;

export interface LinearRgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export interface MaterialFraction {
  readonly materialId: OpticalMaterialId;
  readonly fraction: number;
}

export interface GasMixingRatio {
  readonly gasId: GasSpeciesId;
  readonly mixingRatio: number;
}

export interface AtmosphereOptics {
  readonly rayleighScattering: LinearRgb;
  readonly mieScattering: LinearRgb;
  readonly absorption: LinearRgb;
  readonly referenceVerticalOpticalDepth: number;
  readonly mieAnisotropy: number;
}

export interface HazeAerosol {
  readonly hazeId: string;
  readonly opticalDepthContribution: number;
  readonly calibratedScattering?: LinearRgb;
  readonly calibratedAbsorption?: LinearRgb;
  readonly mieAnisotropy?: number;
}

export interface CloudLayerAppearance {
  readonly lowerAltitudeMeters: number;
  readonly upperAltitudeMeters: number;
  readonly materialId: OpticalMaterialId;
  readonly coverageFraction: number;
  readonly opticalDepth: number;
  readonly calibratedReflectance?: LinearRgb;
  readonly visualAlbedo?: number;
}

export interface VisibleLayerAppearance {
  readonly kind: VisibleLayerKind;
  readonly composition: readonly MaterialFraction[];
  readonly calibratedReflectance?: LinearRgb;
  readonly visualAlbedo?: number;
}

export interface AtmosphereAppearance {
  readonly referencePressurePa: number;
  readonly scaleHeightMeters: number;
  readonly referenceAltitudeMeters?: number;
  readonly gases: readonly GasMixingRatio[];
  readonly optics?: AtmosphereOptics;
  readonly haze?: HazeAerosol;
  readonly cloudLayers: readonly CloudLayerAppearance[];
}

export interface StellarEmissionAppearance {
  readonly effectiveTemperatureKelvin: number;
  readonly luminosityWatts: number;
  readonly spectralClass?: string;
}

export interface AppearanceProvenance {
  readonly source: string;
  readonly sourceIdentifier: string;
  readonly sourceUrl?: string;
  readonly retrievalDate?: string;
  readonly fields: readonly string[];
  readonly normalization: string;
  readonly limitations: string;
}

export interface CelestialAppearance {
  readonly schemaVersion: typeof CELESTIAL_APPEARANCE_SCHEMA_VERSION;
  readonly visibleLayer?: VisibleLayerAppearance;
  readonly atmosphere?: AtmosphereAppearance;
  readonly stellarEmission?: StellarEmissionAppearance;
  readonly provenance: readonly AppearanceProvenance[];
}

export interface OpticalMaterialDefinition {
  readonly materialId: OpticalMaterialId;
  readonly linearReflectance: LinearRgb;
}

export interface OpticalGasDefinition {
  readonly gasId: GasSpeciesId;
  readonly rayleighScattering: LinearRgb;
}

export const OPTICAL_LIBRARY_VERSION = "demo-optics-1" as const;

export const OPTICAL_MATERIAL_LIBRARY: Readonly<Record<string, OpticalMaterialDefinition>> = Object.freeze({
  "silicate-regolith": Object.freeze({ materialId: "silicate-regolith", linearReflectance: Object.freeze({ r: 0.31, g: 0.28, b: 0.24 }) }),
  "basaltic-rock": Object.freeze({ materialId: "basaltic-rock", linearReflectance: Object.freeze({ r: 0.16, g: 0.18, b: 0.20 }) }),
  "iron-oxide-dust": Object.freeze({ materialId: "iron-oxide-dust", linearReflectance: Object.freeze({ r: 0.38, g: 0.15, b: 0.08 }) }),
  "carbonaceous-regolith": Object.freeze({ materialId: "carbonaceous-regolith", linearReflectance: Object.freeze({ r: 0.08, g: 0.07, b: 0.06 }) }),
  "water-ice": Object.freeze({ materialId: "water-ice", linearReflectance: Object.freeze({ r: 0.72, g: 0.82, b: 0.94 }) }),
  "methane-nitrogen-ice": Object.freeze({ materialId: "methane-nitrogen-ice", linearReflectance: Object.freeze({ r: 0.32, g: 0.43, b: 0.58 }) }),
  "sulfur-dioxide-frost": Object.freeze({ materialId: "sulfur-dioxide-frost", linearReflectance: Object.freeze({ r: 0.74, g: 0.64, b: 0.30 }) }),
  "tholin-organic": Object.freeze({ materialId: "tholin-organic", linearReflectance: Object.freeze({ r: 0.20, g: 0.08, b: 0.04 }) }),
  "ammonia-water-cloud": Object.freeze({ materialId: "ammonia-water-cloud", linearReflectance: Object.freeze({ r: 0.67, g: 0.70, b: 0.68 }) }),
  "sulfuric-acid-cloud": Object.freeze({ materialId: "sulfuric-acid-cloud", linearReflectance: Object.freeze({ r: 0.72, g: 0.58, b: 0.30 }) }),
  "neutral-gas-giant-cloud": Object.freeze({ materialId: "neutral-gas-giant-cloud", linearReflectance: Object.freeze({ r: 0.43, g: 0.40, b: 0.35 }) }),
});

export const OPTICAL_GAS_LIBRARY: Readonly<Record<string, OpticalGasDefinition>> = Object.freeze({
  N2: Object.freeze({ gasId: "N2", rayleighScattering: Object.freeze({ r: 0.20, g: 0.52, b: 1.00 }) }),
  O2: Object.freeze({ gasId: "O2", rayleighScattering: Object.freeze({ r: 0.18, g: 0.48, b: 0.96 }) }),
  CO2: Object.freeze({ gasId: "CO2", rayleighScattering: Object.freeze({ r: 0.14, g: 0.35, b: 0.72 }) }),
  Ar: Object.freeze({ gasId: "Ar", rayleighScattering: Object.freeze({ r: 0.16, g: 0.42, b: 0.82 }) }),
  CH4: Object.freeze({ gasId: "CH4", rayleighScattering: Object.freeze({ r: 0.13, g: 0.32, b: 0.64 }) }),
  H2: Object.freeze({ gasId: "H2", rayleighScattering: Object.freeze({ r: 0.10, g: 0.24, b: 0.48 }) }),
  He: Object.freeze({ gasId: "He", rayleighScattering: Object.freeze({ r: 0.09, g: 0.22, b: 0.44 }) }),
  NH3: Object.freeze({ gasId: "NH3", rayleighScattering: Object.freeze({ r: 0.12, g: 0.29, b: 0.58 }) }),
});

function fail(path: string, message: string): never {
  throw new RangeError(`Appearance ${path}: ${message}`);
}

function finite(path: string, value: number): void {
  if (!Number.isFinite(value)) fail(path, "must be finite");
}

function bounded(path: string, value: number, minimum: number, maximum: number): void {
  finite(path, value);
  if (value < minimum || value > maximum) fail(path, `must be within [${minimum}, ${maximum}]`);
}

function nonNegative(path: string, value: number): void {
  finite(path, value);
  if (value < 0) fail(path, "must be non-negative");
}

function nonEmpty(path: string, value: string): void {
  if (typeof value !== "string" || value.trim().length === 0) fail(path, "must be a non-empty string");
}

function validateLinearRgb(path: string, value: LinearRgb): void {
  bounded(`${path}.r`, value.r, 0, 1);
  bounded(`${path}.g`, value.g, 0, 1);
  bounded(`${path}.b`, value.b, 0, 1);
}

function validateFractions<T extends { readonly fraction?: number; readonly mixingRatio?: number; readonly materialId?: string; readonly gasId?: string }>(
  path: string,
  values: readonly T[],
  valueName: "fraction" | "mixingRatio",
  idName: "materialId" | "gasId",
): void {
  const ids = new Set<string>();
  let sum = 0;
  values.forEach((value, index) => {
    const id = value[idName];
    nonEmpty(`${path}[${index}].${idName}`, id ?? "");
    if (ids.has(id!)) fail(`${path}[${index}].${idName}`, `duplicate identifier ${id}`);
    ids.add(id!);
    const fraction = value[valueName];
    bounded(`${path}[${index}].${valueName}`, fraction ?? Number.NaN, 0, 1);
    sum += fraction!;
  });
  if (values.length > 0 && Math.abs(sum - 1) > APPEARANCE_FRACTION_TOLERANCE) {
    fail(path, `fractions must sum to 1 within ${APPEARANCE_FRACTION_TOLERANCE}`);
  }
}

function validateOptics(path: string, optics: AtmosphereOptics): void {
  validateLinearRgb(`${path}.rayleighScattering`, optics.rayleighScattering);
  validateLinearRgb(`${path}.mieScattering`, optics.mieScattering);
  validateLinearRgb(`${path}.absorption`, optics.absorption);
  nonNegative(`${path}.referenceVerticalOpticalDepth`, optics.referenceVerticalOpticalDepth);
  bounded(`${path}.mieAnisotropy`, optics.mieAnisotropy, -0.99, 0.99);
}

function validateAtmosphere(path: string, atmosphere: AtmosphereAppearance): void {
  nonNegative(`${path}.referencePressurePa`, atmosphere.referencePressurePa);
  finite(`${path}.scaleHeightMeters`, atmosphere.scaleHeightMeters);
  if (atmosphere.scaleHeightMeters <= 0) fail(`${path}.scaleHeightMeters`, "must be positive");
  if (atmosphere.referenceAltitudeMeters !== undefined) nonNegative(`${path}.referenceAltitudeMeters`, atmosphere.referenceAltitudeMeters);
  validateFractions(`${path}.gases`, atmosphere.gases, "mixingRatio", "gasId");
  if (atmosphere.optics !== undefined) validateOptics(`${path}.optics`, atmosphere.optics);
  if (atmosphere.haze !== undefined) {
    nonEmpty(`${path}.haze.hazeId`, atmosphere.haze.hazeId);
    nonNegative(`${path}.haze.opticalDepthContribution`, atmosphere.haze.opticalDepthContribution);
    if (atmosphere.haze.calibratedScattering !== undefined) validateLinearRgb(`${path}.haze.calibratedScattering`, atmosphere.haze.calibratedScattering);
    if (atmosphere.haze.calibratedAbsorption !== undefined) validateLinearRgb(`${path}.haze.calibratedAbsorption`, atmosphere.haze.calibratedAbsorption);
    if (atmosphere.haze.mieAnisotropy !== undefined) bounded(`${path}.haze.mieAnisotropy`, atmosphere.haze.mieAnisotropy, -0.99, 0.99);
  }
  let previousUpper = Number.NEGATIVE_INFINITY;
  atmosphere.cloudLayers.forEach((cloud, index) => {
    const cloudPath = `${path}.cloudLayers[${index}]`;
    finite(`${cloudPath}.lowerAltitudeMeters`, cloud.lowerAltitudeMeters);
    finite(`${cloudPath}.upperAltitudeMeters`, cloud.upperAltitudeMeters);
    if (cloud.lowerAltitudeMeters < 0) fail(`${cloudPath}.lowerAltitudeMeters`, "must be non-negative");
    if (cloud.upperAltitudeMeters <= cloud.lowerAltitudeMeters) fail(cloudPath, "upper altitude must be greater than lower altitude");
    if (cloud.lowerAltitudeMeters < previousUpper) fail(cloudPath, "cloud layers must be ordered by altitude");
    previousUpper = cloud.upperAltitudeMeters;
    nonEmpty(`${cloudPath}.materialId`, cloud.materialId);
    bounded(`${cloudPath}.coverageFraction`, cloud.coverageFraction, 0, 1);
    nonNegative(`${cloudPath}.opticalDepth`, cloud.opticalDepth);
    if (cloud.calibratedReflectance !== undefined) validateLinearRgb(`${cloudPath}.calibratedReflectance`, cloud.calibratedReflectance);
    if (cloud.visualAlbedo !== undefined) bounded(`${cloudPath}.visualAlbedo`, cloud.visualAlbedo, 0, 1);
  });
}

function validateProvenance(path: string, provenance: readonly AppearanceProvenance[]): void {
  if (provenance.length === 0) fail(path, "must contain at least one independent source record");
  provenance.forEach((source, index) => {
    const sourcePath = `${path}[${index}]`;
    nonEmpty(`${sourcePath}.source`, source.source);
    nonEmpty(`${sourcePath}.sourceIdentifier`, source.sourceIdentifier);
    if (source.sourceUrl !== undefined && !/^https?:\/\//.test(source.sourceUrl)) fail(`${sourcePath}.sourceUrl`, "must be an http(s) URL");
    if (source.retrievalDate !== undefined) nonEmpty(`${sourcePath}.retrievalDate`, source.retrievalDate);
    if (source.fields.length === 0 || source.fields.some((field) => typeof field !== "string" || field.trim().length === 0)) {
      fail(`${sourcePath}.fields`, "must contain non-empty field names");
    }
    nonEmpty(`${sourcePath}.normalization`, source.normalization);
    nonEmpty(`${sourcePath}.limitations`, source.limitations);
  });
}

export function validateCelestialAppearance(
  appearance: CelestialAppearance | undefined,
  objectId?: ObjectId,
): void {
  if (appearance === undefined) return;
  const prefix = objectId === undefined ? "record" : `record for ${objectId}`;
  if (appearance.schemaVersion !== CELESTIAL_APPEARANCE_SCHEMA_VERSION) {
    fail(`${prefix}.schemaVersion`, `unsupported version ${String(appearance.schemaVersion)}`);
  }
  if (appearance.visibleLayer !== undefined) {
    if (!["solidSurface", "iceSurface", "cloudDeck"].includes(appearance.visibleLayer.kind)) {
      fail(`${prefix}.visibleLayer.kind`, `unsupported layer kind ${String(appearance.visibleLayer.kind)}`);
    }
    validateFractions(`${prefix}.visibleLayer.composition`, appearance.visibleLayer.composition, "fraction", "materialId");
    if (appearance.visibleLayer.calibratedReflectance !== undefined) validateLinearRgb(`${prefix}.visibleLayer.calibratedReflectance`, appearance.visibleLayer.calibratedReflectance);
    if (appearance.visibleLayer.visualAlbedo !== undefined) bounded(`${prefix}.visibleLayer.visualAlbedo`, appearance.visibleLayer.visualAlbedo, 0, 1);
  }
  if (appearance.atmosphere !== undefined) validateAtmosphere(`${prefix}.atmosphere`, appearance.atmosphere);
  if (appearance.stellarEmission !== undefined) {
    finite(`${prefix}.stellarEmission.effectiveTemperatureKelvin`, appearance.stellarEmission.effectiveTemperatureKelvin);
    if (appearance.stellarEmission.effectiveTemperatureKelvin < STELLAR_TEMPERATURE_RANGE_KELVIN.min
        || appearance.stellarEmission.effectiveTemperatureKelvin > STELLAR_TEMPERATURE_RANGE_KELVIN.max) {
      fail(`${prefix}.stellarEmission.effectiveTemperatureKelvin`, `must be within the supported range ${STELLAR_TEMPERATURE_RANGE_KELVIN.min}–${STELLAR_TEMPERATURE_RANGE_KELVIN.max} K`);
    }
    nonNegative(`${prefix}.stellarEmission.luminosityWatts`, appearance.stellarEmission.luminosityWatts);
    if (appearance.stellarEmission.spectralClass !== undefined) nonEmpty(`${prefix}.stellarEmission.spectralClass`, appearance.stellarEmission.spectralClass);
  }
  validateProvenance(`${prefix}.provenance`, appearance.provenance);
}

function freezeRgb(value: LinearRgb): LinearRgb {
  return Object.freeze({ r: value.r, g: value.g, b: value.b });
}

export function createCelestialAppearance(input: CelestialAppearance): CelestialAppearance {
  validateCelestialAppearance(input);
  const visibleLayer = input.visibleLayer === undefined ? undefined : Object.freeze({
    ...input.visibleLayer,
    composition: Object.freeze(input.visibleLayer.composition.map((component) => Object.freeze({ ...component }))),
    ...(input.visibleLayer.calibratedReflectance === undefined ? {} : { calibratedReflectance: freezeRgb(input.visibleLayer.calibratedReflectance) }),
  });
  const atmosphere = input.atmosphere === undefined ? undefined : Object.freeze({
    ...input.atmosphere,
    gases: Object.freeze(input.atmosphere.gases.map((gas) => Object.freeze({ ...gas }))),
    ...(input.atmosphere.optics === undefined ? {} : {
      optics: Object.freeze({
        ...input.atmosphere.optics,
        rayleighScattering: freezeRgb(input.atmosphere.optics.rayleighScattering),
        mieScattering: freezeRgb(input.atmosphere.optics.mieScattering),
        absorption: freezeRgb(input.atmosphere.optics.absorption),
      }),
    }),
    ...(input.atmosphere.haze === undefined ? {} : {
      haze: Object.freeze({
        ...input.atmosphere.haze,
        ...(input.atmosphere.haze.calibratedScattering === undefined ? {} : { calibratedScattering: freezeRgb(input.atmosphere.haze.calibratedScattering) }),
        ...(input.atmosphere.haze.calibratedAbsorption === undefined ? {} : { calibratedAbsorption: freezeRgb(input.atmosphere.haze.calibratedAbsorption) }),
      }),
    }),
    cloudLayers: Object.freeze(input.atmosphere.cloudLayers.map((cloud) => Object.freeze({
      ...cloud,
      ...(cloud.calibratedReflectance === undefined ? {} : { calibratedReflectance: freezeRgb(cloud.calibratedReflectance) }),
    }))),
  });
  const provenance = Object.freeze(input.provenance.map((source) => Object.freeze({
    ...source,
    fields: Object.freeze([...source.fields]),
  })));
  return Object.freeze({
    ...input,
    ...(visibleLayer === undefined ? {} : { visibleLayer }),
    ...(atmosphere === undefined ? {} : { atmosphere }),
    ...(input.stellarEmission === undefined ? {} : { stellarEmission: Object.freeze({ ...input.stellarEmission }) }),
    provenance,
  });
}

export function opticalMaterial(materialId: OpticalMaterialId): OpticalMaterialDefinition | undefined {
  return OPTICAL_MATERIAL_LIBRARY[materialId];
}

export function opticalGas(gasId: GasSpeciesId): OpticalGasDefinition | undefined {
  return OPTICAL_GAS_LIBRARY[gasId];
}
