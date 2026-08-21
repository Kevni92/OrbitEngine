import assert from "node:assert/strict";

import type { Backend } from "../../src/internal/backends/contract.js";
import {
  decodeObjectWire,
  encodeObjectWire,
  type ObjectValue,
} from "../../src/internal/object-wire.js";
import { objectId, ObjectType } from "../../src/objects.js";
import { physicalProperties } from "../../src/properties.js";

export const objectRoundTripCases: readonly ObjectValue[] = [
  { id: objectId("1"), type: ObjectType.star, properties: physicalProperties() },
  { id: objectId("4294967295"), type: ObjectType.planet, properties: physicalProperties({ mass: 0 }) },
  { id: objectId("4294967296"), type: ObjectType.dwarfPlanet, properties: physicalProperties({ mu: 0 }) },
  { id: objectId("9007199254740993"), type: ObjectType.moon, properties: physicalProperties({ physicalRadius: 0 }) },
  {
    id: objectId("18446744073709551615"),
    type: ObjectType.asteroid,
    properties: physicalProperties({ collisionBoundingRadius: 0 }),
  },
  {
    id: objectId("9007199254740993"),
    type: ObjectType.comet,
    properties: physicalProperties({
      mass: Math.PI,
      mu: 1.2345678901234567e20,
      physicalRadius: 1234.5,
      collisionBoundingRadius: 12.25,
    }),
  },
  { id: objectId("1"), type: ObjectType.spacecraft, properties: physicalProperties({ mass: 10 }) },
  { id: objectId("4294967296"), type: ObjectType.station, properties: physicalProperties({ mu: 20 }) },
  { id: objectId("9007199254740993"), type: ObjectType.artificialSatellite, properties: physicalProperties({ physicalRadius: 2 }) },
  { id: objectId("18446744073709551615"), type: ObjectType.surfaceObject, properties: physicalProperties({ collisionBoundingRadius: 3 }) },
  { id: objectId("4294967295"), type: ObjectType.debris, properties: physicalProperties({ mass: 0, collisionBoundingRadius: 0 }) },
];

export function assertObjectRoundTrip(backend: Backend): void {
  for (const expected of objectRoundTripCases) {
    const wire = encodeObjectWire(expected);
    const returnedWire = backend.roundTripObject(wire);
    assert.deepEqual(returnedWire, wire);
    assert.deepEqual(decodeObjectWire(returnedWire), expected);
  }

  const binary64Sentinel = Math.PI;
  assert.equal(backend.roundTripDouble(binary64Sentinel), binary64Sentinel);
}
