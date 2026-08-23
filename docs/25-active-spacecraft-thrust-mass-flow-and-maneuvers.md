# 25 — Active Spacecraft Thrust, Mass Flow, and Maneuver Execution

## Status and scope

This document records the architecture decided by Architecture issue #119. It defines engine-level instantaneous impulses, finite-duration thrust, thrust direction/frame semantics, prescribed attitude dependencies, time-varying physical mass, maneuver identity/editing, exact event integration, and transition back to ballistic motion.

It builds on documents 12–15, 21 and 22. A maneuver is caller-authored physical input; resulting motion remains OrbitEngine authority. Thrust composes with the same numerical force/mass system as gravity and other configured physical forces.

It does not define game propulsion modules, fuel inventories, cargo, crew, missions, automatic guidance/trajectory optimization, atmospheric aerodynamics, rotational dynamics, or renderer/UI controls.

## Decisions at a glance

- V1 has two maneuver kinds: exact-time `ImpulseManeuver` and exact-interval `FiniteBurnManeuver`.
- Every maneuver has stable non-reused engine-scoped `ManeuverId`, revision, object identity and lifecycle.
- Finite burns use bounded piecewise-constant stages; arbitrary JavaScript callbacks or unbounded continuous command functions are not authoritative inputs.
- A v1 finite-burn program has at most 64 stages. Stages are exact half-open intervals and may change force, throttle, mass-flow specification and direction only at exact stage boundaries.
- Overlapping finite burns for one object are rejected in v1. Multiple impulses at the same exact instant are allowed and applied in ascending `ManeuverId` order.
- Thrust accepts explicit force plus mass flow, force plus effective exhaust velocity, or force plus specific impulse. All variants normalize to SI force and mass-flow rate in the portable core.
- Specific impulse uses standard gravity `g0 = 9.80665 m/s²` and `v_e = Isp * g0`; mass flow is `|F| / v_e` for positive thrust.
- Throttle is a dimensionless scalar in `[0,1]` applied to both force and associated mass flow.
- V1 thrust direction is either a unit vector in an explicit reference frame or a unit vector in the object's prescribed body frame. Velocity-relative/LVLH/target-pointing guidance is deferred to a planner/controller layer.
- Body-frame thrust requires an exact-time attitude/orientation source compatible with the translational numerical sampler. Missing/invalid attitude is an explicit burn failure.
- Rotational dynamics are not required in v1; attitude may be prescribed by a separate physical authority/controller.
- The numerical state owns one physical mass history while thrusting. No separate game-fuel inventory participates in equations of motion.
- Burn execution is truncated at the latest representable exact nanosecond at which integrated mass remains at or above configured `minimumMassKilograms`; it never clamps through an unphysical negative/too-low mass state.
- Burn start/end/stage boundaries and impulses are exact scheduled physical work under document 22.
- Adding/updating/cancelling maneuvers is future-only relative to committed mutable engine time and invalidates derived future propagation/predictions from the earliest affected instant.
- A finite burn requests numerical fidelity before start, creates/continues a numerical authority through the burn, then normal Fidelity Manager demotion rules decide the post-burn ballistic authority.
- Any thrust/impulse state change permanently diverges an object that was following a reference ephemeris.

## Maneuver identity and lifecycle

Every maneuver carries:

```text
ManeuverId: stable engine-scoped u64
revision: u64
objectId: ObjectId
kind: impulse | finiteBurn
created/config revision
lifecycle: scheduled | active | completed | cancelled | failed | stale
```

`ManeuverId` is allocated deterministically on committed insertion and is never reused during an engine instance/simulation lineage.

Updating a future maneuver retains its ID and increments revision. Replacing an entire program may reuse unchanged maneuver identities only when the caller explicitly identifies them; otherwise new IDs are allocated.

Completed/cancelled IDs are not recycled.

## Exact impulse maneuver

An impulse is physical delta velocity at exact `SimulationInstant T`:

```text
ImpulseManeuver
  id/revision/objectId
  instant: SimulationInstant
  deltaVelocity: Vec3 m/s
  frame: FrameId
```

The delta-v vector is transformed geometrically into the current motion handoff frame at the same exact instant before application.

At `T` the pre-impulse canonical state is evaluated, position is preserved, velocity changes by the transformed delta-v, and the successor authority starts at `T` under document 15.

Multiple impulses for the same object at `T` are applied in ascending `ManeuverId`; because vector addition is mathematically commutative but floating arithmetic is not perfectly associative, the explicit order is authoritative for native/WASM discrete parity.

Impulses do not consume mass implicitly. A caller that needs an impulsive approximation with mass change must express a separate exact-time physical mass update through a future explicitly designed/available physical-property transaction rather than an undocumented rocket-equation side effect.

## Finite burn model

### Program and stages

A finite burn is an exact non-empty interval `[start,end)` containing 1–64 ordered, contiguous or explicitly gapped piecewise-constant thrust stages. Gaps within one declared burn are represented as zero-thrust stages or, preferably, separate burns/coast intervals; overlapping stages are invalid.

Each stage has exact start/end instants and normalized physical configuration. Stage boundaries are discontinuity/event boundaries for numerical integration.

V1 rejects two active finite-burn intervals for the same object if their open execution intervals overlap. This avoids ambiguous multiple thrust authorities and vector-composition/order semantics. A caller that wants combined engines supplies their net physical force/mass-flow as one stage.

### Normalized stage

Conceptually:

```text
FiniteBurnStage
  interval [start,end)
  forceMagnitudeNewtons
  throttle                // [0,1]
  direction
  massFlowSpecification
```

The effective force magnitude is `forceMagnitudeNewtons * throttle`.

All scalar values must be finite. Force is non-negative. A zero-force stage has zero thrust and, for derived mass-flow variants, zero derived propellant flow.

## Thrust direction

### Reference-frame vector

```text
ReferenceFrameDirection
  frameId
  unitVector
```

The vector is normalized/validated and transformed to the numerical integration frame at each force evaluation time using the same-epoch frame transform contract from document 14.

The frame/provider must be valid for the entire stage or the burn fails at the exact first invalid boundary/sampling point according to the numerical transaction contract.

### Body-frame vector

```text
BodyFrameDirection
  unitVectorBody
  attitudeSourceId/revision
```

The body vector is transformed through the object's prescribed attitude at each numerical evaluation time.

The attitude source provides orientation at `NumericalSampleTime` and has deterministic revision/validity identity. Its quaternion/frame convention follows document 14/15 orientation contracts. The translational integrator samples attitude at the same numerical time used for force evaluation.

V1 does not solve rotational dynamics merely because body-frame thrust exists. A separate physical attitude authority/controller may prescribe orientation and angular velocity. If no valid orientation exists, the stage is invalid; the engine never substitutes renderer/camera orientation.

### Deferred guidance frames

Velocity-relative prograde/retrograde, LVLH, radial/normal, target-pointing, steering laws, autopilot feedback and trajectory guidance are not primitive v1 thrust-direction kinds. Higher-level planners/controllers can resolve those concepts to explicit time-staged physical directions/attitude sources.

This prevents guidance policy from becoming hidden integrator behavior.

## Engine-performance and mass-flow input

The public physical command supports three explicit variants that normalize in the portable core:

### Direct mass flow

```text
forceMagnitudeNewtons
massFlowKilogramsPerSecond
```

Mass flow is non-negative and denotes mass consumed per second. Effective mass derivative under throttle is:

```text
dm/dt = -massFlow * throttle
```

### Effective exhaust velocity

```text
forceMagnitudeNewtons
exhaustVelocityMetersPerSecond > 0
```

For positive effective force:

```text
massFlow = forceMagnitude / exhaustVelocity
```

Throttle scales both force and the derived flow.

### Specific impulse

```text
forceMagnitudeNewtons
specificImpulseSeconds > 0
```

Using exact conventional standard gravity for normalization:

```text
g0 = 9.80665 m/s²
ve = Isp * g0
massFlow = forceMagnitude / ve
```

The engine accepts these as physical parameterizations only. It does not know engine modules, tank names, fuel types, tech levels or inventory units.

Invalid combinations (negative flow, non-positive exhaust velocity/Isp, NaN/infinite values) are rejected before scheduling.

## Physical mass authority

### One mass history

During numerical finite-thrust propagation, mass is part of the integrated state as defined by document 21. The current canonical physical mass at a given executed instant is therefore the mass state of the authoritative motion segment/configuration.

There is no second independently writable 'fuel mass' inside OrbitEngine.

Initial burn mass is the authoritative physical mass at exact burn start. If unavailable when the force model needs mass-dependent acceleration, the burn cannot start.

### Minimum mass boundary

A finite burn configuration declares a finite positive:

```text
minimumMassKilograms
```

The engine never allows the integrated physical mass to fall below it.

For a constant-flow stage starting at exact `T0` with mass `m0` and consumption rate `q > 0`, the continuous depletion limit is:

```text
tLimit = T0 + (m0 - minimumMass) / q
```

The executable end is the latest exact nanosecond-grid `SimulationInstant <= tLimit` for which evaluated mass is not below the minimum within the mass tolerance. If the requested stage continues beyond that instant, execution truncates there with a deterministic `minimumMassReached` result and schedules the exact stage/burn termination transaction.

No negative mass, hidden clamp, or extra fractional-nanosecond burn is permitted. The remaining difference from the exact continuous limit is bounded by at most one nanosecond of configured flow plus numerical mass tolerance and is reported diagnostically.

Mass changes increment relevant physical/motion revisions at committed execution boundaries/checkpoints as defined by implementation, and downstream gravity/encounter/collision/trajectory dependencies use the authoritative revision lineage rather than a parallel gameplay mass value.

## Force composition

Finite thrust is a deterministic force provider in the document-21 numerical system. At every numerical sample:

```text
F_total = F_gravity + F_thrust + other configured physical forces
```

or equivalent acceleration accumulation using authoritative current mass.

Thrust never disables configured gravitational sources. In a coupled group, member-specific thrust is an additional external force contribution for the thrusting member while mutual gravity remains coupled.

Provider evaluation order remains the deterministic order defined by document 21.

## Exact boundary and event semantics

The following are exact scheduled work under document 22:

- impulse instant;
- finite-burn start;
- every thrust-stage start/end;
- finite-burn requested end;
- dynamically determined minimum-mass truncation boundary;
- cancellation/update effective boundary.

Numerical integration is never allowed to step across a known thrust discontinuity without ending exactly at that boundary.

At a finite-burn start, authority transition happens in the `authorityTransition` phase after any same-time physical changes/impulses that precede it under the canonical phase/order contract. Stage activation/deactivation is represented as an exact force-configuration boundary rather than a render-frame condition.

At a burn end, the canonical post-burn state (including mass) remains physical truth and becomes the handoff for subsequent ballistic/numerical/analytical propagation.

## Fidelity and authority transitions

A scheduled finite burn publishes a `FidelityRequirement` early enough that a numerical authority satisfying thrust and mass integration is active at exact burn start.

Typical transition:

```text
reference/analytical ballistic
  -> exact canonical promotion at/before burn start
  -> numerical finite-thrust segment(s)
  -> numerical ballistic handoff at burn end
  -> optional later analytical demotion after document-22 representability/error validation
```

The burn subsystem does not directly choose a specific propagator beyond requiring numerical integration/continuous thrust semantics. Model selection remains the Fidelity Manager's job.

An impulse can be applied to any authority that supports an exact state handoff; the resulting successor must represent the new velocity. If the old authority was a reference ephemeris, the object becomes permanently diverged.

A finite burn likewise causes permanent reference divergence from the first state-changing thrust instant. Neither post-burn demotion nor later low fidelity may restore the original reference future.

## Editing, cancellation and schedule validation

### Future-only mutation

V1 maneuver insertion/update/cancellation must have its earliest effective instant strictly later than committed `currentTime`, except when the operation is itself being executed as authorized same-timestamp scheduled work inside the active document-22 transaction.

Ordinary public calls cannot rewrite maneuver history at or before committed time. Rewind/branching history is a future architecture.

### Update/cancel

Updating a maneuver validates the complete replacement definition before committing. Cancellation increments maneuver/program revision and removes future scheduled work for that generation.

The earliest changed instant `Tchange` invalidates affected future:

- motion checkpoints/segments whose assumptions cross `Tchange`;
- encounter predictions;
- collision predictions;
- trajectory plans/search results;
- numerical dense-output/cache data;
- scheduled fidelity/refinement work whose dependency digest includes the old maneuver revision.

Earlier valid historical execution remains immutable.

### Overlap and same-time ordering

Finite-burn overlap for one object is rejected during schedule normalization.

Same-time impulses use ascending `ManeuverId`. If an impulse occurs exactly at a burn/stage boundary, document-22 event phases and maneuver source ordering define one canonical sequence; the post-physical-change state is then used by the authority/force transition at that same instant.

## Maneuver execution status

Read-only status contains conceptually:

```text
ManeuverStatus
  id/revision/objectId/kind
  lifecycle
  scheduled interval/instant
  current stage index?
  effective thrust vector/magnitude?
  effective mass-flow rate?
  authoritative current mass?
  resulting motion/config revision?
  last execution/truncation/failure result?
  dependency digest
```

Diagnostics may explain invalid attitude, minimum-mass truncation, invalid configuration, stale dependency or authority-transition failure. They do not attach gameplay success, mission, fuel-item or engine-health semantics.

## Public TypeScript API shape

Backend-neutral operations are equivalent to:

```text
scheduleImpulse(objectId, definition)
scheduleFiniteBurn(objectId, definition)
updateManeuver(maneuverId, replacement)
cancelManeuver(maneuverId)
getManeuver(maneuverId)
listManeuvers({objectId, from?, to?, lifecycle?})
getManeuverStatus(maneuverId)
```

Values use exact `SimulationInstant`/`Duration`, SI units, stable IDs and explicit frame identities. The API exposes no C++ force-provider pointers, integrator stages or arbitrary per-step callbacks.

## Native/WASM parity

Native and WASM must match exactly for:

- maneuver IDs/revisions/order;
- schedule validation and overlap rejection;
- normalized performance variant and constants;
- exact burn/stage/impulse boundaries;
- minimum-mass truncation instant/result category;
- same-time impulse ordering;
- authority transition/divergence decisions;
- cancellation/update invalidation identities;
- deterministic failure categories.

Continuous propagated state, thrust-frame transforms and integrated mass use model-owned numerical tolerances; unconditional bitwise floating parity is not required.

## Validation contract

Implementation must cover at least:

1. exact impulse delta-v in an explicit inertial frame;
2. two same-time impulses with deterministic order;
3. constant finite thrust without gravity matching analytical acceleration/mass expectations;
4. constant finite thrust under central gravity against trusted numerical reference;
5. direct-flow, exhaust-velocity and specific-impulse normalization;
6. throttle scaling force and flow together;
7. body-frame thrust under known prescribed attitude;
8. missing/invalid attitude failure without partial motion mutation;
9. exact burn/stage start/end boundary behavior;
10. minimum-mass truncation on the exact nanosecond grid without crossing the limit;
11. overlapping finite burns rejected;
12. edit/cancel invalidating future state/predictions and retaining immutable past;
13. reference -> diverged on impulse/thrust;
14. post-burn analytical demotion continuity after representability validation;
15. thrust plus gravity/coupled gravity composition;
16. native/WASM discrete parity and tolerance-defined continuous parity.

## Follow-up implementation decomposition

Implementation should be split into:

1. maneuver/impulse/finite-stage value types, validation and public APIs;
2. portable-core thrust performance normalization, direction evaluation and integrated mass-flow force provider;
3. exact event scheduling, update/cancel and revision invalidation;
4. numerical/Fidelity/motion-authority handoff around finite burns and impulses;
5. native/WASM parity plus representative spacecraft thrust/mass regression scenarios.
