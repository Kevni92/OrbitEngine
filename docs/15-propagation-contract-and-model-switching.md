# 15 — Propagation Contract and Model Switching

## Status and scope

This document records the architecture decided by Architecture issue #11. It defines OrbitEngine's common state-at-time propagation contract, initial propagation-model taxonomy, motion-authority ownership, permanent reference divergence, safe model switching, fidelity separation, numerical-force extension boundary, active-mass semantics, caching/invalidation, dependency rules, and TypeScript/native/WASM ownership.

It builds on:

- [12 — Simulation Time, Units, and Numerical Precision](12-simulation-time-units-and-precision.md);
- [13 — Physical Object and State Model](13-physical-object-and-state-model.md);
- [14 — Reference Frames and Coordinate System](14-reference-frames-and-coordinate-system.md).

The concrete production source contract for `referenceEphemeris` is defined by [20 — Reference Ephemeris Data and Pipeline](20-reference-ephemeris-data-and-pipeline.md).

It does not implement a Kepler solver, numerical integrator, automatic fidelity manager, encounter/collision system, trajectory optimizer, or game propulsion model. Ephemeris acquisition/import and pack generation remain offline tooling concerns governed by document 20; this document defines how the resulting normalized source participates in motion authority.

## Decisions at a glance

- Every live object has exactly one authoritative translational motion source at any public simulation instant.
- Motion authority is represented by exact-time **segments**. A segment owns one model/configuration over a half-open interval `[start, end)`.
- Every model answers the same pure question: produce a canonical geometric `CartesianState` at an exact requested `SimulationInstant` in the model's declared propagation frame.
- Propagation changes time; reference-frame transformation does not. A state-at-time query evaluates motion first and performs any requested frame transform second, at the same exact target instant.
- Initial model kinds are `referenceEphemeris`, `twoBodyAnalytical`, `numerical`, and `attached`. `ObjectType` does not select a model.
- Production `referenceEphemeris` sources use immutable versioned OrbitEngine Ephemeris Pack (OEP) data from document 20; runtime does not contact JPL/NAIF/Horizons or require CSPICE.
- A pack-backed reference source is bounded by the exact intersection of target-series and source-center/frame dependency validity; it never silently extrapolates or falls back to another model.
- Ephemeris source-center hierarchy is independent from physical `centralBody` hierarchy and may use non-selectable source-center frame providers such as planetary-system barycenters.
- Active thrust is numerical propagation plus deterministic force/mass inputs, not a game-specific propagator kind.
- Orbital elements, spline coefficients, integrator histories, numerical checkpoints, and ephemeris handles are model-specific derived/configuration data. Canonical Cartesian state remains the universal handoff representation.
- `followingReference -> diverged` is an atomic, one-way runtime transition. The original ephemeris can remain as provenance/history but never silently regains future authority.
- A propagator switch is atomic at exact time `T`. The new model must reproduce the canonical handoff state within an explicit switch tolerance or the switch is rejected with no authority mutation.
- Demotion to a cheaper model additionally requires that the candidate can satisfy the currently requested fidelity/error budget over the explicitly evaluated acceptance horizon. Failure means keep the current model.
- Propagation model and fidelity are independent: model is *how* motion is computed; fidelity is the required error/interaction detail.
- Numerical force providers are deterministic, composable engine-level physical inputs. Instantaneous impulses are exact-time state changes, not continuous forces.
- Time-varying mass is one explicit physical-property authority queried by propagation; a numerical integrator must not maintain a hidden second spacecraft-mass truth.
- State-affecting changes at `T` invalidate future propagated predictions/checkpoints from `T` onward while earlier history may remain valid.
- The combined object-motion/frame dependency graph is acyclic.
- The portable C++ core owns authoritative motion segments, model execution contracts, switching/divergence transactions, OEP reference evaluation, force ordering, and propagation cache revisions. TypeScript exposes stable high-level operations and does not maintain a second authoritative motion state machine.

## Motion authority and exact-time segments

### One authority at an instant

For one registered object, exactly one translational motion authority answers the canonical state-at-time query at any instant in the object's supported live/history domain.

The authority is modeled conceptually as ordered segments:

```text
MotionSegment
  start: SimulationInstant
  end: SimulationInstant | openEnded
  modelKind: PropagationModelKind
  propagationFrame: ReferenceFrameId
  modelConfiguration: model-specific immutable configuration
  motionRevision: exact discrete revision
  dependencies: explicit object/frame/source/property dependencies
```

Segments are half-open:

```text
[start, end)
```

This makes a switch/event timestamp unambiguous. If an old model is replaced at exact instant `T`, its segment ends at `T` and the new segment begins at `T`.

The old model may be evaluated internally at `T` to construct the transition handoff, but after the transition commits, public authoritative state at `T` belongs to the new segment.

### Same-time event ordering

Document 12 requires all due work at one reached timestamp to be drained deterministically before advancing past it. Therefore a state-changing event at `T` is applied as part of the transition at `T`.

Conceptually:

```text
old authority evaluated at T
        |
state-changing event(s) at T
        |
post-event canonical handoff at T
        |
new authority segment starts at T
```

A public state query performed after that same-time work is committed returns the post-event/new-authority state at `T`.

### History versus mutable advancement

Motion segments may preserve queryable historical authority where the owning model/source supports it. This does not make the mutable simulation clock reversible.

Mutable engine advancement remains monotonic according to document 12. A backward state query is a read-only model capability, not a rewind of event/object state.

## Common state-at-time contract

### Canonical operation

Every translational model implements the semantic equivalent of:

```text
evaluate(object, targetInstant, readOnlyContext) -> CartesianState
```

The result must satisfy:

- `result.epoch == targetInstant` exactly;
- `result.referenceFrame == model.propagationFrame` exactly;
- position is finite SI metres in binary64;
- velocity is finite SI metres/second in binary64;
- state is geometric, not apparent/light-time corrected;
- evaluation does not mutate the engine `currentTime` or event queue;
- evaluation does not require stepping through a global fixed tick sequence.

The model may perform internal numerical/analytical steps as required. Those are algorithmic implementation details and do not become global simulation ticks.

### Propagator declaration

Each installed model/configuration declares at least:

- exact validity interval/domain;
- query direction capability;
- propagation `ReferenceFrameId`;
- supported frame-dynamics assumptions;
- structural and state dependencies;
- required physical properties/sources;
- deterministic configuration/revision identity;
- numerical error/tolerance contract where applicable.

Registration/switching validates those requirements before a model becomes authoritative.

For OEP-backed reference sources, validity includes all source-center/frame dependencies from document 20. Registration must not advertise a wider segment than the loaded pack can actually resolve.

### Direction capability

The common contract supports explicit direction capabilities rather than assuming every model can propagate both ways:

- `forwardOnly` — targets must be at or after the model anchor/start according to its contract;
- `bidirectional` — either temporal direction is supported inside its documented validity domain;
- `bounded` — querying is supported only inside an explicitly declared interval, with direction rules defined by the model.

Expected initial behavior:

- reference ephemeris: bounded and bidirectional inside the selected source's effective validity;
- two-body analytical: bidirectional inside its documented validity/error domain;
- attached: queryable wherever all parent/frame/orientation dependencies are valid;
- numerical: backward evaluation is supported only when the concrete integrator, force inputs, discontinuity history, and mass inputs explicitly guarantee it. It is never assumed automatically.

### Error categories

State-at-time evaluation must distinguish at least:

- target outside model/source validity;
- unsupported temporal direction;
- unsupported propagation-frame dynamics;
- missing/not-live dependency;
- dependency cycle;
- missing required physical property;
- missing/out-of-range ephemeris/orientation/force/mass source;
- invalid/corrupt/unloaded ephemeris pack or missing required shard/source node;
- numerical non-convergence or step failure;
- model representation invalid for the requested state/domain;
- generated non-finite/invalid canonical state.

A failed pure query does not alter the object's active authority or simulation clock.

## Propagation frame contract

### Propagate first, transform second

Document 14 establishes same-epoch frame transformations. Therefore a high-level query for object `O` at target `T` expressed in output frame `F_out` is:

1. active motion authority evaluates `O` at exactly `T` in its propagation frame `F_prop`;
2. frame system evaluates `F_prop -> F_out` at exactly `T`;
3. frame system transforms the canonical state at exactly `T`.

The frame subsystem must never extrapolate a stale state to satisfy a propagation query.

### Frame assumptions are explicit

A model cannot infer dynamics from `ObjectType`, frame name, or informal wording such as “body-centered inertial”.

Every model states which frame dynamics it mathematically supports.

Initial expectations:

- an external/reference source declares the frame in which its source state is normalized and produces canonical state in that frame;
- an OEP source may use a pack-backed non-rotating source-center frame from document 20 when JPL source geometry is naturally relative to a planetary-system barycenter or other non-physical source node;
- a two-body analytical model normally evolves **relative state** in a declared body/central-object-centered non-rotating frame, with explicit central-body state/`mu` dependencies;
- a generic numerical force integration in the SSB/ICRS root can use ordinary inertial equations directly;
- `attached` motion is constant/configured relative to its declared non-root frame and relies on the frame system to generate outward translational/rotational motion.

The physical `centralBody` relation never rewrites an ephemeris source center implicitly. If an importer changes center, it is an explicit normalization operation validated under document 20.

### Numerical integration in non-inertial frames

Numerical integration in a translating or rotating frame is permitted only when the integration configuration has sufficient explicit frame kinematics to construct the correct equations of motion.

A future/internal frame-dynamics sample for such integration must provide, at the exact evaluation instant, the quantities needed by the chosen equations, including as applicable:

- frame-to-root orientation/transform;
- origin acceleration relative to the inertial root;
- angular velocity;
- angular acceleration.

This enables the correct translation, Coriolis, centrifugal, and Euler terms where needed.

Document 14's normal `RigidStateTransform` deliberately contains only the quantities necessary for position/velocity state transformation. It is not silently reinterpreted as sufficient acceleration dynamics.

If the required derivative data are unavailable, a numerical model that requires them rejects the non-inertial integration frame rather than producing approximate pseudo-forces implicitly.

## Initial propagation-model taxonomy

`PropagationModelKind` is initially a closed public semantic set with stable compact backend codes:

| Wire code | Public name | Meaning |
|---:|---|---|
| 1 | `referenceEphemeris` | State comes from an imported/external reference trajectory source. |
| 2 | `twoBodyAnalytical` | State is computed from an analytical two-body representation anchored to canonical relative state. |
| 3 | `numerical` | State is produced by numerical integration using an explicit deterministic force/mass configuration. |
| 4 | `attached` | State is fixed/configured relative to a declared frame/provider rather than independently orbit-propagated. |

Wire code `0` and unknown/reserved codes are invalid.

The taxonomy may gain later explicitly architected categories such as semi-analytical/perturbed models without changing existing wire meanings.

### Reference ephemeris

`referenceEphemeris` is the model kind for a selected immutable external/reference trajectory while it remains authoritative.

The production source implementation is the OrbitEngine Ephemeris Pack defined by document 20. Reference model configuration owns source/model metadata and handles only, conceptually including:

```text
pack/dataset identity + revision
source series/node binding
propagation frame
exact effective validity
normalization/error metadata handle
```

Chebyshev coefficients, source-center graph records, binary shard offsets, import-kernel details, and hot-record caches remain source-private implementation/data and are not canonical public object state.

An OEP-backed evaluation:

1. verifies the exact target instant is inside effective validity;
2. resolves required source-center frame/provider dependencies at the same instant;
3. evaluates the applicable normalized Chebyshev record in portable C++;
4. returns finite SI geometric state in the declared propagation frame with exact target epoch;
5. only then participates in ordinary output-frame transformation.

The model never performs any of the following implicitly:

- live source/network access;
- source-version refresh;
- last-record extrapolation;
- clamp-to-validity behavior;
- automatic analytical fallback;
- date-dependent DE440/DE441 source switching.

A request outside validity fails. Broader scenario coverage requires an explicit adjacent motion segment/source/model under the normal switching/continuity contract.

Reference-source quality means reproduction of the selected source within the pack's normalization error budget. Source trajectory uncertainty is separate provenance and must not be represented as a tighter model guarantee merely because coefficient evaluation is numerically precise.

Source-specific coefficients, kernel records, tables, or interpolation caches are not public physical state.

### Two-body analytical

The analytical model is configured from a canonical handoff/anchor state plus explicit central-body/`mu` dependencies and a declared propagation frame.

Orbital elements may be derived internally for efficient evaluation, but they are never the global authoritative physical object representation and can always be reconstructed from the anchor state plus model configuration.

Issue #23 implements the analytical model with a universal-variable Kepler solver in the portable C++ core. The canonical Cartesian anchor is the only authoritative state; the solver derives its universal anomaly at each query using the exact `Duration` between anchor and target epochs, and supports elliptic, parabolic, and hyperbolic cases for finite states with non-zero radius and positive `mu` in the declared inertial propagation frame. Stumpff functions use series evaluation near zero and a safeguarded Newton/bisection solve with a relative residual target of `1e-13` and a maximum of 128 iterations. Invalid domains or non-convergence are reported as explicit propagation errors. The default model error contract is `1e-8 m` position and `1e-11 m/s` velocity; callers may provide a stricter model-specific contract when its validity evidence supports it.

### Numerical

Numerical configuration references a deterministic ordered force set, numerical-method configuration, integration-frame contract, required dependencies, and mass authority where needed.

Integrator work arrays, dense output, historical steps, and checkpoints are internal derived state. They are scoped to the motion segment/revision and may not silently cross a state-changing segment boundary.

### Attached

Attached motion represents an object whose canonical local state is fixed or explicitly prescribed relative to a declared frame/provider.

A normal fixed attached object may store constant local position/velocity (`velocity = 0` for a fixed point) and optional local attitude. Its absolute motion arises when document 14 composes the parent frame transforms.

Attachment is not tied to `surfaceObject`; any physically appropriate object may use it.

### Active thrust is not a model kind

Active thrust does not create a `spacecraftThrust` or game-drive propagation taxonomy.

Continuous thrust is a deterministic force/acceleration provider used by `numerical` propagation, normally together with an explicit mass/mass-flow authority. Maneuver scheduling/trajectory definitions supply physical inputs such as force vectors, acceleration laws, orientation dependence, and active intervals; faction, module, fuel-item, or engine-brand concepts remain outside OrbitEngine.

## Physical state versus propagator state

### Canonical physical state

The universal transition/query form remains document 13's frame-qualified canonical Cartesian state:

```text
position
velocity
epoch
referenceFrame
```

This is the state preserved at perturbations, divergence, model switches, serialization boundaries that need a physical anchor, and diagnostic APIs.

### Model-specific configuration/derived state

Examples that do **not** replace canonical physical state include:

- orbital elements;
- ephemeris source handles/record indexes;
- OEP source-node/record indexes and Chebyshev coefficients;
- interpolation polynomials;
- perturbation coefficients;
- force-provider work buffers;
- numerical integrator stage data;
- dense-output coefficients;
- integration checkpoints;
- cached state-at-time results.

Such data is namespaced to the model/segment/source revision and can be discarded/rebuilt without changing `ObjectId` or the physical meaning of the canonical state.

### Attitude is a separate authority

The common translational propagation contract returns Cartesian position/velocity only.

Optional object orientation/angular velocity uses document 14's attitude convention but is supplied by a separate optional **attitude authority/provider** at the same target instant. This avoids forcing a Kepler/reference translational model to invent spacecraft or planetary attitude.

A high-level full-state query may combine:

- translational state at exact `T`;
- optional attitude state at exact `T`;
- same-epoch frame transforms.

If no attitude authority exists, attitude is absent explicitly.

An attached object may use a constant attitude relative to its attachment frame when configured.

## Reference authority and permanent divergence

`ReferenceStatus` remains the object-side status from document 13. `referenceEphemeris` is the corresponding motion model while the source is authoritative.

When a state-changing physical event affects a `followingReference` object at exact instant `T`, OrbitEngine performs one atomic transition:

1. evaluate the authoritative reference source at exactly `T`;
2. obtain its canonical geometric Cartesian state at `T`;
3. transform the state/change inputs at the same epoch as required by their declared frames;
4. apply the physical state change at `T`;
5. capture the resulting post-event canonical Cartesian handoff state at exactly `T`;
6. transform that handoff, at the same epoch, into the required frame of the candidate dynamic model if necessary;
7. construct and validate a new dynamic motion segment starting at `T`;
8. set object `ReferenceStatus` to `diverged`;
9. retain the original reference source only as provenance/history for supported historical/reference queries;
10. invalidate all predictions/caches based on the old reference future for targets `>= T`;
11. commit the new segment/status together.

If constructing/validating the replacement model fails, the transition operation fails atomically; it must not leave a half-diverged object or partially installed motion authority.

Once committed, normal runtime never changes `diverged` back to `followingReference`. Later use of `twoBodyAnalytical` or another cheap model continues from the new simulated trajectory and does not restore source-ephemeris authority.

Changing the loaded dataset version is likewise not a back door for restoring the reference future of a diverged object. Dataset substitution affects only objects/segments that are explicitly rebound under allowed scenario/history semantics.

## Safe model switching

### Atomic switch transaction

A switch from model `A` to candidate model `B` at exact instant `T` proceeds conceptually:

1. evaluate current authority `A` at exactly `T`;
2. obtain one canonical Cartesian handoff state;
3. same-epoch transform the handoff into a mutually supported/candidate propagation frame;
4. construct/configure candidate `B` from that handoff and explicit dependencies;
5. evaluate `B` at exactly `T`;
6. compare candidate state with the handoff using explicit position/velocity absolute+relative `SwitchTolerance`;
7. perform any requested representability/fidelity acceptance check;
8. if all checks pass, close `A`'s segment at `T` and install `B` starting at `T` atomically;
9. invalidate old future caches/predictions from `T` onward.

Any failure before commit leaves `A`, its active segment, object properties, reference status, and future authority unchanged.

### Continuity contract

Changing models is not a physical event. Therefore position and velocity at the switch instant may not jump merely because the mathematical representation changed.

Every switch specifies a `SwitchTolerance` appropriate to the owning operation/model:

```text
positionAbsoluteMeters
positionRelative
velocityAbsoluteMetersPerSecond
velocityRelative
```

Comparison uses the explicit absolute/relative combination documented by the implementation. OrbitEngine defines no universal global epsilon.

An exact anchor-derived model should normally match the handoff to near floating round-off at `T`, but the architecture intentionally does not hard-code one numerical constant across all models/scales.

If attitude authority is switched separately, its continuity uses a separately declared angular/orientation tolerance; attitude is not folded into translational model-switch success implicitly.

### Representability and demotion

Matching exactly at `T` is necessary but not always sufficient for replacing a high-detail model with a cheaper one.

A model-selection/fidelity policy that requests demotion may additionally require an explicit acceptance test over a declared horizon/domain, for example by comparing candidate states at deterministic sample instants against the current/high-detail authority or a model-specific certified error estimate.

The acceptance test must state:

- evaluation horizon/domain;
- deterministic sample/estimation rule;
- position/velocity error budget;
- relevant dependency assumptions.

If the candidate cannot satisfy the requested fidelity budget, OrbitEngine keeps the existing model. It does not degrade silently simply because a cheaper representation can be constructed.

## Propagation model versus fidelity

The concepts remain orthogonal:

- **Propagation model** — the mathematical/source mechanism used to answer state-at-time.
- **Fidelity** — the required accuracy, force/interaction detail, and computational effort for the current use case.

Consequences:

- one model kind may support multiple numerical/error configurations;
- fidelity can change while the model kind stays the same;
- model kind can change while the requested fidelity target stays the same;
- `ObjectType` determines neither;
- divergence determines neither, although it forbids restoring the original reference future as authority.

A later Fidelity Manager may choose/configure a model that meets a requested error/interaction policy. This document defines only the acceptance/switch boundary, not the automatic promotion/demotion heuristics.

## Numerical force-model boundary

### Composable physical providers

Numerical propagation consumes an ordered set of deterministic force/acceleration providers.

A provider declares:

- stable configuration/revision identity;
- exact validity interval/domain;
- required object/frame/source/property dependencies;
- frame/dynamics requirements;
- whether mass/attitude/other optional physical input is required.

The numerical system evaluates providers in a deterministic configured order. Summation/reduction order is part of deterministic semantics where changing it could materially change floating results.

### Evaluation context

A provider receives a read-only physical context conceptually containing:

- exact `SimulationInstant`;
- target `ObjectId`;
- current canonical/integration Cartesian state in the declared integration frame;
- read-only access to the object's physical properties at that instant;
- same-instant dependency-state resolution in explicitly requested frames;
- required frame-dynamics sample where non-inertial integration is explicitly supported.

A provider contributes acceleration in canonical `m/s^2` expressed in the integration frame, or another explicitly architected continuous-force quantity that the numerical layer deterministically converts to acceleration.

Providers must not mutate the registry, schedule arbitrary events, or change model authority while an integration derivative is being evaluated.

### Native/WASM and callback boundary

The normal hot-loop force-provider mechanism belongs in portable C++ or in normalized deterministic data/configuration consumed by portable C++.

Arbitrary per-step JavaScript callbacks are not part of the base contract because they would make native/WASM parity, performance, re-entrancy, and deterministic ordering backend-dependent. A future plugin/callback facility requires a separate architecture decision.

### Instantaneous impulses

An instantaneous impulse/explosion/collision delta is **not** represented as a force provider integrated over an artificial tiny timestep.

It is an exact-time state-changing event:

1. evaluate authoritative state at event `T`;
2. apply the exact physical delta at `T` in its declared frame;
3. create/anchor the resulting motion segment at `T`;
4. invalidate future predictions from `T` onward.

This preserves event-driven semantics and avoids timestep-dependent impulse behavior.

## Time-varying mass and active spacecraft

### One physical mass authority

Document 13 makes `mass` an optional physical property that may change over time. Propagation therefore reads mass through one explicit time-aware physical-property authority.

A numerical propagator must not maintain a hidden independent “remaining spacecraft mass” that can disagree with the object model.

A scenario/trajectory may install an explicit deterministic mass profile/rate authority at an exact segment/event boundary. From then on, `massAt(T)` is the value consumed by numerical force calculations and exposed as the object's physical mass at `T` according to the owning history/current-state API.

### Coupled thrust/mass integration

A numerical implementation may integrate mass as an auxiliary state variable when a physical mass-flow law requires coupled integration. If it does, that auxiliary value is an implementation mechanism for the same authoritative mass evolution, not a second source of truth.

Accepted/current segment boundaries and externally visible state must remain synchronized with the physical-property authority and its revision/invalidation semantics.

The exact storage strategy for dense numerical mass history is implementation-specific, provided queries and events observe one coherent physical mass timeline.

### Missing/zero mass

A force provider that requires mass must fail explicitly when mass is absent.

Explicit `0 kg` remains a valid test-particle value for models/forces that do not require division by inertial mass. A thrust/force law that needs `F/m` cannot operate at zero mass and reports an invalid physical configuration rather than dividing by zero.

Game fuel tanks, resource inventories, engines, modules, and burn UI remain outside OrbitEngine.

## Caching, checkpoints, and invalidation

### Cache identity

A propagated-state cache entry is keyed at minimum by:

- `ObjectId`;
- exact motion segment/revision;
- exact target `SimulationInstant`;
- model configuration revision;
- relevant dependency/source/property revisions.

For pack-backed reference state, source revisions include the OEP dataset/manifest identity and all source-center series/shard revisions required by the query.

The native cached result is the model's canonical propagation-frame state. Frame-transformed output caching belongs to the frame subsystem and includes the corresponding frame dependency revisions.

### Invalidation from exact time

A state-affecting event/configuration change at exact `T` invalidates future derived propagation data whose target/domain depends on the old future, including as applicable:

- cached states for targets `>= T`;
- analytical derived representations anchored to the superseded trajectory;
- ephemeris-authority future cache after divergence;
- numerical dense output/checkpoints crossing or after `T`;
- encounter/trajectory predictions that consume the superseded motion revision;
- dependent frame transform caches according to document 14.

Entries strictly before `T` may remain valid if the system preserves the corresponding history segment and all of its dependencies.

### Segment boundaries

Numerical integration checkpoints and interpolation histories are scoped to a motion segment. They may not be silently reused across a physical state-changing event or model switch.

A new segment starts from its validated handoff/anchor and builds its own derived numerical history.

### Bounded caching

State-at-time queries may target many arbitrary instants. OrbitEngine does not require unbounded retention of every query. Caches/checkpoint policies must be bounded and performance-driven while preserving the exact revision/invalidation semantics above.

OEP evaluators may keep bounded hot-record/source-node caches. Pack bytes and decoded immutable indices are source data, not propagated-state cache entries.

## Dependency graph and state resolution

Every model/provider declares its structural dependencies before installation. Dependencies may include:

- central/gravitating `ObjectId` values;
- `ReferenceFrameId` values;
- ephemeris/orientation/force sources;
- OEP pack/source-node/frame-provider dependencies;
- physical properties such as `mu`/mass;
- attitude/mass authorities.

Together with document 14's frame dependencies these form one acyclic motion/frame dependency graph. Document 20 additionally requires the dataset-local source-center graph itself to be acyclic.

Examples:

- valid: satellite two-body model depends on Earth state/`mu`; Earth root motion does not depend on that satellite;
- valid: Europa reference series and Jupiter center reference series share a pack-backed Jupiter-system-barycenter frame provider whose translation resolves from DE441;
- invalid: Earth-centered frame depends on Earth's state while Earth's own authoritative motion model depends on that same Earth-centered frame;
- invalid: object A state resolver recursively depends on B while B depends back to A through active model/frame providers without a separately defined jointly integrated-system authority.

Registration/switching rejects dependency cycles atomically. State-at-time resolution must detect/report cycles rather than recursing indefinitely.

A future jointly integrated multi-object dynamic system may own a set of objects as one explicit authority node; that architecture is separate from silently allowing cyclic single-object dependencies.

## Public API and backend ownership

### TypeScript surface

Normal consumers interact with high-level engine operations such as:

- load/register immutable OEP bytes/manifest metadata through a browser-safe public API;
- register/configure an object's initial motion authority and pack/source binding;
- query object state at exact `SimulationInstant`, optionally in a requested output frame;
- request an explicit model switch/configuration change at exact simulation time;
- apply an engine-level physical impulse/state change;
- configure deterministic maneuver/force/mass definitions through supported physical APIs;
- inspect current model kind/reference-divergence/dataset/provenance metadata where intentionally exposed.

TypeScript exposes named `PropagationModelKind` values and backend-neutral configuration/value shapes. It owns public validation and error normalization.

Dataset byte acquisition is consumer-owned. The engine accepts immutable bytes/data; it does not embed Node filesystem or browser network policy into the portable core.

TypeScript does not expose raw C++ propagator pointers/vtables, OEP coefficient pointers, integrator work buffers, cache handles, Emscripten objects, or a second mutable authoritative segment graph.

### Portable C++ core

The portable core owns:

- authoritative motion segments and active segment selection;
- propagation-model execution interfaces;
- OEP manifest/binary validation needed by runtime and immutable pack/source handles;
- deterministic Chebyshev/source-center reference evaluation;
- exact model-kind/discrete state;
- dependency validation with the frame/object systems;
- reference-divergence transaction;
- switch transaction/continuity checks;
- deterministic force-provider execution order;
- propagation cache/checkpoint revisions/invalidation;
- authoritative model evaluation errors.

CSPICE/source kernel acquisition and conversion do not belong here.

### Native/WASM transfer

Adapters preserve:

- exact `ObjectId` and `ReferenceFrameId` codecs;
- exact `SimulationInstant`/`Duration` fields;
- stable compact model-kind codes;
- exact segment/switch/discrete outcome semantics;
- OEP dataset/source handle identity and validated byte-transfer semantics;
- f64 canonical state/configuration/tolerance values;
- explicit optional/presence fields.

High-volume state-at-time queries should be batch-oriented, especially for common target epochs, so the portable core can reuse source-center dependencies/frame evaluations efficiently.

Native and WASM must not implement different propagation state machines, different OEP interpolation rules, or separate numerical semantics at the adapter level.

## Determinism and partition independence

For the same initial normalized dataset, OEP bytes/version, ordered events/external commands, model configurations, dependencies, and compiler-supported numerical contract:

- active segment/model/source selection and switch success/failure are exact deterministic discrete outcomes;
- OEP source/record selection is deterministic;
- force providers execute in stable configured order;
- event timestamps/segment boundaries use exact `SimulationInstant` values;
- floating physical results satisfy model-specific/source-specific documented tolerances;
- native/WASM parity follows document 12's tolerance policy rather than demanding universal bit identity.

Public/UI call partitioning must not define a different physical model. With no additional state-changing commands between `A` and `B`, one request to advance/query across the interval versus caller partitioning must obey the same event/model semantics and agree within the owning numerical tolerance.

Internal numerical integration step selection may differ from UI/game update frequency. Reference ephemeris evaluation is direct at the requested instant and has no caller-defined integration steps.

## Rejected alternatives

- One fixed global propagation tick: rejected because state-at-time and event-driven advancement must support direct large time jumps.
- Orbital elements as global authoritative object state: rejected because Cartesian state is the universal perturbation/model-handoff form.
- Propagator-specific public object schemas: rejected because model replacement must not redefine object identity/state semantics.
- Selecting model from `ObjectType`: rejected because physical classification, propagation model, and fidelity are independent.
- Treating frame transformation as time propagation: rejected because document 14 defines same-epoch transforms only.
- Silently restoring original ephemeris after demotion: rejected because divergence is permanent runtime motion-history semantics.
- Switching models without an exact-time continuity validation: rejected because representation change must not create physical impulses.
- One global floating epsilon: rejected by document 12; switch/error budgets are feature/model specific.
- Hidden propagator-owned spacecraft mass: rejected because physical mass must have one coherent authority.
- Arbitrary JavaScript hot-loop force callbacks by default: rejected because backend parity, deterministic ordering, performance, and re-entrancy require a deliberate later plugin architecture.
- Modeling instantaneous impulses as very short continuous forces by default: rejected because the result would depend on integration timestep and blur exact event semantics.
- Unbounded arbitrary-time propagation caches: rejected because revision-correct bounded caches are sufficient and scalable.
- Silently allowing cyclic object/frame dependencies: rejected because recursive state resolution would be ambiguous; joint integration requires an explicit authority model.
- Runtime CSPICE/kernel-pool evaluation as the production reference source: rejected by document 20 in favor of normalized immutable OEP data evaluated by the portable core.
- Live Horizons/JPL lookup or automatic source refresh: rejected because it breaks deterministic dataset identity and offline runtime behavior.
- Automatic DE440/DE441 date switching: rejected because source/profile selection belongs to versioned scenario data, not hidden time-dependent model behavior.

## Constraints on follow-up implementation

Fundamental propagation implementation must not invent new architecture beyond this document and document 20. In particular:

- preserve the shared model-kind/state-at-time/motion-segment/switch contracts;
- integrate with document 13 object/reference lifecycle and document 14 frame/dependency semantics;
- implement OEP-backed `referenceEphemeris` using the exact source/pack/validity rules from document 20;
- keep acquisition/import/CSPICE tooling outside the portable runtime;
- reject missing/corrupt/unloaded/out-of-validity pack data explicitly;
- preserve source-center locality through explicit frame/source providers rather than rewriting physical hierarchy;
- numerical interfaces may be introduced before a production integrator, but deterministic force/dependency/mass contracts must match this document;
- a concrete two-body implementation remains valid and validates known/reference cases over an explicitly documented domain/tolerance;
- automatic Fidelity Manager/encounter-triggered model selection remains separate work.

## Validation requirements for implementation

Base propagation-contract/reference implementation must test at least:

- stable model-kind codes and unknown-code rejection;
- exact half-open segment boundary behavior at switch time `T`;
- pure state-at-time query leaves mutable clock/event state unchanged;
- exact result epoch/frame invariants;
- supported/unsupported forward/backward behavior;
- propagation-before-same-epoch-frame-transform ordering;
- OEP exact validity boundaries and no clamp/extrapolation;
- corrupt/missing shard/source-node rejection;
- deterministic source-center dependency resolution;
- OEP source-vector agreement and native/WASM parity under document-20 budgets;
- model switch success with explicit continuity tolerances;
- model switch failure leaves old authority/revisions unchanged;
- permanent reference divergence with no snap-back after analytical demotion or dataset changes;
- future cache/checkpoint invalidation from exact state-change epoch;
- dependency-cycle rejection across object-motion/frame/source graph;
- deterministic force-provider ordering;
- instantaneous impulse creates an exact new handoff/segment rather than timestep-dependent force behavior;
- absent/zero mass semantics for mass-dependent versus mass-independent providers;
- native/WASM exact parity for IDs/times/model/switch discrete outputs and tolerance-defined floating states.
