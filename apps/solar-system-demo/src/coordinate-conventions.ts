export interface CartesianVector {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export const J2000_ECLIPTIC_OBLIQUITY_RADIANS = 23.43928 * Math.PI / 180;
const J2000_ECLIPTIC_COSINE = Math.cos(J2000_ECLIPTIC_OBLIQUITY_RADIANS);
const J2000_ECLIPTIC_SINE = Math.sin(J2000_ECLIPTIC_OBLIQUITY_RADIANS);

/** Rotate a J2000-ecliptic vector into the canonical ICRS/ICRF-aligned axes. */
export function j2000EclipticToIcrs(vector: CartesianVector): CartesianVector {
  return Object.freeze({
    x: vector.x,
    y: J2000_ECLIPTIC_COSINE * vector.y - J2000_ECLIPTIC_SINE * vector.z,
    z: J2000_ECLIPTIC_SINE * vector.y + J2000_ECLIPTIC_COSINE * vector.z,
  });
}

/** Inverse presentation rotation from canonical ICRS/ICRF axes to J2000 ecliptic axes. */
export function icrsToJ2000Ecliptic(vector: CartesianVector): CartesianVector {
  return Object.freeze({
    x: vector.x,
    y: J2000_ECLIPTIC_COSINE * vector.y + J2000_ECLIPTIC_SINE * vector.z,
    z: -J2000_ECLIPTIC_SINE * vector.y + J2000_ECLIPTIC_COSINE * vector.z,
  });
}
