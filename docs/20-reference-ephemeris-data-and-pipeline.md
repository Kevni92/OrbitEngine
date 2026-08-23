# 20 — Reference Ephemeris Data and Pipeline

## Status and scope

This document records the architecture decided by Architecture issue #113. It defines the production data-source strategy, offline acquisition/normalization pipeline, OrbitEngine Ephemeris Pack representation, runtime `referenceEphemeris` semantics, source-center/barycenter handling, validity/error behavior, packaging, versioning, and validation required for source-faithful Solar-System trajectories.

It builds on:

- [06 — Solar-System Data](06-solar-system-data.md);
- [12 — Simulation Time, Units, and Numerical Precision](12-simulation-time-units-and-precision.md);
- [13 — Physical Object and State Model](13-physical-object-and-state-model.md);
- [14 — Reference Frames and Coordinate System](14-reference-frames-and-coordinate-system.md);
- [15 — Propagation Contract and Model Switching](15-propagation-contract-and-model-switching.md);
- [16 — Browser Solar-System Demo Architecture](16-browser-solar-system-demo.md).

This document does not make OrbitEngine a Solar-System generator, does not put a live NASA/JPL dependency into normal runtime, does not replace `twoBodyAnalytical` or `numerical`, and does not make a reference source authoritative again after physical divergence.

## Trigger and correctness requirement

The educational browser fixture exposed the missing production data path. At the 2026-08-12 total solar eclipse, the current committed Earth/Moon fixtures propagated with `twoBodyAnalytical` place the Moon tens of degrees away from the real Earth/Sun alignment. That behavior is expected from the fixture's documented limitations, but it is not acceptable for the production baseline of known natural bodies.

The production requirement is therefore:

> While a known natural body is `followingReference`, its state must reproduce the selected pinned astronomical reference source within the normalized representation's declared error budget and source validity interval. It must not be produced by indefinite extrapolation from one historical Cartesian anchor unless the scenario explicitly selected an analytical approximation instead of reference authority.

A reference ephemeris is source-faithful, not omniscient. Source uncertainty and finite coverage remain explicit.

## Decisions at a glance

- **DE441 is the default long-horizon major-body baseline** for OrbitEngine's approximately ±1000-year Solar-System scenario target.
- DE440 may be offered later as a separate explicitly selected modern-era dataset profile. OrbitEngine does **not** automatically splice DE440 and DE441 by date.
- Planet centers and natural satellites outside the Earth/Moon case come from pinned JPL planetary-system/satellite ephemeris products where available; their shorter coverage is preserved rather than hidden.
- Pluto-system objects use the DE441 Pluto-system barycenter plus a pinned Pluto-system satellite ephemeris where body-center states are required.
- Curated asteroids/comets/minor bodies prefer an official published NAIF/PDS/JPL SPK when suitable; otherwise the offline importer may request a pinned Horizons-generated small-body SPK. Runtime never calls Horizons.
- **CSPICE is allowed only in acquisition/import/validation tooling. It is not a normal runtime dependency.**
- Runtime consumes a versioned **OrbitEngine Ephemeris Pack (OEP)** owned by the scenario/dataset layer.
- OEP v1 stores normalized piecewise Chebyshev state data plus a manifest and explicit source-center graph. Portable C++ evaluates it directly for both native and WASM.
- Source hierarchy is distinct from physical/display hierarchy. A JPL planetary-system barycenter can exist as an ephemeris source node/frame origin without becoming a gameplay celestial body.
- Each reference series has exact declared coverage. Effective object coverage is the intersection of the series and all source-center dependencies used to resolve it.
- Queries outside reference validity fail explicitly. A scenario may install a separate analytical/numerical segment outside that interval, but there is no silent fallback or extrapolation.
- The npm package contains evaluator/loading capability, not the complete Solar-System database. Dataset assets are independently versioned and selected by scenarios.
- Reference divergence remains one-way. Once a physical event changes a reference-following object, the future JPL trajectory loses authority permanently for that simulation lineage.
- Validation uses source-vector regression cases, import-roundtrip error budgets, native/WASM parity, and cross-body astronomical configurations including the 2026-08-12 eclipse.

## Authoritative source strategy

### Major planetary/lunar baseline: DE441

The standard long-horizon baseline is JPL DE441.

JPL documents DE441 as covering approximately year -13,200 through +17,191 and Horizons uses it for planetary barycenters, the Sun, Moon, Mercury, Venus, and Earth over its exposed long-term range. This comfortably contains OrbitEngine's intended approximately ±1000-year window around a modern era.

DE440 is more accurate for the current century but covers only roughly 1550–2650. A single DE440 baseline therefore cannot satisfy the long-horizon product goal.

OrbitEngine chooses coherence and full target coverage over automatically changing major-body solutions inside one scenario:

```text
normal long-horizon scenario -> pinned DE441-derived dataset
optional modern precision scenario -> separately pinned DE440-derived dataset
```

A scenario/save records the selected dataset identity. The runtime never chooses DE440 or DE441 implicitly from the requested date.

### No automatic DE440/DE441 splice

An automatic date-dependent splice is rejected because it would:

- make one scenario's reference authority depend on an undocumented internal date threshold;
- complicate reproducibility and save-game identity;
- require continuity/error policy at the splice;
- risk state/velocity discontinuity or a hidden source revision change;
- provide little gameplay value compared with selecting one coherent source profile.

If a future dataset deliberately combines source products, the combination is produced offline as a new versioned dataset with explicit segment boundaries, continuity validation, and provenance. It is never an implicit runtime policy.

### Planetary barycenters, planet centers, and natural satellites

DE441 supplies the long-horizon planetary-system barycenter motion. Planet centers and non-lunar natural satellites are obtained from the appropriate pinned JPL planetary-system/satellite ephemeris product where available.

These products commonly have coverage driven by their observational data arcs and may span only hundreds of years. The importer records the actual coverage for every source series.

For a planet system such as Jupiter:

```text
SSB
 └─ Jupiter-system barycenter       <- DE441
     ├─ Jupiter center              <- pinned Jupiter satellite/planet-center SPK
     ├─ Io                          <- pinned Jupiter satellite SPK
     ├─ Europa                      <- pinned Jupiter satellite SPK
     └─ ...
```

The source-center graph does not imply that moons physically orbit a barycenter as their gameplay hierarchy. `centralBody`, `ObjectType`, selection tree, and ephemeris source center remain independent concepts.

### Earth and Moon

Earth/Moon reference motion is taken from the selected DE441-derived source graph. The importer preserves the source relationships required to reconstruct Earth and Moon consistently with the same solution.

The production Moon must not use the current manually circularized `z = 0` educational anchor as reference authority.

### Pluto system

The DE441 Pluto-system barycenter supplies the long-horizon system translation. Pluto/Charon and any other included Pluto-system body centers use a pinned JPL/NAIF Pluto-system satellite ephemeris where available and only over that product's declared coverage.

### Dwarf planets and minor bodies

Physical classification does not choose a source.

For Ceres, Haumea, Makemake, Eris, asteroids, comets, and other curated minor bodies, source precedence is:

1. suitable official JPL/NAIF/PDS published SPK with documented provenance/coverage;
2. a pinned Horizons-generated small-body SPK created offline from a specific orbit solution;
3. if no reference-quality source product is selected, an explicitly different analytical/numerical scenario model rather than a fabricated reference ephemeris.

Horizons-generated small-body SPKs are version-sensitive because orbit solutions change when observations are updated. The importer therefore records the Horizons target/SPK ID, orbit-solution/source information exposed with the generated product, requested time span, retrieval timestamp, and a cryptographic hash of the exact returned SPK bytes.

Horizons currently restricts generated small-body SPKs to its supported small-body integration interval (documented as 1600–2500 at the time of this decision). That limitation is retained in dataset validity and cannot be stretched to the ±1000-year game target by labeling extrapolation as JPL reference data.

### Source precedence and replacement

For a given logical dataset version, every series has one explicit selected source. A newer JPL kernel or Horizons orbit solution creates a new dataset build/version; it does not mutate an existing pack in place.

The source manifest must make the exact selected product auditable.

## External source references

The architecture relies on the following authoritative source families and documentation:

- JPL DE440/DE441: <https://ssd.jpl.nasa.gov/doc/de440_de441.html>
- JPL planetary/lunar ephemeris exports: <https://ssd.jpl.nasa.gov/planets/eph_export.html>
- JPL Horizons manual: <https://ssd.jpl.nasa.gov/horizons/manual.html>
- JPL Horizons API: <https://ssd-api.jpl.nasa.gov/doc/horizons.html>
- JPL planetary satellites ephemerides: <https://ssd.jpl.nasa.gov/sats/orbits.html>
- NAIF SPK required reading: <https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/req/spk.html>
- NAIF SPICE rules/distribution: <https://naif.jpl.nasa.gov/naif/rules.html>

NAIF documents SPK Type 2 as Chebyshev position coefficients with velocity obtained by differentiation and Type 3 as separate Chebyshev position and velocity coefficients; these are representative of the compact source representation this architecture normalizes for runtime use.

## Acquisition and import architecture

### Runtime is offline from astronomy services

Normal engine/game/demo execution must not contact:

- Horizons;
- SSD APIs;
- NAIF servers;
- PDS;
- any mutable external astronomy database.

A browser may of course load its own packaged static OEP asset from the application origin. That is application asset loading, not a live astronomical-data dependency.

### Reproducible pipeline

The selected pipeline is:

```text
pinned JPL/NAIF/Horizons products
            |
            | download / generate offline
            | record URL, product ID, version, hash
            v
      source cache (immutable input)
            |
            | CSPICE-assisted inspection/evaluation
            v
     OrbitEngine importer
            |
            | time/frame/unit normalization
            | source-center graph normalization
            | coefficient extraction/refit where required
            | deterministic validation
            v
   OEP manifest + binary shards
            |
            | committed/released as scenario data
            v
 TypeScript loads bytes -> portable core
            |
            v
 referenceEphemeris state-at-time
```

### CSPICE boundary

CSPICE/SPICE Toolkit usage is permitted in developer/build tooling for:

- opening and inspecting SPK kernels;
- reading target/center/frame descriptors and coverage;
- evaluating source states as an oracle during conversion/validation;
- extracting source records where the supported source type allows exact/direct normalization;
- reading kernel comments/provenance where useful.

CSPICE is not linked into the portable runtime core, Node addon, or WASM module for normal reference evaluation.

This keeps the production hot path portable and avoids making browser consumers understand kernel pools, DAF files, SPICE global state, or toolkit distribution.

### Pinned acquisition inputs

Every source input is described by a machine-readable acquisition record containing at least:

```text
sourceKind                  # de441, planetary-satellite-spk, horizons-small-body-spk, ...
sourceProductId
sourceTargetIds
sourceUrlOrRequestTemplate
retrievalTimestamp
sourceDeclaredVersion
requestedCoverage           # where generated/requested
sha256
redistributionClass/notes
```

For Horizons-generated data the normalized request parameters are part of the acquisition record.

A build refuses a checksum mismatch unless an operator explicitly updates the acquisition record and therefore creates a new dataset version/reviewable diff.

### Direct normalization versus refitting

OEP runtime supports Chebyshev series independent of the source SPK's internal type.

Importer behavior is:

1. **Directly normalizable Chebyshev source records** — preserve the source interval structure and polynomial semantics where possible, while converting units/frame axes and encoding them in OEP.
2. **Other SPK representations** — use CSPICE as the source oracle and deterministically fit OEP Chebyshev state segments, splitting intervals until the configured representation error budget is met.

The direct path is preferred because it avoids unnecessary approximation layers.

The non-Chebyshev fitting algorithm/degree/interval trade-off must be validated by a focused Spike before production small-body conversion is considered complete. The architecture is fixed: its output is still OEP Chebyshev data and must meet an explicit error budget; the Spike only determines efficient fitting parameters/strategy.

## OrbitEngine Ephemeris Pack (OEP) v1

### Ownership

OEP is a versioned **dataset format**, not an embedded catalog inside the `orbit-engine` npm package.

The `orbit-engine` package owns:

- the OEP schema/version contract;
- byte validation/decoding;
- portable C++ Chebyshev evaluation;
- source-center dependency evaluation;
- `referenceEphemeris` integration;
- native/WASM parity.

A scenario/application owns:

- which OEP manifests/shards are distributed;
- stable mapping from its `ObjectId` values to pack source series;
- source selection/version;
- loading the required bytes before registration/query.

### Manifest and binary shards

OEP v1 consists conceptually of:

```text
<dataset>.oep.json          # UTF-8 manifest/provenance/index
<dataset>-<shard>.oepb      # binary coefficient/index data, one or more
```

The manifest is intentionally inspectable and version-control/release friendly. High-volume coefficients remain binary.

### Dataset identity

The manifest includes at least:

```text
schemaVersion: 1
datasetId
datasetVersion
createdAt
importerVersion / importerCommit
canonicalTimeScale: TDB
canonicalEpoch: J2000 TDB
canonicalSpatialFrame: SSB + ICRS/ICRF-aligned
sourceRecords[]
shards[]
sourceNodes[]
objectBindings[]
normalizationPolicyVersion
```

`datasetId + datasetVersion + manifest hash` identifies the reference baseline for scenario/save provenance.

A saved scenario that depends on reference trajectories records this identity. Loading with a different dataset is an explicit migration/substitution operation, not a transparent update.

### Binary encoding

OEP binary shards use a deterministic portable encoding:

- fixed magic/version header;
- little-endian integer and IEEE-754 binary64 fields;
- explicit byte lengths/offsets with bounds checking;
- no native pointers, `size_t`, compiler structs, or platform padding on disk;
- coefficient arrays aligned sufficiently for efficient f64 decoding/evaluation after load;
- checksums recorded in the manifest;
- invalid/reserved enum codes rejected.

WASM/native decode the same bytes and semantics.

### Source node identity

OEP uses a dataset-local `EphemerisSourceNodeId` namespace distinct from both `ObjectId` and `ReferenceFrameId`.

A source node represents an ephemeris target/center needed to reconstruct source geometry, for example:

- SSB;
- Earth-Moon barycenter;
- Jupiter-system barycenter;
- Jupiter center;
- a natural satellite.

Human-readable names and NAIF/Horizons IDs are metadata/provenance, not runtime identity.

### Source-center graph

Each source series declares:

```text
targetSourceNode
centerSourceNode | SSB
sourceFrameConvention
normalizedAxes
validity
representation
records
sourceRevision
normalizationErrorBudget
```

The source-center graph must be acyclic and must resolve to SSB for every series used to provide root translation.

The physical object hierarchy is not derived from this graph.

### Source-center frame providers

To preserve local numerical behavior and source semantics, an OEP may expose source-center origins as normalized non-rotating frame providers.

A pack-backed source-center frame:

- is aligned to the canonical ICRS/ICRF axes unless the normalized series explicitly declares another supported fixed orientation;
- obtains origin translation/velocity by evaluating the OEP source graph at the exact target instant;
- is a normal document-14 frame dependency/provider, not a physical object;
- receives a deterministic scenario/import-supplied `ReferenceFrameId` when exposed to object motion;
- does not become a selectable body or `ObjectType`.

This allows Jupiter and its moons, for example, to share a Jupiter-system-barycenter propagation frame while the public physical hierarchy still records Jupiter as the moons' central body.

Where the selected source directly provides an object relative to its physical center, a normal object-centered frame may be used instead. The importer must not translate a series into a different center merely to make hierarchy labels convenient unless that transformation is explicitly normalized and validated.

### Object binding

A scenario binding associates:

```text
ObjectId
  -> OEP dataset identity
  -> EphemerisSourceNodeId / series
  -> propagation ReferenceFrameId
  -> exact effective validity
  -> source/model revision
```

`ObjectId` is never inferred from a NAIF number or display name.

### Chebyshev record forms

OEP v1 supports two normalized record forms:

1. `positionChebyshev`
   - X/Y/Z position coefficients in metres;
   - velocity is the analytical derivative with respect to TDB seconds.
2. `stateChebyshev`
   - X/Y/Z position coefficients in metres;
   - VX/VY/VZ velocity coefficients in metres/second.

Each logical record includes exact normalized coverage boundaries plus the binary64 midpoint/radius needed for mapping the requested TDB time into the Chebyshev domain.

The importer chooses the form that reproduces the selected source representation within its declared budget. Runtime consumers do not choose based on `ObjectType`.

### Time boundaries

Public/model validity uses exact normalized `SimulationInstant` pairs.

Source SPK descriptor/record epochs are binary64 ephemeris seconds. During import, source boundaries are normalized conservatively to nanosecond `SimulationInstant` values so OEP never claims a target instant beyond the source record actually covering it. Exact comparison happens before polynomial evaluation.

Within a selected record, the exact target instant is converted to a bounded binary64 offset from the record midpoint. The runtime never converts two giant absolute timestamps to `double` and subtracts them.

### Frame normalization

OEP translational state is geometric.

Importer rules:

- source distances/velocities are converted to SI;
- source frame identifiers and documentation are recorded;
- `J2000`, ICRF, ECLIPJ2000, body-equator, or other labels are not assumed equivalent merely by name;
- fixed rotations needed to reach the declared normalized axes are applied exactly once during import;
- apparent/light-time/aberration-corrected observer states are not valid OEP canonical translational input;
- reference evaluation never adds presentation/camera corrections.

The canonical root remains SSB-centered and ICRS/ICRF-aligned.

## Runtime `referenceEphemeris` semantics

### Pure bounded source

An OEP-backed `referenceEphemeris` is a pure bounded model source under document 15.

For a target instant `T`:

1. validate `T` against the object's effective OEP validity;
2. resolve the required source-center frame/provider at exactly `T`;
3. locate the applicable Chebyshev record for the object's series;
4. evaluate canonical position/velocity in the declared propagation frame;
5. return a finite `CartesianState` whose epoch is exactly `T`;
6. perform any requested document-14 output-frame transformation afterward.

No engine clock mutation or fixed global stepping occurs.

### Effective validity

The effective validity of a pack-backed object is the intersection of:

- its target series coverage;
- every source-center series needed to define its propagation-frame origin;
- any required fixed-frame/orientation validity relevant to the translational source;
- the scenario-declared segment interval.

Registration/binding computes and exposes that bounded interval.

### Out-of-range behavior

A `referenceEphemeris` query outside effective validity returns the existing explicit source/model-out-of-range propagation error category.

It must not:

- clamp to the nearest record;
- extrapolate the final Chebyshev polynomial;
- silently instantiate `twoBodyAnalytical`;
- fetch newer data;
- switch to another dataset version.

If broader scenario coverage is desired, the scenario must define an explicit adjacent motion segment and model/source. Such a segment has its own accuracy/provenance semantics and passes normal document-15 continuity/switch validation.

### Reference quality versus source uncertainty

`referenceEphemeris` means that OrbitEngine reproduces the selected source trajectory within the pack's normalization error budget. It does **not** mean the real body's future is known to that same numerical precision.

The manifest distinguishes:

- representation/normalization error against the source;
- source uncertainty/limitations where known;
- validity/observational coverage notes.

A millimetre-level reconstruction of an uncertain asteroid orbit is still an uncertain asteroid orbit.

### Divergence

The existing one-way rule is unchanged:

```text
followingReference / OEP authority
            |
            | state-changing event at exact T
            v
post-event canonical Cartesian handoff
            |
            v
diverged dynamic segment
```

After commit at `T`, OEP data may remain queryable as historical/reference provenance but cannot become authoritative future motion again for that object lineage.

A later fidelity demotion may create `twoBodyAnalytical` from the diverged state if it passes the requested error budget. That analytical orbit follows the changed simulated state, not JPL's original future.

## Runtime performance and caching

### Query complexity

For one series, record lookup is bounded binary search or a representation-specific direct index when fixed intervals permit it. Chebyshev evaluation is O(polynomial degree).

Source-center chains are expected to be shallow. Pack load validation rejects cycles and may enforce a conservative maximum dependency depth.

### Same-epoch reuse

Batch queries at one exact instant should evaluate each required source-center node at most once per pack/source revision within the query context.

This is especially important for moon systems where many bodies share one planetary-system barycenter.

### Hot-record cache

The portable evaluator may retain a bounded last-record/small LRU cache keyed by:

- pack revision;
- source series;
- target record interval.

Cache contents are derived and may be discarded at any time. They do not alter source authority.

### Data ownership

Loaded OEP bytes/decoded indices are immutable for a registered pack revision.

A pack replacement is a new source revision/dataset identity and requires explicit scenario/model rebinding; bytes are not mutated under live readers.

### Native and WASM

Both backends execute the same portable C++ evaluator.

- Native may later memory-map shard bytes as an optimization if profiling justifies it.
- WASM may copy/load shard bytes into linear memory.
- These storage differences must not change state/query semantics.
- No runtime CSPICE implementation exists in only one backend.

### Sharding

One giant all-history/all-small-body file is rejected.

OEP supports independent shards by source family/system and, where data volume justifies it, time span. Example conceptual distribution:

```text
de441-major.oepb
mars-system.oepb
jupiter-system.oepb
saturn-system.oepb
uranus-system.oepb
neptune-system.oepb
pluto-system.oepb
minor-bodies-2020s.oepb
```

The manifest identifies dependencies among shards. A scenario loads all shards required by the objects it registers before those reference models become queryable.

The first implementation does not require transparent asynchronous shard faults during a physics query. Missing required data is an explicit load/registration failure, not an implicit network request.

## Browser and npm packaging

### Engine package

The published `orbit-engine` package contains OEP API/evaluator support but not the full production Solar-System dataset.

This prevents every consumer from paying the storage/download cost for scenarios they do not use and avoids coupling engine release cadence to astronomical dataset updates.

### Scenario assets

The browser demo may ship a curated OEP manifest and required shards as static application assets.

Its startup flow is conceptually:

```text
load application-owned OEP manifest/shards
             |
             v
pass validated bytes through public OrbitEngine API
             |
             v
register pack-backed frames/objects/reference models
             |
             v
normal engine stateAt/statesAt/relativeStateAt
```

The demo must not parse/evaluate Chebyshev coefficients in JavaScript and must not call raw WASM bindings.

Same-origin static asset loading is permitted; external astronomy network access is not.

## Dataset versioning, provenance, and redistribution

### Manifest provenance

Every released dataset records at least:

- OEP schema version;
- dataset ID/version;
- source product/file names;
- source target/center identifiers;
- source product/kernel version when available;
- source URL or Horizons request definition;
- retrieval timestamp;
- SHA-256 of every acquired source input;
- importer version/commit;
- normalization policy version;
- source and normalized time scales;
- source and normalized spatial frames;
- exact per-series source/effective coverage;
- direct-extraction versus refit method;
- representation validation error budget/result;
- known source uncertainty/limitations;
- redistribution/license/attribution notes.

### Redistribution rule

NAIF states that kernels distributed by NAIF may be redistributed unmodified under its published rules. OEP is a derived normalized product rather than an unmodified SPICE kernel, so each released dataset must retain attribution and source provenance and must have its distribution status reviewed from the selected source's rules before publication.

The importer may always build a local OEP from lawfully acquired/pinned inputs. Whether a derived OEP binary may be redistributed with a public npm/demo release is a dataset-release concern and must be recorded explicitly in the manifest/release process.

The SPICE Toolkit itself is not vendored into normal runtime. If importer tooling redistributes CSPICE components, it must follow NAIF's Toolkit redistribution rules separately.

## Validation architecture

Validation is not optional metadata; it is what establishes that an OEP build is source-faithful.

### Import structural validation

Generation fails on:

- duplicate dataset/source node IDs;
- missing center nodes;
- source-center cycles;
- non-finite coefficients;
- invalid/empty coverage;
- overlapping records with ambiguous precedence inside one series;
- uncovered gaps inside a series that claims continuous coverage;
- unsupported frame/time declarations;
- checksum mismatch;
- unresolved object binding;
- invalid binary offsets/lengths.

### Source-vector regression

For every production series family, the importer/test suite stores deterministic validation epochs that include where applicable:

- a source epoch/J2000-near point;
- a modern scenario-era point;
- points decades away from the fixture's old anchor;
- early and late points inside source validity;
- record-boundary-adjacent points;
- deterministic pseudo-random interior points seeded by dataset version.

At each epoch, OEP output is compared with CSPICE/Horizons source-oracle state in the same geometric frame.

### Representation error budget

The normalization target is representation error against the selected source, not astronomical source uncertainty.

For directly normalized major-body/satellite Chebyshev products, the default generation ceiling is:

```text
position absolute error <= 1e-3 m
velocity absolute error <= 1e-6 m/s
```

A source family may define a stricter budget. A looser budget requires an explicit per-series policy/provenance entry and review; the importer may not silently relax it until generation passes.

For fitted non-Chebyshev source representations, the fitting Spike/implementation must establish a practical degree/interval strategy that meets the same configured budget or an explicitly reviewed family-specific budget.

Source uncertainty is reported separately and may be many orders of magnitude larger.

### Native/WASM parity

The same OEP bytes and exact `SimulationInstant` must produce:

- exactly equal discrete pack/source/record selection semantics;
- exactly equal result epoch/frame IDs;
- floating state agreement within the reference evaluator's documented parity tolerance, which must be no looser than the pack representation budget.

The evaluator uses only deterministic polynomial arithmetic; unsafe fast-math remains prohibited by document 12.

### 2026 eclipse regression

The 2026-08-12 total solar eclipse is a required cross-body regression for the first Earth/Moon production pack.

The test must:

1. use a committed exact TDB `SimulationInstant` derived offline from the selected UTC event instant/conversion data;
2. query Sun, Earth, and Moon through normal public OrbitEngine reference state paths;
3. compare all three states to committed source-oracle states from the selected JPL dataset;
4. derive Earth-centered Sun/Moon directional geometry from those returned states;
5. compare the derived angular/separation geometry with the source-oracle geometry using an explicit tolerance.

The event test must not assert that the geocentric angle is mathematically zero; a surface-visible eclipse includes observer parallax. The authoritative source state is the oracle. The current roughly 66.9-degree educational-fixture result must fail decisively.

### Additional event-level cases

The dataset implementation should add a small set of high-value source-derived configurations, for example:

- another solar or lunar eclipse;
- a planetary conjunction/opposition;
- representative Galilean-moon geometry;
- a curated minor-body close approach within a well-understood source validity/uncertainty interval.

These supplement vector regression and are not substitutes for it.

## Browser demo migration

The current educational fixture remains permitted only until the OEP evaluator/imported pack implementation is available.

The migration is:

1. produce a versioned reference dataset containing at least Sun, eight planets, and Moon;
2. load it through the public OEP API in the WASM-backed demo;
3. bind known bodies to `referenceEphemeris` instead of `twoBodyAnalytical` wherever the selected reference source is authoritative;
4. retain the same stable application `ObjectId` values and appearance/UI metadata where possible;
5. remove manually circularized/copy-authored reference anchors for migrated bodies;
6. derive orbit visualization by sampling normal engine state queries exactly as today;
7. display/diagnose per-body reference validity rather than allowing the UI to present out-of-range results as source quality;
8. add the eclipse regression to non-visual numerical coverage and an optional browser-level sanity check.

The demo's scenario loader remains the dataset consumer; Three.js still knows nothing about ephemeris coefficients.

For curated moons/minor bodies whose authoritative source coverage is narrower than the demo's current broad time controls, the demo either constrains reference-quality time selection to the effective loaded coverage or explicitly configures a different non-reference segment. It must not hide fallback behavior.

## Rejected alternatives

### Runtime CSPICE/kernel pool

Rejected as the normal runtime architecture.

Reasons:

- unnecessary native/WASM dependency and package size;
- SPICE global/kernel-pool semantics are a poor fit for immutable engine source handles;
- more complex browser asset/lifecycle integration;
- greater risk of backend-specific behavior;
- canonical normalization would still be required;
- document 06 already requires runtime independence from mutable external kernels.

CSPICE remains the authoritative import/validation tool where useful.

### Dense sampled state tables with generic interpolation

Rejected as the canonical production representation.

They are easy to prototype but require choosing a sampling cadence that trades storage against error, duplicate source dynamics unnecessarily, and usually store far more points than a Chebyshev representation for the same smooth trajectory/error target.

### One anchor plus `twoBodyAnalytical` for known reference bodies

Rejected as production reference authority because it loses real perturbations and phase relationships over time. It remains a valid analytical model for ideal cases, explicit approximations, and diverged/dynamic objects where its error domain is accepted.

### Automatic DE440/DE441 date splice

Rejected for reproducibility/continuity reasons described above. Separate dataset profiles are allowed.

### Flatten every imported series permanently to SSB

Rejected as the only representation because it discards useful source-center locality, duplicates shared barycenter motion, and can force local consumers through avoidable large-coordinate subtraction. OEP preserves the source-center graph and integrates it with document-14 frame providers.

### One monolithic Solar-System pack in npm

Rejected because engine capability and scenario data have different release/size/ownership lifecycles.

### Live Horizons queries

Rejected because source revisions would change runtime results, network availability would become simulation state, browser/server behavior would diverge, and saved simulations would not be reproducible.

## Invariants imposed on implementation

1. `referenceEphemeris` remains one of document 15's model kinds; OEP is a source implementation, not a new `ObjectType` or fidelity level.
2. A source series is never selected from `ObjectType` implicitly.
3. Every pack/object/source dependency has deterministic revision identity and bounded validity.
4. A pack-backed source returns geometric state only.
5. Runtime never contacts JPL/NAIF/Horizons.
6. Runtime never requires CSPICE for OEP evaluation.
7. Source-center and physical central-body hierarchies remain separate.
8. Missing/out-of-range source data fails explicitly.
9. Reference divergence is permanent for the affected future.
10. OEP data remains immutable after registration.
11. Native and WASM execute the same portable evaluator semantics.
12. Dataset bytes are scenario assets, not hidden engine defaults.
13. Source provenance and representation error remain auditable from the dataset version.
14. No OEP import/evaluation path may silently claim accuracy beyond source coverage/uncertainty.

## Follow-up implementation decomposition

Architecture #113 intentionally separates the following work:

1. implement OEP v1 manifest/binary decoding, portable Chebyshev evaluator, pack source/frame providers, TypeScript byte-loading API, native/WASM parity, and corruption/validity tests;
2. implement reproducible JPL/NAIF acquisition and the direct Chebyshev SPK normalization path for DE441 and planetary-system kernels;
3. perform a focused Spike for efficient deterministic conversion of non-Chebyshev SPK/small-body source representations into validated OEP Chebyshev segments;
4. build and version a curated Solar-System production pack with source hashes/provenance/coverage;
5. migrate the browser demo to the production reference source and add source-vector/event regressions including the 2026 eclipse.

The corresponding GitHub issues are created as part of Architecture #113 and are the implementation authority for those stages.

## Acceptance contract

A conforming production reference-data implementation satisfies all of the following:

1. a scenario can identify and load a pinned OEP dataset without a live astronomy service;
2. known bodies use `referenceEphemeris` while their selected source is authoritative;
3. DE441 provides the normal major-body long-horizon baseline for the approximately ±1000-year target;
4. planet centers/satellites/minor bodies preserve their own actual source coverage;
5. source-center and physical hierarchies are not conflated;
6. OEP is evaluated by portable C++ with native/WASM parity;
7. queries outside source validity fail instead of extrapolating silently;
8. representation error is validated against pinned source-oracle states;
9. source uncertainty is not confused with representation error;
10. state-changing gameplay events permanently replace reference future authority from the divergence instant;
11. the browser demo can consume the same public reference source path without JavaScript ephemeris math;
12. the 2026-08-12 eclipse case is reproduced from source-faithful states and decisively rejects the old educational Moon trajectory.
