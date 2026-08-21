import { kilograms, meters, type Kilograms, type Meters } from "./units.js";

declare const gravitationalParameterBrand: unique symbol;

export type GravitationalParameter = number & {
  readonly [gravitationalParameterBrand]: "GravitationalParameter";
};

export interface PhysicalProperties {
  readonly mass?: Kilograms;
  readonly mu?: GravitationalParameter;
  readonly physicalRadius?: Meters;
  readonly collisionBoundingRadius?: Meters;
}
export interface PhysicalPropertiesInput {
  readonly mass?: number;
  readonly mu?: number;
  readonly physicalRadius?: number;
  readonly collisionBoundingRadius?: number;
}

function assertFiniteNumber(value: number, name: string): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number`);
  }
}

function nonNegativeFinite(value: number, name: string): number {
  assertFiniteNumber(value, name);
  if (value < 0) {
    throw new RangeError(`${name} must be greater than or equal to zero`);
  }
  return value === 0 ? 0 : value;
}

export function gravitationalParameter(value: number): GravitationalParameter {
  return nonNegativeFinite(value, "gravitational parameter") as GravitationalParameter;
}

export function mu(value: number): GravitationalParameter {
  return gravitationalParameter(value);
}

export function physicalRadius(value: number): Meters {
  return meters(nonNegativeFinite(value, "physical radius"));
}

export function collisionBoundingRadius(value: number): Meters {
  return meters(nonNegativeFinite(value, "collision bounding radius"));
}

export function physicalProperties(input: PhysicalPropertiesInput = {}): PhysicalProperties {
  if (typeof input !== "object" || input === null) {
    throw new TypeError("Physical properties must be an object");
  }

  const result: {
    mass?: Kilograms;
    mu?: GravitationalParameter;
    physicalRadius?: Meters;
    collisionBoundingRadius?: Meters;
  } = {};

  if (input.mass !== undefined) {
    result.mass = kilograms(nonNegativeFinite(input.mass, "mass"));
  }
  if (input.mu !== undefined) {
    result.mu = gravitationalParameter(input.mu);
  }
  if (input.physicalRadius !== undefined) {
    result.physicalRadius = physicalRadius(input.physicalRadius);
  }
  if (input.collisionBoundingRadius !== undefined) {
    result.collisionBoundingRadius = collisionBoundingRadius(input.collisionBoundingRadius);
  }

  return Object.freeze(result);
}
