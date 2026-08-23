# 28 — Higher-Order Perturbation and Semi-Analytical Propagation

## Status and scope

This document records the architecture decided by Architecture issue #121. It defines OrbitEngine's first production propagation tier between ideal two-body motion and full adaptive numerical integration.

The initial production scope is deliberately narrow: **first-order secular J2 propagation for stable bound motion around one oblate central body**. The public propagation family is `semiAnalytical`; the initial model profile is `j2Secular`.

This document also defines the shared physical J2 source record and the matching numerical J2 force-provider contract used for validation and for cases where the semi-analytical assumptions are not sufficient.

It builds on documents 12–15, 21 and 22. Document 29 will define the production natural-body orientation-source pipeline used by the pole dependency. Until that pipeline is implemented, the same contract may be satisfied by another explicit immutable orientation/pole source already normalized to document-14 frame semantics.

This architecture does not replace production reference ephemerides for undisturbed known natural bodies. It does not add atmospheric drag, SRP, J3/J4, tesseral harmonics, arbitrary third-body semi-analytical theory, relativistic terms, or a general mean-element library.

## Decisions at a glance

- Extend the propagation taxonomy with public `PropagationModelKind.semiAnalytical` using the next stable wire code after the four initial document-15 kinds.
- `semiAnalytical` is a family; v1 contains exactly one normalized profile: `j2Secular`.
- `j2Secular` is intended for diverged/artificial objects and long coast phases where ideal two-body secular error is unacceptable but full numerical integration is not justified.
- It never replaces an undiverged `referenceEphemeris` authority for a known natural body.
- V1 models one central point-mass gravity field plus the central body's axisymmetric J2 secular effect. No other perturbation is hidden in the profile.
- The canonical anchor/handoff remains exact Cartesian position/velocity at one exact `SimulationInstant` in an explicit body-centered non-rotating frame.
- Internal propagation uses a nonsingular modified-equinoctial representation with a deterministic prograde/retrograde chart selected at segment creation. Internal elements never become authoritative public state.
- The anchor is treated as an osculating state. V1 advances first-order secular J2 rates from that anchor; it does not claim high-precision short-period reconstruction.
- The model is O(1) in propagation interval: no adaptive stepping, global ticking, or per-query force integration.
- J2 physical data is an explicit revisioned source: central `mu`, equatorial reference radius, dimensionless `J2`, exact validity/provenance, and pole/orientation dependency.
- Because J2 is axisymmetric, prime-meridian spin is irrelevant to `j2Secular`; only the symmetry/pole axis matters.
- The semi-analytical profile freezes the central symmetry axis at the segment anchor. It is representable only when the declared pole source proves that pole drift across the accepted horizon stays within an explicit model limit.
- A matching portable numerical J2 force provider uses the same J2 physical record and may sample the time-varying pole source continuously. It is the high-fidelity comparison path for the same physical effect.
- Bound elliptic motion only in v1. Parabolic/hyperbolic trajectories and central-body intersecting trajectories are rejected.
- Validity is bounded explicitly by physical/source validity, segment direction/domain, perturbation-domain guards, pole-drift guard and a model-owned accuracy certificate for the requested acceptance horizon.
- Fidelity remains semantic. The manager may choose this profile only when the requested effects/error budget can be met and no requirement demands numerical integration, continuous thrust, mutual coupling or unsupported forces.
- Promotion/demotion uses the exact document-15 Cartesian handoff transaction. Reference divergence remains one-way.
- J3/J4, tesseral harmonics, semi-analytical third-body/SRP and drag are deferred until measured use cases justify separate architecture/implementation.

## Why the first middle tier is J2

### Concrete use cases

J2 provides a useful cost/accuracy middle tier for:

- artificial satellites in stable planet-centered orbit where nodal and apsidal precession matters over days to months;
- post-maneuver coast phases around an oblate planet;
- diverged natural/artificial objects that can no longer resume a reference ephemeris but remain in a stable central orbit;
- large satellite populations where two-body motion produces visibly/physically wrong secular plane evolution and numerical propagation for every quiet object would be wasteful.

These cases have a strong property: the dominant missing effect can often be expressed as one small axisymmetric perturbation while the orbit remains regular and bound.

### Why other candidates are deferred

J3/J4 and tesseral harmonics add value only for narrower orbit classes and require a larger gravity-field data contract. They are not included merely because coefficients are available.

Third-body perturbations are highly geometry- and source-dependent. OrbitEngine already has the correct architectural home for them as deterministic numerical gravity sources. A new semi-analytical third-body family requires separate evidence that the cost saving justifies another approximation theory.

Solar-radiation pressure depends on spacecraft optical/area-to-mass properties and eclipse/occlusion semantics. It remains a future physical force contract and is not smuggled into this model.

Atmospheric drag is explicitly excluded. Rendering atmosphere metadata from documents 19/27 is never physical drag data. A future drag model requires a separate physical atmosphere/density and aerodynamic spacecraft-property architecture.

## Propagation taxonomy extension

Document 15 defined the initial model kinds. This architecture extends that set with:

```text
PropagationModelKind
  referenceEphemeris
  twoBodyAnalytical
  numerical
  attached
  semiAnalytical
```

The backend wire code for `semiAnalytical` is the next stable code after document 15's code `4`; existing codes never change.

The family has an explicit model-profile discriminator:

```text
SemiAnalyticalProfileKind
  j2Secular
```

Unknown profile codes are rejected. Adding another profile later does not reinterpret `j2Secular` and does not silently add forces to an existing segment.

## Canonical segment contract

A `j2Secular` segment is anchored by the ordinary document-15 handoff:

```text
SemiAnalyticalSegmentAnchor
  epoch: SimulationInstant
  propagationFrame: ReferenceFrameId
  position: Vec3 metres
  velocity: Vec3 metres/second
```

The propagation frame must be a declared body-centered **non-rotating** frame whose origin follows the selected central body. The model evolves target motion relative to that origin.

The frame axes need not have +Z aligned with the central pole. Pole orientation is an explicit source and the implementation constructs the required equatorial basis deterministically.

A segment declares:

```text
SemiAnalyticalJ2Configuration
  centralBodyId
  j2GravitySourceId/revision
  poleSourceId/revision
  exact validity interval
  direction capability
  model-domain limits
  accuracy-certificate identity
```

No model parameter is inferred from `ObjectType`, display name or renderer hierarchy.

## Shared J2 physical source

The central-body J2 record is engine physical data, separate from appearance/presentation metadata:

```text
J2GravitySource
  sourceId
  revision
  centralBodyId
  muMeters3PerSecond2
  equatorialReferenceRadiusMeters
  j2Dimensionless
  poleSourceId
  validity: exact interval
  provenance
```

Validation requires:

- `mu > 0`, finite;
- reference radius `> 0`, finite;
- `J2` finite;
- a live compatible pole/orientation source whose validity covers the requested model/force interval;
- explicit source/revision/provenance identity.

The source is not automatically created from a rendering radius. If a body's simulation physical radius happens to equal the gravity model's reference radius, that equality is data provenance, not an implicit fallback.

Changing any J2 value, pole dependency or provenance version creates a new source revision and invalidates dependent future propagation/force cache records from the effective change instant.

## Pole and orientation dependency

### Axisymmetric requirement

The J2 potential is axisymmetric. The semi-analytical model therefore needs the central body's symmetry-axis direction but does **not** need the prime-meridian/spin angle.

The pole source is evaluated according to document 14 and, after document 29, through the normalized natural-body orientation pipeline. Conceptually it provides enough information to resolve a unit north/symmetry axis in the propagation frame at exact time plus source revision/validity.

### Frozen-axis approximation

`j2Secular` freezes the symmetry axis at the exact segment anchor. This keeps the model closed-form/O(1) and makes its assumptions explicit.

The model configuration contains a finite positive:

```text
maxPoleDriftRadians
```

Before installation/demotion acceptance, the pole source is sampled through a deterministic bounded validation procedure over the requested acceptance horizon. If the maximum measured angular change from the anchor pole exceeds this limit, `j2Secular` is not representable for that horizon.

A caller cannot bypass this check by claiming a larger accuracy budget if the normalized model-domain configuration forbids the drift. Cases requiring materially time-dependent pole dynamics use the numerical J2 force provider.

Prime-meridian rotation does not enter this check.

## Internal analytical representation

### Osculating anchor

The exact Cartesian handoff is converted once at segment creation into an osculating orbital representation relative to the central body and frozen equatorial basis.

V1 deliberately does not claim that an arbitrary osculating state has been converted into a high-order mean-element solution. Consequently `j2Secular` is an inexpensive secular approximation, not a high-precision replacement for numerical J2 propagation.

### Modified equinoctial coordinates

The internal canonical representation is modified equinoctial elements (MEE) with a deterministic prograde/retrograde chart factor selected from the anchor orbit normal.

The chart selection is immutable for the segment. It is chosen so ordinary near-equatorial prograde and retrograde orbits avoid the classical `e = 0` and `i = 0/pi` singularities.

The implementation may derive temporary classical quantities for formulas, but stored/evolved state must not depend on undefined argument-of-periapsis or ascending-node values for circular/equatorial cases.

All conversions use binary64 and explicit feature tolerances. A degenerate zero-angular-momentum state is rejected.

### Secular evolution

The selected production theory is the standard **first-order J2 secular perturbation of a bound Keplerian orbit**.

Semantically:

- semi-major axis has no first-order secular J2 drift;
- eccentricity magnitude has no first-order secular J2 drift;
- inclination relative to the frozen symmetry axis has no first-order secular J2 drift;
- node longitude precesses at the canonical first-order J2 secular rate;
- apsidal/periapsis longitude precesses at the canonical first-order J2 secular rate;
- mean longitude/anomaly receives the canonical first-order J2 secular correction in addition to Keplerian mean motion.

The implementation issue must use one documented coefficient/sign convention consistently with the child-to-parent frame/pole convention in document 14 and validate it against independent numerical/reference cases. Backend-specific formula variants are forbidden.

At target time the evolved nonsingular elements are converted back to canonical Cartesian relative position/velocity in the segment propagation frame.

### No short-period claim

V1 does not add an undocumented short-period J2 reconstruction. Its declared error therefore includes omitted periodic J2 terms and all omitted physical forces.

A later higher-order profile may add mean-element fitting/short-period reconstruction, but it must receive a distinct profile identity and validation contract rather than silently changing `j2Secular` semantics.

## Intrinsic model domain

A v1 `j2Secular` segment supports only states satisfying all of:

- finite non-zero central `mu` and J2 source;
- bound elliptic orbit (`specific orbital energy < 0` and derived `0 <= e < 1` within conversion tolerance);
- non-zero angular momentum;
- positive semi-major axis and semilatus rectum;
- osculating periapsis radius strictly outside the configured central exclusion radius;
- J2 perturbation-strength sanity guard;
- valid pole/J2 source across the requested interval;
- no required unsupported force/effect.

The normalized model-domain configuration contains:

```text
centralExclusionRadiusMeters
maxEccentricity                 // < 1
maxJ2PerturbationParameter
maxPoleDriftRadians
```

The dimensionless perturbation guard is evaluated from the anchor orbit using a quantity equivalent to:

```text
abs(J2) * (referenceRadius / semilatusRectum)^2
```

This is a **domain guard**, not an accuracy estimate. Concrete preset values may be provided by TypeScript, but the normalized values are explicit in model/configuration identity and portable-core validation. The core has no hidden universal epsilon.

Parabolic/hyperbolic motion, trajectories intersecting the exclusion radius, degenerate radial motion, or configurations outside these limits fail with `modelRepresentationInvalid` rather than falling back silently.

## Validity and accuracy certificate

### Bounded validity

Every segment has an explicit exact validity interval. Effective validity is the intersection of:

- requested segment validity;
- J2 physical source validity;
- pole source validity;
- central-body/frame dependency validity;
- intrinsic model-domain limits;
- accepted accuracy-certificate horizon.

Querying outside the effective interval fails. No secular extrapolation beyond the accepted horizon is presented as validated motion.

### Why a certificate is required

A first-order secular J2 model has approximation error that depends on altitude, eccentricity, inclination, J2 strength and horizon. A single global promise such as “J2 is accurate to X metres” is false.

OrbitEngine therefore uses a **model-owned acceptance certificate** when the Fidelity/model selector needs a quantitative error budget.

Conceptually:

```text
SemiAnalyticalAccuracyCertificate
  model/profile/config revision
  anchor state/revision
  comparison force configuration identity
  horizon [anchor, acceptedThrough]
  sample schedule identity
  estimatedMaxPositionErrorMeters
  estimatedMaxVelocityErrorMetersPerSecond
  maxPoleDriftRadiansObserved
  safetyFactor
  certificateRevision/fingerprint
```

The certificate is derived/read-only data, not motion authority.

### Deterministic comparison path

The canonical comparison is detached numerical propagation using document 21 with:

- central point-mass gravity;
- the matching numerical J2 force provider from this document;
- the same central body/J2/pole source;
- no extra forces unless the candidate semi-analytical profile also represents them.

The validator evaluates a bounded deterministic sample schedule across the requested acceptance horizon. The initial normalized validator uses at least 16 interior/equally partitioned samples plus the exact horizon endpoint; implementation may evaluate additional deterministic orbital-phase/event-aware samples but may not use random sampling.

The observed maximum errors are multiplied by a normalized safety factor `> 1` before being advertised.

This certificate is an engineering acceptance bound, not a mathematical proof between samples. Strict requirements that cannot tolerate this approximation use numerical authority.

Certificate generation is required for automatic **demotion** from a higher-fidelity authority when quantitative position/velocity budgets are active. A caller may explicitly install a `j2Secular` segment without a quantitative certificate only when it supplies an explicit bounded model validity and does not claim a stronger error guarantee; the Fidelity Manager must not use that uncertified segment to satisfy a numerical error budget.

Any dependency revision invalidates the certificate from the effective change instant.

## Matching numerical J2 force provider

The portable numerical force system gains a typed J2 provider using the same `J2GravitySource`.

At each `NumericalSampleTime` it evaluates the central-body-relative state and applies the canonical axisymmetric quadrupole acceleration using:

- source `mu`;
- source equatorial reference radius;
- source `J2`;
- pole axis sampled consistently from the pole/orientation source at the numerical sample time.

The provider does not require the central body's prime-meridian angle because J2 is axisymmetric.

The provider is deterministic portable C++, participates in document-21 provider ordering/configuration identity and supports coupled groups when the group configuration explicitly includes the same external central J2 field for the relevant members.

No JavaScript derivative callback is introduced.

This force provider serves three purposes:

1. actual numerical propagation when higher fidelity is required;
2. reference validation for `j2Secular`;
3. a shared physical-data path so the analytical and numerical models cannot silently use different J2 constants/radii/poles.

## Switching and reference divergence

### Exact Cartesian handoff

All transitions use document 15:

```text
old authority at exact T
  -> canonical Cartesian handoff
  -> construct candidate semiAnalytical/numerical/twoBody authority
  -> validate continuity + representability
  -> commit one exact-time segment transition
```

Internal MEE values never cross the authoritative handoff boundary.

### Two-body -> J2

Promotion from two-body to `j2Secular` is allowed when:

- the J2 profile is representable from the exact handoff state;
- all source/domain dependencies are valid;
- the active Fidelity requirement needs the J2 effect or an error budget that two-body cannot satisfy;
- the `j2Secular` candidate satisfies its required certificate/validity contract.

### J2 -> numerical

Promotion to numerical occurs when any active requirement needs behavior outside the profile, including continuous thrust, mutual coupling, collision-precision numerical integration, unsupported force sources, time-varying pole beyond the allowed drift, or tighter accuracy than the certificate permits.

The numerical successor normally includes the same point-mass + J2 source so the physical model does not accidentally lose the perturbation during promotion.

### Numerical -> J2 / J2 -> two-body

Demotion requires the ordinary document-22 dwell/hysteresis rules plus a candidate accuracy/representability check over the requested acceptance horizon.

Demotion from numerical to J2 compares the candidate against detached numerical motion and requires its certificate to satisfy the effective error budget.

Demotion from J2 to two-body is allowed only when J2 is no longer a required physical effect and two-body separately passes its own document-15 representability/error acceptance. It is never justified merely because the object moved farther from the camera.

### Reference ephemeris

An undiverged known natural body remains on `referenceEphemeris` when that reference is the selected source of truth. The existence of J2 data does not justify replacing it with a reconstructed orbit.

After an object physically diverges from its reference trajectory, normal runtime may use two-body, `j2Secular` or numerical authorities as appropriate. The original reference source never regains future authority automatically.

## Fidelity Manager integration

`requiresPerturbations` from document 22 is interpreted as a semantic requirement, not a direct request for `semiAnalytical`.

For J2-aware policies the normalized selector reasons about an effect capability equivalent to:

```text
required physical effect: centralAxisymmetricJ2(sourceId/revision)
```

A `j2Secular` candidate can satisfy that effect only inside its declared domain/certificate. The numerical J2 provider can satisfy the same effect while also composing with other numerical providers.

A candidate is ineligible when the effective profile includes any of:

- `requiresNumericalIntegration`;
- `requiresMutualCoupling`;
- `requiresContinuousThrust`;
- a force/source requirement unsupported by `j2Secular`;
- a position/velocity error budget tighter than the active certificate;
- a required validity horizon beyond the certificate/source/domain interval.

Model cost metadata ranks eligible candidates; it never overrides required physics or accuracy.

Promotion/demotion hysteresis remains owned by document 22. This document adds no renderer, camera-distance or selection inputs to Fidelity.

## Cache and invalidation

A semi-analytical cache/configuration result is reusable only when all of these identities match:

- object motion segment/revision;
- anchor state;
- profile/configuration;
- central body;
- J2 source/revision;
- pole source/revision and frozen anchor pole;
- propagation frame/provider revision;
- accuracy certificate when one is relied upon.

A relevant physical/source/frame change at exact `T` invalidates derived queries/certificates and future scheduled Fidelity decisions from `T` onward. Historical records entirely before `T` may remain valid.

Because state evaluation is O(1), implementations should prefer cheap recomputation over complex long-lived element caches when cache bookkeeping would dominate.

## Public TypeScript API boundary

Public concepts are backend-neutral and physical:

- create/register/query a J2 gravity source;
- install/switch to a `semiAnalytical` model with `j2Secular` profile;
- inspect effective validity/model status and accuracy-certificate diagnostics;
- configure/use J2 as a numerical force provider through the normal numerical configuration surface.

The normal `stateAt`/batch state API does not gain a special J2 result shape. It returns the same canonical `CartesianState` as every model.

Public APIs do not expose mutable internal equinoctial arrays, integrator pointers, provider vtables or rendering concepts.

## Portable-core and backend ownership

The following run in shared portable C++:

- Cartesian <-> nonsingular internal element conversion;
- `j2Secular` state evaluation;
- model-domain checks;
- J2 numerical acceleration;
- normalized certificate comparison calculations/digests where they touch physics results;
- exact discrete profile/source/revision semantics.

TypeScript owns ergonomic configuration/presets and error normalization. Native and WASM bindings marshal the same normalized data and never implement their own J2 formulas.

Discrete parity must match exactly for:

- model/profile/source codes;
- IDs/revisions;
- validity boundaries;
- chart selection;
- supported/unsupported outcomes;
- certificate sample schedule and pass/fail decision;
- switch/demotion decisions.

Continuous Cartesian/J2 acceleration/certificate error values use explicit feature tolerances rather than unconditional bit identity.

## Performance contract

The middle tier exists only if it is materially cheaper than numerical propagation.

`j2Secular` state evaluation has fixed work independent of time span and must not allocate per query in the steady-state hot path. Batch queries reuse normalized source/pole/configuration data.

Implementation benchmarks must include at least:

- 1,000 independent stable planet-centered satellites;
- a same-epoch batch query after a representative 24-hour propagation horizon;
- equivalent `twoBodyAnalytical`, `j2Secular`, and numerical point-mass+J2 configurations;
- native and WASM results.

The production target is:

- `j2Secular` throughput remains within one order of magnitude of `twoBodyAnalytical` for the same batch shape; and
- `j2Secular` is at least 5x faster than the representative DOP853 point-mass+J2 numerical workload on the benchmark environment while satisfying the scenario's declared J2 accuracy envelope.

A benchmark environment may record the wall-clock ratio rather than make a flaky cross-run CI timing threshold mandatory. CI must still enforce the structural invariant that `j2Secular` performs no adaptive integration/force-stage loop.

If representative measured workloads cannot demonstrate a material advantage, the implementation should not be promoted as an automatic Fidelity tier merely because the algorithm exists.

## Validation matrix

Implementation must cover at least:

1. inclined near-circular Earth-like satellite: correct sign/magnitude of J2 nodal regression versus independent reference/numerical integration;
2. eccentric inclined orbit: correct apsidal secular precession;
3. circular equatorial and near-retrograde cases: no classical-element singularity/NaN;
4. comparison against numerical point-mass+J2 over representative one-day, multi-day and accepted-horizon windows;
5. exact state continuity at twoBody -> J2, J2 -> numerical, numerical -> J2 and J2 -> twoBody switches;
6. reference-following object remains on reference authority until actual divergence;
7. pole drift over configured limit rejects/ends representability;
8. out-of-range J2/pole source validity fails explicitly;
9. hyperbolic/parabolic, central-intersecting and degenerate-radial states are rejected;
10. dependency revision invalidates future certificate/model cache;
11. native/WASM discrete parity and tolerance-based continuous parity;
12. large batch performance/structural no-integrator-loop regression.

## Deferred extensions

The following require separate future architecture or explicitly scoped extensions:

- first-order/higher-order short-period J2 reconstruction under a new profile;
- J3/J4 or arbitrary zonal/tesseral gravity fields;
- resonance-aware Earth satellite theory;
- semi-analytical third-body perturbations;
- SRP/eclipse semi-analytical models;
- physical atmosphere/drag;
- relativistic corrections;
- symplectic long-horizon coupled integration.

Adding one of these cannot silently change the semantics or error claim of `j2Secular`.

## Implementation decomposition

Architecture #121 is complete when implementation can proceed through focused issues in this order:

1. J2 physical source/revision/public value types and portable numerical J2 force provider;
2. nonsingular `semiAnalytical/j2Secular` propagator and reference tests;
3. semi-analytical accuracy-certificate validator and validity diagnostics;
4. exact model-switch/Fidelity integration for two-body/J2/numerical authorities;
5. public API/native/WASM parity, benchmark and regression completion.

## Non-goals

- No JPL/reference ephemeris replacement for undiverged known natural bodies.
- No rendering appearance/atmosphere data as physical force input.
- No automatic atmosphere drag/SRP/third-body/J3/J4 behavior.
- No fixed global timestep.
- No game-specific spacecraft modules/resources.
- No promise that first-order secular J2 is high-precision osculating truth.
