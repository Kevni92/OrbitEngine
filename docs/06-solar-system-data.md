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

## Data categories

Orbit-relevant dataset fields may include:

- identifiers/names used by the import layer;
- mass / gravitational parameter as required;
- mean/physical radius and shape information where needed;
- epoch state vectors and/or ephemeris representation;
- orbital elements where appropriate;
- rotation period/orientation/frame data;
- parent/reference relationships;
- source/provenance/version information.

Resource composition, geology, atmosphere as gameplay content, habitability, population, and economy data are outside OrbitEngine unless a physical subset is specifically required by trajectory physics.

## Accuracy window

The intended simulation use case is approximately ±1000 years around a scenario epoch. We do not need a model optimized for tens of millions of years. Data and propagation choices should be validated against the actual supported time window.

## Reference divergence

Imported data defines the baseline/reference history. Once a simulation changes an object's physical state, the current simulated state becomes authoritative for that object and its future no longer needs to match the source ephemeris.

Source provenance should still be retained so the original baseline can be inspected or the scenario can be recreated deterministically.
