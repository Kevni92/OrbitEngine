import {
  objectId,
  referenceFrameId,
  type ObjectId,
  type ObjectType,
  type PhysicalPropertiesInput,
  type PropagationDirection,
  type PropagationModelKind,
  type PropagationState,
  type ReferenceFrameId,
} from "orbit-engine";
import { createCelestialAppearance, validateCelestialAppearance, type CelestialAppearance } from "./celestial-appearance.js";

export type CelestialCatalogCategory = "star" | "planet" | "moon" | "dwarfPlanet" | "asteroid";

export interface OrbitVisualizationDefinition {
  readonly sampleSpanSeconds: number;
  readonly sampleCount: number;
  readonly closedReferenceOrbit: boolean;
}

export interface CelestialPropagationDefinition {
  readonly modelKind: PropagationModelKind;
  readonly direction: PropagationDirection;
  readonly propagationFrame: ReferenceFrameId;
  readonly configurationRevision: string;
  readonly orbitVisualization?: OrbitVisualizationDefinition;
}

export interface CelestialDisplayMetadata {
  /** Canonical UI/marker/orbit-guide accent and fallback color; never sphere truth. */
  readonly accentColor: number;
  /** @deprecated Use accentColor. Kept as a compatibility alias for existing consumers. */
  readonly color: number;
  readonly category: CelestialCatalogCategory;
  readonly aliases: readonly string[];
  readonly defaultVisible: boolean;
}

export interface CelestialSourceProvenance {
  readonly source: string;
  readonly sourceUrl: string;
  readonly sourceIdentifier: string;
  readonly retrievalDate: string;
  readonly sourceEpoch: string;
  readonly sourceTimeScale: string;
  readonly sourceFrame: string;
  readonly normalization: string;
  readonly limitations: string;
}

export interface CelestialBodyDefinition {
  readonly id: ObjectId;
  readonly name: string;
  readonly type: ObjectType;
  /** Undefined only for the catalog root/reference body. */
  readonly centralBody?: ObjectId;
  readonly properties: PhysicalPropertiesInput;
  readonly anchor: PropagationState;
  readonly propagation: CelestialPropagationDefinition;
  readonly display: CelestialDisplayMetadata;
  /** Optional application-owned appearance metadata; never passed to OrbitEngine. */
  readonly appearance?: CelestialAppearance;
  readonly provenance: CelestialSourceProvenance;
}

export interface CelestialCenteredFrameDefinition {
  readonly id: ReferenceFrameId;
  readonly centerBody: ObjectId;
  readonly parent: ReferenceFrameId;
}

export interface CelestialCatalog {
  readonly bodyById: ReadonlyMap<ObjectId, CelestialBodyDefinition>;
  readonly childrenByParent: ReadonlyMap<ObjectId, readonly ObjectId[]>;
  readonly roots: readonly ObjectId[];
  readonly byCategory: ReadonlyMap<CelestialCatalogCategory, readonly ObjectId[]>;
  readonly registrationOrder: readonly ObjectId[];
  readonly frameByCenterBody: ReadonlyMap<ObjectId, CelestialCenteredFrameDefinition>;
  childrenOf(parentId: ObjectId): readonly ObjectId[];
  parentOf(bodyId: ObjectId): ObjectId | undefined;
  frameForCenter(centerBody: ObjectId): CelestialCenteredFrameDefinition | undefined;
  search(query: string): readonly ObjectId[];
}

const ROOT_FRAME = referenceFrameId("1");
const CATEGORIES: readonly CelestialCatalogCategory[] = ["star", "planet", "moon", "dwarfPlanet", "asteroid"];

function compareIds(left: ObjectId, right: ObjectId): number {
  const difference = BigInt(left) - BigInt(right);
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

function sortedIds(values: Iterable<ObjectId>): readonly ObjectId[] {
  return Object.freeze([...values].sort(compareIds));
}

function fail(message: string): never {
  throw new RangeError(message);
}

function validateDisplay(body: CelestialBodyDefinition): void {
  if (body.display.accentColor !== body.display.color) {
    fail(`Catalog body ${body.id} must keep display accentColor and legacy color alias identical`);
  }
  if (!Number.isSafeInteger(body.display.accentColor) || body.display.accentColor < 0 || body.display.accentColor > 0xffffff) {
    fail(`Catalog body ${body.id} has an invalid display accent color`);
  }
  if (!Number.isSafeInteger(body.display.color) || body.display.color < 0 || body.display.color > 0xffffff) {
    fail(`Catalog body ${body.id} has an invalid display color`);
  }
  if (!CATEGORIES.includes(body.display.category)) fail(`Catalog body ${body.id} has an invalid display category`);
  if (!body.display.aliases.every((alias) => typeof alias === "string" && alias.trim().length > 0)) {
    fail(`Catalog body ${body.id} has an invalid search alias`);
  }
  if (typeof body.display.defaultVisible !== "boolean") fail(`Catalog body ${body.id} has invalid visibility metadata`);
}

function validateProvenance(body: CelestialBodyDefinition): void {
  const fields: readonly (keyof CelestialSourceProvenance)[] = [
    "source", "sourceUrl", "sourceIdentifier", "retrievalDate", "sourceEpoch", "sourceTimeScale", "sourceFrame", "normalization", "limitations",
  ];
  if (fields.some((field) => typeof body.provenance[field] !== "string" || body.provenance[field].trim().length === 0)) {
    fail(`Catalog body ${body.id} is missing source/provenance metadata`);
  }
  if (!/^https?:\/\//.test(body.provenance.sourceUrl)) fail(`Catalog body ${body.id} has an invalid provenance URL`);
}

function validateBodyGraph(
  bodyById: ReadonlyMap<ObjectId, CelestialBodyDefinition>,
): { readonly roots: readonly ObjectId[]; readonly childrenByParent: ReadonlyMap<ObjectId, readonly ObjectId[]> } {
  const children = new Map<ObjectId, ObjectId[]>();
  const roots: ObjectId[] = [];
  for (const body of bodyById.values()) {
    objectId(body.id);
    validateDisplay(body);
    validateCelestialAppearance(body.appearance, body.id);
    validateProvenance(body);
    if (body.centralBody === undefined) {
      roots.push(body.id);
      continue;
    }
    objectId(body.centralBody);
    if (body.centralBody === body.id) fail(`Catalog body ${body.id} cannot be its own central body`);
    if (!bodyById.has(body.centralBody)) fail(`Catalog body ${body.id} references unknown central body ${body.centralBody}`);
    const siblings = children.get(body.centralBody) ?? [];
    siblings.push(body.id);
    children.set(body.centralBody, siblings);
  }

  const visiting = new Set<ObjectId>();
  const visited = new Set<ObjectId>();
  const visit = (id: ObjectId): void => {
    if (visited.has(id)) return;
    if (visiting.has(id)) fail(`Catalog central-body cycle detected at ${id}`);
    visiting.add(id);
    const parent = bodyById.get(id)?.centralBody;
    if (parent !== undefined) visit(parent);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of bodyById.keys()) visit(id);

  return {
    roots: sortedIds(roots),
    childrenByParent: new Map([...children].map(([id, values]) => [id, sortedIds(values)])),
  };
}

function validateFrames(
  bodyById: ReadonlyMap<ObjectId, CelestialBodyDefinition>,
  frames: readonly CelestialCenteredFrameDefinition[],
): ReadonlyMap<ObjectId, CelestialCenteredFrameDefinition> {
  const byId = new Map<ReferenceFrameId, CelestialCenteredFrameDefinition>();
  const byCenter = new Map<ObjectId, CelestialCenteredFrameDefinition>();
  for (const frame of frames) {
    const id = referenceFrameId(frame.id);
    const parent = referenceFrameId(frame.parent);
    const centerBody = objectId(frame.centerBody);
    if (id === ROOT_FRAME) fail("Catalog centered frame cannot replace the root frame");
    if (byId.has(id)) fail(`Duplicate centered frame ID ${id}`);
    if (byCenter.has(centerBody)) fail(`Duplicate centered frame for body ${centerBody}`);
    if (!bodyById.has(centerBody)) fail(`Centered frame ${id} references unknown body ${centerBody}`);
    byId.set(id, Object.freeze({ id, centerBody, parent }));
    byCenter.set(centerBody, Object.freeze({ id, centerBody, parent }));
  }
  for (const frame of byId.values()) {
    if (frame.parent !== ROOT_FRAME && !byId.has(frame.parent)) fail(`Centered frame ${frame.id} references unknown parent frame ${frame.parent}`);
    if (frame.parent === frame.id) fail(`Centered frame ${frame.id} cannot be its own parent`);
  }
  const visiting = new Set<ReferenceFrameId>();
  const visited = new Set<ReferenceFrameId>();
  const visit = (id: ReferenceFrameId): void => {
    if (id === ROOT_FRAME || visited.has(id)) return;
    if (visiting.has(id)) fail(`Centered-frame parent cycle detected at ${id}`);
    visiting.add(id);
    const parent = byId.get(id)?.parent;
    if (parent !== undefined) visit(parent);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of byId.keys()) visit(id);

  for (const body of bodyById.values()) {
    const expectedFrame = body.centralBody === undefined ? ROOT_FRAME : byCenter.get(body.centralBody)?.id;
    if (expectedFrame === undefined) fail(`Catalog body ${body.id} has no centered frame for its central body`);
    if (body.propagation.propagationFrame !== expectedFrame) {
      fail(`Catalog body ${body.id} propagation frame does not match its central body`);
    }
  }
  for (const frame of byCenter.values()) {
    const body = bodyById.get(frame.centerBody)!;
    const expectedParent = body.centralBody === undefined ? ROOT_FRAME : byCenter.get(body.centralBody)?.id;
    if (expectedParent === undefined || frame.parent !== expectedParent) {
      fail(`Centered frame ${frame.id} is not parented to the central body's frame`);
    }
  }
  return byCenter;
}

function deterministicRegistrationOrder(bodyById: ReadonlyMap<ObjectId, CelestialBodyDefinition>): readonly ObjectId[] {
  const remaining = new Set(bodyById.keys());
  const registered = new Set<ObjectId>();
  const order: ObjectId[] = [];
  while (remaining.size > 0) {
    const ready = [...remaining]
      .filter((id) => {
        const parent = bodyById.get(id)!.centralBody;
        return parent === undefined || registered.has(parent);
      })
      .sort(compareIds);
    if (ready.length === 0) fail("Catalog cannot produce a deterministic topological registration order");
    for (const id of ready) {
      remaining.delete(id);
      registered.add(id);
      order.push(id);
    }
  }
  return Object.freeze(order);
}

export function createCelestialCatalog(
  definitions: readonly CelestialBodyDefinition[],
  frames: readonly CelestialCenteredFrameDefinition[],
): CelestialCatalog {
  const bodyById = new Map<ObjectId, CelestialBodyDefinition>();
  for (const definition of definitions) {
    const id = objectId(definition.id);
    if (bodyById.has(id)) fail(`Duplicate catalog ObjectId ${id}`);
    bodyById.set(id, Object.freeze({
      ...definition,
      id,
      ...(definition.centralBody === undefined ? {} : { centralBody: objectId(definition.centralBody) }),
      propagation: Object.freeze({ ...definition.propagation }),
      display: Object.freeze({ ...definition.display, aliases: Object.freeze([...definition.display.aliases]) }),
      ...(definition.appearance === undefined ? {} : { appearance: createCelestialAppearance(definition.appearance) }),
      provenance: Object.freeze({ ...definition.provenance }),
    }));
  }
  if (bodyById.size === 0) fail("Catalog must contain at least one body");
  const { roots, childrenByParent } = validateBodyGraph(bodyById);
  if (roots.length !== 1) fail(`Catalog must contain exactly one root body, received ${roots.length}`);
  const frameByCenterBody = validateFrames(bodyById, frames);
  const registrationOrder = deterministicRegistrationOrder(bodyById);
  const byCategory = new Map<CelestialCatalogCategory, readonly ObjectId[]>(CATEGORIES.map((category) => [
    category,
    Object.freeze(registrationOrder.filter((id) => bodyById.get(id)!.display.category === category)),
  ]));

  return Object.freeze({
    bodyById,
    childrenByParent,
    roots,
    byCategory,
    registrationOrder,
    frameByCenterBody,
    childrenOf: (parentId: ObjectId) => childrenByParent.get(parentId) ?? [],
    parentOf: (bodyId: ObjectId) => bodyById.get(bodyId)?.centralBody,
    frameForCenter: (centerBody: ObjectId) => frameByCenterBody.get(centerBody),
    search: (query: string) => {
      const normalized = query.trim().toLocaleLowerCase("en-US");
      return Object.freeze(registrationOrder.filter((id) => {
        const body = bodyById.get(id)!;
        return normalized.length === 0
          || body.name.toLocaleLowerCase("en-US").includes(normalized)
          || body.display.aliases.some((alias) => alias.toLocaleLowerCase("en-US").includes(normalized));
      }));
    },
  });
}
