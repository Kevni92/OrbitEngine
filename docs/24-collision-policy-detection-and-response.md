# 24 — Collision Policy, Continuous Detection, and Physical Response

## Status and scope

This document records the architecture decided by Architecture issue #118. It defines collision eligibility, v1 geometry, continuous sphere-sphere contact detection, exact contact records, optional engine-owned spherical impulse response, lifecycle boundaries, simultaneous-contact semantics, and revision-aware invalidation.

It builds on documents 13–15 and 21–23. Collision relevance remains independent from gravity-source selection and encounter monitoring. Collision detection consumes the encounter/event infrastructure rather than introducing a second global pair scheduler.

It does not define gameplay damage, combat, terrain contact, fracture/fragment generation, arbitrary mesh collision, visual effects, or automatic object merging.

## Decisions at a glance

- Collision eligibility is an explicit revisioned pair policy. Mass, object type, radius, gravity relevance, encounter relevance, or registration never enables collision work by itself.
- V1 collision geometry is a sphere using an explicit `collisionBoundingRadiusMeters`. Visual/adaptive render size and physical radius are never silently substituted.
- Missing collision radius means the object cannot participate in v1 spherical collision detection. Radius `0` is valid point geometry.
- Collision broad phase reuses document 23 encounter domains/window indexes with collision-specific inflation. There is no independent permanent all-pairs scanner.
- Continuous detection solves the signed sphere separation over trajectory intervals and therefore prevents high-speed tunneling caused by fixed-tick sampling.
- A contact event uses an exact `SimulationInstant` selected conservatively from the final continuous root bracket; root-time/separation uncertainty remains explicit.
- Contact records contain physical information only.
- V1 supports two explicit engine-level response modes: `detectOnly` and `frictionlessImpulse`. No-response ambiguity is therefore impossible.
- `frictionlessImpulse` applies the standard spherical normal impulse with configured coefficient of restitution and authoritative physical masses. Tangential relative velocity is unchanged.
- Collision-driven velocity changes use document 15 exact-time canonical handoff semantics and permanently diverge reference-following objects.
- V1 does not automatically merge, destroy, retire, fragment, or create objects as a collision response. Lifecycle changes require a separate explicit exact-time operation and caller-supplied identity where creation is involved.
- Multiple detect-only contacts at one instant may be recorded together. A frictionless-impulse contact set in which one object participates in more than one simultaneous contact is explicitly unsupported in v1 and rolls the timestamp transaction back rather than applying order-dependent sequential impulses.
- Every prediction/contact carries dependency revisions; stale scheduled contacts are unable to execute after a relevant change.

## Collision policy

### Independent pair policy

The engine owns a revisioned normalized `CollisionPolicy`. It resolves the canonical ordered pair `(min(ObjectId), max(ObjectId))` to:

```text
disabled
or
enabled(CollisionProfileId)
```

Policy rules may inspect engine-level facts such as immutable `ObjectType`, divergence status, explicit physical interaction tags, and caller-supplied pair/object overrides. They may not inspect faction, ownership, combat role, mission, economic value, renderer state, selection, or camera state.

Rule resolution/override precedence is deterministic and part of the normalized policy configuration identity.

Gravity and encounter policies are independent inputs. A collision-enabled pair may exert no mutual gravity; a gravity pair may be collision-disabled. When collision monitoring requires predictive support, the collision subsystem requests/uses a collision-aware encounter profile without redefining encounter-policy semantics globally.

## V1 collision geometry

### Sphere contract

A participating object must expose an explicit finite non-negative:

```text
collisionBoundingRadiusMeters: double
collisionShapeRevision: u64
```

The value is collision geometry only. It is independent from:

- physical radius;
- rendered sphere/marker radius;
- atmosphere radius;
- camera-aware visibility enhancement;
- gravitational softening or influence radius.

Missing is distinct from zero. A missing radius makes v1 spherical collision registration/profile resolution invalid for that object. Zero radius represents a point particle and participates normally against nonzero spheres or another point according to the same contact equation.

For objects A and B:

```text
R = RA + RB
contact when |rB - rA| <= R
```

The authoritative v1 contact surface is therefore conservative spherical geometry.

### Future shape extension

A later architecture may add ellipsoids, convex primitives or other proxy shapes behind a versioned shape-kind interface. Non-spherical shapes must define their body-frame geometry, orientation/attitude dependency, continuous support mapping/distance semantics and broad-phase bounds. They do not change `ObjectId`, canonical translational state, or the v1 sphere meaning.

Arbitrary triangle-mesh/terrain contact is not implied by this extension boundary.

## Collision profiles

The portable core receives explicit normalized profile values, conceptually:

```text
CollisionProfile
  responseMode: detectOnly | frictionlessImpulse
  coefficientOfRestitution        // impulse mode, [0,1]
  broadPhaseMarginMeters
  contactDistanceToleranceMeters
  contactTimeTolerance: Duration
  separationHysteresisMeters
  maxCandidateSubdivisions
  maxRootIterations
  requiredPositionErrorMeters
  requiredVelocityErrorMetersPerSecond
  policyRevision
```

All values are validated. TypeScript may provide named presets, but presets are expanded before crossing the backend boundary.

There is no hidden global collision epsilon.

## Relationship to encounter broad phase

Collision infrastructure consumes the domains, exact rolling windows, conservative swept bounds, spatial indexes and revision model from document 23.

For a collision-enabled pair/object population, broad-phase bounds are inflated by:

```text
collision radius + broadPhaseMargin + trajectory/model uncertainty
```

A pair can be rejected only when the conservative collision-specific swept bounds prove no overlap. If trajectory uncertainty cannot certify safety, the pair remains a candidate or the window subdivides; uncertainty never becomes a false-negative optimization.

Collision-specific candidate records reference the source encounter/bound-window identity and both shape revisions. A collision subsystem does not scan every registered pair independently on each simulation/render tick.

## Continuous sphere-sphere detection

### Contact function

For continuous relative position `r(t) = rB(t) - rA(t)` and `R = RA + RB`:

```text
f(t) = r(t) · r(t) - R²
```

`f > 0` means separated, `f = 0` contact, and `f < 0` overlap.

The task is to locate the **earliest entry contact** in a candidate interval, not merely the interval's closest-approach sample.

### Interval boundaries

A solve interval is always split at exact discontinuities relevant to either body:

- motion-segment boundaries;
- impulses;
- maneuver/force boundaries;
- coupled-group membership boundaries;
- source/frame validity boundaries;
- collision-shape/radius revision boundaries.

No root solver crosses such a boundary under a false smoothness assumption. Boundary states are evaluated according to the exact timestamp event/segment semantics of documents 15 and 22.

### Conservative bracketing

The detector starts from document 23's collision-aware encounter window. It evaluates relative state and contact function at endpoints and adaptively at interior points.

A subinterval is rejected only when a conservative lower bound on sphere separation, including propagation/interpolation error, proves positive clearance beyond the configured contact tolerance.

Intervals that may contain contact are subdivided until:

- an entry root is bracketed;
- the interval begins already touching/overlapping;
- or the deterministic work budget is exhausted.

High relative velocity increases required subdivision/refinement rather than allowing a body to tunnel through another between sparse simulation timestamps.

DOP853 dense output from document 21 is used when available under matching revision identity. Analytical/reference authorities use their normal continuous/state-at-time sampling contract. Contact detection never requires the application to implement an orbital solver.

### Root refinement

For a separated-to-touching/overlapping bracket, the core applies a safeguarded Brent-style scalar solve on `f(t)` with bisection fallback. The bracket invariant is preserved.

The continuous solve stops when the time bracket and separation uncertainty satisfy the profile tolerances or representation/work limits are reached. Exhaustion/non-convergence is explicit; it does not silently publish an overconfident contact instant.

If the interval starts within contact tolerance, its exact start instant is the candidate contact instant subject to duplicate-contact suppression rules.

### Exact `SimulationInstant`

After continuous refinement, the engine evaluates exact nanosecond-grid candidates at/around the final bracket. The published contact instant is the earliest representable instant inside the final uncertainty interval whose evaluated separation is within the configured contact tolerance, with an explicit exception diagnostic when model uncertainty prevents a strict sign determination.

The record retains the final continuous time bracket/time uncertainty and separation uncertainty. Exact timestamp representation does not imply zero physical prediction error.

## Contact record

A committed physical contact creates a stable read-only derived/diagnostic record:

```text
CollisionContactRecord
  contactId: u64
  generation: u64
  objectA/objectB                 // ascending ObjectId
  exactContactInstant
  evaluationFrame
  stateA/stateB at contact
  radiusA/radiusB
  contactPointApproximation
  contactNormal
  relativeVelocity
  normalRelativeSpeed
  quality / timeUncertainty / separationUncertainty
  collisionPolicy/profile revision
  shape revisions
  motion/dependency revision digest
  responseMode
  responseResult
  lifecycle: active | stale | retired | failed
```

For non-coincident sphere centers, the contact normal points from A to B:

```text
n = normalize(rB - rA)
```

and the contact-point approximation is the radius-weighted surface point along that line, for example `pA + n*RA` in the evaluation frame. Numerical tolerance may mean the two nominal surface points differ slightly; diagnostics retain that separation error.

For exactly coincident centers where no geometric normal exists, impulse response is unsupported unless a deterministic nonzero relative-velocity direction provides an unambiguous normal under a separately documented rule. V1 otherwise reports `undefinedContactNormal`; detect-only may still record the overlap without inventing a direction.

No damage, faction, visual effect, ownership or gameplay outcome fields belong in this record.

## Physical response ownership

### `detectOnly`

`detectOnly` means the engine commits the physical contact record but intentionally does not modify translational state. This is a complete, explicit policy—not a request for an implicit callback.

To avoid repeatedly rediscovering the same persistent overlap at one timestamp, the contact pair enters a revisioned suppression/contact-state record until either:

- separation exceeds `RA + RB + separationHysteresisMeters`; or
- either dependency/policy/shape revision changes.

A caller may later apply an explicit state-changing physical command through ordinary engine APIs. Such a command is a separate exact-time transaction and invalidates predictions normally.

### `frictionlessImpulse`

For two spheres with finite positive authoritative masses `mA`, `mB`, pre-contact velocities `vA`, `vB`, contact normal `n` from A to B, and coefficient of restitution `e`:

```text
vRelN = dot(vB - vA, n)
```

If `vRelN >= 0` within tolerance, the pair is not approaching along the normal and no bounce impulse is generated; the contact is recorded/suppressed.

For an approaching pair, impulse magnitude is:

```text
j = -(1 + e) * vRelN / (1/mA + 1/mB)
```

and post-contact velocities are:

```text
vA' = vA - (j/mA) * n
vB' = vB + (j/mB) * n
```

Positions at the exact contact instant are unchanged. Tangential velocity components are unchanged. The operation conserves linear momentum to the numerical contract and gives the configured normal restitution behavior.

An authoritative positive mass is mandatory for both bodies in this response mode. Missing, zero, negative or non-finite mass is an explicit response error; the engine does not invent infinite mass from object type or physical radius.

Rotational impulse, friction, spin transfer, deformation and energy loss beyond normal restitution are outside v1.

### Atomic handoff

Impulse response is part of the same document-22 timestamp transaction as the physical contact. Pre-contact authority is evaluated at exact `T`; response produces canonical post-contact velocity states; successor motion authority/segments begin at `T` according to document 15/21 contracts.

If either object was `followingReference`, a state-changing response marks it permanently `diverged`. Historical reference data remains provenance only.

Any failure to validate both successor authorities, masses, frames, dependencies or continuity rolls back the complete collision timestamp transaction. One object is never bounced while the other remains pre-collision.

The public TypeScript response surface is explicit and callback-free:

```ts
engine.resolveCollisionVelocityResponse({ contact, profile, massA, massB })
engine.applyCollisionResponseAtomically({
  contact,
  profile,
  massA,
  massB,
  referenceStatusA,
  referenceStatusB,
  successorValidation,
})
engine.collisionContactSuppression()
```

The first operation computes a response outcome without mutating caller-owned state. The atomic operation returns either `committed` post-contact states for both objects or `rolledBack` pre-contact states for both objects. `detectOnly` does not require masses and returns unchanged states. The suppression manager canonicalizes object pairs, releases them only after the configured hysteresis distance, and invalidates a record when the supplied motion-dependency revision digest changes.

## Lifecycle boundary

A collision does not automatically remove, retire, merge, replace, fragment or create objects in v1.

Lifecycle changes use the existing explicit object-lifecycle operation at an exact timestamp. Removal still requires structural dependency checks. A caller that wants a physical merge must use a separately architected/explicit creation/removal transaction and supply a new never-reused `ObjectId`; collision code never reuses one participant's identity for a merged body by implication.

This preserves the engine/game boundary: the engine reports physical contact and can perform the selected simple physical impulse, while game damage/destruction decisions remain external.

## Simultaneous and multiple contacts

All collision work at exact time `T` participates in document 22's atomic timestamp transaction. Candidate contacts are canonicalized and sorted by `(objectA, objectB, contactId)`.

### Detect-only groups

Any number of detect-only contacts may be recorded in one timestamp transaction, subject to the global same-time work budget. Records are ordered deterministically.

### Impulse groups

Disjoint frictionless-impulse contacts—where each object participates in at most one impulse pair at `T`—can be solved independently and committed atomically.

If any object appears in two or more frictionless-impulse contacts whose contact-time uncertainty intervals overlap the same exact timestamp, v1 reports `unsupportedSimultaneousImpulseContact` and rolls back the timestamp transaction. It does not process pair impulses sequentially because that would make the physical result depend on arbitrary pair ordering.

A future local rigid-body/multi-contact solve requires separate architecture and may use a coupled constraint solve.

## Invalidation and rebuild

Collision candidates/contact predictions depend on:

- both motion segment/group revisions;
- collision shape/radius revisions;
- collision policy/profile revision;
- relevant frame/source/provider revisions;
- encounter-window/broad-phase revisions;
- authoritative mass revisions for impulse response.

A state-changing response or other relevant change at exact `T` invalidates every affected future collision/encounter/trajectory/numerical-cache record whose covered interval intersects `[T,+∞)` through the generic revision infrastructure in documents 22 and 23.

Scheduled collision work is generation/digest checked immediately before execution. A stale contact cannot fire because it remained in a queue.

Rebuild is targeted and bounded; no collision commit triggers a synchronous global rescan of all objects.

## Public API shape

Backend-neutral TypeScript capabilities are equivalent to:

```text
setCollisionPolicy(...)
setCollisionProfile(...)
getCollisionContact(contactId)
listCollisionContacts({objectId?, from?, to?})
getCollisionDiagnostics(contactId)
```

The continuous-detection primitive also exposes the encounter-fed operations needed by
the v1 detector without exposing index internals:

```text
buildCollisionSweptBound({sphere, profile, interval, domainId, ...})
predictCollisionContact({interval, sphereA, sphereB, source, profile, boundaries?})
```

`predictCollisionContact` returns an explicit `contact`, `noContact`, `incomplete`, or
`failed` result. Its contact result carries the exact selected nanosecond instant,
continuous bracket, time/separation uncertainty, and refinement quality. An
`incomplete` result is not a safe rejection; it indicates that the configured work
budget or convergence contract could not certify the interval.

Collision geometry/property updates remain exact-time physical/configuration operations and create revision changes.

The public API never exposes BVH nodes, dense-output buffers, C++ pointers or mutable event-queue internals.

## Native/WASM parity

Native and WASM must match exactly for:

- collision policy resolution;
- canonical pair/contact ordering;
- candidate/refine/reject decisions under normalized tolerances;
- exact published contact instant after nanosecond-grid selection;
- contact IDs/generations/lifecycle;
- response-mode branch and deterministic error category;
- simultaneous-contact supported/unsupported decision;
- invalidation/suppression outcomes.

Continuous states/contact geometry are compared using documented propagation/contact tolerances rather than unconditional bitwise parity.

## Validation contract

Implementation must cover at least:

1. safely separated near miss;
2. stationary spheres exactly touching;
3. persistent overlap with detect-only duplicate suppression;
4. high-speed crossing that would tunnel under coarse discrete ticks;
5. analytically known moving sphere-sphere contact time;
6. zero-radius point versus sphere;
7. contact exactly at a motion-segment boundary;
8. state revision invalidating a previously predicted contact;
9. elastic (`e=1`) and inelastic (`e=0`) two-body normal impulse momentum/restitution checks;
10. missing mass causing atomic impulse-response failure;
11. reference-following body becoming permanently diverged after bounce;
12. lifecycle removal dependency failure not partially committing collision-side lifecycle changes;
13. multiple detect-only simultaneous contacts;
14. shared-object simultaneous impulse contacts producing explicit unsupported rollback;
15. native/WASM discrete parity and tolerance-defined continuous parity.

Performance tests must show collision refinement is fed by conservative candidate windows rather than a second all-pairs tick loop.

## Follow-up implementation decomposition

Implementation should be split into:

1. collision policy/profile, sphere-shape and contact-record primitives;
2. encounter-integrated continuous sphere-sphere detection/refinement;
3. detect-only suppression and frictionless impulse response/exact motion handoff;
4. simultaneous-contact, lifecycle-boundary and revision invalidation integration;
5. public APIs, native/WASM parity and collision stress/regression coverage.
