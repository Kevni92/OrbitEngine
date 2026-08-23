# 23 — Predictive Encounters and Close-Approach Scheduling

## Status and scope

This document records the architecture decided by Architecture issue #117. It defines OrbitEngine's predictive encounter system: policy eligibility, scalable broad phase, rolling prediction windows, coarse/refined closest-approach solving, revision-aware encounter records, fidelity/coupled-authority scheduling, invalidation, public observability, and performance instrumentation.

It builds on documents 12–15, 21 and 22. Encounter prediction is derived scheduling data. It is not gravity-source selection, collision contact detection, or authoritative motion.

## Decisions at a glance

- Gravity relevance, encounter monitoring, and collision relevance are three independent policies.
- Encounter monitoring is enabled only by explicit normalized policy; `ObjectType`, mass, radius, registration, or visual importance never imply global monitoring.
- Candidate generation uses hierarchy-aware **encounter domains** plus time-windowed conservative swept bounds stored in spatial indexes. There is no every-tick all-pairs scan.
- The portable core requires an explicit prediction profile: horizon, maintenance lead/cadence, distance thresholds, error tolerances, subdivision/work budgets, and policy revision. TypeScript may provide presets, but the core receives concrete values.
- Broad-phase windows are split at motion/source/segment validity boundaries. If a model cannot provide a trustworthy conservative bound, the system degrades toward more subdivision/candidates, never toward false rejection.
- Coarse closest approach uses relative position/velocity samples and adaptive cubic-Hermite interval approximation with a conservative residual/curvature uncertainty bound.
- Refined closest approach minimizes squared relative distance by finding roots of `g(t)=r_rel(t)·v_rel(t)` with safeguarded Brent-style bracketing/refinement and explicit endpoint checks.
- Multiple local minima are represented as separate encounter windows/records rather than collapsing a long interval into one minimum.
- Final predicted closest-approach time is an exact `SimulationInstant` selected from the nanosecond grid after continuous refinement; time/distance uncertainty remains explicit diagnostics.
- Encounter records are stable derived objects keyed to canonical ordered participants plus a stable `EncounterId`, generation and dependency revisions.
- Encounter records schedule fidelity escalation through document 22 early enough to refine under the required model. Encounter code never switches propagation directly.
- Coupled N-body promotion is requested only when a documented interaction-strength/error criterion requires mutual response; it is not inferred from mass alone.
- State/model/property/policy changes invalidate only dependent future predictions where practical. Stale scheduled work is generation checked before execution.
- Public APIs are read-only prediction/diagnostic queries. Internal spatial nodes, BVH handles and cache pointers remain private.

## Encounter policy boundary

### Pair policy

The engine stores a revisioned normalized `EncounterPolicy` whose rules resolve a canonical pair `(min(ObjectId), max(ObjectId))` to one of:

```text
disabled
monitor(profileId)
```

Rules may use engine-level facts such as:

- immutable `ObjectType`;
- following-reference/diverged status;
- explicit caller interaction tags whose semantics are physical/engine-level;
- presence of collision geometry when collision-related monitoring is requested;
- explicit pair/object overrides.

Rules may not use faction, ownership, mission, economy, camera, selection or renderer LOD.

`ObjectType` is only a rule input. It never independently enables monitoring.

Changing policy/rules/profile revision invalidates affected future predictions.

### Independence from gravity and collision

An encounter-monitored pair may exert no gravity on each other. A gravity source pair may be encounter-disabled. Collision policy may require a tighter contact window but does not redefine the encounter policy.

Later collision infrastructure may subscribe to encounter candidates or request a collision-specific encounter profile; it must not create a second global pair scanner.

## Prediction profiles

The portable core receives concrete normalized values:

```text
EncounterPredictionProfile
  lookahead: Duration
  maintenanceLead: Duration
  broadPhaseDistanceMeters
  refineDistanceMeters
  closestApproachDistanceToleranceMeters
  closestApproachTimeTolerance: Duration
  maxBroadPhaseWindows
  maxCandidatesPerMaintenance
  maxCoarseSubdivisionsPerCandidate
  maxRefinementIntervalsPerCandidate
  maxSolverIterationsPerMinimum
  maxPublishedEncountersPerPair
  policyRevision
```

All values are finite/positive where applicable and validated. `refineDistance <= broadPhaseDistance` is required.

The core has no hidden universal Solar-System horizon. TypeScript may expose documented presets for common dynamic spacecraft, local-system, or catalog monitoring, but presets are expanded before entering the portable core.

This makes the architecture suitable for a months-long transfer without forcing every quiet asteroid to use the same horizon.

## Encounter domains

Candidate generation is partitioned into explicit **encounter domains** chosen by configuration/hierarchy, normally a stable inertial or effectively non-rotating frame appropriate to a local system.

Examples include:

- an SSB/ICRS root domain for heliocentric/interplanetary traffic;
- a planet-centered non-rotating domain for satellites/local traffic;
- a bounded local dynamic/coupled region.

An object may publish bounds into more than one domain when its trajectory crosses configured domain boundaries. Domain membership is derived/revisioned and does not change object identity or canonical propagation frame.

A domain transform is evaluated at the same prediction sample instant using document 14. Encounter arithmetic should remain in the most local suitable frame to avoid subtracting unnecessarily large root coordinates.

## Time-windowed conservative broad phase

### Window records

The rolling horizon `[currentTime, currentTime + lookahead]` is divided into adaptive prediction windows. Windows are always split at:

- motion segment boundaries;
- ephemeris/source validity boundaries;
- maneuver/force discontinuities known to the engine;
- relevant frame/provider validity boundaries;
- policy-defined maximum window span.

For each object/domain/window the engine builds a conservative swept bound inflated by the profile's broad-phase distance and model uncertainty.

The initial production bound is an axis-aligned bounding box in the encounter-domain frame plus exact time interval:

```text
SweptEncounterBound
  objectId
  interval [start,end]
  domainId
  min/max Vec3 metres
  inflation/error bound
  dependency revision digest
```

### Conservative bound construction

The bound builder samples authoritative state through the normal model-neutral state source. It uses endpoint/midpoint/adaptive samples plus model-provided numerical/analytical error information to bound between-sample motion.

If a trajectory/provider cannot certify a conservative between-sample bound for a window, the builder subdivides until the configured minimum window/work budget is reached. If it still cannot prove a safe bound, the result is marked **unbounded/uncertain** and remains a candidate against overlapping domain windows rather than being rejected.

False positives are acceptable; false negatives caused by pretending an uncertain trajectory is bounded are not.

### Spatial index

Each domain/time-window bucket owns a deterministic spatial BVH/AABB tree (or equivalent implementation with the same semantics). Querying overlaps produces candidate pairs only where:

- time intervals overlap;
- spatial inflated bounds overlap;
- the pair policy enables monitoring.

Candidate pair output is canonicalized by ascending `ObjectId` and deduplicated across neighboring windows/domains before refinement.

This yields expected `O(N log N + K)` broad-phase behavior for quiet separated populations, where `K` is overlapping candidates, without imposing a strict implementation class as public API.

## Large populations

Reference/minor-body populations may use bulk immutable/revisioned bound shards per domain/window. The index is built once for a source/motion revision and reused across maintenance passes.

A maneuvering spacecraft queries the bulk index; the system does not allocate an orbit/encounter record for every asteroid in advance and does not run every asteroid pair through refinement.

Policy may disable minor-body/minor-body monitoring while enabling spacecraft/minor-body monitoring. This is a physical interaction-policy choice, not a renderer optimization.

## Rolling maintenance and time warp

Encounter prediction is maintained by scheduled work in document 22, not by render frames.

For each profile/domain the system schedules maintenance no later than:

```text
horizonEnd - maintenanceLead
```

Advancing far through time warp reaches that exact maintenance work before the maintained horizon would become insufficient. The work extends/rebuilds the rolling horizon in bounded chunks.

If candidate/work budgets are exceeded, maintenance returns an explicit overload/incomplete-horizon diagnostic and prevents the engine from claiming protected encounter coverage beyond the verified horizon. It never silently drops candidates.

## Coarse closest-approach estimation

A broad-phase candidate is refined over each overlapping exact interval.

The coarse solver evaluates authoritative relative state `(r_rel, v_rel)` at interval endpoints and midpoint, in a suitable same-epoch encounter frame. It constructs a cubic Hermite relative-position approximation from position/velocity samples.

The solver compares additional samples against the interpolation and combines:

- state-source/model error bounds;
- interpolation residual;
- acceleration/curvature bound where available;
- configured numerical tolerance

into a conservative distance uncertainty for the interval.

The cubic's candidate minimum plus uncertainty is used only for rejection when it can prove:

```text
minimumPossibleDistance > refineDistance
```

Otherwise the interval is subdivided or promoted to refined solving. Uncertainty therefore makes the system do more work, not miss an encounter.

The coarse stage emits diagnostics: sampled minimum, lower/upper distance bound, interval and reason for reject/refine.

## Refined closest-approach solver

### Objective

For relative state at continuous time `t`:

```text
D(t) = r_rel(t) · r_rel(t)
g(t) = 0.5 dD/dt = r_rel(t) · v_rel(t)
```

Interior local minima occur where `g(t)=0` with the sign changing from negative to positive or equivalent local-minimum verification.

### Bracketing

The candidate interval is adaptively subdivided using coarse samples/dense output until all plausible extrema are bracketed within configured work limits. Segment/provider boundaries split the solve; no root finder crosses a discontinuity pretending it is smooth.

Every subinterval checks:

- both endpoints;
- sign changes in `g`;
- near-zero/tangent cases indicated by the coarse interpolation;
- model validity/error diagnostics.

### Root/minimum refinement

Each bracket is solved with a safeguarded Brent-style scalar root method on `g(t)` using authoritative state/dense-output sampling. Bisection fallback preserves the bracket.

The continuous solve stops when both:

- the time bracket is within `closestApproachTimeTolerance` or cannot be represented more finely;
- distance change/uncertainty is within the configured distance/error criterion,

or the deterministic iteration budget is exhausted.

Non-convergence is explicit and leaves the encounter in `needsRefinement`/failed-quality state; it does not publish an overconfident precise minimum.

### Exact SimulationInstant selection

The continuous candidate time is mapped to the exact nanosecond `SimulationInstant` grid. The engine evaluates the representable floor/ceiling instants inside the final bracket plus any exact boundary candidate and selects the smallest distance; ties choose the earlier instant.

The record includes the final continuous bracket/time uncertainty and distance uncertainty, so exact timestamp representation is not confused with infinite prediction precision.

### Multiple minima

A long candidate interval may contain multiple local minima. Each accepted local minimum receives a separate encounter record/window. `maxPublishedEncountersPerPair` bounds output; if the budget is exceeded the status reports incomplete/multiple-minima overflow rather than silently keeping only the globally smallest event.

## Encounter identity and record lifecycle

A published record contains conceptually:

```text
EncounterRecord
  encounterId: stable u64
  generation: u64
  objectA/objectB: ascending ObjectId
  predictionInterval
  closestApproachInstant
  closestApproachDistanceMeters
  relativeVelocityAtClosestApproach
  quality: coarse | refined | highFidelityValidated
  timeUncertainty
  distanceUncertaintyMeters
  domain/frame context
  dependencyRevisionDigest
  policy/profile revision
  scheduledRefinementWorkId?
  scheduledFidelityWorkId?
  lifecycle: active | stale | retired | failed
```

`EncounterId` is stable for one logical predicted minimum while it is refined under unchanged pair/continuity lineage. Rebuilding after a state-changing dependency revision creates a new generation; if continuity cannot be established, it creates a new ID.

Records are derived data. They never become motion authority.

## Fidelity integration

The encounter system produces/upgrades `FidelityRequirement` signals from document 22. It never calls a propagator switch directly.

A profile defines deterministic escalation thresholds such as:

```text
promotionLeadTime
promotionDistanceMeters
requiredPosition/velocity error
requiresNumericalIntegration
requiresEncounterRefinement
```

The scheduled promotion instant is early enough that the selected higher-fidelity model can be active before the final refinement interval begins. If the prediction uncertainty is larger than the promotion margin, promotion occurs earlier rather than waiting for nominal closest approach.

After the encounter window, the encounter requirement expires and normal document-22 demotion/hysteresis rules apply.

The TypeScript facade exposes the integration boundary without exposing propagation authority mutation:

```text
scheduleEncounterMaintenance(input)
scheduleEncounterFidelity(input)
encounterSchedulingStatus()
assessEncounterMutualCoupling(input)
mergeEncounterCouplingWindows(proposals, groupLimit?)
```

Maintenance and refinement calls create deterministic scheduled work. Fidelity scheduling creates a semantic requirement with `validFrom` and `reevaluateBy`, then requests it through the Fidelity Manager at the scheduled transition instant. Encounter code does not select or switch a propagator directly.

## Coupled N-body integration trigger

An encounter requests `requiresMutualCoupling` only when the configured physical criterion predicts that independent prescribed-source propagation cannot meet the encounter error budget.

The initial criterion evaluates, for each member candidate over the interaction window:

- mutual Newtonian acceleration from available `mu`/mass;
- estimated velocity/position perturbation over the window;
- required encounter position/velocity error budget;
- configured nearby gravity contributors.

If the conservative estimated mutual perturbation exceeds a configured fraction of the allowed error budget, the requirement requests a coupled group under document 21.

Membership is the minimal deterministic participant set needed to satisfy that budget, ordered by `ObjectId` and bounded by document 21's group limit. Multi-body overlapping encounter windows may merge proposed membership. Failure to fit/construct a required group is explicit.

Mass alone never triggers coupling without the error/interaction criterion.

## Invalidation and rebuilding

Encounter records/windows/index entries depend on:

- both motion segment/revision identities;
- relevant physical property/`mu` revisions;
- frame/provider/source revisions;
- maneuver/force discontinuity revisions;
- encounter policy/profile revision;
- coupled/numerical configuration revisions where used.

A change effective at exact `T` invalidates affected prediction intervals intersecting `[T,+∞)`. Dependency indexes map object/source/policy revisions to bound/candidate/encounter records.

Stale scheduled refinement/fidelity work carries the old generation/digest and is retired by document 22 before execution. Rebuild is scheduled in bounded batches; there is no mandatory global synchronous recomputation.

## Public API

The TypeScript facade exposes read-only capabilities equivalent to:

```text
getEncounter(encounterId)
listUpcomingEncounters({ objectId?, from, to, quality? })
getEncounterCoverage(profile/domain?)
getEncounterDiagnostics(encounterId)
registerEncounter(record, dependencyRevisions?)
enqueueEncounterRebuild(records)
rebuildEncounters(maxItems?)
encounterPerformanceDiagnostics()
```

Results contain stable semantic records, revisions/quality and physical metrics. They do not expose BVH nodes, C++ pointers, cache addresses or mutable queue internals.

## Determinism and parity

Native and WASM must match exactly for:

- policy resolution;
- canonical pair ordering;
- broad-phase candidate membership for the same normalized floating inputs/tolerance rules;
- encounter IDs/generations;
- refine/reject/escalate decisions;
- scheduled work identities/times after exact-time quantization;
- stale/invalidation lifecycle outcomes.

Closest-approach continuous state/distance is tolerance compared using solver/model-owned error bounds; bitwise floating parity is not required.

## Performance instrumentation

Required counters include:

- indexed objects/bounds by domain/window;
- BVH overlap tests;
- candidate pairs after deduplication;
- coarse rejects;
- refinement intervals/solver evaluations;
- active/stale encounter records;
- invalidations/rebuild counts;
- scheduled maintenance/refinement work;
- incomplete-horizon/work-budget events.

Regression tests must include a large quiet population where refined work is proportional to actual overlapping candidates, not `N²`, plus a spacecraft crossing a dense indexed population where only spatial/temporal neighbors reach refinement.

## Validation contract

Implementation must include deterministic cases for:

1. impossible/non-overlapping pair rejected by broad phase;
2. known linear crossing closest approach;
3. two-body orbital near pass;
4. high-speed flyby;
5. multiple minima over a long interval;
6. candidate split across motion-segment boundary;
7. maneuver/state revision invalidating and replacing a prediction;
8. fidelity promotion before the refinement/encounter window and demotion eligibility after it;
9. mutually significant encounter requesting a coupled group;
10. thousands of quiet objects avoiding quadratic refined work;
11. native/WASM discrete parity and tolerance-defined continuous parity.

## Follow-up implementation decomposition

Implementation should be split into issues for:

1. encounter policy/profile and encounter-record primitives;
2. encounter domains, conservative swept bounds and spatial broad phase;
3. coarse Hermite and refined closest-approach solvers;
4. event/Fidelity/coupled-group scheduling integration;
5. dependency-indexed invalidation, public queries, parity and scaling tests.
