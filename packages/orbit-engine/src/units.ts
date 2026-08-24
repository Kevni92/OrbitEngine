declare const metersBrand: unique symbol;
declare const metersPerSecondBrand: unique symbol;
declare const metersPerSecondSquaredBrand: unique symbol;
declare const kilogramsBrand: unique symbol;
declare const newtonsBrand: unique symbol;
declare const kilogramsPerSecondBrand: unique symbol;
declare const radiansBrand: unique symbol;
declare const radiansPerSecondBrand: unique symbol;
declare const radiansPerSecondSquaredBrand: unique symbol;

export type Meters = number & { readonly [metersBrand]: "Meters" };
export type MetersPerSecond = number & { readonly [metersPerSecondBrand]: "MetersPerSecond" };
export type MetersPerSecondSquared = number & { readonly [metersPerSecondSquaredBrand]: "MetersPerSecondSquared" };
export type Kilograms = number & { readonly [kilogramsBrand]: "Kilograms" };
export type Newtons = number & { readonly [newtonsBrand]: "Newtons" };
export type KilogramsPerSecond = number & { readonly [kilogramsPerSecondBrand]: "KilogramsPerSecond" };
export type Radians = number & { readonly [radiansBrand]: "Radians" };
export type RadiansPerSecond = number & { readonly [radiansPerSecondBrand]: "RadiansPerSecond" };
export type RadiansPerSecondSquared = number & { readonly [radiansPerSecondSquaredBrand]: "RadiansPerSecondSquared" };

function finiteValue(value: number, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number`);
  }

  return value;
}

export function meters(value: number): Meters {
  return finiteValue(value, "meters") as Meters;
}

export function metersPerSecond(value: number): MetersPerSecond {
  return finiteValue(value, "metersPerSecond") as MetersPerSecond;
}

export function metersPerSecondSquared(value: number): MetersPerSecondSquared {
  return finiteValue(value, "metersPerSecondSquared") as MetersPerSecondSquared;
}

export function kilograms(value: number): Kilograms {
  return finiteValue(value, "kilograms") as Kilograms;
}

export function newtons(value: number): Newtons {
  return finiteValue(value, "newtons") as Newtons;
}

export function kilogramsPerSecond(value: number): KilogramsPerSecond {
  return finiteValue(value, "kilogramsPerSecond") as KilogramsPerSecond;
}

export function radians(value: number): Radians {
  return finiteValue(value, "radians") as Radians;
}

export function radiansPerSecond(value: number): RadiansPerSecond {
  return finiteValue(value, "radiansPerSecond") as RadiansPerSecond;
}

export function radiansPerSecondSquared(value: number): RadiansPerSecondSquared {
  return finiteValue(value, "radiansPerSecondSquared") as RadiansPerSecondSquared;
}
