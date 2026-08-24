# 25 — Active Spacecraft Thrust, Mass Flow, and Maneuver Execution

## Status and scope

This document records the architecture decided by Architecture issue #119. It defines engine-level instantaneous impulses, finite-duration thrust, thrust direction/frame semantics, prescribed attitude dependencies, time-varying physical mass, maneuver identity/editing, exact event integration, and transition back to ballistic motion.

It builds on documents 12–15, 21 and 22. A maneuver is caller-authored physical input; resulting motion remains OrbitEngine authority. Thrust composes with the same numerical force/mass system as gravity and other configured physical forces.

The 2026-08-24 clarification in this document makes the maneuver-to-motion-authority integration contract normative. In particular it defines how future Fidelity requirements are published without early promotion, how successor authorities are constructed from exact handoff state, how thrust/mass-flow configuration reaches numerical and coupled authorities, which mutable structures form one atomic commit, and how failed transitions roll back.

It does not define game propulsion modules, fuel inventories, cargo, crew, missions, automatic guidance/trajectory optimization, atmospheric aerodynamics, rotational dynamics, or renderer/UI controls.

## Normative ownership and invariants

- `ManeuverManager` owns maneuver intent, identity, revision, schedule and lifecycle. It does not choose a propagation model and does not construct or install a successor `MotionAuthority` directly.
- The Fidelity/model-switch layer owns selection of the cheapest configured authority that satisfies the effective physical requirements.
- A state-changing maneuver supplies an exact canonical handoff plus physical capability/configuration requirements to that layer; it never bypasses it with a private maneuver propagator.
- A successor authority is constructed from the exact handoff state at the transition instant. A prebuilt model anchored at another instant is not a valid substitute.
- Numerical thrust and mass flow are typed portable force/mass configuration. No arbitrary JavaScript derivative callback is authoritative.
- One committed instant has one coherent authority, registry record, query binding, Fidelity state, reference status and physical mass history. Mixed partially updated views are forbidden.
- Camera, renderer, LOD, UI and game state never participate in maneuver physics or authority selection.

## Maneuver identity and lifecycle

V1 has two maneuver kinds:

- exact-time `ImpulseManeuver`;
- exact-interval `FiniteBurnManeuver`.

Every maneuver has a stable non-reused engine-scoped `ManeuverId`, revision, object identity and lifecycle:

```text
scheduled | active | completed | cancelled | failed | stale
```

Updating a future maneuver retains its ID and increments revision. Completed/cancelled IDs are not recycled. Overlapping finite burns for one object are rejected in v1. Multiple impulses at the same exact instant are allowed and execute in ascending `ManeuverId` order.

Ordinary insert/update/cancel operations are future-only relative to committed `currentTime`. Rewind/history rewrite is outside v1.

## Exact impulse maneuver

An impulse is a physical delta velocity at exact `SimulationInstant T`:

```text
ImpulseManeuver
  id/revision/objectId
  instant: SimulationInstant
  deltaVelocity: Vec3 m/s
  frame: FrameId
```

At `T`, the vector is transformed geometrically into the canonical handoff frame. Position is preserved. Same-time impulses are accumulated in ascending `ManeuverId` order in the `physicalChange` phase.

The resulting post-impulse state is not installed directly. It becomes the handoff input to the ordinary authority-transition path defined below. The selected successor may have the same model kind as the predecessor, but it must be freshly anchored/configured from the post-impulse state. A reference-ephemeris candidate is ineligible after an impulse changes state.

Impulses do not consume mass implicitly.

## Finite-burn program and stages

A finite burn is a non-empty exact interval `[start,end)` with 1–64 ordered piecewise-constant stages. Each stage has exact start/end instants and normalized physical configuration:

```text
FiniteBurnStage
  interval [start,end)
  forceMagnitudeNewtons
  throttle                // [0,1]
  direction
  massFlowSpecification
```

Stage boundaries are hard numerical/event boundaries. Numerical integration may not step across them.

Throttle scales both effective thrust and associated mass flow. Force is non-negative and all scalar inputs are finite. Zero-force/zero-flow stages are allowed and do not by themselves constitute physical divergence.

## Thrust direction and attitude

V1 supports two primitive direction forms.

### Reference-frame direction

```text
ReferenceFrameDirection
  frameId
  unitVector
```

The vector is transformed to the active numerical integration frame at every `NumericalSampleTime` using document-14 same-epoch transforms.

### Body-frame direction

```text
BodyFrameDirection
  unitVectorBody
  attitudeSourceId/revision
```

The translational integrator samples the prescribed attitude at the same numerical time used for force evaluation. Missing, stale or invalid attitude is an explicit execution failure. Rotational dynamics are not implied by body-frame thrust.

Velocity-relative, LVLH, target-pointing and guidance laws remain planner/controller responsibilities and are not hidden integrator callbacks.

## Engine performance and mass flow

Public physical input supports three explicit variants, normalized to SI in the portable core:

1. force + direct non-negative mass-flow rate;
2. force + positive effective exhaust velocity;
3. force + positive specific impulse.

Specific impulse uses:

```text
g0 = 9.80665 m/s²
ve = Isp * g0
massFlow = |F| / ve
```

The engine models physical mass only, not fuel-tank/game inventories.

## Physical mass authority

While finite thrust is active, numerical propagation owns one integrated physical mass history. Initial burn mass is the authoritative physical mass at the exact numerical-handoff instant.

A finite burn may declare positive `minimumMassKilograms`. The engine truncates execution at the latest exact nanosecond for which integrated mass remains at or above that minimum within the owned mass tolerance. It never clamps through an invalid mass state.

At every stage boundary, burn end or minimum-mass termination, the exact carried mass is part of the canonical successor handoff. Post-burn propagation continues from that mass; no earlier registry/game value may overwrite it.

## Portable numerical force configuration

`NumericalMotion` and coupled numerical authorities must accept an immutable, backend-neutral typed force/mass configuration rather than requiring callers to manufacture a special maneuver-specific model outside the numerical architecture.

Conceptually the configuration contains:

```text
NumericalForceConfiguration
  ordered deterministic physical providers
  provider/configuration revisions
  frame/source dependencies
  integratedMassConfiguration?
```

A finite-burn stage contributes one typed maneuver-thrust provider configuration containing at least:

```text
ManeuverThrustProviderConfiguration
  maneuverId/revision
  stageIndex
  exact stage interval
  normalized effective thrust
  direction + frame/attitude dependencies
  normalized mass-flow semantics
  minimumMassKilograms?
  provider/configuration revision
```

The configured gravity and other physical providers are preserved and composed with thrust. Adding thrust must never replace or disable gravity implicitly.

For a coupled authority, thrust is member-specific external force configuration for the thrusting member while mutual gravity remains group-owned. The coupled successor is prepared/committed at group scope when group membership or authority requires it; no member may be partially switched out of the group.

Existing convenience fields such as a single gravity source or constant acceleration may remain compatibility inputs, but they must normalize into the same deterministic force-configuration identity used for authority construction and parity.

## Fidelity requirement publication without early promotion

Scheduling a future finite burn publishes its Fidelity intent immediately, but publication and activation are distinct operations.

The maneuver-owned signal is keyed by maneuver identity/revision and contains, for the interval that actually requires thrust/mass integration:

```text
requiresNumericalIntegration = true
requiresContinuousThrust = true
validFrom = exact first stage instant that can change thrust/mass state
reason includes maneuver identity/revision
```

A future signal is stored and observable before `validFrom`, but it does not participate in the effective requirement and must not trigger an authority switch before `validFrom` solely because it was registered early.

The Fidelity Manager therefore evaluates requirements against the query/transition instant. Signals with `validFrom > now` are future requirements, not active requirements. Their earliest activation is eligible for `nextReevaluation` diagnostics/scheduling.

Burn-start/stage scheduled work guarantees reevaluation at the exact activation instant. If some independent requirement has already promoted the object to numerical authority, the maneuver simply reuses that fact; the maneuver itself still may not cause an earlier switch.

At the exact burn end or minimum-mass termination, the continuous-thrust requirement is retired atomically with the thrust-removal handoff. Its removal does not authorize immediate analytical demotion; the engine first commits a numerical ballistic successor and then ordinary Fidelity dwell/hysteresis/representability rules govern any later demotion.

A finite burn whose leading stages have zero effective thrust and zero effective mass flow does not require premature divergence merely because its lifecycle has started. Numerical/thrust authority activation begins at the first stage that can change authoritative translational or mass state.

## Dynamic authority-candidate construction

Static preconstructed `PropagationModel` candidates are insufficient for a state-changing event because numerical/analytical successors must be anchored at the exact post-event state and must include the active force/mass configuration.

The Fidelity/model-switch layer therefore owns a deterministic candidate-construction boundary. An implementation may name it differently, but it must have semantics equivalent to:

```text
AuthorityTransitionRequest
  objectId
  instant
  canonicalHandoffState
  authoritativeMass?
  effectiveFidelityRequirement
  currentAuthoritySnapshot
  activePhysicalForceConfiguration
  dependency/revision snapshot
  reason

AuthorityCandidateFactory(request)
  -> prepared successor authority/model/configuration
```

The factory is engine-internal/backend-neutral orchestration, not a per-integrator-stage user callback. For numerical candidates it builds a `NumericalMotion`/coupled successor anchored at `request.instant`, carrying the exact handoff state/mass and a deterministic force-configuration revision. For analytical candidates it builds the corresponding exact-state successor under document 15.

Candidate identity must include the resulting configuration revision/digest, not only a broad candidate ID. Changing a burn stage or removing thrust therefore forces an exact reconfiguration even when the selected model kind remains `numerical`.

Candidate preparation is side-effect free with respect to committed simulation state. It may allocate temporary model/configuration objects and validate them, but installation occurs only through the timestamp transaction.

## Exact timestamp transaction for maneuvers

All maneuver-induced state changes use the document-22 timestamp transaction and canonical phase order.

### `boundary`

At exact `T`:

- identify the non-stale maneuver generation;
- stage lifecycle/stage-index changes;
- stage activation/deactivation of the maneuver Fidelity signal and typed force configuration;
- establish hard numerical boundary semantics;
- do not yet expose a new committed authority.

### `physicalChange`

- evaluate the canonical pre-event state from the committed authority;
- apply same-time impulses in canonical order to a staged handoff;
- apply other same-time physical changes in their documented order;
- do not mutate the live `MotionAuthority` segment list yet.

### `authorityTransition`

Using the final staged handoff from `physicalChange`:

1. evaluate the effective Fidelity requirement at `T`;
2. select the satisfying authority kind/configuration through the Fidelity Manager;
3. construct the exact successor through the candidate factory;
4. include the active maneuver thrust/mass configuration when required;
5. validate frame/source/attitude/mass dependencies and switch tolerances;
6. for coupled authority, prepare the complete affected group transition;
7. stage the new motion segment/configuration and carried physical mass;
8. stage one-way reference divergence if this instant contains the first actual maneuver state change.

Only after all required work at `T` succeeds may the transaction commit.

### `predictionMaintenance` and `observation`

Invalidation/rebuild work sees the newly committed revision lineage only after the authority transaction is valid. Observation callbacks/diagnostics never see a half-transitioned object.

## Atomic motion commit bundle

The following state is one logical commit unit for a maneuver-induced transition:

- `MotionAuthority` segment/configuration history;
- `ObjectRegistry` canonical state and `MotionMetadata`;
- registry `referenceStatus`;
- `ObjectStateQueries` motion-model binding and propagation-frame binding;
- Fidelity Manager current authority/candidate/configuration revision, signal state, `since`, quiet/retry state as applicable;
- authoritative numerical mass state/configuration;
- coupled-group authority/membership state when applicable;
- ManeuverManager lifecycle/runtime stage state;
- generated motion/property/source dependency revisions and invalidation records;
- same-time scheduled work created/replaced/cancelled by the transaction.

Implementation must introduce a staged/prepare-then-commit path (or an equivalent transaction-owned draft) so methods that currently mutate immediately, such as direct `MotionAuthority.switchModel()`/`applyImpulse()` plus separate registry/query updates, are not invoked as independent commits.

`ObjectRegistry`, `MotionAuthority` and `ObjectStateQueries` must agree on model kind, propagation frame, configuration revision, motion revision and exact segment start immediately after commit. State queries must never observe a new registry revision with an old model binding or the reverse.

For an object that was `followingReference`, `referenceStatus` becomes `diverged` in the same commit as the first state-changing impulse or non-zero thrust/mass-flow effect. Merely scheduling a maneuver, publishing a future Fidelity signal, or preparing/promoting for a zero-effect stage does not by itself mark divergence. `diverged` remains one-way.

## Impulse handoff contract

At impulse instant `T`:

1. evaluate committed pre-impulse state;
2. transform/apply all same-time delta-v values in deterministic order;
3. create one post-impulse canonical handoff;
4. request a successor from the Fidelity/model-switch layer using that handoff;
5. reject any successor that would resume the original reference ephemeris;
6. stage authority, registry, query binding and reference divergence together;
7. commit all or none.

This replaces the architectural assumption that `MotionAuthority.applyImpulse()` receives an already constructed successor model from the maneuver subsystem.

## Finite-burn start and stage-boundary contract

At the first state-changing burn stage:

1. activate the maneuver Fidelity requirement at exact `T`;
2. derive the final same-time canonical handoff after physical-change ordering;
3. select/build a numerical or required coupled successor at `T`;
4. compose existing gravity/physical providers with the active maneuver-thrust provider;
5. initialize numerical mass from the authoritative handoff mass;
6. validate attitude/frame/source/provider dependencies;
7. stage lifecycle, authority, registry/query binding and reference divergence;
8. commit atomically.

At each later stage boundary, the current numerical state and integrated mass at exact `T` form a new handoff. A new numerical configuration revision is constructed with the next stage's provider configuration. Dense output/checkpoints from the previous configuration may not cross the boundary.

A stage change is therefore an exact numerical reconfiguration even when the broad Fidelity candidate/model kind remains unchanged.

## Burn end and minimum-mass termination

At requested burn end or deterministic minimum-mass termination:

1. evaluate the exact final numerical state and physical mass;
2. remove the maneuver-thrust provider from the successor force configuration;
3. construct/validate a numerical ballistic successor anchored at that exact state/mass;
4. stage completion/truncation lifecycle and retirement of the continuous-thrust Fidelity signal;
5. commit the ballistic numerical authority and all synchronized registry/query/Fidelity state atomically;
6. only after commit may ordinary Fidelity logic consider later analytical demotion.

The original pre-burn reference future can never resume after divergence.

## Coupled-authority handoff

If the current/effective authority is coupled or `requiresMutualCoupling` is active, maneuver transitions operate on the coupled authority transaction rather than independently on one member.

Member-specific thrust is injected as an external deterministic provider for that member. Exact handoff state/mass for every affected member and the group configuration must validate before commit. If the required group successor cannot be constructed within configured limits, the complete timestamp transaction fails; no member-level fallback or partial switch is allowed.

## Failure and rollback semantics

Candidate construction/validation is preparatory. Until the timestamp commits, temporary authorities, force configurations, mass states, model bindings and revision values are not authoritative.

If any burn/impulse authority transition fails because of missing attitude, invalid mass, unavailable frame/source, unsupported coupled transition, candidate-construction failure, switch-tolerance failure, backend failure or any other timestamp error:

- discard the prepared successor/draft;
- leave the prior `MotionAuthority` and segment history unchanged;
- leave Registry state/motion/reference status unchanged;
- leave StateQueries bound to the prior committed model;
- leave authoritative mass unchanged;
- leave Fidelity installed-authority state unchanged;
- do not commit maneuver lifecycle activation/completion from the failed instant;
- do not commit invalidation derived from a transition that never happened;
- restore/retain due scheduled work according to document-22 transaction rollback;
- leave committed `currentTime` before the failed timestamp.

The pre-published future maneuver/Fidelity intent remains committed because it existed before attempting `T`; on retry it is evaluated again against the same generation unless the caller edits/cancels it. The failed `advanceTo` result exposes deterministic diagnostics. A failed timestamp must not create a partial authoritative `failed` lifecycle record while simultaneously claiming that timestamp did not commit. Terminal edit/cancel/recovery is a subsequent explicit operation.

Minimum-mass termination is not a rollback failure: once its exact safe boundary is determined it is ordinary scheduled boundary/authority work and commits a valid truncated burn.

## Editing, cancellation and invalidation

Updating/cancelling a future maneuver increments its revision/generation and retires stale scheduled work and future Fidelity intent for the replaced generation. The earliest changed instant invalidates affected future:

- motion segments/checkpoints/dense output;
- encounter/collision predictions;
- trajectory plans/search results;
- numerical force/configuration caches;
- scheduled Fidelity/refinement work whose dependency digest contains the old maneuver revision.

Earlier committed history is immutable.

## Public API boundary

Backend-neutral public operations remain equivalent to:

```text
scheduleImpulse(objectId, definition)
scheduleFiniteBurn(objectId, definition)
updateManeuver(maneuverId, replacement)
cancelManeuver(maneuverId)
getManeuver(maneuverId)
listManeuvers({objectId, from?, to?, lifecycle?})
getManeuverStatus(maneuverId)
```

Public values expose exact time, SI physical values, stable IDs, explicit frames and physical diagnostics. They expose no C++ pointers, force-provider handles, integrator stages or arbitrary per-step callbacks.

The candidate factory, transaction draft and portable provider configuration are internal engine contracts unless a future architecture explicitly promotes a subset to public configuration APIs.

## Diagnostics

Read-only status may expose:

- active/upcoming maneuver and stage;
- effective thrust vector/magnitude;
- effective mass-flow rate;
- authoritative physical mass;
- resulting motion/configuration revision;
- current Fidelity requirement/authority;
- execution/truncation/transition failure diagnostics;
- dependency digest.

The TypeScript status facade names these physical values `effectiveThrustVectorNewtons`,
`effectiveThrustMagnitudeNewtons`, `massFlowRateKilogramsPerSecond`, and
`physicalMassKilograms`. They are snapshots from the last committed maneuver boundary;
future intent is not reported as active execution, and a failed/uncommitted timestamp does
not replace the previous committed diagnostics. `effectiveThrustFrame` identifies whether
the vector is expressed in its declared reference frame or the prescribed body frame.

Diagnostics must distinguish an uncommitted failed advance attempt from a committed maneuver lifecycle transition.

## Native/WASM parity

Native and WASM must match exactly for discrete semantics including:

- maneuver IDs/revisions/order;
- schedule validation and overlap rejection;
- normalized engine-performance variants/constants;
- exact stage/impulse/burn/minimum-mass boundaries;
- future-vs-active Fidelity requirement semantics;
- authority candidate/configuration identity;
- reference divergence instant;
- atomic transition success/failure result;
- cancellation/update invalidation identities;
- coupled transition membership/outcome.

Continuous propagated state, frame transforms and integrated mass use feature-owned numerical tolerances rather than unconditional bitwise floating equality.

## Validation contract

Implementation must cover at least:

1. exact inertial-frame impulse delta-v;
2. deterministic same-time impulse ordering;
3. future maneuver signal is observable before start but does not promote authority early;
4. exact promotion/reconfiguration at first state-changing burn stage;
5. reference -> impulse divergence in the same atomic commit;
6. reference -> finite-burn divergence only at first actual state change;
7. constant finite thrust without gravity;
8. finite thrust under central gravity with gravity preserved;
9. all three mass-flow normalization variants and throttle scaling;
10. body-frame thrust with valid prescribed attitude;
11. missing/stale attitude causing full timestamp rollback;
12. exact stage-boundary numerical reconfiguration and carried mass;
13. minimum-mass truncation on the exact ns grid;
14. burn end producing numerical ballistic successor with final mass;
15. later analytical demotion only through ordinary Fidelity validation;
16. Registry/MotionAuthority/StateQueries/Fidelity/referenceStatus revisions agree immediately after commit;
17. failed successor construction leaves all of those structures at the previous committed snapshot;
18. coupled member thrust preserves mutual gravity and commits group transition atomically;
19. edit/cancel invalidates future configuration and retires stale generations;
20. native/WASM discrete parity plus tolerance-defined continuous parity.

## Follow-up implementation decomposition

Implementation remains split into:

1. maneuver/impulse/finite-stage value types, validation and public APIs (#159);
2. portable-core thrust performance normalization, direction evaluation and integrated mass-flow force provider (#160);
3. exact event scheduling, update/cancel and revision invalidation (#161);
4. dynamic successor construction, numerical/coupled force configuration, Fidelity activation and atomic motion-authority handoff around impulses/burns (#162);
5. native/WASM parity plus representative spacecraft thrust/mass regression scenarios (#163).

Issue #162 explicitly owns the internal API extensions required by this clarification. It must not require the ManeuverManager or application caller to preconstruct a successor propagation model.
