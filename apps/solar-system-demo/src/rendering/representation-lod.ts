export const Representation = Object.freeze({
  hidden: "hidden",
  marker: "marker",
  sphere: "sphere",
} as const);

export type RepresentationLevel = (typeof Representation)[keyof typeof Representation];

export const HIDDEN_TO_MARKER_PIXELS = 1.5;
export const MARKER_TO_HIDDEN_PIXELS = 1;
export const MARKER_TO_SPHERE_PIXELS = 6;
export const SPHERE_TO_MARKER_PIXELS = 4;

export interface RepresentationTransitionInput {
  readonly physicalDiameterPixels: number;
  readonly hierarchyEligible: boolean;
  readonly selected: boolean;
  readonly focused: boolean;
}

function validPixels(value: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new RangeError("Representation prominence must be finite and non-negative");
  }
  return value;
}

/** Persistent hysteresis transition. The caller stores the returned level by ObjectId. */
export function transitionRepresentation(
  previous: RepresentationLevel | undefined,
  input: RepresentationTransitionInput,
): RepresentationLevel {
  const diameter = validPixels(input.physicalDiameterPixels);
  if (typeof input.hierarchyEligible !== "boolean") throw new TypeError("hierarchyEligible must be boolean");
  if (typeof input.selected !== "boolean" || typeof input.focused !== "boolean") {
    throw new TypeError("selected and focused must be boolean");
  }

  if (input.focused) return diameter >= SPHERE_TO_MARKER_PIXELS ? Representation.sphere : Representation.marker;
  if (input.selected) return diameter >= MARKER_TO_SPHERE_PIXELS ? Representation.sphere : Representation.marker;
  if (!input.hierarchyEligible) return Representation.hidden;

  switch (previous) {
    case Representation.sphere:
      return diameter < SPHERE_TO_MARKER_PIXELS ? Representation.marker : Representation.sphere;
    case Representation.marker:
      if (diameter >= MARKER_TO_SPHERE_PIXELS) return Representation.sphere;
      if (diameter < MARKER_TO_HIDDEN_PIXELS) return Representation.hidden;
      return Representation.marker;
    case Representation.hidden:
    case undefined:
      return diameter >= HIDDEN_TO_MARKER_PIXELS ? Representation.marker : Representation.hidden;
  }
}

export interface LodDiagnostics {
  readonly registeredCount: number;
  readonly queriedCount: number;
  readonly hiddenCount: number;
  readonly markerCount: number;
  readonly sphereCount: number;
  readonly promotedRuntimeSphereCount: number;
}
