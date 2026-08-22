import assert from "node:assert/strict";
import test from "node:test";
import { createCelestialCatalog } from "../src/scenario/celestial-catalog.js";
import {
  CHARON_ID,
  EUROPA_ID,
  JUPITER_ID,
  SCENARIO_BODIES,
  SCENARIO_CENTERED_FRAMES,
  SUN_ID,
  TITAN_ID,
  TITANIA_ID,
} from "../src/scenario/scenario-data.js";
import { searchCelestialBodies } from "../src/ui/body-search.js";
import { buildCelestialTree, type CelestialTreeBodyNode } from "../src/ui/celestial-tree.js";

const catalog = createCelestialCatalog(SCENARIO_BODIES, SCENARIO_CENTERED_FRAMES);

function flattenBodies(): string[] {
  const tree = buildCelestialTree(catalog);
  const ids: string[] = [];
  const visit = (node: CelestialTreeBodyNode): void => {
    ids.push(node.id);
    for (const child of node.children) visit(child);
  };
  for (const body of tree.rootBodies) visit(body);
  for (const group of tree.groups) for (const body of group.children) visit(body);
  return ids;
}

test("celestial tree builds presentation groups while preserving catalog hierarchy", () => {
  const tree = buildCelestialTree(catalog);
  const planets = tree.groups.find((group) => group.key === "planets");
  const dwarfPlanets = tree.groups.find((group) => group.key === "dwarf-planets");
  const asteroids = tree.groups.find((group) => group.key === "asteroids");
  assert.ok(planets);
  assert.ok(dwarfPlanets);
  assert.ok(asteroids);
  assert.equal(tree.rootBodies.find((body) => body.id === SUN_ID)?.children.length, 0);

  const jupiter = planets.children.find((body) => body.id === JUPITER_ID);
  assert.ok(jupiter);
  assert.equal(jupiter.children.some((body) => body.id === EUROPA_ID), true);
  assert.equal(dwarfPlanets.children.some((body) => body.definition.name === "Pluto"), true);
  assert.equal(asteroids.children.length, 7);

  const ids = flattenBodies();
  assert.equal(new Set(ids).size, catalog.bodyById.size);
  assert.equal(ids.length, catalog.bodyById.size);
});

test("body search ranks canonical names before aliases and includes parent context", () => {
  const europa = searchCelestialBodies(catalog, "eu");
  assert.equal(europa[0]?.id, EUROPA_ID);
  assert.equal(europa[0]?.breadcrumb, "Jupiter › Europa");

  const titans = searchCelestialBodies(catalog, "titan");
  assert.deepEqual(titans.slice(0, 2).map((result) => result.id), [TITAN_ID, TITANIA_ID]);

  const alias = searchCelestialBodies(catalog, "pluto i");
  assert.deepEqual(alias.map((result) => result.id), [CHARON_ID]);
  assert.deepEqual(searchCelestialBodies(catalog, "xyz"), []);
});
