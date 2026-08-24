/**
 * Scenario-facing adapter for the public renderer-neutral presentation API.
 * The demo owns the scenario records; validation and optical semantics live in
 * orbit-engine-three/presentation.
 */
export {
  APPEARANCE_FRACTION_TOLERANCE,
  CELESTIAL_APPEARANCE_SCHEMA_VERSION,
  OPTICAL_GAS_LIBRARY,
  OPTICAL_LIBRARY_VERSION,
  OPTICAL_MATERIAL_LIBRARY,
  STELLAR_TEMPERATURE_RANGE_KELVIN,
  createCelestialAppearance,
  opticalGas,
  opticalMaterial,
  validateCelestialAppearance,
} from "orbit-engine-three/presentation";

export type {
  AppearanceProvenance,
  AtmosphereAppearance,
  AtmosphereOpticalCalibration,
  CelestialAppearance,
  CloudLayerAppearance,
  GasMixingRatio,
  GasSpeciesId,
  HazeAerosol,
  LinearRgb,
  MaterialFraction,
  OpticalGasDefinition,
  OpticalMaterialDefinition,
  OpticalMaterialId,
  StellarEmissionAppearance,
  StellarEmission,
  VisibleLayerAppearance,
  VisibleLayerKind,
} from "orbit-engine-three/presentation";

/** Compatibility name for the scenario's explicit optical calibration input. */
export type { AtmosphereOpticalCalibration as AtmosphereOptics } from "orbit-engine-three/presentation";
