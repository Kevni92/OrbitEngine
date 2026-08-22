import type { ObjectId } from "orbit-engine";

export const LIGHTING_MODES = ["physical", "enhanced"] as const;
export type LightingMode = (typeof LIGHTING_MODES)[number];

export const DEFAULT_INSPECTION_FILL_STRENGTH = 0.18;
export const MAX_INSPECTION_FILL_CONTRIBUTION = 0.25;
export const INSPECTION_FILL_CHROMATICITY = Object.freeze({ r: 1, g: 1, b: 1 });

export interface LightingModeDiagnostics {
  readonly mode: LightingMode;
  readonly physicalIncidentFill: 0;
  readonly inspectionFillContribution: number;
  readonly inspectionFillMaximum: typeof MAX_INSPECTION_FILL_CONTRIBUTION;
  readonly inspectionFillChromaticity: typeof INSPECTION_FILL_CHROMATICITY;
  readonly inspectionFillSource: "none" | "presentation-only artificial inspection lighting";
  readonly targetObjectIds: readonly ObjectId[];
}

export function parseLightingMode(value: unknown): LightingMode {
  if (value === "physical" || value === "enhanced") return value;
  throw new RangeError(`Unknown lighting mode: ${String(value)}`);
}

export function inspectionFillContribution(mode: LightingMode, requestedStrength = DEFAULT_INSPECTION_FILL_STRENGTH): number {
  if (!Number.isFinite(requestedStrength) || requestedStrength < 0) {
    throw new RangeError("inspection fill strength must be finite and non-negative");
  }
  return mode === "enhanced"
    ? Math.min(MAX_INSPECTION_FILL_CONTRIBUTION, requestedStrength)
    : 0;
}

export function lightingModeDiagnostics(
  mode: LightingMode,
  targetObjectIds: Iterable<ObjectId>,
  requestedStrength = DEFAULT_INSPECTION_FILL_STRENGTH,
): LightingModeDiagnostics {
  const targets = [...new Set(targetObjectIds)].sort((left, right) => {
    const leftNumber = BigInt(left);
    const rightNumber = BigInt(right);
    return leftNumber < rightNumber ? -1 : leftNumber > rightNumber ? 1 : 0;
  });
  const contribution = inspectionFillContribution(mode, requestedStrength);
  return Object.freeze({
    mode,
    physicalIncidentFill: 0,
    inspectionFillContribution: contribution,
    inspectionFillMaximum: MAX_INSPECTION_FILL_CONTRIBUTION,
    inspectionFillChromaticity: INSPECTION_FILL_CHROMATICITY,
    inspectionFillSource: contribution === 0 ? "none" : "presentation-only artificial inspection lighting",
    targetObjectIds: Object.freeze(targets),
  });
}
