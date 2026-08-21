# Deterministic Solar-System demo fixture

This directory contains the small offline scenario used by the reference demo. It is an application-owned normalized fixture; OrbitEngine registers and propagates the supplied objects but does not generate a Solar System or fetch ephemerides.

## Provenance

- Source families: [NASA/JPL Horizons documentation](https://ssd.jpl.nasa.gov/horizons/manual.html) and [JPL planetary orbit reference material](https://ssd.jpl.nasa.gov/planets/orbits.html).
- Retrieval/version date recorded in code: `2026-08-21`.
- Source epoch/time scale: J2000, TDB.
- Source spatial frame: right-handed ICRS/ICRF-aligned axes, represented in the engine's root inertial frame.
- Normalization: explicit canonical decimal IDs, SI metres, metres per second, kilograms, gravitational parameter in m³/s², and simulation seconds/nanoseconds from J2000 TDB.

The committed anchors are deterministic, circularized educational fixture values chosen to exercise the public registration, frame, dependency, batch-query, relative-query, and rendering contracts. They are not a precision DE ephemeris extraction and must not be treated as production navigation data. Runtime execution has no network dependency; the URLs above are provenance only.
