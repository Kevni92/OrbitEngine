# 14 — Reference Frames and Coordinate System

## Status and scope

This document records the architecture decided by Architecture issue #10. It defines OrbitEngine reference-frame identity, the canonical Solar-System root frame, coordinate and attitude conventions, hierarchical rigid-state transforms, local/relative query semantics, surface attachment, frame lifecycle, caching, and TypeScript/native/WASM transfer rules.

It builds on [12 — Simulation Time, Units, and Numerical Precision](12-simulation-time-units-and-precision.md) and [13 — Physical Object and State Model](13-physical-object-and-state-model.md). It does not define propagation algorithms, force models, encounter/collision policy, trajectory planning, rendering/camera coordinates, terrain, or a planetary shape database.

## Decisions at a glance

- OrbitEngine owns one explicit reference-frame graph with one immutable root.
- The canonical root is the Solar System Barycenter (SSB) with fixed ICRS/ICRF-aligned right-handed axes.
- Root axes are equatorial/celestial, not ecliptic: +X is the ICRS right-ascension origin, +Y is +90 degrees right ascension in the ICRS equatorial plane, and +Z is the ICRS north celestial pole.
- Frame transforms and object states are geometric. Light-time, stellar aberration, and apparent-observer corrections are not part of the core frame transform contract.
- `ReferenceFrameId` is a non-zero unsigned 64-bit logical identifier in a namespace distinct from `ObjectId`. Public TypeScript uses a canonical branded decimal string; C++ uses `uint64_t`; native/WASM use exact 32-bit words.
- Frame ID `1` is permanently reserved for the canonical root. Other frame IDs are supplied by scenario/import tooling, are stable, and are never reused after retirement in a simulation lineage.
- Every non-root frame has exactly one immutable parent. Parent/provider changes are modeled as explicit replacement/re-registration rather than silent re-parenting.
- Every edge evaluates a rigid state transform at an exact `SimulationInstant`: translation, origin velocity, unit quaternion rotation, and angular velocity.
- Body-centered, body-fixed, local topocentric, and object-attached frames are compositions/providers over the same transform contract rather than unrelated coordinate systems.
- Canonical object state remains local to its owning/reference frame where appropriate. Absolute/root state is computed only when requested.
- Relative-state queries compose the graph directly and must not be implemented by always converting both objects to huge root coordinates and subtracting them.
- Surface-fixed runtime state is Cartesian in a body-fixed/local frame. Latitude/longitude/height are import/convenience representations requiring an explicit body-shape model.
- Frame transforms do not propagate a state to another time. A state is transformed at its own exact epoch; propagation to a different epoch belongs to issue #11.
- The portable C++ core owns frame graph validation, transform composition, and high-volume transform execution. TypeScript owns public validation and ergonomic value shapes.

## Canonical Solar-System root frame

### Origin

The root origin is the Solar System Barycenter.

This matches the barycentric reference-system convention used by modern Solar-System ephemerides and avoids making any one body the privileged global origin.

### Orientation

The root axes are fixed to the International Celestial Reference System orientation, realized by the ICRF family of celestial reference frames.

OrbitEngine defines the root Cartesian basis as:

- `+X`: ICRS right ascension `0`, declination `0`;
- `+Y`: ICRS right ascension `+90 degrees`, declination `0`;
- `+Z`: ICRS north celestial pole;
- right-handed, so `+X x +Y = +Z`.

The root frame is kinematically non-rotating for OrbitEngine runtime purposes. It does not precess with Earth and it is not an ecliptic-of-date or mean-ecliptic frame.

The canonical time origin from document 12 remains J2000 TDB, but the simulation-time epoch does not make the root axes time-dependent.

### Relationship to SPICE/JPL `J2000`

NAIF documents that modern JPL DE4xx and related products are referenced to ICRF realizations even though SPICE commonly labels the inertial frame `J2000` for historical compatibility, and that the ICRS/J2000 rotational offset is below 0.1 arcseconds.

OrbitEngine therefore names its root semantics explicitly as SSB + ICRS/ICRF-aligned axes rather than treating the string `J2000` as sufficient provenance. Import tooling must record the exact source frame/product convention and apply a documented rotation when a source is materially different from the canonical root.

References:

- IERS, International Celestial Reference Frame: <https://www.iers.org/iers/en/dataproducts/icrf/icrf>
- NAIF SPICE Frames Required Reading, `ICRF vs J2000`: <https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/req/frames.html>

### Geometric-state rule

Core frame/object state is geometric at the requested TDB instant. It does not include observer-dependent light-time, stellar aberration, relativistic apparent-position, or camera/render corrections.

Those are separate observation/presentation calculations if introduced later. They must not contaminate canonical physical state or frame composition.

## ReferenceFrameId

### Semantic value

`ReferenceFrameId` is a non-zero unsigned 64-bit logical identifier in its own type/namespace. It is not interchangeable with `ObjectId`, even when a frame is centered on or attached to an object.

`0` is invalid. `1` is the immutable canonical root frame ID.

Other IDs are supplied deterministically by scenario/import tooling. They are unique within one simulation/state lineage and are never reused after frame removal in that lineage.

### Representation contract

Public TypeScript uses a nominal canonical unsigned decimal string with the same lexical rules as `ObjectId`: decimal digits only, no sign/whitespace/leading zeroes, range `1..uint64_max`.

The portable core uses `uint64_t`. Backend transfer is lossless:

```text
referenceFrameIdHigh: uint32
referenceFrameIdLow:  uint32
```

or an equivalent exact i64 mechanism. IDs must never pass through binary64.

The root constant is serialized as canonical string `"1"` at the public/persistence boundary.

## Explicit frame graph

### Frame node

Every frame is an explicit graph node with:

- stable `ReferenceFrameId`;
- exactly one parent except the root;
- an immutable transform-provider definition;
- zero or more explicit structural dependencies, such as an `ObjectId`, orientation source, or imported frame data handle;
- optional provenance/validity metadata for imported astronomical frame definitions.

A frame's public identity is independent of internal storage index, pointer, cache slot, or provider implementation.

### One parent, acyclic graph

The frame graph is a rooted tree with respect to frame-parent edges. Registration rejects:

- missing parent;
- self-parenting;
- any parent-edge cycle;
- invalid or retired frame IDs;
- dangling structural dependencies.

The broader motion dependency graph must also remain acyclic. A frame may depend on an object's state to define its origin/orientation, but that object's own authoritative motion may not depend structurally on the same frame or one of its descendants.

Example of valid dependency:

```text
root
  Earth state propagated in root
    -> Earth-centered frame depends on Earth state
       -> Earth-fixed frame depends on Earth center + orientation data
          -> surface object is fixed in Earth-fixed/local child frame
```

An Earth state whose own authoritative propagation frame were the Earth-centered frame above would create a dependency cycle and is rejected.

### No semantic overloading of ObjectType

Frame attachment is independent from `ObjectType`. `surfaceObject` is commonly attached to a body-fixed/local frame, but no object type selects a frame or propagation model implicitly.

## Unified rigid-state transform

For each non-root edge at exact instant `t`, the transform provider evaluates:

```text
RigidStateTransform Parent <- Child
  translation: Vec3<Meters>
  originVelocity: Vec3<MetersPerSecond>
  rotation: UnitQuaternion
  angularVelocity: Vec3<RadiansPerSecond>
  epoch: SimulationInstant
```

All four continuous values describe the child frame relative to its parent at the same exact epoch.

Notation below uses:

- `P` = parent frame;
- `C` = child frame;
- `r_PC` = child-origin position relative to parent origin, expressed in `P`;
- `v_PC` = child-origin velocity relative to parent origin, expressed in `P`;
- `R_PC` = rotation mapping a vector expressed in `C` into `P`;
- `omega_PC` = angular velocity of child axes relative to parent axes, expressed in `P`.

### Position and velocity transformation

For a Cartesian state `(r_C, v_C)` expressed in child frame `C`:

```text
r_P = r_PC + R_PC * r_C
v_P = v_PC + R_PC * v_C + omega_PC x (R_PC * r_C)
```

The `omega x r` term is mandatory for velocity conversion out of rotating frames. Coriolis/centrifugal/Euler terms arise when transforming accelerations or writing equations of motion in rotating coordinates; they are not extra terms in this position/velocity state transform.

Inverse transforms are mathematically derived from the same rigid-state transform; separate hand-authored inverse providers are not authoritative.

### Composition

For `A <- B` and `B <- C`, composition produces one `A <- C` transform at the same exact epoch.

Conceptually:

```text
R_AC = R_AB * R_BC
r_AC = r_AB + R_AB * r_BC
omega_AC = omega_AB + R_AB * omega_BC
v_AC = v_AB + R_AB * v_BC + omega_AB x (R_AB * r_BC)
```

Composition order is deterministic and follows the explicit parent path. Implementations must not depend on hash/container iteration order.

## Quaternion and attitude convention

### Quaternion layout and meaning

OrbitEngine uses right-handed Hamilton quaternions in scalar-first layout:

```text
(w, x, y, z)
```

A frame quaternion `q_PC` is an active rotation that maps coordinates from child frame `C` into parent frame `P`.

For an object's optional attitude state, `q_FB` maps vectors from the object's body/local axes `B` into the object's stated reference frame `F`.

Quaternion multiplication composes active rotations in the same order as the matrix convention above. `q` and `-q` represent the same physical orientation and must not be treated as different attitudes.

### Validation

Quaternion components are binary64 and finite. The zero quaternion is invalid. Public/raw registration values must be unit length within the feature-specific quaternion validation tolerance and are normalized once at the authoritative boundary before storage/use.

Orientation comparison and backend parity use angular error/tolerance rather than requiring identical quaternion signs or bit-identical components.

### Angular velocity

Frame-edge and object-attitude angular velocity is expressed in the parent/reference frame coordinates used by the corresponding quaternion and uses radians per second.

Keeping angular velocity in the destination/reference coordinates makes the velocity transform and transform-composition formulas unambiguous.

## Required frame constructions

OrbitEngine does not need a large public `FrameType` enum. The physical behavior is defined by the transform provider. The minimum required constructions are:

### Canonical root inertial frame

One engine-defined SSB/ICRS frame with no parent and identity transform.

### Body/object-centered non-rotating frame

The child origin follows a registered object's propagated center state while its axes remain aligned with the parent frame.

Its edge has time-dependent translation/origin velocity and identity rotation/zero relative angular velocity.

This is often colloquially called body-centered inertial, but OrbitEngine documentation should prefer **body-centered non-rotating** because an accelerating origin is not globally inertial.

### Body-fixed rotating frame

The child origin follows the body's center and its axes follow an explicit orientation provider. The provider supplies orientation and angular velocity at exact `SimulationInstant` values.

This supports planet/moon/asteroid-fixed coordinates without embedding a particular IAU/PCK database implementation in the portable core.

### Static local/topocentric frame

A local frame may be a static rigid child of a body-fixed frame. Once its body-fixed translation and rotation are defined, runtime evaluation is cheap and requires no independent orbital integration.

For the standard topocentric convenience convention OrbitEngine uses right-handed **ENU** axes:

- `+X`: east;
- `+Y`: north;
- `+Z`: outward/up surface normal.

For irregular bodies the importer/shape layer must provide the actual local origin and surface normal/tangent basis. The generic frame core still receives only the resulting body-fixed rigid transform.

### Object-attached frame

A spacecraft/station/instrument-like frame may follow a registered object's center and optional attitude state. This is the same dynamic rigid-transform mechanism as body-fixed frames; it is not a game-domain concept and does not require a separate object type.

## Canonical local state and query semantics

### State stays in a useful native frame

Document 13's canonical Cartesian state remains frame-qualified. OrbitEngine must not normalize all stored state eagerly into root coordinates.

A satellite may keep an Earth-centered anchor state; a surface object may remain constant in a Mars-fixed/local frame; a spacecraft in local operations may use an appropriate local frame when the owning propagation model permits it.

The exact propagation frame requirements are defined by issue #11.

### Transform is same-epoch only

The frame system transforms a state at the state's exact epoch. It does not move that state forward/backward in time.

If a consumer requests an object's state at time `T` in frame `G`, the high-level engine operation is conceptually:

1. propagation/motion authority computes the object's canonical state at exactly `T` in its valid source frame;
2. the frame system evaluates the frame path at exactly `T`;
3. the frame system transforms the state into `G`.

This ordering prevents frame transforms from silently becoming a second propagation engine.

### Absolute/root queries

Root-frame state is computed on demand. Stable objects do not need a permanently materialized giant barycentric XYZ copy merely so it can be queried occasionally.

### Relative-state queries

A relative-state API is first-class. To compute target relative to observer, the engine composes the frame graph along the shortest valid path/common ancestor and performs the subtraction in the most local suitable representation before optional output rotation.

It must not be implemented unconditionally as:

```text
root(target) - root(observer)
```

because that unnecessarily loses local precision when both objects share a much smaller local frame hierarchy.

If a caller explicitly asks for root-frame relative components, the result may be expressed on root axes, but the internal calculation should still avoid adding and subtracting huge common translations when graph composition can cancel them analytically.

## Surface-bound object representation

### Runtime canonical representation

Surface-fixed objects use body-fixed Cartesian or a static local-frame Cartesian state. A fixed object normally has constant position and zero local velocity relative to that frame.

When transformed outward, parent translation and frame rotation automatically generate the correct inertial/root velocity contribution through `v_origin + omega x r`.

### Latitude/longitude/height boundary

Latitude/longitude/height is not the universal runtime state representation because its meaning depends on body shape, reference ellipsoid, coordinate convention, and irregular-body geometry.

Import/convenience tooling may accept planetocentric, planetographic/geodetic, or dataset-specific surface coordinates only together with an explicit shape/convention. It converts them to a body-fixed Cartesian/static local transform before the portable runtime core relies on them.

A later non-spherical terrain/shape system can produce such transforms without changing the frame graph mathematics.

## Natural-body orientation data boundary

The portable frame core consumes an abstract orientation source rather than a specific SPICE/PCK or IAU database schema.

An orientation source must provide, for supported instants:

- exact validity interval/domain;
- orientation quaternion mapping body-fixed axes into the declared parent/non-rotating frame;
- angular velocity in radians per second expressed in the parent frame;
- source-frame identity/convention;
- provenance/version information sufficient to reproduce the dataset.

If the source supplies Euler angles, pole/right-ascension/declination/prime-meridian parameters, matrices, or another representation, import/runtime adapter code converts it into the canonical quaternion + angular-velocity contract.

Missing orientation data is an explicit unsupported query/registration condition; the core must not invent a rotation period or silently assume identity orientation.

NAIF PCK body-fixed conventions are a useful source family, but OrbitEngine does not require SPICE at runtime.

Reference: <https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/req/pck.html>

## Structural dependencies and lifecycle

### Registration

Frame registration is atomic. Before mutation the core validates:

- valid non-zero ID and reserved-root rules;
- ID is neither live nor retired;
- valid live parent for non-root frame;
- no parent cycle;
- all object/source dependencies exist and are compatible;
- no cycle in the combined frame/motion dependency graph;
- finite transform/configuration values;
- valid source validity metadata where required.

### Immutability

For a live frame, identity, parent, and transform-provider dependency structure are immutable.

Time-varying values produced by the provider are expected; changing which object/source/provider defines the frame is a structural replacement, not an in-place mutation.

This keeps transform topology and cache invalidation deterministic.

### Removal

The root frame cannot be removed.

Removing another frame permanently retires its ID and is rejected while any live structural dependent exists, including:

- child frames;
- object canonical/native state or attached motion that requires the frame;
- another transform provider that depends on the frame.

Removal never silently cascades. Dependents must be explicitly removed/reconfigured first.

## Caching and invalidation

### Topology/path caching

Because parents are immutable, frame ancestry, depth, lowest-common-ancestor paths, and static transform chains may be cached until involved frames are removed.

### Time-dependent transform caching

For repeated queries at the same exact `SimulationInstant`, an evaluated edge transform should be reused across batch/object queries where possible.

Caches are keyed by exact frame identity, exact instant, and provider/dependency revision. Arbitrary-time caches must be bounded; the architecture does not require retaining every queried epoch indefinitely.

### State-change invalidation

When an object/source that drives a frame changes authoritative state from instant `T` onward, cached transforms/predictions depending on that source at `T` and later are invalidated. Entries strictly before `T` remain valid if the owning history semantics preserve them.

Static frame transforms need no time invalidation.

## TypeScript, C++, native, and WASM ownership

### TypeScript public surface

TypeScript exposes stable backend-neutral concepts such as:

- nominal `ReferenceFrameId`;
- the canonical root-frame constant;
- quaternion/attitude and Cartesian-state value shapes;
- frame registration definitions at the supported high-level abstraction;
- object-state query with optional requested output frame;
- explicit state transform at the state's epoch;
- first-class relative-state query.

TypeScript owns lexical ID parsing, public validation/error normalization, and import/convenience conversions such as degrees or supported surface-coordinate helpers.

It does not expose C++ pointers, provider vtables, Emscripten objects, dense indexes, or cache handles.

### Portable C++ core

The portable core owns:

- live/retired frame registry;
- structural dependency validation and cycle prevention;
- transform-provider execution contracts;
- quaternion/rigid-transform math;
- path/LCA composition;
- absolute and relative state transformation;
- cache/revision semantics;
- authoritative frame lifecycle behavior.

### Backend transfer

Native and WASM adapters preserve:

- exact 64-bit frame IDs through integer high/low words or equivalent i64 transport;
- exact `SimulationInstant` fields;
- f64 position, velocity, quaternion, and angular-velocity components;
- explicit optional/presence fields;
- stable error categories.

High-volume state/transform queries should be batch-oriented and reuse evaluated frame transforms for common epochs.

## Determinism and numerical policy

- Frame graph traversal/composition order is structurally defined and deterministic.
- Root/frame IDs, topology, and time fields are exact discrete semantics across backends.
- Floating transforms use binary64 and feature-specific tolerances according to document 12.
- Quaternion equivalence is angular, not sign-sensitive.
- Implementations must not enable unsafe floating-point modes that alter the documented transform equations without explicit architecture approval.
- Relative queries should minimize cancellation by composing locally rather than materializing unnecessary root translations.

## Error semantics

Public/core behavior must distinguish at least:

- invalid/malformed frame ID;
- duplicate live or retired-ID reuse;
- reserved-root violation;
- missing parent;
- parent/dependency cycle;
- missing/dangling object or orientation dependency;
- frame/source outside validity interval;
- invalid/non-finite transform or quaternion;
- unsupported object attitude/orientation query;
- blocked frame removal due to structural dependents;
- frame not live;
- inability of the object's motion/propagation authority to supply a state at the requested instant.

The last case originates from propagation/motion authority; the frame system must not hide it by extrapolating independently.

## Rejected alternatives

- One flat global XYZ store: rejected because it needlessly loses local precision and makes surface/local motion expensive.
- Ecliptic root axes: rejected because modern ephemeris/frame ecosystems use ICRS/ICRF as the fundamental celestial reference and ecliptic frames can be derived when needed.
- Treating `J2000` as an unqualified universal source-frame name: rejected because time epoch and spatial orientation are distinct concepts and modern data labeled J2000 may in practice be ICRF-based.
- JavaScript `number` frame IDs: rejected because full uint64 identity would not be exact.
- Reusing `ObjectId` as `ReferenceFrameId`: rejected because objects and frames have independent lifecycles/namespaces and not every frame maps one-to-one to an object.
- Mutable re-parenting: rejected because it destabilizes structural dependencies, cached paths, and state semantics. Replacement is explicit.
- Latitude/longitude as canonical runtime state: rejected because it depends on a body-shape convention and is not universal for irregular bodies.
- Matrices only with no angular velocity: rejected because correct velocity transforms out of rotating frames require rotation-rate information.
- Euler angles as canonical orientation: rejected because composition/singularity behavior is inferior to unit quaternions for the core transform contract.
- Root-state subtraction for every relative query: rejected because it defeats the local-precision requirement from document 12.
- Apparent/light-time-corrected positions as canonical state: rejected because those are observer-dependent observations, not geometric physical state.

## Constraints imposed on issue #11

Issue #11 must obey these frame semantics:

- propagation receives/returns frame-qualified canonical Cartesian states;
- a propagator declares which frame/motion conditions it supports rather than assuming every frame is inertial;
- exact source/target instants remain separate from frame transform evaluation;
- propagator switching hands off one canonical Cartesian state at one exact epoch in a mutually supported frame;
- frame transforms do not silently advance time;
- reference ephemeris and numerical/analytical propagators normalize output to the common geometric state contract;
- object-centered/body-fixed frame providers may depend on propagated object state only through an acyclic motion dependency graph;
- attached/fixed motion is a valid propagation/motion-authority category for objects constant in a non-root frame;
- force/integration architecture must explicitly account for whether equations are evaluated in inertial, translating, or rotating coordinates rather than inferring this from object type.

## Validation requirements for implementation

Frame implementation must test at least:

- frame-ID parsing/codec including values above JavaScript safe-integer range;
- root ID reservation and root immutability;
- parent cycle and combined object/frame dependency-cycle rejection;
- static translation/rotation and inverse round trips;
- rotating-frame velocity transform including `omega x r`;
- multi-level transform composition against direct known cases;
- quaternion normalization/`q` versus `-q` equivalence;
- body-centered non-rotating and body-fixed examples;
- fixed surface/local object gaining correct inertial velocity from parent rotation;
- relative-state calculation through a common local ancestor without root subtraction;
- deterministic results across repeated/batched queries;
- cache invalidation from a dependency revision/time;
- blocked removal with child/object structural dependents;
- native/WASM parity for exact IDs/times and tolerance-defined floating transforms.
