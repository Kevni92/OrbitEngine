# Production Solar-System demo scenario

This directory contains the application-owned catalog used by the reference demo. It registers 48 bodies: eleven production OEP objects (Sun, Mercury, Venus, Earth, Moon, Mars, Jupiter, Saturn, Uranus, Neptune, and Pluto) plus supplemental display fixtures for the remaining catalog entries. OrbitEngine registers and propagates supplied objects; it does not generate a Solar System or fetch astronomy data from the network.

## Provenance

- Production source: the committed [NASA/JPL DE441 part-2 source product](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/de441_part-2.bsp), imported into `data/solar-system-oep/` by the OEP importer.
- Dataset identity: `solar-system-reference@1.0.0-de441-major`; the manifest and four shard checksums are pinned by the loader and bundled into the application during `prepare:oep`.
- Retrieval/version date recorded in code and the manifest: `2026-08-23`.
- Source epoch/time scale: J2000, TDB.
- Source spatial frame: SSB plus right-handed ICRS/ICRF-aligned axes, represented in the engine's root inertial frame.
- Normalization: explicit canonical decimal IDs, SI metres, metres per second, kilograms, and exact simulation seconds/nanoseconds from J2000 TDB.

The production bodies use the public `OrbitEngine.loadEphemerisPack`, `registerEphemerisSourceFrame`, `bindReferenceEphemeris`, `stateAt`, `statesAt`, and `relativeStateAt` APIs. Mercury, Venus, and the Earth/Moon barycenter use source-centered frames `201`, `202`, and `203`; the catalog's physical hierarchy still exposes Sun/Earth/Moon relationships through the application-owned centered frames. The source validity interval is enforced as bounded OEP validity, so out-of-range queries fail instead of silently extrapolating.

The remaining catalog entries are explicitly marked supplemental educational fixtures in provenance and diagnostics. They retain the demo's isolated two-body presentation coverage until corresponding production OEP bindings exist; they are not presented as authoritative ephemerides. In particular, the Moon is no longer represented by the former z=0 circularized fixture. Runtime execution has no network dependency; source URLs are provenance only.
