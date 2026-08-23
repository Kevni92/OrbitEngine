# 26 — Trajectory Planning, Transfers, Rendezvous, and Intercepts

## Status and scope

This document records the architecture decided by Architecture issue #120. It defines OrbitEngine's read-only trajectory-planning boundary, initial impulsive Lambert capability, moving-object state acquisition, explicit central-body/frame assumptions, bounded window searches, revision-aware plan results, explicit application through the maneuver system, and later extension boundaries for finite-thrust and multi-leg planning.

It builds on documents 12–15, 20–22 and 25. Planning is derived analysis. A query may consume authoritative state, but it never mutates the simulation clock, registry, motion segments, fidelity state, event queue, or maneuver schedule. A plan becomes authoritative only through a separate explicit application transaction that uses the normal maneuver APIs.

V1 does not implement a mission/economy planner, automatic guidance, a finite-thrust nonlinear optimizer, gravity-assist optimization, live external ephemeris queries, or renderer/UI behavior.

## Decisions at a glance

- The planner is a read-only engine subsystem exposed through the TypeScript facade; performance-sensitive solver/search work lives in the shared portable C++ core.
- V1 production transfer solving uses an Izzo/Lancaster-Blanchard-style nondimensional Lambert formulation with safeguarded iteration in portable C++.
- V1 supports **zero-revolution** Lambert solutions only. Multi-revolution solutions are explicitly deferred, but the request/result model reserves a revolution count and branch metadata so adding them does not require redesigning plan identity.
- Branch selection is explicit: motion sense (`prograde | retrograde`) and path (`shortWay | longWay`). Degenerate/undefined branch geometry is reported, never guessed from object type or caller coordinate orientation.
- Source, target and central-body state are obtained at exact requested instants through the normal authoritative OrbitEngine state-at-time machinery. Planner queries never advance mutable engine time.
- Every V1 Lambert leg names an explicit central `ObjectId`, positive gravitational parameter `mu`, inertial planning frame, departure instant and arrival instant. Object type never selects the central body implicitly.
- Planning geometry is central-body-relative in the selected inertial frame. The central body's authoritative state is sampled at both endpoints and subtracted from source/target positions and velocities.
- Intercept means position coincidence at arrival without required velocity matching. Rendezvous adds an explicit arrival impulse that matches target velocity. Flyby is an intercept-like arrival with no velocity match and optional physical geometry diagnostics; it is not a separate propagation authority.
- Plan results are immutable revision-aware derived records. Their deterministic content/dependency digest is the plan identity; read-only queries do not allocate mutable engine IDs merely to name a result.
- Window searches are bounded deterministic work: coarse departure/time-of-flight sampling followed by bounded local refinement, with explicit work/candidate budgets and physical ranking metrics.
- Applying an impulsive plan first revalidates its dependency digest, then atomically schedules the required #119 maneuver commands. The planner never writes state directly.
- Optional high-fidelity validation propagates a detached analysis trajectory under an explicit numerical force configuration and reports miss/error metrics without altering the original Lambert solution or authoritative motion.
- Native/WASM must match discrete branch selection, candidate ordering, stale/infeasible categories and exact requested instants; continuous solver outputs are compared within solver-owned tolerances.

## Planner ownership and purity

The public conceptual flow is:

```text
authoritative OrbitEngine state
        -> read-only planner request
        -> immutable candidate plan(s)
        -> caller inspects/ranks/selects
        -> explicit apply operation
        -> maneuver scheduling transaction
        -> authoritative future motion
```

The planner may populate ordinary derived caches that are semantically invisible, but a planning query must not:

- change `currentTime`;
- execute scheduled events;
- create/modify motion segments;
- mark an object diverged;
- change fidelity requirements;
- schedule or cancel maneuvers;
- alter object properties/lifecycle;
- make a candidate plan authoritative.

`stateAt(T)` purity from documents 15/21/22 remains unchanged.

## Initial Lambert solver

### Selected algorithm family

V1 uses a portable C++ Lambert implementation based on the Izzo/Lancaster-Blanchard nondimensional formulation. The implementation uses one canonical coefficient/branch convention and a safeguarded root iteration: fast Householder/Newton-family iteration where well-conditioned, with bracketed bisection fallback when convergence or conditioning requires it.

Reasons for this selection:

- handles the ordinary elliptic/hyperbolic zero-revolution domain with one consistent formulation;
- gives explicit branch control;
- has well-known nondimensional variables that avoid unnecessary scale loss across Solar-System distances;
- supports a future multi-revolution extension without replacing the result model;
- is practical to implement identically in native and WASM through the shared core.

A naive application-side universal-variable solver and backend-specific JS/native implementations are rejected because they would duplicate orbital truth and weaken parity.

### V1 branch policy

Every Lambert request declares:

```text
motionSense: prograde | retrograde
path: shortWay | longWay
revolutions: 0
```

`revolutions != 0` is rejected as `unsupportedRevolutionCount` in V1 rather than silently mapped to a zero-revolution solution.

`prograde/retrograde` is defined relative to an explicit planning-plane reference normal supplied by the request or derived from the selected inertial frame's documented reference axis. For public transfer helpers, the reference normal must be explicit in normalized input; the core never infers it from rendering axes.

`shortWay/longWay` selects the transfer-angle family relative to that normal. Near-collinear/antipodal geometry where the requested branch is undefined or numerically singular is reported as a deterministic degenerate-geometry result. The solver does not silently flip branches.

### Solver tolerances and budgets

Normalized solver configuration contains finite validated values for at least:

```text
relativeTimeOfFlightTolerance
velocityToleranceMetersPerSecond
maxIterations
minimumGeometryScaleMeters
```

The package may provide convenience presets, but concrete values reach the core. `maxIterations` is bounded; V1 default policy is 64 root iterations per branch. Non-convergence is explicit.

Continuous output is accepted when the nondimensional time-of-flight residual and reconstructed endpoint state satisfy the configured solver tolerances. Exact bitwise floating equality between backends is not required.

## Planning inputs and state acquisition

### Engine-bound transfer request

A moving-object transfer request contains conceptually:

```text
TransferRequest
  sourceObjectId
  targetObjectId
  centralBodyId
  planningFrameId
  departure: SimulationInstant
  arrival: SimulationInstant
  branch
  purpose: intercept | rendezvous | flyby
  constraints
  solverConfiguration
```

`arrival` must be strictly later than `departure`.

At both endpoints the planner obtains authoritative frame-qualified source, target and central-body state through the same model-neutral state query path used elsewhere. The target may be reference-ephemeris, analytical, numerical, attached or otherwise supported by the ordinary propagation contract.

The planner never asks the application to run a duplicate Kepler propagator to predict target position.

### Pure geometry solver

A lower-level backend-neutral Lambert geometry function may also accept already prepared central-relative endpoint vectors plus `mu`, exact time of flight and branch configuration. It is useful for deterministic reference tests and expert consumers, but it does not bypass the engine-bound moving-target API for ordinary object planning.

Pure geometry inputs are caller data and therefore carry no OrbitEngine object-revision staleness guarantees unless the caller supplies its own provenance.

## Central body, frame and gravitational parameter

V1 Lambert planning is a two-body point-mass approximation around one explicit central object.

Normalized engine-bound input requires:

```text
centralBodyId: ObjectId
mu: positive finite m^3/s^2 resolved from the central object/property contract
planningFrameId: inertial frame valid across the request interval
```

The planner resolves `mu` using the same physical-property semantics as numerical gravity: explicit `mu` is authoritative; otherwise an allowed mass-derived value uses the engine's documented `G`. The resolved value and property revision are captured in the plan dependency digest.

The planning frame must be inertial for the Lambert assumption. Rotating/body-fixed frames are rejected for the core Lambert solve. Consumers may request output vectors transformed into other frames after solving, but that does not change the planning model.

At departure and arrival:

```text
r_source_rel = r_source - r_central
v_source_rel = v_source - v_central
r_target_rel = r_target - r_central
v_target_rel = v_target - v_central
```

all after same-epoch transformation into the planning frame.

The transfer conic is solved from `r_source_rel(departure)` to `r_target_rel(arrival)` under the selected constant `mu`.

This model is invalid when the requested interval/geometry is not reasonably represented by a central two-body approximation. The result always declares this assumption; higher-fidelity validation is the mechanism for measuring its error, not silently changing the Lambert model.

## Candidate and leg result model

A successful candidate is immutable derived data containing conceptually:

```text
TrajectoryPlan
  digest
  purpose
  sourceObjectId
  targetObjectId
  legs[]
  departure
  arrival
  timeOfFlight
  departureStateUsed
  targetArrivalStateUsed
  dependencyDigest
  assumptions
  constraintsEvaluation
  quality
```

The initial V1 leg is:

```text
ImpulsiveLambertLeg
  centralBodyId
  planningFrameId
  muUsed
  branch
  revolutions = 0
  transferDepartureVelocity
  transferArrivalVelocity
  departureDeltaVelocity
  arrivalRelativeVelocity
  arrivalDeltaVelocity?      // present for rendezvous
  totalDeltaV
  conic/periapsis diagnostics
  solver residual/iterations
```

The plan `digest` is a deterministic hash/fingerprint of normalized request semantics, selected solution data and all dependency revision identities. It is not a mutable global allocation and does not make the plan authoritative.

## Intercept, rendezvous and flyby semantics

### Intercept

An intercept candidate reaches the target's predicted position at exact arrival time under the declared Lambert assumptions.

It reports:

- required departure delta-v;
- transfer arrival velocity;
- target arrival velocity;
- arrival relative velocity and speed.

No arrival velocity-matching burn is implied.

### Rendezvous

A rendezvous candidate is an intercept plus an arrival impulse:

```text
deltaV_arrival = v_target_arrival - v_transfer_arrival
```

in the common planning frame at the exact arrival instant.

Total impulsive cost is the sum of departure and arrival delta-v magnitudes unless another explicit physical ranking metric is requested.

### Flyby

A flyby candidate is position-targeted like an intercept but explicitly declares that no arrival velocity match is intended. It may report relative velocity and central-body conic geometry suitable for later flyby analysis. V1 does not optimize a powered/unpowered gravity assist around the target body itself.

## Physical constraints

V1 supports deterministic filters that remain engine-physical rather than game-specific:

- minimum/maximum exact time of flight;
- maximum departure delta-v;
- maximum arrival delta-v for rendezvous;
- maximum total impulsive delta-v;
- allowed explicit central body/frame;
- optional minimum central-body radius clearance;
- source/target/central/frame validity intervals.

Central-body clearance is evaluated from the transfer conic's minimum radius/periapsis where defined. The configured minimum may be derived by the caller from an authoritative physical radius plus a physical margin, but a render/adaptive radius is never used.

V1 does not claim general multi-body collision-free trajectory planning. A candidate that passes central clearance may still be numerically validated or separately checked against encounter/collision systems.

## Dependency identity and stale-plan detection

Every engine-bound plan captures revisions sufficient to determine whether its physical assumptions remain valid. At minimum this includes, as applicable:

- source motion segment/group revision covering departure;
- target motion/source revision covering arrival;
- central-body motion revision at both endpoints;
- source/target/central physical-property revisions used by planning;
- resolved central `mu` revision/value;
- planning-frame/provider revisions;
- ephemeris pack/dataset/source revisions;
- source maneuver-program revision affecting the departure state;
- solver/model version and normalized planner configuration.

Staleness is interval-aware. A later unrelated revision outside the plan's dependency interval need not invalidate the candidate.

Before application, the engine re-resolves the dependency digest. A mismatch returns `stalePlan` with changed dependency identities; the plan is never silently re-solved or applied with updated states.

The caller may explicitly request a new plan after staleness.

## Applying an impulsive plan

Application is a separate mutating operation, conceptually:

```text
applyImpulsivePlan(plan, applyOptions)
```

It is valid only for a plan whose source object is the maneuvered object and whose required maneuver instants are still future-valid under document 25.

Application performs one atomic validation/scheduling transaction:

1. verify the plan digest/dependencies are current;
2. verify the source state/maneuver revision used by the plan still matches;
3. normalize the plan's departure impulse into the normal #119 impulse representation;
4. for rendezvous, normalize the arrival matching impulse as a second scheduled maneuver;
5. validate all maneuver times, frames and overlap/order constraints before any insertion commits;
6. schedule the complete required maneuver set atomically or schedule none.

Intercept/flyby application schedules only the departure impulse unless the caller explicitly adds another physical maneuver outside the plan.

The planner never writes position/velocity directly, never bypasses event ordering, and never marks reference divergence merely because a plan was computed. Divergence occurs only when the scheduled physical maneuver executes.

## Departure/arrival window search

### Search request

Window search is explicit and bounded:

```text
TransferSearchRequest
  sourceObjectId
  targetObjectId
  centralBodyId
  planningFrameId
  departureWindow
  arrivalWindow or timeOfFlightRange
  branchSet
  purpose
  constraints
  rankingMetric
  searchBudget
```

The search domain must be finite.

### Coarse sampling

The planner first evaluates a deterministic coarse lattice over departure time and time of flight (or departure/arrival). Sample instants are generated on the exact nanosecond grid from normalized integer counts/spacing.

Default implementation policy may choose adaptive convenience presets in TypeScript, but the normalized core request contains explicit sample counts. No search has an unbounded implicit resolution.

### Refinement

The best feasible coarse cells are refined with a bounded deterministic local search over the two time variables. Refinement may use bracketed one-dimensional/coordinate minimization or a bounded two-dimensional derivative-free method, but it must preserve exact request-domain bounds and solver work accounting.

The implementation must use one documented canonical refinement strategy; backend-specific optimizers are not allowed.

### Initial work budgets

Normalized budgets include at least:

```text
maxLambertSolves
maxCoarseCells
maxRefinementSeeds
maxRefinementIterationsPerSeed
maxReturnedCandidates
```

Initial production limits should cap a single search to at most 100,000 Lambert solves and 256 returned candidates unless the caller explicitly supplies a lower supported budget. Exceeding the budget produces a structured `budgetExceeded`/partial-coverage diagnostic; work is never silently continued without bound.

### Cancellation

The public async TypeScript search API accepts cancellation (for example an `AbortSignal`). Native/WASM adapters execute search in bounded batches and check cancellation between batches. Cancellation is non-authoritative and cannot alter engine state.

A cancelled search returns `cancelled` plus optional explicitly marked partial diagnostics/candidates only when the caller requested partial results. Completed-search parity does not depend on wall-clock cancellation timing.

## Ranking and candidate ordering

OrbitEngine supplies physical ranking metrics, not mission/economic preferences.

V1 ranking choices include:

```text
minimumTotalDeltaV
minimumDepartureDeltaV
minimumArrivalDeltaV
minimumTimeOfFlight
```

A caller may also request an unranked deterministic candidate set and score it externally.

Ties are ordered deterministically by:

1. primary metric;
2. departure instant;
3. arrival instant;
4. motion-sense code;
5. path code;
6. plan digest.

No hash/container iteration order is observable.

Porkchop-style grid data may be returned as derived numeric samples (times, feasibility, cost metrics, branch), but plotting/UI is outside OrbitEngine.

## High-fidelity numerical validation

A Lambert plan's declared model remains two-body even if it is validated against a richer model.

The planner provides a separate read-only analysis operation conceptually:

```text
validateTrajectoryPlan(plan, numericalValidationConfig)
```

Validation builds a detached analysis trajectory from the plan's exact departure state after applying the planned departure delta-v, then propagates it with the document-21 DOP853 machinery and an explicit force/source configuration through the arrival instant.

This detached analysis:

- does not install a motion authority on the source object;
- does not alter engine time/events/fidelity;
- may reuse immutable source data but has its own derived numerical cache lifetime;
- reports propagated arrival position/velocity, target state, miss distance, relative velocity and integration diagnostics;
- captures the validation configuration/dependency digest separately from the original Lambert plan.

A validation result never silently edits the plan. A caller may reject the candidate or request a new/higher-level planning method based on measured error.

## Finite-thrust extension boundary

Document 25 supplies the physical execution model for finite burns. V1 planning does not attempt to optimize those burns.

The public result model is nevertheless leg-oriented so a later finite-thrust architecture can add a leg kind carrying concepts such as:

- exact coast/burn arc boundaries;
- normalized thrust/mass constraints;
- prescribed/optimized direction representation;
- trajectory nodes/samples;
- path/endpoint constraints;
- objective metrics;
- convergence/KKT or equivalent optimizer diagnostics.

A future optimizer may use multiple shooting, direct collocation or another evidence-backed method, but selecting that algorithm requires separate architecture/spike work. It must produce ordinary #119 maneuver commands for application rather than a hidden propulsion authority.

## Multi-leg and gravity-assist extension boundary

`TrajectoryPlan.legs[]` is ordered and each leg has explicit start/end state, times, frame, central model, assumptions and dependency identity.

Future multi-leg planning may compose Lambert legs and flyby nodes, but a gravity-assist node must explicitly model target-body-relative incoming/outgoing asymptotes, periapsis constraints and powered/unpowered semantics. V1 does not infer or optimize those nodes.

No V1 API assumes there can be only one leg forever; equally, no initial implementation must build a global multi-leg optimizer.

## Public TypeScript surface

The stable facade should expose capabilities equivalent to:

```text
engine.planner.solveLambertGeometry(input)
engine.planner.planTransfer(request)
engine.planner.searchTransfers(request, options?)
engine.planner.checkPlanStaleness(plan)
engine.planner.validateTrajectoryPlan(plan, validationConfig)
engine.planner.applyImpulsivePlan(plan, applyOptions?)
```

Exact naming may follow package conventions, but the semantic split between pure solve, read-only moving-object planning/search/validation and explicit mutating application is mandatory.

The public API exposes no C++ solver pointer, integrator tape, backend-specific callback or mutable cache node.

## Portable-core ownership and backend crossing

The following belong in portable C++:

- Lambert math and branch selection;
- deterministic solver iteration/fallback;
- engine-bound endpoint state preparation where it can use the core registry/frame/state contracts directly;
- bounded search/refinement loops;
- constraint evaluation and deterministic ranking;
- detached numerical validation math.

TypeScript owns normalization/convenience presets, ergonomic async cancellation wiring, result mapping and the public facade.

Large window searches must cross native/WASM boundaries as normalized batch requests/results rather than one JS call per Lambert cell.

## Determinism and parity

Native and WASM must match exactly for:

- normalized request acceptance/rejection;
- branch/revolution interpretation;
- exact departure/arrival instants selected by a completed search;
- feasible/infeasible/stale/error categories;
- candidate ordering/tie breaking;
- dependency digest inputs and application validation decisions;
- which maneuver commands a plan normalizes to.

Continuous values are tolerance-based:

- transfer velocities and delta-v;
- Lambert residuals;
- conic diagnostics;
- numerical-validation miss distances/velocities.

The canonical coefficient tables, branch conventions, iteration order and fallback conditions must be shared by both backends through the portable core.

## Validation contract

Implementation must include at least:

1. published Lambert benchmark cases covering elliptic and hyperbolic zero-revolution solutions;
2. circular coplanar transfer sanity case with expected transfer/delta-v scale;
3. explicit prograde/retrograde and short/long-way branch cases;
4. degenerate near-collinear/antipodal geometry with deterministic errors;
5. moving source/target using ordinary authoritative state queries;
6. intercept reporting non-zero arrival relative velocity without matching burn;
7. rendezvous producing the exact configured arrival-matching impulse;
8. invalid source/target/central/frame/ephemeris validity interval;
9. central-clearance constraint rejection;
10. bounded window search returning deterministic ranked candidates and respecting work limits;
11. stale plan after target motion revision;
12. stale plan after source maneuver-program revision;
13. applying a valid intercept/rendezvous plan schedules normal maneuver commands atomically and does not directly mutate state;
14. computing a plan without applying it changes no authoritative engine state/time;
15. detached numerical validation quantifying a known perturbed miss without changing the Lambert plan;
16. native/WASM parity of discrete results and tolerance-defined continuous outputs.

Window-search performance tests must demonstrate that backend crossings are batched and work is bounded by normalized budgets rather than UI/render cadence.

## Follow-up implementation decomposition

Implementation should be split into reviewable issues for:

1. planner value types, constraints, plan/dependency-digest APIs and read-only subsystem facade;
2. portable zero-revolution Lambert solver with branch handling and benchmark suite;
3. engine-bound moving-source/target intercept/rendezvous/flyby planning and central-frame preparation;
4. bounded departure/time-of-flight search, refinement, physical ranking, cancellation and porkchop-data output;
5. stale-plan revalidation and atomic conversion/application through the maneuver subsystem;
6. detached DOP853 plan validation plus native/WASM parity/performance regressions.

Multi-revolution Lambert, finite-thrust optimization and gravity-assist/multi-leg optimization require separate follow-up architecture/implementation work when demanded by a concrete use case.
