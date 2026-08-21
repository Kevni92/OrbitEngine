# 04 — Propagation, Fidelity, and Events

## Two independent concepts

OrbitEngine keeps **propagation model** and **simulation fidelity** separate.

A propagation model answers: “How is this object's state computed at time T?”

Fidelity answers: “What error/interaction detail is required for the current situation?”

The canonical architecture is [15 — Propagation Contract and Model Switching](15-propagation-contract-and-model-switching.md). Object identity/canonical handoff state/reference status are defined in [13 — Physical Object and State Model](13-physical-object-and-state-model.md), while [14 — Reference Frames and Coordinate System](14-reference-frames-and-coordinate-system.md) defines same-epoch frame transforms.

A diverged asteroid may therefore use `twoBodyAnalytical` at low fidelity, temporarily switch to `numerical` treatment during an encounter, and later demote to a newly derived analytical representation without ever restoring its original reference future.

## Common propagation contract

Every model returns the same geometric canonical Cartesian state at an exact requested `SimulationInstant` in a declared propagation frame.

The query is pure with respect to mutable engine time/events: it does not require a fixed global tick and does not advance the engine clock.

Frame transformation happens after propagation at the same target instant. A frame transform never extrapolates a state through time.

Models explicitly declare validity, temporal direction support, frame-dynamics assumptions, dependencies, required physical inputs, and numerical tolerance/error behavior.

## Initial propagation models

The initial model kinds are:

- `referenceEphemeris` — normalized imported/reference state source;
- `twoBodyAnalytical` — analytical relative two-body propagation from a canonical anchor;
- `numerical` — deterministic numerical integration with explicit force/mass configuration;
- `attached` — fixed/configured motion relative to a declared frame/provider.

Semi-analytical/perturbed model kinds may be added later through explicit architecture without changing existing meanings.

Active thrust is not a game-specific propagation kind. It is represented as deterministic physical force/acceleration plus mass evolution consumed by `numerical` propagation.

`ObjectType` never selects a propagation model implicitly.

## Motion segments and model switching

One object has one authoritative translational motion source at an instant. Authority is represented by exact-time half-open segments `[start, end)`.

At a model switch time `T`:

1. evaluate the old authority at exactly `T`;
2. obtain the canonical Cartesian handoff state;
3. same-epoch transform it into a mutually supported candidate frame if required;
4. construct/evaluate the candidate model at `T`;
5. verify position/velocity continuity using explicit model/operation tolerances;
6. perform any required fidelity/representability acceptance check;
7. only then atomically end the old segment at `T` and start the new segment at `T`.

If any check fails, the old model remains authoritative and no partial switch is committed.

Changing a model is not itself a physical event, so it may not create a state jump.

## Fidelity concept

A provisional fidelity ladder remains useful as planning terminology:

- **F0 — analytical/reference:** cheap long-range propagation/query;
- **F1 — refined analytical:** selected perturbations or improved estimates;
- **F2 — numerical interaction:** numerically integrate relevant forces/bodies;
- **F3 — local dynamic system:** jointly simulate a small interaction set;
- **F4 — precision interaction:** collision, rendezvous, docking, close flyby, impulse, or active maneuver requiring tighter error budgets.

These labels/thresholds are not yet a committed public API.

Fidelity may change without changing model kind, and model kind may change while the requested fidelity remains the same. A later Fidelity Manager chooses/configures models; document 15 defines only the acceptance/switch boundary.

## Promotion and demotion

Promotion may eventually be triggered by:

- predicted close approach;
- collision risk;
- proximity to relevant gravity sources;
- active thrust/maneuver;
- external impulse/explosion;
- explicit high-precision query.

After an interaction stabilizes, a cheaper candidate may be derived from the current canonical state. Matching at the handoff instant is necessary but a demotion may also require a deterministic error-budget test over a declared horizon/domain.

If the cheaper candidate cannot satisfy the requested fidelity, the engine keeps the current model.

## Reference divergence

A `followingReference` object uses its normalized reference source as motion authority until a state-changing event affects it.

At exact divergence time `T`, OrbitEngine atomically evaluates the reference state, applies the physical change, captures the post-event canonical Cartesian state, constructs a replacement dynamic motion segment from that state, sets the object to `diverged`, and invalidates old-reference future predictions from `T` onward.

The original ephemeris remains only as provenance/history after divergence. No later fidelity reduction or analytical model switch restores it as future authority.

## Forces, impulses, and mass

`numerical` propagation consumes an explicit ordered set of deterministic physical force/acceleration providers. Providers declare validity, dependencies, frame requirements, and required physical properties.

Arbitrary per-step JavaScript callbacks are not part of the base hot-loop contract; portable C++ or normalized deterministic provider data preserve native/WASM semantics and performance.

An instantaneous impulse is an exact-time state-changing event, not a force integrated over an arbitrary tiny timestep. It creates a new canonical handoff/segment and invalidates the affected future.

Time-varying mass has one coherent physical authority. Numerical thrust/mass-flow integration may use mass as an auxiliary numerical state, but it cannot maintain a hidden second mass truth that disagrees with the object's physical mass timeline.

## Frame/motion dependency safety

Object motion, frame providers, and propagation dependencies form one acyclic dependency graph.

A state resolver rejects cycles rather than recursively evaluating indefinitely. For example, an Earth-centered frame may depend on Earth's root state, but Earth's own authority cannot in turn depend on that same Earth-centered frame.

A future jointly integrated multi-object authority may explicitly own a coupled set; it is not represented by silently allowing cyclic single-object dependencies.

## Encounter detection

The engine must not compare every object pair on every tick. Encounter detection remains hierarchical:

1. broad-phase orbital/spatial filtering eliminates impossible pairs;
2. candidate pairs receive coarse temporal close-approach estimates;
3. credible future encounters are scheduled;
4. estimates are refined as the event approaches;
5. fidelity/model configuration is increased only when required;
6. after a state-changing event, affected future predictions are invalidated and rebuilt.

Only pair types enabled by later interaction policy participate.

## Event-driven time warp

Large jumps do not require millions of fixed simulation ticks. Document 12 defines monotonic mutable advancement and exact event timing.

Advancing from `t0` to `t1` processes scheduled work in `(t0, t1]`, may jump directly to the next relevant event, drains deterministic same-time work, and continues toward the target.

Propagators may evaluate internal sample/integration times. Those do not become global ticks, and UI/game call frequency must not define a different physical model.

A state-changing event at `T` creates/increments the affected motion revision and invalidates propagated caches, dependent frame transforms, encounter candidates, and other future predictions from `T` onward.

## Example: redirected asteroid

1. Asteroid follows `referenceEphemeris` at F0.
2. A spacecraft encounter requires higher fidelity.
3. A numerical model is installed at an exact handoff time after passing continuity checks.
4. An explosion applies an exact-time impulse; the object becomes permanently `diverged` and a post-event motion segment is anchored.
5. After local dynamics settle, a `twoBodyAnalytical` candidate is derived from the new state.
6. The candidate passes handoff continuity and the requested future error-budget test, so it becomes authoritative at F0.
7. The asteroid remains diverged; its original ephemeris is provenance only.
8. Broad-phase predictions are rebuilt for the new trajectory and may identify a future planetary encounter.

This preserves physical consequences while allowing cheap propagation across long quiet intervals.
