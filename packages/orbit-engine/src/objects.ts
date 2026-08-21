const UINT64_MAX_DECIMAL = "18446744073709551615";

declare const objectIdBrand: unique symbol;

export type ObjectId = string & {
  readonly [objectIdBrand]: "ObjectId";
};

function isCanonicalObjectIdText(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > UINT64_MAX_DECIMAL.length) {
    return false;
  }
  if (value.length > 1 && value.charCodeAt(0) === 48) {
    return false;
  }
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 48 || code > 57) {
      return false;
    }
  }
  if (value.length === UINT64_MAX_DECIMAL.length && value > UINT64_MAX_DECIMAL) {
    return false;
  }
  return value !== "0";
}
export function isObjectId(value: unknown): value is ObjectId {
  return isCanonicalObjectIdText(value);
}

export function objectId(value: string): ObjectId {
  if (typeof value !== "string") {
    throw new TypeError("ObjectId must be a string");
  }
  if (!isCanonicalObjectIdText(value)) {
    throw new RangeError("ObjectId must be canonical decimal text in the range 1..uint64_max");
  }
  return value as ObjectId;
}

export const ObjectType = Object.freeze({
  star: "star",
  planet: "planet",
  dwarfPlanet: "dwarfPlanet",
  moon: "moon",
  asteroid: "asteroid",
  comet: "comet",
  spacecraft: "spacecraft",
  station: "station",
  artificialSatellite: "artificialSatellite",
  surfaceObject: "surfaceObject",
  debris: "debris",
} as const);

export type ObjectType = (typeof ObjectType)[keyof typeof ObjectType];

const objectTypeValues = new Set<string>(Object.values(ObjectType));

export function objectType(value: unknown): ObjectType {
  if (typeof value !== "string") {
    throw new TypeError("ObjectType must be a string");
  }
  if (!objectTypeValues.has(value)) {
    throw new RangeError(`Unknown ObjectType: ${value}`);
  }
  return value as ObjectType;
}
