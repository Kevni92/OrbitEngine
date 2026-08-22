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
  /** Optional presentation-role floor applied after normal hierarchy/LOD evaluation. */
  readonly minimumRepresentation?: RepresentationLevel;
}

const REPRESENTATION_RANK: Readonly<Record<RepresentationLevel, number>> = Object.freeze({
  [Representation.hidden]: 0,
  [Representation.marker]: 1,
  [Representation.sphere]: 2,
});

function validPixels(value: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new RangeError("Representation prominence must be finite and non-negative");
  }
  return value;
}

function validMinimum(value: RepresentationLevel | undefined): RepresentationLevel | undefined {
  if (value === undefined) return undefined;
  if (value !== Representation.hidden && value !== Representation.marker && value !== Representation.sphere) {
    throw new RangeError(`Unknown minimum representation: ${String(value)}`);
  }
  return value;
}

function applyMinimumRepresentation(
  representation: RepresentationLevel,
  minimum: RepresentationLevel | undefined,
): RepresentationLevel {
  if (minimum === undefined) return representation;
  return REPRESENTATION_RANK[representation] < REPRESENTATION_RANK[minimum] ? minimum : representation;
}

/** Persistent hysteresis transition. The caller stores the returned level by ObjectId. */
export function transitionRepresentation(
  previous: RepresentationLevel | undefined,
  input: RepresentationTransitionInput,
): RepresentationLevel {
  const diameter = validPixels(input.physicalDiameterPixels);
  const minimum = validMinimum(input.minimumRepresentation);
  if (typeof input.hierarchyEligible !== "boolean") throw new TypeError("hierarchyEligible must be boolean");
  if (typeof input.selected !== "boolean" || typeof input.focused !== "boolean") {
    throw new TypeError("selected and focused must be boolean");
  }

  let next: RepresentationLevel;
  if (input.focused) {
    next = diameter >= SPHERE_TO_MARKER_PIXELS ? Representation.sphere : Representation.marker;
  } else if (input.selected) {
    next = diameter >= MARKER_TO_SPHERE_PIXELS ? Representation.sphere : Representation.marker;
  } else if (!input.hierarchyEligible) {
    next = Representation.hidden;
  } else {
    switch (previous) {
      case Representation.sphere:
        next = diameter < SPHERE_TO_MARKER_PIXELS ? Representation.marker : Representation.sphere;
        break;
      case Representation.marker:
        if (diameter >= MARKER_TO_SPHERE_PIXELS) next = Representation.sphere;
        else if (diameter < MARKER_TO_HIDDEN_PIXELS) next = Representation.hidden;
        else next = Representation.marker;
        break;
      case Representation.hidden:
      case undefined:
        next = diameter >= HIDDEN_TO_MARKER_PIXELS ? Representation.marker : Representation.hidden;
        break;
    }
  }

  return applyMinimumRepresentation(next, minimum);
}

export interface LodDiagnostics {
  readonly registeredCount: number;
  readonly queriedCount: number;
  readonly hiddenCount: number;
  readonly markerCount: number;
  readonly sphereCount: number;
  readonly promotedRuntimeSphereCount: number;
}
