# 29 — Natural-Body Orientation, Rotation, and Body-Fixed Sources

## Status and scope

This document records the production architecture decided by Architecture issue #122. It defines the source strategy, offline normalization pipeline, runtime representation, dataset packaging, public registration, validity/invalidation and backend semantics for time-dependent natural-body orientation.

It completes the production data boundary intentionally left open by document 14. The frame graph, rigid-state transform mathematics, quaternion convention and body-fixed/surface attachment behavior from document 14 remain authoritative.

It also supplies the production pole/orientation dependency required by document 28's J2 physical source and future pole-dependent force models.

This architecture does not redesign reference frames, does not add terrain/topography, does not define rendering texture rotation, does not make spacecraft attitude control part of natural-body orientation, and does not require SPICE/IERS software or network access at runtime.

## Decisions at a glance

- Natural-body translation and natural-body orientation are separate reference products with independent source/version/validity/provenance.
- Add a separately versioned **OrbitEngine Orientation/Rotation Pack (ORP)** dataset format rather than overloading OEP's translational ephemeris schema.
- A scenario astronomical-baseline manifest pins an exact compatible pair/set of OEP and ORP dataset identities/hashes. Saves therefore reproduce both translational and rotational reference baselines.
- Source precedence is body-family-specific rather than one global formula:
  - Earth: pinned high-precision IERS/NAIF Earth-orientation solution where the scenario coverage supports it;
  - Moon: pinned JPL/NAIF high-accuracy lunar orientation with the associated lunar frame definitions, preferably matched to the selected DE solution family;
  - Sun, planets and major satellites: pinned IAU WGCCRE rotational-element recommendations, commonly acquired/validated through NAIF text PCK/FK products;
  - body/mission-specific higher-accuracy orientation products may be selected explicitly by a dataset profile but never silently override a pinned baseline.
- Runtime does not interpret text PCK, binary PCK, FK, IERS EOP or live IAU data. Import tooling normalizes them offline.
- ORP v1 uses **piecewise Chebyshev quaternion-component series** with deterministic sign continuity, normalization and derivative semantics. This common representation supports both analytical source models and high-precision sampled/oracle products.
- Every ORP segment directly represents the document-14 child-to-parent active quaternion for the declared body-fixed frame relative to a declared non-rotating parent orientation frame.
- Angular velocity is derived analytically from the derivative of the normalized quaternion series, not independently interpolated with a potentially inconsistent model.
- Import fitting is split until explicit angular-orientation and angular-velocity error budgets are met against the source oracle.
- ORP stores exact TDB-domain segment boundaries even when the source standard uses TT, UTC, UT1 or another scale. Source time-scale metadata and every conversion dependency remain in provenance.
- Earth source conversion explicitly captures the chosen terrestrial realization and Earth-orientation parameter/model baseline; ORP runtime does not re-evaluate UT1/leap-second logic.
- Pole, precession, nutation, libration, retrograde rotation and non-uniform spin are preserved whenever present in the selected source. There is no global constant-spin simplification.
- Queries outside exact source validity fail. A lower-quality constant-spin approximation is allowed only as a separately configured explicit approximation source/segment with distinct provenance/quality, never as silent fallback.
- Production body-fixed frames bind a typed ORP orientation source through public APIs; arbitrary JavaScript callbacks are not the production natural-body path.
- Surface-fixed objects remain attached motion in body-fixed/local frames. Correct inertial/root velocity emerges through document 14's `omega x r` term; no independent orbital propagator is created for a fixed surface object.
- ORP source/revision identity participates in frame-transform caches, transformed-state caches, J2/force dependencies and derived prediction invalidation.
- Same-epoch orientation evaluation is cached by source/revision/instant so thousands of surface-attached objects sharing one body do not re-evaluate the orientation series independently.
- Portable C++ owns ORP decoding/evaluation and quaternion/angular-velocity calculation. Native/WASM adapters only marshal normalized data.

## Source strategy by body family

### General principle

A dataset profile chooses one explicit source lineage for each logical orientation frame. “Latest available” is not a runtime policy.

A newer IAU report, IERS product, JPL DE solution, NAIF PCK or mission kernel produces a **new ORP build/version**. Existing ORP bytes and saves remain immutable/reproducible.

Translation source precedence from document 20 does not automatically decide rotation source precedence.

### Earth

Earth is special because source-faithful body orientation requires polar motion, Earth rotation and celestial-pole/precession-nutation information rather than one constant sidereal period.

The high-precision production Earth path uses a pinned Earth-orientation solution based on the IERS terrestrial/celestial transformation standards and EOP data, or an equivalent pinned NAIF high-precision binary-PCK realization derived from those authoritative Earth-orientation inputs.

The selected ORP build records at least:

- IERS EOP product family/version/coverage where used;
- precession-nutation convention/model baseline;
- terrestrial frame realization represented by the source, for example the exact ITRF/ITRF93-style frame named by the selected source;
- leap-second/time-conversion inputs needed during import;
- NAIF binary-PCK/FK product IDs/hashes when NAIF is the acquisition/oracle route;
- angular accuracy/error budget achieved by normalization.

Earth orientation is finite-coverage reference data. Long-term low-accuracy prediction products may be included only as separately identified lower-quality ORP segments/profile coverage.

The engine never extends a last EOP sample indefinitely while still calling it high-precision Earth orientation.

### Moon

The high-accuracy Moon path uses a pinned JPL/NAIF lunar orientation solution represented by a lunar binary PCK plus its associated frame kernel/definitions.

The dataset records the exact lunar frame semantics, for example principal-axes (PA) or a selected Mean-Earth/Polar-Axis (ME) realization. Those names are source/frame semantics, not aliases for a generic `MoonFixed` frame.

Where practical, the lunar orientation source is selected from the same JPL DE solution family as the scenario's translational baseline. If a specific high-accuracy orientation product belongs to a different DE family, that mismatch is explicit in the ORP/OEP compatibility manifest and its limitations; it is never hidden by merely naming both products “JPL”.

Lunar physical libration/non-uniform orientation supplied by the source is retained by the fitted quaternion series. The runtime does not reduce the Moon to synchronous constant spin.

### Sun, planets, and major satellites

For bodies without a deliberately selected higher-accuracy special product, the baseline source is the pinned IAU Working Group on Cartographic Coordinates and Rotational Elements (WGCCRE) recommendation represented directly or through a pinned NAIF generic text PCK/frame definition.

The importer preserves all source-supported terms needed to reproduce the chosen orientation, including where applicable:

- pole right ascension/declination evolution;
- prime-meridian angle;
- secular terms;
- periodic nutation/libration terms;
- retrograde rotation conventions;
- body-specific recommended frame definitions.

As of this architecture decision, NAIF generic text PCK products remain a practical distribution/oracle route for IAU WGCCRE rotational elements, while the IAU WGCCRE remains the standards authority for those recommendations.

A single “rotation period” field is therefore not the canonical natural-body orientation model.

### Mission/body-specific orientation products

Some bodies may have mission-specific or specialized binary PCK/FK/orientation products with materially better accuracy than the generic WGCCRE baseline.

A scenario/dataset profile may select such a source explicitly when its provenance, frame semantics and coverage are understood. It creates a distinct ORP source lineage/version.

It never silently overrides the baseline because a file happens to be newer or was loaded later.

### Unsupported/minor bodies

If no trusted orientation source is selected, production reference orientation is absent.

A scenario may explicitly install an approximation source such as constant-axis/constant-spin orientation. That source must declare:

```text
quality = approximation
sourceKind = constantSpinApproximation
exact validity interval
explicit pole/phase/spin inputs
provenance/limitations
```

It is not tagged as IAU/JPL/IERS reference orientation and is never activated automatically after a reference source expires.

## External source families

The architecture relies on pinned, auditable source families such as:

- IAU WGCCRE rotational-element reports and current working-group recommendations;
- NAIF Planetary Constants Kernel (PCK) and frame-kernel documentation/products;
- NAIF generic high-precision Earth and Moon binary PCK products where selected;
- IERS Earth Orientation Parameters and terrestrial/celestial reference-system conventions;
- JPL DE-associated lunar orientation/frame solutions where available.

Useful canonical references include:

- IAU WGCCRE: https://www.iau.org/WG100/WG100/Home.aspx
- 2015 WGCCRE report: https://doi.org/10.1007/s10569-017-9805-5
- NAIF PCK required reading: https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/req/pck.html
- NAIF generic kernels: https://naif.jpl.nasa.gov/naif/data_generic.html
- IERS Earth orientation/data products: https://www.iers.org/

Concrete dataset builds pin exact downloaded products/checksums rather than treating these index pages as mutable runtime dependencies.

## OrbitEngine Orientation/Rotation Pack (ORP)

### Why a separate pack

OEP and ORP share dataset principles but have different semantics and update cadence.

Translation may remain pinned to one DE441-derived OEP for a long-horizon scenario while Earth orientation receives a different finite-coverage IERS/NAIF baseline, or lunar orientation uses a specific DE-associated orientation solution.

Keeping ORP separate allows those products to be versioned, rebuilt and loaded independently without pretending quaternion orientation coefficients are ephemeris-state coefficients.

The scenario still binds them reproducibly through one baseline manifest.

### File shape

ORP v1 consists conceptually of:

```text
<dataset>.orp.json
<dataset>-<shard>.orpb
```

The JSON manifest contains source/provenance/index/compatibility metadata. Binary shards contain normalized coefficient/index data.

The exact binary field layout is an implementation concern but must be versioned, endian-defined and bounds-checkable before evaluation.

### Dataset identity

An ORP has immutable identity including at least:

```text
formatVersion
logicalDatasetId
buildVersion
manifestSha256
shardSha256[]
source acquisition records
normalization-tool version/config
```

Loaded bytes are immutable. Replacing any source or coefficients creates a new ORP identity.

### OEP compatibility

A scenario astronomical baseline records:

```text
AstronomicalReferenceBaseline
  ephemerisPacks[]  // exact OEP IDs/hashes
  orientationPacks[] // exact ORP IDs/hashes
  compatibilityProfileId/revision
  declared known cross-product limitations
```

The compatibility profile can assert relationships such as a lunar orientation solution being associated with a particular DE family.

The engine does not require every OEP and ORP to share a version number. Compatibility is explicit data, not a naming convention.

## Normalized ORP source model

### OrientationSourceId

Each loaded logical orientation series receives stable dataset-scoped source identity translated to an engine-safe orientation-source handle/ID during registration.

Public identity is not a raw SPICE frame code, kernel-pool pointer or file offset.

An orientation source record contains conceptually:

```text
OrientationSource
  sourceId
  revision
  bodyId / external body key mapping
  bodyFixedFrameSemanticId
  parentFrameSemanticId
  exact validity interval
  quality class
  source provenance
  ordered coefficient segments
```

The source may contain multiple contiguous segments with different coefficient ranges while retaining one logical source identity.

### Runtime output contract

At exact `SimulationInstant T` the source returns:

```text
OrientationSample
  epoch = T
  rotationChildToParent: UnitQuaternion
  angularVelocityParent: Vec3 radians/second
  sourceId/revision
  quality/provenance identity
```

This exactly matches the orientation portion required by document 14.

The body-center translation/origin velocity is supplied by the ordinary body-centered frame provider/state source, not duplicated in ORP.

## Piecewise Chebyshev quaternion representation

### Source-oracle normalization

The importer evaluates the chosen authoritative/source product as an orientation oracle and produces piecewise polynomial segments.

At each source sample it obtains the exact intended child-body-fixed -> declared parent orientation and canonicalizes quaternion sign **for continuity inside the candidate fit interval**.

The importer never interprets `q` and `-q` as physically different orientations.

### Stored component series

For one segment the binary representation stores four Chebyshev component series for an unnormalized quaternion-like vector:

```text
u(T) = [uw(T), ux(T), uy(T), uz(T)]
```

Runtime evaluates the series and derivative, then normalizes:

```text
q(T) = u(T) / ||u(T)||
```

A fit whose norm approaches the configured safety floor anywhere in its validation grid is rejected/split.

The segment is constructed so source quaternion signs remain continuous relative to the fitted curve. The importer splits intervals as needed; it does not permit an arbitrary sign discontinuity to be approximated through zero.

### Why this representation

The normalized quaternion-series representation gives one backend-neutral runtime model for:

- IAU polynomial/periodic orientation laws;
- high-precision Earth binary-PCK orientation;
- JPL/NAIF lunar libration/orientation;
- mission-specific frame/orientation sources.

The runtime therefore does not contain a separate IAU-angle evaluator, IERS matrix chain and SPICE binary-PCK interpreter with potentially divergent conventions.

Source-specific complexity is confined to offline acquisition/normalization and oracle validation.

### Segment fitting and error budget

An ORP build declares explicit maximum:

```text
maxAngularErrorRadians
maxAngularVelocityErrorRadiansPerSecond
```

The importer deterministically fits a configured Chebyshev degree/interval, validates it against denser oracle samples, and recursively splits the interval until both error budgets are met or a deterministic minimum interval/budget limit is reached.

Failure to meet the budget fails the dataset build; it never silently emits a lower-quality segment under the same quality label.

Segment boundaries are exact `SimulationInstant` values on the nanosecond grid.

## Angular velocity derivation

### Consistency requirement

Angular velocity must be mathematically consistent with the orientation curve used by frame transforms.

It is therefore **not** independently interpolated in ORP v1.

Let `u` be the evaluated raw 4-vector and `udot` its derivative with respect to physical seconds. After normalization `q = u / ||u||`, runtime computes the derivative of the normalized quaternion deterministically:

```text
qdot = (I - q q^T) * udot / ||u||
```

using the corresponding four-dimensional projection arithmetic.

For OrbitEngine's active child-to-parent Hamilton quaternion convention, parent-frame angular velocity is then derived from the vector part of the convention-consistent quaternion product equivalent to:

```text
omega_quat = 2 * qdot * conjugate(q)
```

The implementation must validate the sign/order against document-14 rigid-state velocity transforms and source-oracle angular rates.

A source/oracle-provided angular velocity may be used during importer validation but does not become a second independent runtime truth.

This guarantees that a surface-fixed point's rotational velocity is consistent with the exact orientation function being evaluated.

## Time normalization

### Canonical runtime domain

All ORP runtime segments are indexed by document-12 exact TDB `SimulationInstant`.

The fact that a source standard is parameterized by TT, TDB, UTC, UT1, TAI or another time argument remains import provenance.

### Offline conversion ownership

Importer/acquisition tooling owns source-time conversion.

It pins every auxiliary product required to reproduce that conversion, for example:

- leap-second table/kernel;
- IERS EOP/UT1 data;
- source-specific TT/TDB conventions;
- source kernel/frame definitions;
- conversion library/tool version.

The tool evaluates the source orientation at the physical instant corresponding to each canonical TDB sample and fits `q(TDB)`.

Runtime therefore never needs mutable leap-second/EOP network data simply to evaluate a loaded historical ORP.

### Earth implications

Earth orientation is especially sensitive to UT1 and terrestrial/celestial realization. ORP normalization captures the selected full source solution as a function of TDB over its finite coverage.

A future EOP update creates a new ORP dataset. It does not mutate old loaded bytes or saves.

## Spatial-frame normalization

### Parent orientation frame

Every orientation source declares the exact non-rotating parent orientation frame into which its body-fixed axes rotate.

For the normal Solar-System path this ultimately composes to the ICRS/ICRF-aligned root convention from document 14, commonly through a body-centered non-rotating frame with axes aligned to that parent/root orientation.

The importer applies any source-frame transforms once during normalization.

No ecliptic, Three.js, camera or rendering-axis rotation appears in ORP.

### Body-fixed semantic identity

A source record preserves the selected body-fixed frame semantic identity, for example source-specific concepts such as IAU body-fixed, ITRF realization, lunar PA or lunar ME.

Two different physical frame definitions for the same body are different orientation sources/frames. The engine never treats them as interchangeable merely because their origins coincide.

### Quaternion canonicalization

Runtime physical comparison uses orientation-equivalent quaternion angular distance, not component sign.

For deterministic serialization/cache outputs the evaluator may canonicalize result sign using a stable rule such as positive scalar part with deterministic tie-break. This is representation-only; parity tests remain sign-insensitive for physical orientation.

## Pole, precession, nutation, libration and retrograde rotation

The generic ORP representation does not classify these effects at runtime. It reproduces the selected source orientation curve.

Importer/source provenance records which physical/model components the source contains.

Consequences:

- secular pole/precession terms are preserved when source-supported;
- nutation/periodic terms are preserved if required to meet the declared source-fit budget;
- Moon libration is preserved in the high-accuracy lunar source;
- retrograde planets naturally produce the correct quaternion/angular-velocity direction;
- irregular/non-uniform spin can be represented if a trusted source oracle provides it.

No runtime code assumes positive/prograde angular velocity.

## Validity and fallback behavior

### Exact coverage

Every source and every segment has exact inclusive/exclusive validity boundaries normalized to `SimulationInstant`.

Effective source validity also requires all source/frame dependency data needed to construct its declared frame semantics.

A query outside validity returns an explicit orientation-source-out-of-range error.

### No silent extension

The engine does not:

- extrapolate the last quaternion polynomial past coverage;
- continue the last measured Earth rotation rate indefinitely;
- replace missing lunar libration with synchronous spin;
- fall back from high-precision Earth to an IAU/constant-spin source automatically.

### Explicit approximation segments

A scenario that needs broader visual/gameplay coverage may install a separate lower-quality orientation source with its own validity and quality tag.

Transition between reference and approximation orientation sources is an explicit frame/source segment/configuration decision. Diagnostics expose the active quality/source.

An approximation cannot claim reference-source provenance simply because its state was initialized at the reference boundary.

## Public loading and registration API

The public TypeScript surface provides backend-neutral operations equivalent to:

- load/validate immutable ORP manifest + shard bytes;
- inspect dataset/source identities, provenance and validity;
- bind an ORP source to a natural body's body-fixed frame registration;
- query orientation-source status/validity;
- optionally evaluate an orientation sample directly for diagnostics/testing;
- unload only when no live frame/source dependency remains, following explicit lifecycle rules.

Production registration conceptually supplies:

```text
registerBodyFixedFrame({
  frameId,
  parentBodyCenteredFrameId,
  originObjectId,
  orientationSourceId
})
```

The exact API may compose existing frame-registration primitives, but the consumer never supplies a per-query JavaScript orientation callback for the production ORP path.

## Frame-provider integration

### Body-fixed provider

The document-14 body-fixed provider composes:

- child origin translation/origin velocity from the registered central body's canonical state in the parent frame;
- orientation/angular velocity from the bound ORP source at the same exact instant.

The resulting `RigidStateTransform Parent <- Child` is ordinary frame data. No special natural-body transform path bypasses document 14.

### Source immutability

Loaded production ORP sources are immutable for a dataset instance.

Switching to a different source baseline is not an in-place mutation of old historical source bytes. A scenario creates/binds a new source/frame-provider segment/replacement at an explicit exact boundary according to frame lifecycle architecture.

Source revision remains part of cache/dependency identity for pack loading, shard completion and any explicitly supported revisioned source handle, but normal reference datasets are content-addressed immutable values.

## Surface-attached objects

A fixed surface object remains `attached` to a body-fixed or static local child frame.

In the body-fixed frame it may have constant position and zero relative velocity.

At exact `T`, outward transformation yields:

```text
r_parent = r_body + R * r_fixed
v_parent = v_body + R * 0 + omega x (R * r_fixed)
```

plus any additional static-local composition.

Thus Earth rotation, lunar libration, retrograde Venus rotation, etc. automatically generate the correct inertial/root motion of a fixed point without assigning that point an orbital propagator.

Latitude/longitude/height remains an import/convenience concern requiring explicit body shape as defined by document 14; ORP does not become a planet-shape database.

## J2 and force-model integration

Document 28's `J2GravitySource` references a pole/orientation source.

The ORP body source supplies the authoritative production pole direction. Because J2 is axisymmetric:

- the semi-analytical `j2Secular` profile resolves/fixes the source pole at its segment anchor and checks pole drift over its certificate horizon;
- the numerical J2 provider may sample the ORP orientation continuously at `NumericalSampleTime` and extract the symmetry axis;
- prime-meridian angle is irrelevant to the J2 acceleration itself.

The orientation dependency is source/revision/validity keyed. Changing the selected ORP baseline invalidates affected J2 certificates/numerical caches/future selections according to documents 21/22/28.

Future non-axisymmetric/tesseral gravity would require the full body-fixed orientation and a separate gravity-field architecture; this document provides the orientation source but does not add that force model.

## NumericalSampleTime support

Pole-dependent numerical force evaluation may require orientation at internal DOP853 stage times that are not public nanosecond instants.

The ORP evaluator therefore has a portable-core internal continuous sampler compatible with document 21's `NumericalSampleTime`.

It evaluates the same Chebyshev segment at the binary64 offset from the exact step start after verifying that the sample remains inside segment validity.

This internal sampler does not create a public timestamp or event ordering point.

Public frame/orientation queries remain exact `SimulationInstant` values.

## Dependency and invalidation semantics

Orientation dependencies participate in the existing revision graph.

A source/configuration change effective at exact `T` invalidates dependent derived work whose covered interval intersects `[T,+infinity)`, including as applicable:

- orientation evaluation caches;
- body-fixed/local frame transforms;
- object states transformed through those frames;
- frame-relative query caches;
- J2/semi-analytical accuracy certificates;
- numerical force/integration caches using the source;
- encounter/collision/trajectory predictions whose state dependencies use affected frame/force results;
- future scheduled Fidelity decisions relying on those derived values.

Historical immutable results entirely before `T` may remain reusable.

A renderer/texture orientation cache is outside authoritative simulation invalidation and remains presentation-owned.

## Caching and performance

### Same-epoch source cache

Many attached objects may share one natural body's body-fixed frame.

The portable frame/orientation layer therefore caches the evaluated orientation sample by at least:

```text
orientationSourceId/revision
exact instant
coefficient segment identity
```

Within one same-epoch batch/frame composition, the source is evaluated once and reused.

Surface object count must not multiply Chebyshev evaluation cost for one shared source/instant.

### Segment lookup

ORP source segment lookup is logarithmic or indexed O(1)-amortized for sequential/same-source access. Evaluation work is O(polynomial degree), independent of elapsed historical time.

No evaluation steps through daily samples or simulates rotation tick-by-tick.

### Memory/loading

ORP may be sharded by body/source/time region. The manifest exposes exact shard/source coverage so applications load only needed data.

A source cannot advertise query validity for coefficients whose required shard bytes are not loaded.

The runtime package contains the evaluator/decoder, not a mandatory full Solar-System ORP dataset.

## Backend ownership and parity

Portable C++ owns:

- ORP manifest/binary validation primitives needed at runtime;
- segment lookup;
- Chebyshev component/derivative evaluation;
- quaternion normalization;
- angular-velocity derivation;
- same-epoch orientation cache;
- body-fixed provider integration where performance-critical;
- continuous `NumericalSampleTime` sampling.

TypeScript owns:

- ergonomic loading orchestration;
- public value validation/error normalization;
- scenario mapping from application body catalog to ORP source IDs;
- provenance inspection shapes.

Native/WASM adapters do not contain separate orientation formulas.

Exact parity is required for:

- source/dataset IDs and revisions;
- exact validity/segment boundaries;
- selected segment/source/quality code;
- load/validation error categories;
- dependency invalidation decisions.

Quaternion comparison is sign-insensitive angular error. Quaternion/angular-velocity continuous values use explicit ORP fit/parity tolerances rather than bit identity.

## Offline importer architecture

### Tool boundary

Developer/build tooling may use:

- CSPICE for PCK/FK/kernel evaluation;
- IERS/SOFA-compatible tooling for Earth-orientation transformations;
- source-specific parsers for WGCCRE/IAU products;
- high-precision numerical libraries for fitting/validation.

None of those become normal native/WASM runtime dependencies.

### Acquisition record

Every source input records at least:

```text
sourceKind
sourceProductId/frameId
sourceUrl
retrievalTimestamp
sourceDeclaredVersion
sourceTimeScale/convention
sourceFrame/bodyFixed semantic
requested/actual coverage
sha256
auxiliary products/hashes
redistribution/license notes
```

A checksum mismatch fails a reproducible build unless the acquisition record is deliberately updated.

### Deterministic oracle sampling/fitting

For each output interval:

1. choose deterministic source sample instants in canonical TDB;
2. evaluate source child-to-parent rotation through the pinned oracle/toolchain;
3. normalize source frame semantics into document-14 parent coordinates;
4. choose quaternion signs continuously inside the candidate interval;
5. fit the four component series;
6. validate normalized quaternion angular error on a denser deterministic grid;
7. derive runtime angular velocity from the fitted derivative and compare with oracle/source-consistent angular velocity where available;
8. split/refit until both budgets pass;
9. emit immutable coefficients + provenance.

No random fitting grid determines released coefficients.

## Baseline Solar-System ORP profile

The first production dataset implementation should include at minimum:

- Sun;
- Mercury;
- Venus;
- Earth;
- Moon;
- Mars;
- Jupiter;
- Saturn;
- Uranus;
- Neptune;
- the major natural satellites already present in the committed Solar-System scenario where a defensible pinned source exists.

It should not fabricate orientation for catalog bodies lacking a source merely to reach 100% coverage.

The manifest makes per-body coverage/quality explicit.

## Validation matrix

Implementation must include deterministic source/oracle cases covering at least:

1. Earth high-precision body-fixed orientation at pinned epochs versus the selected IERS/NAIF oracle;
2. Earth fixed surface point root/inertial displacement and velocity over time, including the correct `omega x r` contribution;
3. Moon high-accuracy PA/selected frame orientation demonstrating libration/non-uniformity versus the pinned JPL/NAIF oracle;
4. Venus or another retrograde planet with correct rotation direction under the document-14 quaternion convention;
5. at least one outer-planet/major-satellite WGCCRE source with periodic terms where present;
6. body-fixed -> parent -> body-fixed transform round trip;
7. exact source/segment validity boundary acceptance/rejection;
8. explicit approximation segment never reported as reference quality;
9. ORP coefficient-fit error stays within declared angular/angular-velocity budgets over dense validation samples;
10. q/-q source sign changes do not create physical orientation discontinuities;
11. source revision/replacement invalidates dependent frame/J2/derived caches from the effective instant;
12. thousands of same-body surface-attached transforms reuse one same-epoch orientation evaluation;
13. native/WASM discrete parity and tolerance-defined quaternion/angular-velocity parity;
14. packaged browser/WASM loading of a small ORP fixture through public APIs without CSPICE/IERS runtime dependencies.

## Implementation decomposition

Architecture #122 is complete when implementation can proceed through focused issues in this order:

1. ORP v1 manifest/binary format, acquisition records and deterministic importer/fitting tooling;
2. portable ORP quaternion/derivative/angular-velocity evaluator plus runtime loader;
3. public orientation-source lifecycle and body-fixed frame registration integration;
4. baseline Solar-System ORP generation with Earth/Moon special-source paths and WGCCRE planet/satellite sources;
5. surface-frame/J2 dependency invalidation, native/WASM parity, package/browser and performance regressions.

## Non-goals

- No terrain/topography/shape database.
- No rendering texture rotation or material/shader architecture.
- No gameplay settlement/geography metadata.
- No spacecraft attitude-control dynamics.
- No live IERS/NAIF/IAU/JPL network access at runtime.
- No silent constant-spin fallback outside source coverage.
- No assumption that translational OEP provenance automatically supplies orientation provenance.
