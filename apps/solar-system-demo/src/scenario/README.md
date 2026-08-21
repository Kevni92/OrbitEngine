# Deterministic Solar-System demo fixture

This directory contains the application-owned, offline catalog used by the reference demo. It currently registers 48 bodies: the Sun, eight planets, the required major moons, five dwarf planets, and seven representative asteroids. OrbitEngine registers and propagates the supplied objects but does not generate a Solar System or fetch ephemerides.

## Provenance

- Source families: [NASA/JPL Horizons API documentation](https://ssd-api.jpl.nasa.gov/doc/horizons.html), [NASA/JPL Horizons documentation](https://ssd.jpl.nasa.gov/horizons/manual.html), and [JPL planetary orbit reference material](https://ssd.jpl.nasa.gov/planets/orbits.html).
- Retrieval/version date recorded in code: `2026-08-21`.
- Source epoch/time scale: J2000, TDB.
- Source spatial frame: right-handed ICRS/ICRF-aligned axes, represented in the engine's root inertial frame.
- Normalization: explicit canonical decimal IDs, SI metres, metres per second, kilograms, gravitational parameter in m³/s², and simulation seconds/nanoseconds from J2000 TDB.

Earth now uses its normalized JPL Horizons J2000/TDB heliocentric state vector as well. The other original planet fixture anchors remain deterministic, circularized educational values; their ecliptic-plane vectors are rotated once at the scenario boundary into the engine's ICRS/ICRF-aligned axes so Earth's orbit is coplanar with the primary-planet fixtures. The added moons, dwarf planets, and asteroids carry one normalized JPL Horizons J2000/TDB vector per body and are propagated by the demo's educational two-body model; they are not precision long-term ephemerides or production navigation data. The catalog keeps physical central-body relationships separate from display categories and validates deterministic topological registration, centered-frame dependencies, aliases, and per-body provenance. Runtime execution has no network dependency; the URLs above are provenance only.
