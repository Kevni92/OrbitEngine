import { objectId, objectType, ObjectType, type ObjectId, type ObjectType as ObjectTypeValue } from "../objects.js";
import { physicalProperties, type PhysicalProperties } from "../properties.js";

const TWO_TO_32 = 4_294_967_296;
const UINT32_MAX = 4_294_967_295;

const OBJECT_TYPE_CODES: Readonly<Record<ObjectTypeValue, number>> = Object.freeze({
  [ObjectType.star]: 1,
  [ObjectType.planet]: 2,
  [ObjectType.dwarfPlanet]: 3,
  [ObjectType.moon]: 4,
  [ObjectType.asteroid]: 5,
  [ObjectType.comet]: 6,
  [ObjectType.spacecraft]: 7,
  [ObjectType.station]: 8,
  [ObjectType.artificialSatellite]: 9,
  [ObjectType.surfaceObject]: 10,
  [ObjectType.debris]: 11,
});

const OBJECT_TYPES_BY_CODE: Readonly<Record<number, ObjectTypeValue>> = Object.freeze(
  Object.fromEntries(Object.entries(OBJECT_TYPE_CODES).map(([name, code]) => [code, name])) as Record<number, ObjectTypeValue>,
);

export interface ObjectWire {
  readonly objectIdHigh: number;
  readonly objectIdLow: number;
  readonly objectTypeCode: number;
  readonly massPresent: boolean;
  readonly mass: number;
  readonly muPresent: boolean;
  readonly mu: number;
  readonly physicalRadiusPresent: boolean;
  readonly physicalRadius: number;
  readonly collisionBoundingRadiusPresent: boolean;
  readonly collisionBoundingRadius: number;
}
export interface ObjectValue {
  readonly id: ObjectId;
  readonly type: ObjectTypeValue;
  readonly properties: PhysicalProperties;
}

function assertInteger(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new TypeError(`${name} must be an integer`);
  }
  return value;
}

function assertUnsigned(value: unknown, maximum: number, name: string): number {
  const integer = assertInteger(value, name);
  if (integer < 0 || integer > maximum) {
    throw new RangeError(`${name} is outside its unsigned range`);
  }
  return integer;
}

function validateOptionalScalar(
  present: unknown,
  value: unknown,
  name: string,
): { readonly present: boolean; readonly value: number } {
  if (typeof present !== "boolean") {
    throw new TypeError(`${name} presence must be boolean`);
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number`);
  }
  if (value < 0) {
    throw new RangeError(`${name} must be greater than or equal to zero`);
  }
  if (!present && value !== 0) {
    throw new RangeError(`${name} must be zero when absent`);
  }
  return { present, value: value === 0 ? 0 : value };
}

export function validateObjectWire(value: unknown): ObjectWire {
  if (typeof value !== "object" || value === null) {
    throw new TypeError("object wire value must be an object");
  }

  const candidate = value as Record<string, unknown>;
  const objectIdHigh = assertUnsigned(candidate.objectIdHigh, UINT32_MAX, "object wire objectIdHigh");
  const objectIdLow = assertUnsigned(candidate.objectIdLow, UINT32_MAX, "object wire objectIdLow");
  const objectTypeCode = assertInteger(candidate.objectTypeCode, "object wire objectTypeCode");
  if (objectTypeCode < 1 || objectTypeCode > 11 || OBJECT_TYPES_BY_CODE[objectTypeCode] === undefined) {
    throw new RangeError("object wire objectTypeCode is unknown or reserved");
  }
  if (objectIdHigh === 0 && objectIdLow === 0) {
    throw new RangeError("object wire ObjectId must be non-zero");
  }

  const mass = validateOptionalScalar(candidate.massPresent, candidate.mass, "object wire mass");
  const gravitationalParameter = validateOptionalScalar(candidate.muPresent, candidate.mu, "object wire mu");
  const physicalRadius = validateOptionalScalar(
    candidate.physicalRadiusPresent,
    candidate.physicalRadius,
    "object wire physical radius",
  );
  const collisionRadius = validateOptionalScalar(
    candidate.collisionBoundingRadiusPresent,
    candidate.collisionBoundingRadius,
    "object wire collision bounding radius",
  );

  return Object.freeze({
    objectIdHigh,
    objectIdLow,
    objectTypeCode,
    massPresent: mass.present,
    mass: mass.value,
    muPresent: gravitationalParameter.present,
    mu: gravitationalParameter.value,
    physicalRadiusPresent: physicalRadius.present,
    physicalRadius: physicalRadius.value,
    collisionBoundingRadiusPresent: collisionRadius.present,
    collisionBoundingRadius: collisionRadius.value,
  });
}

export function objectIdToWire(value: ObjectId): { readonly objectIdHigh: number; readonly objectIdLow: number } {
  const canonical = objectId(value);
  let high = 0;
  let low = 0;

  for (let index = 0; index < canonical.length; index += 1) {
    const digit = canonical.charCodeAt(index) - 48;
    const lowProduct = low * 10 + digit;
    low = lowProduct % TWO_TO_32;
    high = high * 10 + Math.floor(lowProduct / TWO_TO_32);
    if (high >= TWO_TO_32) {
      throw new RangeError("ObjectId exceeds uint64 range");
    }
  }

  return { objectIdHigh: high, objectIdLow: low };
}

export function objectIdFromWire(objectIdHigh: number, objectIdLow: number): ObjectId {
  const high = assertUnsigned(objectIdHigh, UINT32_MAX, "objectIdHigh");
  let low = assertUnsigned(objectIdLow, UINT32_MAX, "objectIdLow");
  if (high === 0 && low === 0) {
    throw new RangeError("ObjectId wire value must be non-zero");
  }

  let digits = "";
  let currentHigh = high;
  while (currentHigh !== 0 || low !== 0) {
    const highRemainder = currentHigh % 10;
    currentHigh = Math.floor(currentHigh / 10);
    const combined = highRemainder * TWO_TO_32 + low;
    low = Math.floor(combined / 10);
    digits = String(combined % 10) + digits;
  }
  return objectId(digits);
}

function optionalValue(value: number | undefined): { readonly present: boolean; readonly value: number } {
  return value === undefined ? { present: false, value: 0 } : { present: true, value };
}

export function objectTypeToCode(value: ObjectTypeValue): number {
  return OBJECT_TYPE_CODES[objectType(value)];
}

export function objectTypeFromCode(code: number): ObjectTypeValue {
  const value = OBJECT_TYPES_BY_CODE[assertInteger(code, "object type code")];
  if (value === undefined) {
    throw new RangeError("Unknown or reserved object type code");
  }
  return value;
}

export function encodeObjectWire(value: ObjectValue): ObjectWire {
  if (typeof value !== "object" || value === null) {
    throw new TypeError("object value must be an object");
  }
  const id = objectIdToWire(value.id);
  const properties = physicalProperties(value.properties ?? {});
  const mass = optionalValue(properties.mass);
  const gravitationalParameter = optionalValue(properties.mu);
  const physicalRadius = optionalValue(properties.physicalRadius);
  const collisionRadius = optionalValue(properties.collisionBoundingRadius);

  return validateObjectWire({
    ...id,
    objectTypeCode: objectTypeToCode(value.type),
    massPresent: mass.present,
    mass: mass.value,
    muPresent: gravitationalParameter.present,
    mu: gravitationalParameter.value,
    physicalRadiusPresent: physicalRadius.present,
    physicalRadius: physicalRadius.value,
    collisionBoundingRadiusPresent: collisionRadius.present,
    collisionBoundingRadius: collisionRadius.value,
  });
}

export function decodeObjectWire(value: unknown): ObjectValue {
  const wire = validateObjectWire(value);
  return Object.freeze({
    id: objectIdFromWire(wire.objectIdHigh, wire.objectIdLow),
    type: objectTypeFromCode(wire.objectTypeCode),
    properties: physicalProperties({
      mass: wire.massPresent ? wire.mass : undefined,
      mu: wire.muPresent ? wire.mu : undefined,
      physicalRadius: wire.physicalRadiusPresent ? wire.physicalRadius : undefined,
      collisionBoundingRadius: wire.collisionBoundingRadiusPresent ? wire.collisionBoundingRadius : undefined,
    }),
  });
}
