# 06 — Solar-System Data

## Boundary

OrbitEngine does not generate the Solar System. The initial game use case will provide a curated, versioned dataset containing the Sun, planets, known moons, selected/known asteroids, comets, and other required bodies.

The engine consumes normalized physical/orbital/frame data; separate import/build tooling is responsible for acquiring and converting source data.

## Intended source direction

Authoritative astronomical sources such as NASA/JPL data products should provide the factual baseline where practical, including ephemerides/orbital state, physical constants, rotation/orientation data, and body metadata.

The exact source set and licenses/redistribution rules must be decided before a production dataset is shipped. Candidate source families include JPL Horizons and SPICE/NAIF products.

## Reproducible import pipeline

Preferred flow:

```text
Authoritative external sources
          |
      import tooling
          |
validation / normalization
          |
versioned OrbitEngine dataset
          |
scenario/game loads objects + frames
          |
      OrbitEngine
```

Normal game/server execution should not depend on live internet access to JPL/NASA services.

## Time, units, object, and frame normalization

The canonical runtime time/unit conventions are defined in [12 — Simulation Time, Units, and Numerical Precision](12-simulation-time-units-and-precision.md). The canonical runtime object contract is defined in [13 — Physical Object and State Model](13-physical-object-and-state-model.md). The canonical spatial/frame contract is defined in [14 — Reference Frames and Coordinate System](14-reference-frames-and-coordinate-system.md).

Import/build tooling is responsible for:

- converting source units to SI;
- converting source epochs/time scales to normalized TDB `SimulationInstant` values;
- mapping each imported body to one stable caller-supplied OrbitEngine `ObjectId`;
- mapping source body classification to the closed physical `ObjectType` taxonomy;
- assigning deterministic non-root `ReferenceFrameId` values for imported frame definitions;
- recording the exact source spatial reference-frame convention/realization rather than relying on ambiguous labels alone;
- rotating/translating imported states into the declared OrbitEngine frame when the source frame is materially different;
- converting source orientation models into the canonical quaternion + angular-velocity provider contract where runtime body-fixed frames require them;
- keeping physical mass, gravitational parameter, physical radius, and collision envelope as explicit fields rather than relying on hidden inference;
- preserving reference-source/provenance information separately from runtime identity/type.

Runtime simulation must not need live SPICE kernels, a live network connection, or a mutable leap-second table merely to interpret a versioned normalized dataset.

The produced dataset must retain source/provenance information sufficient to reproduce time conversion, frame conversion, orientation, and physical values, including source time scale, source spatial frame/product convention, orientation-source version, and leap-second/time-conversion data source where applicable.

## Spatial reference convention

OrbitEngine's canonical root is SSB-centered with fixed ICRS/ICRF-aligned axes. Import tooling must not silently equate every source string called `J2000`, `ECLIPJ2000`, equator-of-date, body-fixed, or local coordinates with that root.

Modern JPL/SPICE products commonly labeled `J2000` may be ICRF-aligned for historical compatibility; the exact source product documentation remains authoritative and should be preserved as provenance.

Body-fixed source frames are normalized through explicit orientation providers. Source surface coordinates such as planetocentric/planetographic latitude/longitude are converted through an explicit body-shape/convention into body-fixed Cartesian/local transforms rather than becoming universal runtime state.

## Data categories

Orbit-relevant dataset fields may include:

- stable OrbitEngine object ID plus source identifiers/names used for provenance;
- physical `ObjectType`;
- stable frame IDs plus parent/dependency definitions;
- source/canonical frame convention and validity metadata;
- mass and/or gravitational parameter as explicitly supplied/normalized;
- mean/physical radius and later collision/shape information where needed;
- epoch Cartesian state vectors and/or reference ephemeris representation;
- orbital elements where appropriate as derived/import representation, not canonical dynamic authority after divergence;
- normalized orientation provider data for required body-fixed frames;
- parent/reference relationships;
- source/provenance/version information, including source unit/time-scale/spatial-frame metadata where relevant.

Resource composition, geology, atmosphere as gameplay content, habitability, population, economy, detailed terrain, and rendering-coordinate data are outside OrbitEngine unless a physical subset is specifically required by trajectory/frame physics.

## Accuracy window

The intended simulation use case is approximately ±1000 years around a scenario epoch. We do not need a model optimized for tens of millions of years. Data, frame/orientation, and propagation choices should be validated against the actual supported time window.

The underlying instant/identity representations have larger numerical ranges; that does not extend the scientific validity of imported data or models automatically.

## Reference divergence

Imported data defines the baseline/reference history. `followingReference` is motion/provenance status, not `ObjectType`.

Once simulation changes an imported object's physical state, the object transitions atomically to diverged dynamic authority at that exact instant. Its `ObjectId`, physical `ObjectType`, and frame identities stay unchanged unless an explicit separate structural operation changes frame attachment. The original source ephemeris remains available only as historical/reference provenance and must never silently regain authority.
