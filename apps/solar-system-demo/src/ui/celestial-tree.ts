import type { ObjectId } from "orbit-engine";
import type {
  CelestialBodyDefinition,
  CelestialCatalog,
  CelestialCatalogCategory,
} from "../scenario/celestial-catalog.js";

export interface CelestialTreeBodyNode {
  readonly kind: "body";
  readonly id: ObjectId;
  readonly definition: CelestialBodyDefinition;
  readonly children: readonly CelestialTreeBodyNode[];
}

export interface CelestialTreeGroupNode {
  readonly kind: "group";
  readonly key: string;
  readonly label: string;
  readonly category: CelestialCatalogCategory;
  readonly children: readonly CelestialTreeBodyNode[];
}

export interface CelestialTreeModel {
  readonly rootBodies: readonly CelestialTreeBodyNode[];
  readonly groups: readonly CelestialTreeGroupNode[];
  readonly bodyById: ReadonlyMap<ObjectId, CelestialTreeBodyNode>;
}

const PRESENTATION_GROUPS: readonly {
  readonly key: string;
  readonly label: string;
  readonly category: CelestialCatalogCategory;
}[] = Object.freeze([
  Object.freeze({ key: "planets", label: "Planets", category: "planet" }),
  Object.freeze({ key: "dwarf-planets", label: "Dwarf planets", category: "dwarfPlanet" }),
  Object.freeze({ key: "asteroids", label: "Asteroids", category: "asteroid" }),
]);

function compareNames(left: CelestialBodyDefinition, right: CelestialBodyDefinition): number {
  const byName = left.name.localeCompare(right.name, "en", { sensitivity: "base" });
  if (byName !== 0) return byName;
  const leftId = BigInt(left.id);
  const rightId = BigInt(right.id);
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
}

export function buildCelestialTree(catalog: CelestialCatalog): CelestialTreeModel {
  const bodyById = new Map<ObjectId, CelestialTreeBodyNode>();

  const buildBody = (id: ObjectId, includeChildren = true): CelestialTreeBodyNode => {
    const cached = bodyById.get(id);
    if (cached !== undefined) return cached;
    const definition = catalog.bodyById.get(id);
    if (definition === undefined) throw new RangeError(`Catalog body ${id} is missing`);
    const node: CelestialTreeBodyNode = {
      kind: "body",
      id,
      definition,
      children: Object.freeze(includeChildren
        ? catalog.childrenOf(id).map((childId) => buildBody(childId)).sort((left, right) => compareNames(left.definition, right.definition))
        : []),
    };
    bodyById.set(id, Object.freeze(node));
    return bodyById.get(id)!;
  };

  const rootBodies = Object.freeze(catalog.roots.map((id) => {
    const definition = catalog.bodyById.get(id)!;
    // Heliocentric children are presented in category groups below. Their
    // physical parent is still retained in the catalog and in every child
    // body's own ancestry; this avoids duplicating all planets under the Sun.
    return buildBody(id, definition.display.category !== "star");
  }));
  const rootIds = new Set(catalog.roots);
  const groups = Object.freeze(PRESENTATION_GROUPS.flatMap((group) => {
    const children = (catalog.byCategory.get(group.category) ?? [])
      .filter((id) => {
        const parent = catalog.parentOf(id);
        return parent === undefined || rootIds.has(parent);
      })
      .map((id) => buildBody(id))
      .sort((left, right) => compareNames(left.definition, right.definition));
    return children.length === 0 ? [] : [{ kind: "group" as const, ...group, children: Object.freeze(children) }];
  }));

  return Object.freeze({
    rootBodies,
    groups,
    bodyById,
  });
}

export function categoryLabel(category: CelestialCatalogCategory): string {
  switch (category) {
    case "star": return "Star";
    case "planet": return "Planet";
    case "moon": return "Moon";
    case "dwarfPlanet": return "Dwarf planet";
    case "asteroid": return "Asteroid";
  }
}
