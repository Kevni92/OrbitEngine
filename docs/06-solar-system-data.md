# 06 — Solar-System Data

## Boundary

OrbitEngine does not generate the Solar System. The initial game use case will provide a curated, versioned dataset containing the Sun, planets, known moons, selected/known asteroids, comets, and other required bodies.

The engine consumes normalized physical/orbital data; separate import/build tooling is responsible for acquiring and converting source data.

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
scenario/game loads objects
          |
      OrbitEngine
```

Normal game/server execution should not depend on live internet access to JPL/NASA services.

## Time, units, and object normalization

The canonical runtime time/unit conventions are defined in [12 — Simulation Time, Units, and Numerical Precision](12-simulation-time-units-and-precision.md). The canonical runtime object contract is defined in [13 — Physical Object and State Model](13-physical-object-and-state-model.md).

Import/build tooling is responsible for:

- converting source units to SI;
- converting source epochs/time scales to normalized TDB `SimulationInstant` values;
- mapping each imported body to one stable caller-supplied OrbitEngine `ObjectId`;
- mapping source body classification to the closed physical `ObjectType` taxonomy;
- keeping physical mass, gravitational parameter, physical radius, and collision envelope as explicit fields rather than relying on hidden inference;
- preserving reference-source/provenance information separately from runtime identity/type.

Runtime simulation must not need a live or mutable leap-second table merely to interpret versioned dataset epochs.

The produced dataset must retain source/provenance information sufficient to reproduce time conversion and physical values, including source time scale and leap-second/time-conversion data version or source where applicable.

## Data categories

Orbit-relevant dataset fields may include:

- stable OrbitEngine object ID plus source identifiers/names used for provenance;
- physical `ObjectType`;
- mass and/or gravitational parameter as explicitly supplied/normalized;
- mean/physical radius and later collision/shape information where needed;
- epoch Cartesian state vectors and/or reference ephemeris representation;
- orbital elements where appropriate as derived/import representation, not canonical dynamic authority after divergence;
- rotation period/orientation/frame data;
- parent/reference relationships;
- source/provenance/version information, including source unit/time-scale metadata where relevant.

Resource composition, geology, atmosphere as gameplay content, habitability, population, and economy data are outside OrbitEngine unless a physical subset is specifically required by trajectory physics.

## Accuracy window

The intended simulation use case is approximately ±1000 years around a scenario epoch. We do not need a model optimized for tens of millions of years. Data and propagation choices should be validated against the actual supported time window.

The underlying instant/identity representations have larger numerical ranges; that does not extend the scientific validity of imported data or propagation models automatically.

## Reference divergence

Imported data defines the baseline/reference history. `followingReference` is motion/provenance status, not `ObjectType`.

Once simulation changes an imported object's physical state, the object transitions atomically to diverged dynamic authority at that exact instant. Its `ObjectId` and physical `ObjectType` stay unchanged. The original source ephemeris remains available only as historical/reference provenance and must never silently regain authority.
