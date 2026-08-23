# 22 — Event-Driven Advancement and Fidelity Management

## Status and scope

This document records the architecture decided by Architecture issue #116. It defines OrbitEngine's mutable simulation clock, deterministic event scheduler, exact-time advancement transaction, fidelity requirement model, promotion/demotion policy, time-warp semantics, and revision-aware invalidation.

It builds on documents 12–15 and 21. Numerical propagation remains a local propagation authority; this document decides when mutable simulation work is processed and when fidelity requirements require a different authority/configuration.

It does not define encounter broad phase, collision response, maneuver APIs, trajectory planning, rendering, or a global fixed tick.

## Decisions at a glance

- The engine owns one exact mutable `currentTime: SimulationInstant`.
- `stateAt(T)` remains pure and never advances `currentTime`, drains events, or commits future work.
- Mutable advancement is exposed semantically as `advanceTo(target)` and `advanceBy(duration)` and is monotonic in v1.
- Advancement jumps directly between exact scheduled instants; it never iterates render/game ticks.
- Scheduled work has stable identity, revision/generation, source ownership, exact time, deterministic phase, and deterministic source-local ordering.
- Same-time work is processed as one atomic timestamp transaction. Failure rolls the entire timestamp back and leaves `currentTime` at the previous committed instant.
- Same-time work may schedule more work at the same timestamp; the engine drains it before advancing past that instant, subject to a deterministic cycle budget.
- Fidelity is represented by semantic requirements, not by a public F0–F4 enum and not by a direct propagator selector.
- The Fidelity Manager produces a concrete required fidelity profile from deterministic signals. A separate model-selection step chooses a compatible propagation configuration.
- Promotion/demotion always uses the exact-time motion-switch transaction from document 15; coupled promotion uses document 21.
- Demotion requires representability/error-budget validation plus anti-thrashing hysteresis/dwell rules.
- Time warp only changes the requested target distance; it never authorizes skipping required events.
- Future work is dependency/revision keyed. State-affecting commits invalidate stale scheduled predictions from their exact effective instant.
- Native/WASM must match exact discrete ordering, event identity semantics, promotion/demotion decisions, and failure categories. Floating numerical states remain tolerance-based under document 21.

## Mutable engine clock

The engine owns:

```text
SimulationClock
  currentTime: SimulationInstant
  revision: u64
```

`currentTime` is exact TDB/J2000 time from document 12. It is never a JavaScript `Date`, wall-clock value, frame counter, or binary64 total-seconds accumulator.

V1 mutable time is monotonic. `advanceTo(target)` requires `target >= currentTime`; `advanceBy(duration)` requires a non-negative exact `Duration` and is equivalent to advancing to the exact sum.

A pure query may ask for supported historical/future state without mutating the clock. Mutable rewind is a separate future architecture.

## Scheduled work model

### Identity

Each scheduled item has a stable engine-scoped 64-bit `ScheduledWorkId` that is never reused during an engine instance. IDs are allocated deterministically when a scheduling mutation commits.

A logical source may replace a prediction without changing higher-level source identity by publishing a new generation. Queue identity therefore contains both stable work ID and generation/revision data.

### Normalized record

```text
ScheduledWork
  id: ScheduledWorkId
  generation: u64
  instant: SimulationInstant
  phase: EventPhase
  sourceKind: stable engine enum
  sourceId: stable source-local identity
  sourceOrdinal: u64
  dependencyRevisionDigest
  payloadKind: stable engine enum
  normalized payload/configuration
```

The queue never stores arbitrary JavaScript callbacks as authoritative work.

### Event phases

Same-time ordering uses a small stable semantic phase enum:

1. `boundary` — exact activation/deactivation boundaries required before physical evaluation at the instant;
2. `physicalChange` — impulses and explicit physical state/property/lifecycle mutations;
3. `authorityTransition` — propagation/group/fidelity transitions caused by the resulting physical state;
4. `predictionMaintenance` — encounter/collision/trajectory invalidation and rebuild scheduling;
5. `observation` — read-only diagnostic/publicly observable completion records.

A later subsystem may add payload kinds inside a phase but may not invent an ordering that bypasses these phases without architecture review.

Within one phase the canonical ordering is:

```text
(sourceKind code, sourceId canonical bytes/numeric value, sourceOrdinal, ScheduledWorkId)
```

Container/hash iteration order is never observable.

### Cancellation and replacement

Cancellation is explicit and revisioned. A cancelled item is removed/tombstoned by exact ID+generation. Replacement schedules a new generation and invalidates the prior generation atomically.

Scheduling work in the past relative to committed `currentTime` is rejected. Scheduling at exactly `currentTime` is allowed only while the engine is actively draining that same timestamp transaction; otherwise callers schedule strictly in the future.

## Queue structure and bounds

The semantic queue is ordered by exact `SimulationInstant`; implementation may use a binary heap plus ID index or an equivalent deterministic structure.

Required complexity targets:

- peek/pop next timestamp: O(log N) or better;
- cancel/replace by ID: O(log N) or amortized equivalent with bounded tombstone cleanup;
- no scan of all registered objects to discover the next event.

The core configuration has deterministic safety budgets, initially:

```text
maxScheduledWorkItems = 1_000_000
maxWorkItemsPerTimestamp = 4096
maxTimestampTransactionsPerAdvance = 1_000_000
```

These are guardrails, not physics tolerances. Exceeding them returns an explicit overload/cycle error; the engine never silently drops work.

## Atomic timestamp transaction

For a next due instant `T`, advancement creates one transaction snapshot covering all mutable engine structures that may be changed by work at `T`.

Conceptually:

```text
pre-transaction committed state
  -> evaluate required pre-event states at T
  -> drain all due same-time work in phase/order sequence
  -> stage new motion/property/lifecycle revisions
  -> stage queue cancellations/new work
  -> stage invalidation/rebuild requests
  -> validate all invariants
  -> commit atomically
```

If any item fails validation or execution:

- none of the staged mutations at `T` commit;
- no newly scheduled same-time/future work from the failed transaction survives;
- consumed queue items are restored logically;
- `currentTime` remains at the previous committed instant;
- the caller receives the failing work identity/category and deterministic error;
- diagnostic failure data may be emitted outside authoritative state.

This chooses timestamp-level atomicity over partially committing earlier same-time events, avoiding order-dependent half-applied physical states.

After a successful timestamp commit, `currentTime = T` and the clock revision increments.

## Same-time draining

Work executed at `T` may stage additional work for `T`. The newly created work is inserted into the remaining same-time ordered set and is processed before the transaction can commit.

A newly created item may not target an earlier phase than the phase currently being processed. Attempting to do so is a deterministic scheduling error because it would imply retroactive reordering inside the timestamp.

The `maxWorkItemsPerTimestamp` budget prevents infinite same-time scheduling cycles. Exceeding it fails and rolls back the entire timestamp transaction.

## Advancement loop

`advanceTo(target)` behaves semantically as:

```text
while currentTime < target:
    T = earliest valid scheduled instant <= target
    if no such T:
        currentTime = target
        commit clock-only advancement
        return reachedTarget

    processTimestampTransaction(T)
    if transaction fails:
        return failedAt(T)

return reachedTarget
```

Before selecting an item, stale queue generations whose dependency revisions no longer match are retired without executing their payload. Their owning subsystem may schedule replacement work through the invalidation/rebuild mechanism.

Advancing to a target exactly equal to the next event instant processes all work at that instant before returning.

Caller partitioning is semantically irrelevant: absent external interventions between calls, `advanceTo(T2)` must produce the same committed discrete state as `advanceTo(T1); advanceTo(T2)`.

## Event-neutral state evaluation

During a timestamp transaction, propagators evaluate canonical state at exact `T` using the normal state-at-time contract and the pre-transaction authority valid up to the boundary.

Internal DOP853 stage samples remain numerical implementation details. They are not scheduled events.

An event-induced physical mutation at `T` yields the post-event canonical handoff used to start the successor segment/group authority at `T` under documents 15 and 21.

## Fidelity requirements

The provisional F0–F4 labels remain documentation shorthand only. The stable architectural contract is a semantic requirement profile:

```text
FidelityRequirement
  maxPositionErrorMeters?
  maxVelocityErrorMetersPerSecond?
  requiresPerturbations: bool
  requiresNumericalIntegration: bool
  requiresMutualCoupling: bool
  requiresContinuousThrust: bool
  requiresEncounterRefinement: bool
  requiresCollisionPrecision: bool
  requiredGravitySources / source-policy revision
  validFrom / reevaluateBy
  reason set
```

Requirements combine monotonically: the effective profile is the strongest requirement from all active signals. One requirement cannot erase a stronger independent requirement.

The profile says what accuracy/interactions are required; it does not name `referenceEphemeris`, `twoBodyAnalytical`, `numerical`, or a concrete coupled group.

## Fidelity Manager inputs

The manager consumes deterministic engine-level signals only:

- scheduled encounter/refinement records;
- collision relevance/contact windows;
- active maneuver/thrust state;
- requested physical error budgets;
- explicit engine interaction policy;
- proximity/relative-dynamics metrics already produced by physical subsystems;
- concrete gravity-source requirements;
- an optional caller-supplied **minimum physical fidelity requirement**.

Rendering focus, zoom, marker/sphere LOD, camera state, UI selection, faction, ownership, mission priority, and economic value are not implicit fidelity signals.

If a consumer wants more simulation accuracy for a selected object it must request that explicitly through the physical-fidelity API; selection itself has no effect.

## Model/configuration selection

A deterministic selector maps the current fidelity requirement and available valid authorities/configurations to candidate propagation choices.

Selection priority is semantic rather than type-based:

1. preserve current authority if it already satisfies the requirement;
2. otherwise choose the cheapest configured candidate proven to satisfy the requirement;
3. if mutual response is required, construct/propose a bounded coupled authority under document 21;
4. if no candidate can satisfy the requirement, fail the fidelity transition rather than silently downgrade accuracy.

Automatic source discovery may propose gravity sets or coupled membership, but the installed numerical configuration is always explicit as required by document 21.

## Promotion

Promotion is scheduled early enough by the subsystem that detected the upcoming requirement. At exact promotion instant `T`:

1. evaluate current canonical state at `T`;
2. construct the candidate authority/configuration;
3. validate dependencies/validity/error contract;
4. perform the exact-time continuity transaction from document 15 or coupled-entry transaction from document 21;
5. commit new authority and fidelity state atomically;
6. increment relevant revisions and invalidate derived future work.

Failure leaves the old authority unchanged and reports that the requested fidelity could not be met.

## Demotion and anti-thrashing

Demotion is never triggered merely because a high-fidelity signal disappeared at one sample instant.

A candidate demotion requires all of:

- no active requirement that needs the current high-cost capability;
- a minimum high-fidelity dwell time of 60 exact simulation seconds since the last promotion unless explicitly overridden by subsystem configuration;
- a quiet-window/hysteresis margin supplied by the originating policy (for encounter distance/time thresholds, the exit threshold must be looser than the entry threshold);
- candidate handoff continuity;
- deterministic representability/error validation over the declared acceptance horizon from document 15;
- preservation of permanent divergence semantics.

If validation fails, the current authority remains active and a later reevaluation is scheduled. Repeated failed demotions must use bounded backoff rather than retrying every render/game frame.

The 60-second default is policy, not a universal physical constant, and may be overridden by normalized engine configuration when a subsystem requires another dwell interval.

## Fidelity state and diagnostics

Per object/group the engine retains derived read-only fidelity diagnostics:

```text
FidelityStatus
  effectiveRequirement
  currentAuthorityKind/configRevision
  since: SimulationInstant
  reasons[]
  nextReevaluation?
  lastTransitionResult?
```

This state is observable but not a backdoor for mutating backend internals.

## Invalidation and rebuild

Every derived prediction/work item declares dependency revision identity, including as applicable:

- motion segment/group revision;
- object physical-property revision;
- reference/ephemeris source revision;
- frame/provider revision;
- maneuver revision;
- interaction-policy revision;
- encounter/collision subsystem revision.

A state-affecting commit at exact `T` publishes an invalidation record keyed by affected dependency identities and effective interval `[T, +infinity)`.

Owning subsystems use dependency indexes to retire only affected future records where practical. Stale queue work is checked again immediately before execution and cannot run merely because it remained in the heap.

Rebuild work is scheduled and bounded. Invalidation never requires immediate global recomputation of every registered object.

## Time warp

Time warp is expressed only as a farther requested advancement target or repeated larger `advanceBy` durations.

The engine may jump directly between scheduled instants. It may not skip:

- physical state changes;
- maneuver boundaries;
- encounter/fidelity refinement work;
- collision/contact work;
- required lifecycle/property changes.

If huge time warp reaches many events, normal queue budgets apply. The engine returns an explicit overload/failure/stop result rather than dropping events.

Consumers may observe committed timestamp boundaries through a batched advancement result/diagnostic stream. Observation cadence does not change event ordering or propagation.

Encounter maintenance, refinement, fidelity-promotion, and fidelity-expiry work are ordinary scheduled events. A large advancement is partitioned at their exact instants; required encounter coverage is never skipped merely because the caller requested a sparse time warp.

## Public API shape

The TypeScript facade exposes backend-neutral operations equivalent to:

```text
engine.currentTime
engine.advanceTo(target, options?)
engine.advanceBy(duration, options?)
engine.getFidelityStatus(objectId)
engine.setMinimumFidelityRequirement(objectId, requirement | null)
engine.listScheduledWorkDiagnostics(filter?)
```

`advance*` returns structured information including reached instant, whether target was reached, processed timestamp/event counts, and deterministic failure/stop diagnostics.

The public API does not expose queue nodes, C++ pointers, integrator stage state, or mutable event internals.

## Native/WASM parity

Native and WASM must match exactly for:

- exact scheduled instants;
- work IDs/generations;
- same-time phase/order decisions;
- cancellation/replacement outcomes;
- transaction commit/rollback decisions;
- fidelity requirement combination;
- promotion/demotion decisions and reason codes;
- revision/invalidation identities.

Continuous propagated state remains compared using model-owned numerical tolerances. Unconditional bitwise floating-point parity is not required.

## Validation contract

Implementation must include deterministic tests for:

1. `advanceTo(T)` versus partitioned advancement producing identical discrete state;
2. multiple same-time events ordered by phase/source ordering;
3. same-time work scheduling and cancellation;
4. cycle-budget rollback with no partial commit;
5. impulse/model-switch boundary returning post-event state at `T` after commit;
6. failed timestamp transaction restoring queue and mutable state;
7. huge time warp processing all required work;
8. promotion before a scheduled high-fidelity interaction;
9. hysteresis/dwell preventing repeated promote/demote thrashing;
10. failed demotion keeping current authority;
11. state/property revision retiring stale future work;
12. native/WASM parity of discrete outcomes.

Performance tests must demonstrate that a large jump with sparse events scales with scheduled work, not elapsed render/game ticks.

## Follow-up implementation decomposition

Implementation should be split into independent issues for:

1. exact mutable clock and deterministic scheduled-work queue;
2. atomic timestamp transaction and `advanceTo`/`advanceBy` loop;
3. fidelity requirement/status primitives and deterministic manager;
4. propagation/coupled promotion-demotion integration with hysteresis and representability checks;
5. dependency-indexed invalidation/rebuild hooks plus native/WASM parity and performance coverage.

These implementation tasks must preserve the contracts in documents 12–15 and 21 and must not invent encounter/collision-specific algorithms before their architecture is defined.
