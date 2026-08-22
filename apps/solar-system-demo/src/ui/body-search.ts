import type { ObjectId } from "orbit-engine";
import type { CelestialBodyDefinition, CelestialCatalog } from "../scenario/celestial-catalog.js";

export interface CelestialSearchResult {
  readonly id: ObjectId;
  readonly definition: CelestialBodyDefinition;
  readonly breadcrumb: string;
  readonly score: number;
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function matchScore(value: string, query: string, exact: number, prefix: number, substring: number): number | undefined {
  const normalized = normalize(value);
  if (normalized === query) return exact;
  if (normalized.startsWith(query)) return prefix;
  if (normalized.includes(query)) return substring;
  return undefined;
}

function breadcrumbFor(catalog: CelestialCatalog, id: ObjectId): string {
  const ids: ObjectId[] = [];
  let current: ObjectId | undefined = id;
  while (current !== undefined) {
    ids.unshift(current);
    current = catalog.parentOf(current);
  }
  if (ids.length > 1 && catalog.roots.includes(ids[0]!)) ids.shift();

  const names: string[] = [];
  for (const bodyId of ids) {
    const body = catalog.bodyById.get(bodyId);
    if (body === undefined) break;
    names.push(body.name);
  }
  return names.join(" › ");
}

export function searchCelestialBodies(catalog: CelestialCatalog, queryText: string): readonly CelestialSearchResult[] {
  const query = normalize(queryText);
  if (query.length === 0) return [];

  const matches: CelestialSearchResult[] = [];
  for (const id of catalog.registrationOrder) {
    const definition = catalog.bodyById.get(id)!;
    const nameScore = matchScore(definition.name, query, 0, 10, 20);
    const aliasScore = definition.display.aliases.reduce<number | undefined>((best, alias) => {
      const score = matchScore(alias, query, 30, 40, 50);
      return score === undefined ? best : Math.min(best ?? Number.POSITIVE_INFINITY, score);
    }, undefined);
    const score = Math.min(nameScore ?? Number.POSITIVE_INFINITY, aliasScore ?? Number.POSITIVE_INFINITY);
    if (Number.isFinite(score)) {
      matches.push(Object.freeze({
        id,
        definition,
        breadcrumb: breadcrumbFor(catalog, id),
        score,
      }));
    }
  }

  return Object.freeze(matches.sort((left, right) => {
    if (left.score !== right.score) return left.score - right.score;
    const byName = left.definition.name.localeCompare(right.definition.name, "en", { sensitivity: "base" });
    if (byName !== 0) return byName;
    const leftId = BigInt(left.id);
    const rightId = BigInt(right.id);
    return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
  }));
}
