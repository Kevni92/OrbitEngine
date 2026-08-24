import type { ObjectId } from "orbit-engine";
import type { BodyRepresentation, CelestialBodyRenderState } from "./snapshot.js";
import type { BodySizingResult } from "./sizing.js";

export const Representation = Object.freeze({
  hidden: "hidden",
  marker: "marker",
  sphere: "sphere",
} as const);

export type RepresentationLevel = BodyRepresentation;

export const HIDDEN_TO_MARKER_PIXELS = 1.5;
export const MARKER_TO_HIDDEN_PIXELS = 1;
export const MARKER_TO_SPHERE_PIXELS = 6;
export const SPHERE_TO_MARKER_PIXELS = 4;
export const HIERARCHY_RESOLUTION_DIAMETER_PIXELS = 4;

export interface RepresentationPolicyConfiguration {
  readonly hiddenToMarkerPixels: number;
  readonly markerToHiddenPixels: number;
  readonly markerToSpherePixels: number;
  readonly sphereToMarkerPixels: number;
  readonly hierarchyResolutionDiameterPixels: number;
}

export interface RepresentationTransitionInput {
  readonly physicalDiameterPixels: number;
  readonly hierarchyEligible: boolean;
  readonly selected: boolean;
  readonly focused: boolean;
  readonly minimumRepresentation?: RepresentationLevel;
  readonly projectable?: boolean;
}

export interface RepresentationPolicy {
  readonly configuration: RepresentationPolicyConfiguration;
  resolve(previous: RepresentationLevel | undefined, input: RepresentationTransitionInput): RepresentationLevel;
}

export interface RepresentationDecision {
  readonly objectId: ObjectId;
  readonly representation: RepresentationLevel;
  readonly sizing: BodySizingResult;
  readonly hierarchyEligible: boolean;
  readonly selected: boolean;
  readonly focused: boolean;
}

export interface RepresentationEvaluationOptions {
  readonly bodies: readonly CelestialBodyRenderState[];
  readonly sizingById: ReadonlyMap<ObjectId, BodySizingResult>;
  readonly previousRepresentations?: ReadonlyMap<ObjectId, RepresentationLevel>;
  readonly selectedObjectIds?: ReadonlySet<ObjectId>;
  readonly focusedObjectId?: ObjectId;
  readonly contextPriorityObjectIds?: ReadonlySet<ObjectId>;
  readonly minimumRepresentationById?: ReadonlyMap<ObjectId, RepresentationLevel>;
  readonly policy?: RepresentationPolicy;
}

const DEFAULT_CONFIGURATION: RepresentationPolicyConfiguration = Object.freeze({
  hiddenToMarkerPixels: HIDDEN_TO_MARKER_PIXELS,
  markerToHiddenPixels: MARKER_TO_HIDDEN_PIXELS,
  markerToSpherePixels: MARKER_TO_SPHERE_PIXELS,
  sphereToMarkerPixels: SPHERE_TO_MARKER_PIXELS,
  hierarchyResolutionDiameterPixels: HIERARCHY_RESOLUTION_DIAMETER_PIXELS,
});

const REPRESENTATION_RANK: Readonly<Record<RepresentationLevel, number>> = Object.freeze({
  [Representation.hidden]: 0,
  [Representation.marker]: 1,
  [Representation.sphere]: 2,
});

function finiteNonNegative(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} must be finite and non-negative`);
}

function positive(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be finite and greater than zero`);
}

function validateLevel(value: RepresentationLevel | undefined): RepresentationLevel | undefined {
  if (value === undefined) return undefined;
  if (value !== Representation.hidden && value !== Representation.marker && value !== Representation.sphere) {
    throw new RangeError(`Unknown minimum representation: ${String(value)}`);
  }
  return value;
}

function applyMinimumRepresentation(representation: RepresentationLevel, minimum: RepresentationLevel | undefined): RepresentationLevel {
  if (minimum === undefined) return representation;
  return REPRESENTATION_RANK[representation] < REPRESENTATION_RANK[minimum] ? minimum : representation;
}

export function createRepresentationPolicy(input: Partial<RepresentationPolicyConfiguration> = {}): RepresentationPolicy {
  const configuration = Object.freeze({ ...DEFAULT_CONFIGURATION, ...input });
  positive("hiddenToMarkerPixels", configuration.hiddenToMarkerPixels);
  positive("markerToHiddenPixels", configuration.markerToHiddenPixels);
  positive("markerToSpherePixels", configuration.markerToSpherePixels);
  positive("sphereToMarkerPixels", configuration.sphereToMarkerPixels);
  positive("hierarchyResolutionDiameterPixels", configuration.hierarchyResolutionDiameterPixels);
  if (configuration.hiddenToMarkerPixels <= configuration.markerToHiddenPixels) throw new RangeError("hidden-to-marker threshold must exceed marker-to-hidden threshold");
  if (configuration.markerToSpherePixels <= configuration.sphereToMarkerPixels) throw new RangeError("marker-to-sphere threshold must exceed sphere-to-marker threshold");
  return Object.freeze({
    configuration,
    resolve(previous: RepresentationLevel | undefined, transition: RepresentationTransitionInput): RepresentationLevel {
      finiteNonNegative("physicalDiameterPixels", transition.physicalDiameterPixels);
      if (typeof transition.hierarchyEligible !== "boolean") throw new TypeError("hierarchyEligible must be boolean");
      if (typeof transition.selected !== "boolean" || typeof transition.focused !== "boolean") throw new TypeError("selected and focused must be boolean");
      if (transition.projectable !== undefined && typeof transition.projectable !== "boolean") throw new TypeError("projectable must be boolean");
      const minimum = validateLevel(transition.minimumRepresentation);
      if (transition.projectable === false) return applyMinimumRepresentation(Representation.hidden, minimum);

      let next: RepresentationLevel;
      if (transition.focused) {
        next = transition.physicalDiameterPixels >= configuration.sphereToMarkerPixels ? Representation.sphere : Representation.marker;
      } else if (transition.selected) {
        next = transition.physicalDiameterPixels >= configuration.markerToSpherePixels ? Representation.sphere : Representation.marker;
      } else if (!transition.hierarchyEligible) {
        next = Representation.hidden;
      } else {
        switch (previous) {
          case Representation.sphere:
            next = transition.physicalDiameterPixels < configuration.sphereToMarkerPixels ? Representation.marker : Representation.sphere;
            break;
          case Representation.marker:
            if (transition.physicalDiameterPixels >= configuration.markerToSpherePixels) next = Representation.sphere;
            else if (transition.physicalDiameterPixels < configuration.markerToHiddenPixels) next = Representation.hidden;
            else next = Representation.marker;
            break;
          case Representation.hidden:
          case undefined:
            if (transition.physicalDiameterPixels >= configuration.markerToSpherePixels) next = Representation.sphere;
            else next = transition.physicalDiameterPixels >= configuration.hiddenToMarkerPixels ? Representation.marker : Representation.hidden;
            break;
        }
      }
      return applyMinimumRepresentation(next, minimum);
    },
  });
}

function compareObjectId(left: ObjectId, right: ObjectId): number {
  const leftNumber = BigInt(left);
  const rightNumber = BigInt(right);
  return leftNumber < rightNumber ? -1 : leftNumber > rightNumber ? 1 : 0;
}

function contextClosure(
  bodiesById: ReadonlyMap<ObjectId, CelestialBodyRenderState>,
  selectedObjectIds: ReadonlySet<ObjectId>,
  focusedObjectId: ObjectId | undefined,
): ReadonlySet<ObjectId> {
  const result = new Set<ObjectId>();
  const addAncestors = (objectId: ObjectId): void => {
    if (result.has(objectId)) return;
    result.add(objectId);
    const parentId = bodiesById.get(objectId)?.parentId;
    if (parentId !== undefined && bodiesById.has(parentId)) addAncestors(parentId);
  };
  selectedObjectIds.forEach(addAncestors);
  if (focusedObjectId !== undefined) addAncestors(focusedObjectId);
  return result;
}

/** Resolves generic hierarchy-aware presentation state without identity/name rules. */
export function resolveRepresentationDecisions(options: RepresentationEvaluationOptions): ReadonlyMap<ObjectId, RepresentationDecision> {
  const policy = options.policy ?? createRepresentationPolicy();
  const selected = options.selectedObjectIds ?? new Set<ObjectId>();
  const focusedObjectId = options.focusedObjectId;
  const bodiesById = new Map(options.bodies.map((body) => [body.objectId, body]));
  const requiredContext = contextClosure(bodiesById, selected, focusedObjectId);
  const decisions = new Map<ObjectId, RepresentationDecision>();
  const visiting = new Set<ObjectId>();

  const resolve = (body: CelestialBodyRenderState): RepresentationDecision => {
    const cached = decisions.get(body.objectId);
    if (cached !== undefined) return cached;
    const sizing = options.sizingById.get(body.objectId);
    if (sizing === undefined) throw new RangeError(`Missing sizing result for ${body.objectId}`);
    if (visiting.has(body.objectId)) {
      return Object.freeze({ objectId: body.objectId, representation: Representation.hidden, sizing, hierarchyEligible: false, selected: selected.has(body.objectId), focused: focusedObjectId === body.objectId });
    }
    visiting.add(body.objectId);
    const selectedBody = selected.has(body.objectId);
    const focusedBody = focusedObjectId === body.objectId;
    let hierarchyEligible = true;
    if (body.parentId !== undefined && bodiesById.has(body.parentId)) {
      const parent = bodiesById.get(body.parentId)!;
      const parentDecision = resolve(parent);
      const parentSizing = options.sizingById.get(parent.objectId)!;
      hierarchyEligible = requiredContext.has(body.objectId)
        || (parentDecision.representation !== Representation.hidden
          && parentSizing.presentedDiameterPixels >= policy.configuration.hierarchyResolutionDiameterPixels);
    }
    const explicitMinimum = validateLevel(options.minimumRepresentationById?.get(body.objectId));
    const contextMinimum = options.contextPriorityObjectIds?.has(body.objectId) || requiredContext.has(body.objectId)
      ? Representation.marker
      : undefined;
    const minimum = REPRESENTATION_RANK[explicitMinimum ?? Representation.hidden] >= REPRESENTATION_RANK[contextMinimum ?? Representation.hidden]
      ? explicitMinimum ?? contextMinimum
      : contextMinimum;
    const previous = options.previousRepresentations?.get(body.objectId) ?? body.representation;
    const representation = policy.resolve(previous, {
      physicalDiameterPixels: sizing.physicalDiameterPixels,
      hierarchyEligible,
      selected: selectedBody,
      focused: focusedBody,
      minimumRepresentation: minimum,
      projectable: sizing.projectable,
    });
    const decision = Object.freeze({ objectId: body.objectId, representation, sizing, hierarchyEligible, selected: selectedBody, focused: focusedBody });
    visiting.delete(body.objectId);
    decisions.set(body.objectId, decision);
    return decision;
  };

  [...options.bodies].sort((left, right) => compareObjectId(left.objectId, right.objectId)).forEach(resolve);
  return decisions;
}
