# 06 — Solar-System Data

## Boundary

OrbitEngine does not generate the Solar System. The initial game use case will provide a curated, versioned dataset containing the Sun, planets, known moons, selected/known asteroids, comets, and other required bodies.

The engine consumes normalized physical/orbital/frame data; separate import/build tooling is responsible for acquiring and converting source data.

Reference/demo applications may ship small committed normalized fixtures for deterministic integration and visualization. Those fixtures are consumers of the same object/time/frame/propagation contracts and must not become a second runtime astronomy database or a source of hidden engine defaults.

The production translational reference-data contract is defined by [20 — Reference Ephemeris Data and Pipeline](20-reference-ephemeris-data-and-pipeline.md).

## Authoritative source direction

Authoritative astronomical sources such as NASA/JPL data products provide the factual baseline where practical, including ephemerides/orbital state, physical constants, rotation/orientation data, and body metadata.

Architecture #113 makes the translational source strategy concrete:

- JPL **DE441** is the standard long-horizon major-body baseline because it covers OrbitEngine's approximately ±1000-year target around a modern era;
- DE440 may later be offered as a separately selected modern-era dataset profile, but runtime does not automatically splice DE440 and DE441 by date;
- planet centers and non-lunar natural satellites use pinned JPL planetary-system/satellite ephemerides where available and retain their actual, often shorter, validity intervals;
- Pluto-system body centers use an appropriate pinned Pluto-system ephemeris combined with the DE441 Pluto-system barycenter where required;
- curated asteroids/comets/minor bodies prefer suitable official JPL/NAIF/PDS SPKs and may otherwise use pinned Horizons-generated small-body SPKs acquired offline;
- runtime never contacts JPL/Horizons/NAIF to obtain or refresh authoritative state.

The exact product/kernel/version selected for a released scenario is part of that scenario dataset's identity and provenance.

## Reproducible import pipeline

The production flow is:

```text
Pinned authoritative JPL/NAIF/Horizons products
          |
      acquisition cache
      + checksums/version
          |
  CSPICE-assisted import tooling
          |
validation / SI + TDB + frame normalization
          |
OrbitEngine Ephemeris Pack (OEP)
manifest + binary shards
          |
scenario/game loads dataset + objects + frames
          |
portable referenceEphemeris evaluator
          |
      OrbitEngine
```

Normal game/server/browser execution does not depend on live internet access to JPL/NASA services.

CSPICE is an allowed acquisition/import/validation dependency. It is not a normal portable-core, native-addon, or WASM runtime dependency. Runtime evaluates the OrbitEngine-owned normalized OEP representation directly.

OEP is scenario/dataset content rather than a hidden database bundled into every `orbit-engine` npm installation. The npm package owns the loader/evaluator contracts; scenarios own which pack versions and shards they distribute/load.

See document 20 for pack format, source-center graph, sharding, error budgets, versioning, and source-vector/event validation.

## Time, units, object, and frame normalization

The canonical runtime time/unit conventions are defined in [12 — Simulation Time, Units, and Numerical Precision](12-simulation-time-units-and-precision.md). The canonical runtime object contract is defined in [13 — Physical Object and State Model](13-physical-object-and-state-model.md). The canonical spatial/frame contract is defined in [14 — Reference Frames and Coordinate System](14-reference-frames-and-coordinate-system.md).

Import/build tooling is responsible for:

- converting source units to SI;
- converting source epochs/time scales to normalized TDB `SimulationInstant` values;
- mapping each imported body to one stable caller-supplied OrbitEngine `ObjectId`;
- keeping dataset-local ephemeris source-node identity distinct from `ObjectId` and `ReferenceFrameId`;
- mapping source body classification to the closed physical `ObjectType` taxonomy;
- assigning deterministic non-root `ReferenceFrameId` values for imported frame definitions;
- recording the exact source spatial reference-frame convention/realization rather than relying on ambiguous labels alone;
- rotating/translating imported states or coefficients into the declared normalized OrbitEngine frame exactly once when the source frame is materially different;
- preserving the source target/center graph needed for barycenter/planet/moon reconstruction without conflating it with the physical `centralBody` hierarchy;
- converting source orientation models into the canonical quaternion + angular-velocity provider contract where runtime body-fixed frames require them;
- keeping physical mass, gravitational parameter, physical radius, and collision envelope as explicit fields rather than relying on hidden inference;
- preserving reference-source/provenance information separately from runtime identity/type;
- recording source coverage, source uncertainty/limitations, and normalization/representation error separately.

Runtime simulation must not need live SPICE kernels, a live network connection, or a mutable leap-second table merely to interpret a versioned normalized dataset.

The produced dataset must retain source/provenance information sufficient to reproduce time conversion, frame conversion, orientation, and physical values, including source time scale, source spatial frame/product convention, source/kernel/orbit-solution version, checksums, orientation-source version, and leap-second/time-conversion data source where applicable.

## Spatial reference convention

OrbitEngine's canonical root is SSB-centered with fixed ICRS/ICRF-aligned axes. Import tooling must not silently equate every source string called `J2000`, `ECLIPJ2000`, equator-of-date, body-fixed, or local coordinates with that root.

Modern JPL/SPICE products commonly labeled `J2000` may be ICRF-aligned for historical compatibility; the exact source product documentation remains authoritative and should be preserved as provenance.

Production OEP translational series are geometric. Observer/light-time/stellar-aberration-corrected Horizons results are not canonical physical-state input.

Body-fixed source frames are normalized through explicit orientation providers. Source surface coordinates such as planetocentric/planetographic latitude/longitude are converted through an explicit body-shape/convention into body-fixed Cartesian/local transforms rather than becoming universal runtime state.

## Ephemeris source hierarchy versus physical hierarchy

JPL source products distinguish SSB, planetary-system barycenters, planet centers, and satellite centers. That source dependency graph is not OrbitEngine's physical/display hierarchy.

A dataset may therefore contain a non-selectable ephemeris source node or frame origin such as the Jupiter-system barycenter while the physical catalog still says:

```text
Europa.centralBody = Jupiter
```

Pack-backed source-center frames are ordinary document-14 non-rotating frame providers with explicit dataset dependencies; they are not `ObjectType` values and do not become game entities.

This separation prevents double-applying parent translation and preserves useful local source coordinates for satellite systems.

## Data categories

Orbit-relevant dataset fields may include:

- stable OrbitEngine object ID plus source identifiers/names used for provenance;
- dataset-local ephemeris source-node IDs and source-center relationships;
- physical `ObjectType`;
- stable frame IDs plus parent/dependency definitions;
- source/canonical frame convention and validity metadata;
- mass and/or gravitational parameter as explicitly supplied/normalized;
- mean/physical radius and later collision/shape information where needed;
- epoch Cartesian state vectors and/or OEP reference ephemeris bindings;
- orbital elements where appropriate as derived/import representation, not canonical dynamic authority after divergence;
- normalized orientation provider data for required body-fixed frames;
- physical parent/reference relationships distinct from source-center relationships;
- source/provenance/version/checksum information;
- per-series effective validity and normalization error budgets;
- source uncertainty/limitations where known.

Resource composition, geology, atmosphere as gameplay content, habitability, population, economy, detailed terrain, and rendering-coordinate data are outside OrbitEngine unless a physical subset is specifically required by trajectory/frame physics.

## Astronomical appearance data for consumers

A versioned scenario/import product may contain additional astronomical metadata that is useful for presentation but is not part of the OrbitEngine physical registry. The canonical browser-demo contract for that data is defined by [19 — Celestial Appearance, Atmospheres, and Stellar Lighting](19-celestial-appearance-atmospheres-and-lighting.md).

Examples include:

- visible surface/cloud-layer composition;
- calibrated visible reflectance and visual albedo;
- atmosphere gas composition, pressure, scale height, haze, clouds, and optical calibration;
- stellar effective temperature and luminosity;
- appearance-specific provenance and limitations.

These records are associated with the same stable `ObjectId` as their physical OrbitEngine object but remain application/dataset metadata. They must not be inserted into `PhysicalPropertiesInput` merely because they describe a physical body.

The boundary is based on simulation responsibility rather than whether a fact is physically real. A surface composition may be physically real while still being irrelevant to orbit propagation. If a future OrbitEngine feature genuinely needs a physical subset — for example an atmospheric density model for aerodynamic drag — that subset receives a separate explicitly defined engine contract and must not consume rendering metadata implicitly.

### Appearance provenance is independent

Orbital/ephemeris provenance does not automatically establish appearance provenance.

The normalized dataset must track the source and limitations of appearance fields independently enough to avoid claims such as treating a JPL Horizons state-vector source as the authority for atmosphere chemistry or cloud optical depth.

A body may therefore have separate source records for:

- state vectors/ephemerides;
- mass/radius/orientation;
- surface or cloud composition;
- atmosphere composition and structure;
- albedo/reflectance;
- stellar temperature/luminosity.

### No authoritative stored planet RGB

A fixed RGB value is presentation metadata, not an astronomical physical truth. The browser demo may retain an accent/fallback color for markers, UI, orbit guides, or incomplete data, but resolved sphere appearance is derived through the document-19 optical/lighting pipeline when richer appearance data exists.

Composition alone must not be presented as an exact color prediction. The normalized appearance dataset may provide calibrated visible reflectance where available and otherwise use a documented, versioned optical approximation.

## Browser demo fixture and migration

The browser Solar-System reference application defined by [16 — Browser Solar-System Demo Architecture](16-browser-solar-system-demo.md) currently uses a committed offline educational fixture.

That fixture remains an integration/scenario artifact and is explicitly superseded for reference-quality motion by the OEP production path from document 20.

Migration requirements:

- preserve stable application `ObjectId` values and UI/appearance metadata where practical;
- load a versioned application-owned OEP manifest/shard set through public OrbitEngine APIs;
- use `referenceEphemeris` for known natural bodies while their source is authoritative;
- remove manually circularized/copy-authored reference anchors for migrated bodies;
- continue to derive all rendered positions and sampled orbit lines from normal engine state-at-time queries;
- require no external astronomy network request at runtime;
- expose or enforce per-body effective reference validity instead of presenting out-of-range results as source quality;
- retain appearance provenance separately from ephemeris provenance;
- include source-vector regressions and the 2026-08-12 eclipse geometry as a concrete Earth/Moon cross-body regression.

The demo never receives a JavaScript ephemeris solver and never parses OEP coefficients into its own authoritative state.

## Accuracy window and source validity

The intended simulation use case is approximately ±1000 years around a modern scenario epoch. The default major-body DE441 baseline covers that target comfortably.

That does **not** imply every planet-center, natural-satellite, asteroid, or comet source has the same validity. JPL planetary-satellite and small-body products retain their own actual source intervals and uncertainty.

Every `referenceEphemeris` binding has an effective validity equal to the intersection of its target series, source-center dependencies, required frame/provider coverage, and configured motion segment.

A query outside that interval fails explicitly. A scenario may deliberately install a separate adjacent `twoBodyAnalytical`, `numerical`, or other future source/model segment with its own accuracy contract, but OrbitEngine never silently extrapolates the final reference record or labels such fallback as JPL reference quality.

The underlying instant/identity representations have larger numerical ranges; that does not extend the scientific validity of imported data or models automatically.

## Reference quality and validation

Reference quality means reproducing the **selected pinned source trajectory** within the OEP normalization error budget. It does not mean the real body is known to that same numerical precision.

The production pipeline validates OEP states against the selected CSPICE/Horizons source oracle at deterministic epochs, including record boundaries and dates far from old single-anchor fixtures.

For directly normalized major-body/satellite Chebyshev data, document 20 sets a default normalization ceiling of:

```text
position error <= 1e-3 m
velocity error <= 1e-6 m/s
```

unless a source family explicitly adopts a stricter or reviewed looser policy.

Source trajectory uncertainty is recorded separately.

## Reference divergence

Imported data defines the baseline/reference history. `followingReference` is motion/provenance status, not `ObjectType`.

Once simulation changes an imported object's physical state, the object transitions atomically to diverged dynamic authority at that exact instant. Its `ObjectId`, physical `ObjectType`, and frame identities stay unchanged unless an explicit separate structural operation changes frame attachment. The original source ephemeris remains available only as historical/reference provenance and must never silently regain authority.

A later low-cost `twoBodyAnalytical` segment may be derived from the diverged handoff state if it meets the requested fidelity/error contract. It continues the simulated changed trajectory; it does not restore the original OEP/JPL future.
