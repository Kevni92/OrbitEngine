import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeObjectWire,
  encodeObjectWire,
  objectIdFromWire,
  objectIdToWire,
  objectTypeFromCode,
  objectTypeToCode,
  validateObjectWire,
} from "../../src/internal/object-wire.js";
import { ObjectType, objectId } from "../../src/objects.js";
import { physicalProperties } from "../../src/properties.js";

test("ObjectId decimal text and uint32 wire words round-trip exactly", () => {
  for (const text of [
    "1",
    "4294967295",
    "4294967296",
    "9007199254740993",
    "18446744073709551615",
  ]) {
    const wire = objectIdToWire(objectId(text));
    assert.equal(objectIdFromWire(wire.objectIdHigh, wire.objectIdLow), text);
  }
  assert.throws(() => objectIdFromWire(0, 0), RangeError);
});
test("ObjectType names map to stable internal wire codes", () => {
  const values = Object.values(ObjectType);
  values.forEach((value, index) => {
    assert.equal(objectTypeToCode(value), index + 1);
    assert.equal(objectTypeFromCode(index + 1), value);
  });
  assert.throws(() => objectTypeFromCode(0), RangeError);
  assert.throws(() => objectTypeFromCode(12), RangeError);
});

test("object wire codec keeps optional zero distinct from absence", () => {
  const value = {
    id: objectId("18446744073709551615"),
    type: ObjectType.debris,
    properties: physicalProperties({ mass: 0, mu: Math.PI }),
  } as const;
  const wire = encodeObjectWire(value);

  assert.equal(wire.objectIdHigh, 4_294_967_295);
  assert.equal(wire.objectIdLow, 4_294_967_295);
  assert.equal(wire.objectTypeCode, 11);
  assert.equal(wire.massPresent, true);
  assert.equal(wire.mass, 0);
  assert.equal(wire.muPresent, true);
  assert.equal(wire.mu, Math.PI);
  assert.equal(wire.physicalRadiusPresent, false);
  assert.equal(wire.physicalRadius, 0);

  assert.deepEqual(decodeObjectWire(wire), value);
  assert.throws(() => validateObjectWire({ ...wire, objectIdHigh: 0, objectIdLow: 0 }), RangeError);
  assert.throws(() => validateObjectWire({ ...wire, objectTypeCode: 0 }), RangeError);
  assert.throws(() => validateObjectWire({ ...wire, massPresent: false, mass: 1 }), RangeError);
});
