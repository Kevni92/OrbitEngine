import assert from "node:assert/strict";
import test from "node:test";

import {
  ObjectType,
  isObjectId,
  objectId,
  objectType,
} from "../../src/objects.js";
import {
  collisionBoundingRadius,
  gravitationalParameter,
  mu,
  physicalProperties,
  physicalRadius,
  type GravitationalParameter,
} from "../../src/properties.js";

test("ObjectId accepts canonical decimal uint64 text without using number", () => {
  const valid = [
    "1",
    "4294967295",
    "4294967296",
    "9007199254740993",
    "18446744073709551615",
  ];

  for (const value of valid) {
    const id = objectId(value);
    assert.equal(id, value);
    assert.equal(isObjectId(id), true);
  }

  const invalid = [
    "",
    "0",
    "00",
    "01",
    "+1",
    "-1",
    " 1",
    "1 ",
    "1.0",
    "1e3",
    "١",
    "18446744073709551616",
  ];
  for (const value of invalid) {
    assert.throws(() => objectId(value), /ObjectId/);
    assert.equal(isObjectId(value), false);
  }

  assert.throws(() => objectId(1 as unknown as string), TypeError);
});
test("ObjectId and physical brands remain compile-time distinct", () => {
  const id = objectId("1");
  assert.equal(typeof id, "string");

  // @ts-expect-error plain strings are not ObjectId values
  const invalidId: ReturnType<typeof objectId> = "1";
  void invalidId;

  // @ts-expect-error plain numbers are not gravitational-parameter values
  const invalidMu: GravitationalParameter = 1;
  void invalidMu;
});

test("ObjectType exposes exactly the closed physical taxonomy", () => {
  const values = [
    ObjectType.star,
    ObjectType.planet,
    ObjectType.dwarfPlanet,
    ObjectType.moon,
    ObjectType.asteroid,
    ObjectType.comet,
    ObjectType.spacecraft,
    ObjectType.station,
    ObjectType.artificialSatellite,
    ObjectType.surfaceObject,
    ObjectType.debris,
  ];

  assert.equal(new Set(values).size, 11);
  for (const value of values) {
    assert.equal(objectType(value), value);
  }
  assert.throws(() => objectType("reserved"), /Unknown/);
  assert.throws(() => objectType(1), TypeError);
});

test("physical properties validate finite non-negative SI values and preserve absence", () => {
  const absent = physicalProperties();
  assert.equal("mass" in absent, false);
  assert.equal("mu" in absent, false);
  assert.equal("physicalRadius" in absent, false);
  assert.equal("collisionBoundingRadius" in absent, false);

  const zero = physicalProperties({
    mass: 0,
    mu: 0,
    physicalRadius: 0,
    collisionBoundingRadius: 0,
  });
  assert.deepEqual(zero, {
    mass: 0,
    mu: 0,
    physicalRadius: 0,
    collisionBoundingRadius: 0,
  });

  const nonZero = physicalProperties({
    mass: Math.PI,
    mu: 1.32712440018e20,
    physicalRadius: 6_371_000,
    collisionBoundingRadius: 10,
  });
  assert.equal(nonZero.mass, Math.PI);
  assert.equal(nonZero.mu, 1.32712440018e20);
  assert.equal(nonZero.physicalRadius, 6_371_000);
  assert.equal(nonZero.collisionBoundingRadius, 10);
  assert.equal("collisionBoundingRadius" in physicalProperties({ physicalRadius: 5 }), false);
  assert.equal("physicalRadius" in physicalProperties({ collisionBoundingRadius: 5 }), false);

  assert.equal(gravitationalParameter(0), 0);
  assert.equal(mu(3), 3);
  assert.equal(physicalRadius(4), 4);
  assert.equal(collisionBoundingRadius(5), 5);

  for (const input of [NaN, Infinity, -Infinity]) {
    assert.throws(() => physicalProperties({ mass: input }));
    assert.throws(() => physicalProperties({ mu: input }));
    assert.throws(() => physicalProperties({ physicalRadius: input }));
    assert.throws(() => physicalProperties({ collisionBoundingRadius: input }));
  }
  assert.throws(() => physicalProperties({ mass: -1 }), RangeError);
  assert.throws(() => gravitationalParameter(-1), RangeError);
  assert.throws(() => physicalRadius(-1), RangeError);
  assert.throws(() => collisionBoundingRadius(-1), RangeError);
});
