# 21 — Numerical Propagation, Force Models, and Coupled N-Body Integration

## Status and scope

This document records the production architecture decided by Architecture issue #115. It completes the `numerical` propagation contract left intentionally open by [04 — Propagation, Fidelity, and Events](04-propagation-fidelity-and-events.md) and [15 — Propagation Contract and Model Switching](15-propagation-contract-and-model-switching.md).

It defines:

- the production adaptive translational integrator;
- error control, dense output, checkpoints, and cache identity;
- deterministic force-provider execution;
- explicit gravity-source semantics;
- a first-class coupled multi-object authority for true mutual interaction;
- numerical frame dynamics;
- time-varying physical mass authority;
- pure `stateAt(T)` behavior and reuse by later mutable event-driven advancement;
- native/WASM determinism and performance constraints.

It does not define an automatic Fidelity Manager, encounter scheduler, collision response, trajectory planner, complete maneuver API, reference-ephemeris import, rendering, or a global simulation tick.

The contracts in documents 12–15 remain authoritative. In particular, exact `SimulationInstant`, SI/binary64 quantities, stable `ObjectId`, canonical frame-qualified Cartesian state, exact-time motion segments, permanent divergence, and propagate-then-transform semantics are unchanged.

## Decisions at a glance

- Production numerical translation uses **DOP853**, the explicit Dormand–Prince Runge–Kutta 8(5,3) method, with adaptive internal steps and seventh-order dense output.
- Numerical integration remains local to one numerical authority. There is no global numerical clock or browser/render-driven timestep.
- Every normalized numerical configuration carries explicit position/velocity relative and absolute tolerances plus explicit step bounds. There is no universal physics epsilon.
- Accepted integration step endpoints are canonical exact `SimulationInstant` values. Proposed adaptive step sizes are deterministically quantized to the engine's one-nanosecond time grid before an accepted step is attempted.
- DOP853 stage evaluations use an internal continuous sample-time representation relative to the exact step start. Stage times are algorithmic samples, not public simulation instants and never participate in event ordering.
- A numerical authority maintains a target-independent forward integration tape. Query targets are normally answered from dense output inside accepted steps instead of forcing a step boundary at every query time.
- Checkpoints and dense-output records are derived cache only. They are scoped to one exact segment/revision/configuration/dependency identity and never cross a motion-segment boundary.
- Initial production numerical segments are **forward-only from their exact segment anchor**. Historical queries inside the segment are still supported by replaying forward from the anchor/checkpoints; negative integration before the segment anchor is not part of v1.
- Force providers are typed portable-C++ providers or normalized immutable provider data. Arbitrary per-step JavaScript callbacks are not supported.
- Provider execution order is the normalized configuration order and is therefore part of configuration/revision identity.
- Gravity contributors are explicit. The numerical propagator never infers source membership from `ObjectType`.
- For gravity strength, explicit `mu` is authoritative when present. Otherwise supplied mass may be converted using the engine constant `G = 6.67430e-11 m^3 kg^-1 s^-2`. If neither is available, the source is invalid for Newtonian gravity.
- True mutually interacting objects are owned by an explicit **coupled numerical authority**. Mutual interaction is evaluated from one simultaneous stage state rather than through cyclic per-object `stateAt` dependencies.
- Coupled members are always ordered by ascending numeric `ObjectId`; that order defines group state layout and deterministic pair accumulation.
- A v1 coupled group contains at most 32 members. Work inside the group may be O(N²); that bound is local and does not imply Solar-System-wide all-pairs integration.
- Inertial integration in the SSB/ICRS root is the preferred/default numerical path. Translating/rotating integration frames are accepted only with complete `FrameDynamicsSample` data.
- Time-varying mass has one physical authority. When mass flow is integrated as a numerical state component, that component is the physical mass authority for the same numerical segment; it is not a hidden second truth.
- A pure state query may populate/reuse derived numerical cache, but it must not advance `currentTime`, commit events, mutate motion authority, or change public simulation history.
- Native/WASM must match exact public/discrete semantics. Continuous trajectories are compared by documented numerical tolerances; unconditional bitwise floating-point parity is not required.

## Why DOP853

OrbitEngine's high-fidelity numerical use cases are predominantly smooth, non-stiff orbital ODEs with occasional exact discontinuity boundaries: close approaches, perturbed objects, active thrust intervals, and small local N-body systems.

DOP853 is selected because it provides:

- high order for accurate orbital propagation at relatively low derivative-call counts;
- embedded error estimation for adaptive step control;
- efficient shrinkage during close interactions and growth during quiet intervals;
- seventh-order dense output for arbitrary exact-time queries and future event root finding;
- no dependence on a fixed global timestep;
- direct applicability to non-conservative force and mass-flow terms.

The production implementation must use one canonical coefficient table and one documented DOP853 controller implementation derived from the published Hairer/Wanner formulation. Coefficients, stage order, error-estimator arithmetic, and controller branch order are semantic implementation details and must not vary between native and WASM builds.

DOP853 is not symplectic. That is accepted because this numerical model is the local/high-fidelity tool, not the mandatory long-horizon propagator for every stable celestial body. Analytical/reference propagation remains preferred for long quiet spans, and a future specialist symplectic model may be added if evidence shows a distinct long-duration coupled use case.

## Numerical state and exact time

### Segment anchor

Every numerical motion segment begins with an exact canonical handoff:

```text
NumericalSegmentAnchor
  epoch: exact SimulationInstant
  propagationFrame: ReferenceFrameId
  position: Vec3<double> metres
  velocity: Vec3<double> metres/second
  optional physical mass: double kilograms
```

The anchor is immutable for that segment revision. No checkpoint or dense-output record may be reused across the segment start/end boundary.

### Integration state

For one object without active mass integration:

```text
y = [rx, ry, rz, vx, vy, vz]
```

When one coherent integrated mass authority is active:

```text
y = [rx, ry, rz, vx, vy, vz, mass]
```

For a coupled authority, member blocks are concatenated in ascending numeric `ObjectId` order. A member's optional mass component is present only when that member's mass authority is integrated by the group.

### Step endpoints

The adaptive controller may propose a binary64 step size, but every attempted accepted-step endpoint is mapped to an exact `SimulationInstant` by quantizing the proposed duration to integer nanoseconds.

Rules:

- positive forward steps only in v1;
- quantization is deterministic round-to-nearest nanosecond with ties-to-even;
- the result is clamped to the configured `minStep`/`maxStep` and the next exact hard boundary;
- an exact segment/provider/event boundary always wins over ordinary `minStep` clipping so the integrator can land exactly on that boundary;
- if error control requires a step below one nanosecond or below the configured minimum away from a hard boundary, propagation fails with numerical step underflow/non-convergence rather than silently relaxing tolerance.

`minStep`, `maxStep`, and all hard boundaries use exact `Duration`/`SimulationInstant` values. DOP853 arithmetic uses the resulting bounded duration converted to binary64 seconds.

### Internal stage sample time

DOP853 stage abscissae generally do not land on the integer-nanosecond grid. Therefore internal derivative evaluation uses:

```text
NumericalSampleTime
  exactStepStart: SimulationInstant
  offsetSeconds: finite binary64
```

This type is portable-core internal only. It is not a public timestamp, is never persisted as authoritative time, and is never used for event ordering or segment selection.

Any dependency that participates in the numerical hot loop must provide an internal continuous sampler compatible with `NumericalSampleTime`. OEP reference evaluation, analytical propagation dependencies, gravity-source sampling, thrust laws, and frame-dynamics providers may expose such portable-core internal sampling paths. If a dependency can only be evaluated at public integer-nanosecond instants and cannot provide the required continuous sample semantics, it cannot be installed as a numerical hot-loop dependency.

Canonical checkpoints, public query results, model switches, impulses, and event boundaries remain exact `SimulationInstant` values.

## Error control

### Required normalized configuration

The portable core receives concrete values for:

```text
relativeTolerance
positionAbsoluteToleranceMeters
velocityAbsoluteToleranceMetersPerSecond
massAbsoluteToleranceKilograms   // required only when mass is integrated
minStep
maxStep
checkpointStrideAcceptedSteps
maxCheckpointCount
maxDenseStepCount
maxAcceptedStepsPerExtension
maxRejectedStepsPerExtension
```

All tolerances must be finite and strictly positive. Step/budget values must be finite positive validated values with `maxStep >= minStep >= 1 ns`.

The TypeScript layer may provide convenience presets, but presets are expanded before entering the core. The core never relies on an implicit global epsilon or hidden backend-specific defaults.

### Scaling and acceptance

For every candidate step, each translational component is scaled by its quantity-specific absolute tolerance plus the common relative tolerance:

```text
position scale_i = positionAbsTol + relativeTol * max(abs(r_old_i), abs(r_new_i))
velocity scale_i = velocityAbsTol + relativeTol * max(abs(v_old_i), abs(v_new_i))
mass scale       = massAbsTol     + relativeTol * max(abs(m_old),   abs(m_new))
```

The DOP853 embedded 5th/3rd error estimators are normalized with these scales using the canonical DOP853 error-norm arithmetic. A step is accepted exactly when the resulting normalized error measure is finite and `<= 1`.

For coupled groups, error cannot be diluted merely by adding more members. The core computes the normalized DOP853 error contribution for each member block and uses the **maximum member error norm** as the group acceptance value.

A non-finite derivative, candidate state, scale, or error norm fails the step immediately.

### Rejected steps

A rejected step:

- commits no checkpoint, dense record, physical state, mass, motion revision, or engine time;
- reduces the next proposed step using the canonical DOP853 controller;
- is counted against the configured deterministic rejection budget;
- fails clearly if the minimum representable/configured step or rejection budget is exhausted.

Caller query partitioning, render cadence, and previous public query targets are not inputs to the error controller.

## Target-independent forward integration tape

A numerical authority owns a derived forward integration tape beginning at the exact segment anchor.

The tape is extended only as far as necessary to cover requested work, but the accepted-step sequence is not shaped by arbitrary query targets. When a target lies inside the next acceptable step, the core accepts that full step and answers the target through dense output. The step is clipped only by a true hard boundary such as the segment end or a force/mass/frame validity discontinuity.

This rule makes:

- `stateAt(B)`;
- `stateAt(A)` followed by `stateAt(B)`; and
- mutable advancement/query partitioning

use the same numerical path up to ordinary floating-point/backend tolerance instead of forcing different endpoint steps merely because the caller chose different query partitions.

The initial-step estimator is the canonical DOP853/Hairer estimator using the anchor derivative and configured scales. It is capped by `maxStep` and the next hard boundary, never by an arbitrary read-only query target.

## Dense output, checkpoints, and retention

### Dense output

Every accepted DOP853 step may produce the method's seventh-order local dense-output coefficients. Dense output is the normal path for:

- a public exact-time state inside an accepted step;
- batch same-time member extraction from a coupled group;
- future event-function/root evaluation inside the step.

Dense output is valid only inside its owning accepted step and only under the exact cache identity that produced it.

### Checkpoint contents

A checkpoint contains enough data to restart the canonical forward tape without selecting a new integration history:

```text
NumericalCheckpoint
  epoch: exact SimulationInstant
  full y state
  next proposed step duration/controller state
  accepted-step ordinal
  numerical configuration identity
  force configuration identity
  dependency revision vector/digest
  owning segment/group revision identity
```

For a coupled authority the checkpoint contains the complete shared group state, never independently checkpointed member states.

### Cadence and bounded retention

The initial production cache policy is:

- segment anchor: always retained while the segment exists;
- regular checkpoint: every 32 accepted steps;
- maximum retained non-anchor checkpoints: 64;
- maximum retained dense-output step records: 256.

These are cache/performance policy values, not physics semantics. They may later become tunable, but changing retention must not change the documented propagation result beyond the numerical tolerance contract.

When cache limits are exceeded, non-anchor records may be evicted by deterministic/LRU implementation policy. A query into an evicted interval replays forward from the nearest retained valid checkpoint, or from the segment anchor if necessary.

### Cache identity and invalidation

A cache record is reusable only when all of the following match:

- object motion segment identity/revision, or coupled authority identity/revision;
- numerical method/configuration identity;
- ordered force-provider configuration identity;
- gravity-source membership and source-strength policy identity;
- integration-frame/frame-dynamics identity;
- every referenced object/property/source/provider revision relevant to the record interval.

A state-affecting change at exact time `T` invalidates every cached numerical record whose covered interval intersects `[T, +infinity)` for an affected authority. Earlier historical records may remain valid.

No cache record crosses a motion-segment boundary, coupled-group membership revision, provider discontinuity, impulse, or exact mass-authority boundary.

## Force-provider runtime

### Ownership

The derivative hot loop runs entirely in the portable C++ core.

TypeScript supplies validated, normalized, immutable provider definitions and exact activation/validity boundaries. Native and WASM adapters transfer configuration; neither adapter executes physical force callbacks per stage.

Arbitrary JavaScript callbacks in the derivative loop are explicitly out of scope. A future callback mechanism would require separate architecture for re-entrancy, performance, determinism, failure semantics, and native/WASM equivalence.

### Provider contract

Every production provider declares:

```text
provider kind
immutable normalized configuration
exact validity interval(s)
required object properties
required object/source/frame dependencies
required attitude/mass authority, if any
continuous numerical-sample capability
revision/configuration identity
```

At a sample time a provider contributes one or more of:

- translational acceleration;
- physical force that the provider deterministically converts to acceleration using the authoritative mass state;
- mass derivative `dm/dt`.

Provider output must be finite SI binary64. Missing required input is an explicit propagation error.

### Ordering

The provider array order in the normalized numerical configuration is the canonical execution and accumulation order. It is part of configuration identity and may not depend on hash-map/container iteration.

Changing provider membership, order, parameters, validity, dependencies, or required physical properties creates a new configuration/revision and invalidates affected future numerical work from the exact change time onward.

## Gravity-source semantics

### Explicit source set

A single-object numerical gravity provider owns an explicit ordered source set. Higher-level policy/Fidelity systems may generate that set later, but the installed numerical configuration always contains the concrete source membership.

The propagator does not infer gravity from `ObjectType`, hierarchy, collision policy, visual role, or mere object registration.

The canonical source ordering is ascending numeric `ObjectId` regardless of caller container order.

### Gravity strength

For Newtonian point-mass gravity from a configured source:

1. if the source has explicit `mu`, that `mu` is authoritative;
2. otherwise, if the source has supplied physical mass, use `mu = G * mass` with `G = 6.67430e-11 m^3 kg^-1 s^-2`;
3. otherwise registration/evaluation fails because gravity strength is unavailable.

`mu` and mass must be finite and non-negative. An explicit `mu` of zero means the source exerts zero Newtonian gravity. If both `mu` and mass exist, the force model does not average, reconcile, or silently overwrite either property; `mu` wins for gravity.

The fixed `G` value is a deterministic model constant based on the CODATA 2022 recommended numerical value. A future change to that constant is an explicit model/version change, not a silent runtime update.

### Test particles and self-force

Target translational acceleration from Newtonian gravity does not require target mass. Therefore a massless/test-particle target may respond normally to configured gravity sources.

A source never applies Newtonian self-force to the same state slot. In a coupled group, pairwise internal gravity is evaluated directly from the shared stage state.

### Source state at a stage

For a prescribed external gravity source, position is evaluated at the same `NumericalSampleTime` as the target derivative stage using the source's portable continuous sampler.

An external prescribed source is not dynamically affected by the numerical target/group. If mutual response is required, both objects must belong to the same coupled authority.

A source dependency that becomes unavailable or exits validity causes the numerical evaluation to fail at that exact validity boundary; the core does not freeze the last source state or silently remove the source.

## Coupled numerical authority

### Purpose

Mutually interacting bodies cannot be modeled correctly by allowing object A's single-object propagator to query B while B recursively queries A. Such cycles remain invalid.

A coupled numerical authority explicitly owns a bounded set of objects and integrates them simultaneously.

### Identity and public object model

The portable core owns an internal `CoupledAuthorityId` plus a monotonically increasing group revision. This identity is an engine/runtime authority handle, not a game entity and not a replacement for any `ObjectId`.

Normal public state queries remain keyed by each member's stable `ObjectId`. Each member has an ordinary motion segment that references the same coupled authority plus its deterministic member slot.

A v1 group has `2..32` members.

### Canonical member order

Group membership is stored and laid out by ascending numeric `ObjectId`.

This order defines:

- state-vector member blocks;
- provider/member iteration;
- internal gravity pair order;
- batch result extraction;
- group revision/configuration hashing.

Container/hash iteration order is never observable physics semantics.

### Simultaneous derivative evaluation

For each DOP853 stage:

1. materialize the complete candidate stage state for all members;
2. evaluate group-internal mutual interactions from that same stage state;
3. evaluate prescribed external providers/sources at the same `NumericalSampleTime`;
4. accumulate provider contributions in canonical order;
5. produce derivatives for the complete shared state vector.

For pairwise Newtonian internal gravity, unordered member pairs are visited deterministically with `i < j` in canonical member order. Each direction uses the source member's authoritative stage gravity strength. A massless/zero-`mu` member may respond to gravity while exerting none.

The group does not imply that every member must exert gravity. Interaction membership/configuration is explicit.

### Promotion into a group

Promotion at exact time `T` is one atomic authority transaction:

1. evaluate every candidate member's current authority at exactly `T`;
2. transform each handoff state at `T` into the chosen group integration frame;
3. resolve authoritative mass-at-`T` where required;
4. validate group configuration, frame dynamics, provider dependencies, source membership, and no illegal external dependency cycle;
5. build the canonical sorted shared anchor state;
6. verify per-member continuity under the normal switch tolerance;
7. end all replaced member segments at `T` and start coupled-backed segments at `T` atomically.

If any member/configuration fails, no member is partially promoted.

### Demotion/removal

Demotion at exact time `T` evaluates the shared group state once and constructs candidate per-object authorities from each member's canonical state/mass at `T`.

A multi-member transition is atomic. If required continuity/representability validation fails for any requested member, the requested transition is not partially committed.

Removing one member while others remain is represented as an exact-time authority transition:

- old group revision ends at `T`;
- the removed member receives its new authority or is retired after dependency validation;
- remaining members receive a newly anchored group revision at `T` with the new canonical member set.

Destroying/removing a member never leaves a stale slot inside a continuing group. Any instantaneous impulse or property change affecting one member likewise ends the old shared numerical segment/revision at the exact event time and constructs the required successor authority.

### Group revision identity

Group cache/configuration identity includes at least:

- internal authority ID and revision;
- exact segment anchor;
- sorted member IDs and member slots;
- member motion/property/mass revisions;
- integration frame and frame-dynamics revision;
- numerical configuration;
- ordered provider configuration;
- external gravity/source dependency revisions;
- explicit internal interaction configuration.

Any change to these inputs invalidates affected future group cache from the exact change time onward.

## Numerical frame semantics

### Preferred inertial path

The preferred/default integration frame is the canonical SSB/ICRS root, where ordinary inertial equations apply directly.

Another frame may be used only when its numerical configuration explicitly declares the required dynamics and the frame provider can supply them continuously for every internal sample.

### FrameDynamicsSample

Numerical integration in a translating/rotating frame requires an internal continuous sample containing enough data to construct acceleration equations, including as applicable:

```text
orientation between integration frame and inertial root
origin acceleration relative to inertial root
angular velocity
angular acceleration
```

The core normalizes these quantities into the integration-frame coordinates required by the equations of motion.

The numerical derivative then applies the complete required non-inertial terms, including translational-origin acceleration and, for rotating frames, Coriolis, centrifugal, and Euler acceleration.

Document 14's ordinary `RigidStateTransform` remains a same-epoch position/velocity transform and is not treated as sufficient acceleration dynamics.

Missing, non-finite, unsupported, or out-of-validity frame dynamics cause explicit registration/query failure. The core never silently assumes zero origin acceleration, zero angular acceleration, or inertial behavior merely because a frame is described informally as non-rotating.

## Time-varying mass

### Single physical authority

Physical mass may be constant/property-timeline driven or numerically integrated, but there is exactly one authoritative mass value for an object at an instant.

When a numerical segment has active deterministic mass flow, its integrated mass component becomes the object's physical mass authority over that same segment interval. Public/internal `massAt(T)` for that interval reads the numerical authority; no independently mutable hidden mass copy exists.

At segment start, mass is anchored from the previous authoritative mass state at the exact handoff instant. At segment end, the exact-time numerical mass is the handoff value for the successor mass authority.

### Mass flow

Mass derivative contributions are evaluated and accumulated in deterministic provider order.

Rules:

- mass must remain finite and `>= 0`;
- any provider that converts physical force to acceleration by dividing by mass requires strictly positive mass over its validity interval;
- a candidate step producing invalid/negative mass is rejected/fails; the integrator never clamps mass to zero;
- expected depletion/dry-mass boundaries must be represented as exact provider/motion boundaries rather than discovered by stepping through an invalid state;
- external exact-time mass changes create a new mass/motion revision and invalidate future dependent numerical work.

### Maneuver and impulse boundaries

A discontinuous provider or mass-flow change at maneuver start/end is an exact hard boundary. Numerical accepted steps do not straddle it; the numerical configuration/revision changes at that instant.

An instantaneous impulse remains an exact-time state-changing event under document 15. It is never approximated as an enormous continuous force over a tiny integration step.

## Pure state queries and mutable advancement

`stateAt(T)` remains semantically pure:

- `currentTime` is unchanged;
- no event is committed or consumed;
- motion authority/segments are unchanged;
- group membership is unchanged;
- no physical property/mass history is committed merely because the future was queried.

The implementation may populate checkpoints, dense output, and integration work cache because these are derived memoization and not simulation state.

A later event-driven `advanceTo` path may reuse exactly the same validated numerical tape/cache when advancing toward an event or target. Committing an event/property/authority change at exact `T` then invalidates any speculative cached future from `T` onward.

A read-only query may therefore have performance side effects but no physical or temporal side effects.

## Determinism and backend parity

### Exact semantics

Native and WASM must agree exactly on:

- validation and error categories for the same normalized inputs;
- exact segment/checkpoint epochs;
- provider ordering;
- gravity-source ordering/membership;
- coupled member ordering and membership revisions;
- promotion/demotion transaction success for the regression corpus;
- revision/invalidation boundaries;
- exact `ObjectId`, frame ID, time, provider/configuration identifiers and other discrete wire values.

### Floating-point semantics

Bit-identical continuous trajectories are not a blanket requirement across compilers/toolchains.

Production numerical translation units must:

- use binary64 throughout continuous state and DOP853 arithmetic;
- disable unsafe/fast-math transformations;
- disable uncontrolled floating-point contraction/FMA differences where toolchains permit a strict portable setting;
- never depend on unordered-container iteration for summation/order;
- use the same coefficient tables and arithmetic branch ordering in native and WASM.

Internal accepted/rejected adaptive-step sequences are not public wire semantics and need not be bit-identical if toolchain floating behavior differs near an error threshold. Nevertheless, both backends must satisfy the same configured error contract and must agree on success/failure for the committed regression suite. A supported reference case that succeeds on one backend and fails on the other is a parity defect.

Transcendental/libm sensitivity is handled by feature-specific output tolerances, not by weakening exact discrete simulation semantics.

## Performance and scaling contract

### One numerical object

Cost is proportional to DOP853 derivative evaluations times the explicitly configured provider/source count. No work is performed for unrelated registered objects.

### Coupled group

For `N <= 32` members, explicit mutual pairwise gravity is O(N²) per derivative stage. Prescribed external providers/sources add bounded O(N*S) work as configured.

The 32-member v1 cap prevents one coupled authority from silently becoming a global Solar-System integrator. Increasing the cap requires evidence/benchmarking and must preserve bounded local use.

### Coexistence with low-fidelity objects

Thousands or millions of analytical/reference objects may coexist while only a few objects/groups are numerical. Their existence alone does not add numerical force work. Only explicit dependencies/source sets participate.

### Batch queries

A batch same-time query containing several members of the same coupled authority integrates/evaluates that authority once and extracts all requested member states from the shared result.

Dependency states and frame-dynamics samples at one stage should be reused inside the portable core where identity permits.

### Backend crossings

Numerical stages, force evaluation, checkpoints, dense output, and coupled pair loops remain behind one native/WASM call boundary. TypeScript sends normalized configuration and requests state/batch results; it never receives per-stage callbacks.

### Memory

Memory is bounded by the explicit group cap, state dimension, provider configuration, and cache retention limits. Cache eviction may increase recomputation but cannot change authority or physical semantics.

## Validation contract

Implementation must include deterministic portable-core tests and shared backend parity cases.

### Constant acceleration

A no-gravity fixture with constant acceleration must reproduce the analytical polynomial solution over a declared interval. Test both direct endpoint evaluation and dense-output interior queries.

### Two-body comparison

Numerical point-mass gravity must be compared with the production `twoBodyAnalytical` model from the same exact handoff state across circular, eccentric, and hyperbolic fixtures. Tests must declare explicit numerical tolerance configuration and output error budgets.

### Coupled three-body reference

A deterministic equal-mass figure-eight three-body fixture, scaled into SI units, is the canonical first coupled regression. Expected checkpoints/states are generated once using an independent higher-precision reference calculation and committed as test data/provenance.

The regression must verify:

- simultaneous mutual interaction;
- member-order independence at registration followed by canonical `ObjectId` ordering;
- reference state error at declared epochs;
- conservation behavior in the conservative fixture.

### Conservation

For conservative no-thrust fixtures, tests report relative total-energy and angular-momentum drift over a declared interval. These are regression/error-budget checks, not claims that DOP853 is symplectic or exactly conservative.

The initial tight-regression profile should target approximately:

- `relativeTolerance = 1e-12`;
- `positionAbsoluteTolerance = 1e-3 m`;
- `velocityAbsoluteTolerance = 1e-6 m/s`;

with fixture-specific acceptance budgets documented beside the tests. Integrated-mass fixtures must specify their own physically scaled mass absolute tolerance.

### Adaptive convergence

Run the same fixtures with at least two tighter tolerance profiles and confirm state error decreases consistently. Verify explicit failures for minimum-step/budget exhaustion and non-finite derivatives.

### Handoff continuity

Test exact-time:

- analytical -> numerical;
- numerical -> analytical;
- single-object numerical -> coupled numerical;
- coupled numerical -> independent authorities;

with normal document-15 switch continuity checks and no position/velocity jump beyond the declared switch tolerance.

### Query/checkpoint partition independence

Compare direct `stateAt(B)` with sequences such as `stateAt(A)` then `stateAt(B)`, cache eviction/replay, and batch member queries. Results must agree within the numerical contract, while exact epochs/revisions/order remain identical.

### Provider ordering and invalidation

Tests must prove:

- configured provider order is the accumulation order;
- gravity sources are sorted canonically by `ObjectId`;
- provider/source/property revision at exact `T` invalidates only affected future cache;
- no stale checkpoint survives a segment/group revision boundary.

### Time-varying mass

A deterministic thrust/mass-flow fixture must verify integrated `massAt(T)`, acceleration from force/mass, exact start/end boundaries, continuity at handoff, rejection of invalid mass, and absence of a second contradictory mass truth.

### Native/WASM parity

Shared scenarios must compare exact discrete results exactly and continuous states using the same feature-specific tolerances. The parity suite includes at least constant acceleration, two-body gravity, the three-body coupled fixture, force ordering, promotion/demotion, and integrated mass.

## Rejected alternatives

### Global fixed-step or render-driven integration

Rejected because it makes UI cadence part of physics, scales poorly during time warp, and violates OrbitEngine's event-driven architecture.

### One global adaptive N-body integration

Rejected because most registered Solar-System objects should remain cheap reference/analytical objects. Numerical interaction must be explicit and local.

### Cyclic single-object gravity dependencies

Rejected because recursive `stateAt` cycles do not represent simultaneous coupled dynamics and break the dependency graph contract.

### Fixed-step symplectic method as the sole production numerical integrator

Rejected for v1 because active thrust, exact discontinuity boundaries, and rapidly changing close-approach error requirements benefit from adaptive non-conservative integration. A specialist symplectic model may be added later for a separately demonstrated long-duration use case.

### Lower-order RK45 as the production default

Rejected because DOP853 provides higher-order accuracy and dense output well suited to OrbitEngine's tight local orbital work at comparable architectural complexity.

### Implicit stiff solver as the production default

Rejected because the primary target problems are non-stiff orbital dynamics. Radau/BDF-class methods add solve/Jacobian complexity without current evidence that stiffness dominates production workloads.

### Per-step JavaScript force callbacks

Rejected because they create excessive backend crossings and make native/WASM determinism, re-entrancy, and failure semantics substantially harder.

### Query-target-clipped integration steps

Rejected because caller query partitioning would alter the accepted-step sequence and make cache reuse/partition independence weaker. Dense output exists specifically to avoid making every query a physical integration boundary.

### Hidden integrated mass separate from object mass

Rejected because force evaluation and public physical state could disagree about the object's mass.

## Implementation decomposition

This architecture should be realized through separate Implementation issues for at least:

1. portable DOP853 integrator, error control, exact-time step endpoints, dense output, checkpoints, and deterministic cache tape;
2. typed deterministic force-provider runtime plus Newtonian gravity-source handling;
3. `numerical` motion-segment integration with engine-owned state queries, invalidation, and physical mass authority;
4. coupled numerical authority, promotion/demotion/member lifecycle, and shared batch evaluation;
5. native/WASM/TypeScript configuration and batch API wiring plus full parity/regression coverage.

Implementation work must not substitute a different integrator family, allow cyclic single-object coupling, add JS stage callbacks, or introduce a global numerical tick without returning to Architecture.

## References

- E. Hairer, S. P. Nørsett, G. Wanner, *Solving Ordinary Differential Equations I: Nonstiff Problems*, 2nd ed., Springer, 1993 — DOP853 family/reference formulation.
- Hairer/Wanner DOP853 reference implementation — explicit Runge–Kutta 8(5,3) with dense output of order 7.
- NIST/CODATA 2022 recommended Newtonian gravitational constant: `G = 6.67430(15)e-11 m^3 kg^-1 s^-2`; OrbitEngine pins the numerical model value `6.67430e-11` for deterministic mass-to-`mu` conversion.
