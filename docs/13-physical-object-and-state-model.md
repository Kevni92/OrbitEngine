# 13 — Physical Object and State Model

## Status and scope

This document records the architecture decided by Architecture issue #9. It defines OrbitEngine object identity, physical classification, canonical state snapshots, optional physical properties, reference/divergence semantics, lifecycle, and backend transfer rules.

It builds on [12 — Simulation Time, Units, and Numerical Precision](12-simulation-time-units-and-precision.md). Reference-frame hierarchy, propagator algorithms, force models, encounter/collision policy, and trajectory planning remain separate architecture work.

## Decisions at a glance

- Every registered object has one stable `ObjectId` and exactly one immutable `ObjectType`.
- `ObjectId` is logically a non-zero unsigned 64-bit integer. TypeScript exposes a nominal canonical decimal string; C++ uses `uint64_t`; native/WASM transfer uses exact 32-bit words.
- IDs are supplied by the registering layer, are unique within one simulation lineage, and are never reused after removal in that lineage.
- `ObjectType` is a closed physical/simulation taxonomy, not a game taxonomy.
- Canonical translational state is Cartesian position + velocity + exact `SimulationInstant` + reference-frame association. Orbital elements are derived/propagator-specific.
- Identity/classification, mutable physical properties, motion/propagation state, and reference provenance are separate concerns.
- Mass, gravitational parameter, physical radius, collision envelope, and rotational state are optional capabilities/properties rather than mandatory fields.
- Reference-following vs. diverged is propagation metadata, not `ObjectType`.
- `followingReference -> diverged` is atomic and one-way during normal runtime. Cheaper propagation/fidelity never restores the original reference future.
- Surface attachment is a motion/frame relationship; surface objects remain normal OrbitEngine objects.
- The portable C++ core owns the authoritative runtime registry. TypeScript owns validation/API ergonomics.
- Registration/removal are atomic. Removal never silently cascades through structural dependents, and retired IDs cannot be reused.

## Object identity

### Semantic value

`ObjectId` is a non-zero unsigned 64-bit logical identifier. `0` is reserved as invalid.

The ID has no physical or game-domain meaning. Engine behavior must not infer type, ownership, parentage, or other semantics from its bits.

### Ownership, scope, and reuse

The scenario/import/game layer supplies IDs at registration. OrbitEngine does not silently allocate random IDs or derive identity from names.

IDs are unique within one simulation/state lineage. They remain stable until removal and are never reused in that lineage after retirement. Future persistence must preserve enough identity history to maintain this invariant after save/load.

This no-reuse rule prevents stale references from resolving to unrelated later objects.

### Representation contract

Public TypeScript uses a nominal canonical decimal string. Valid text contains only decimal digits, no sign/whitespace/leading zeroes, and represents `1..uint64_max`.

JavaScript `number` is not the full public ID representation because it cannot exactly represent all 64-bit values. Public `bigint` is not required.

The portable core uses `uint64_t`. Backend transfer is lossless, conceptually:

```text
objectIdHigh: uint32
objectIdLow:  uint32
```

Adapters may use i64/BigInt internally but must never round-trip IDs through binary64. JSON persistence uses the canonical decimal string.

## Object type

Every live object has exactly one `ObjectType` from this closed initial set:

| Wire code | Public name |
|---:|---|
| 1 | `star` |
| 2 | `planet` |
| 3 | `dwarfPlanet` |
| 4 | `moon` |
| 5 | `asteroid` |
| 6 | `comet` |
| 7 | `spacecraft` |
| 8 | `station` |
| 9 | `artificialSatellite` |
| 10 | `surfaceObject` |
| 11 | `debris` |

Wire code `0` is invalid; unknown/reserved codes are rejected. TypeScript exposes the named values; compact numeric codes are internal/backend representation.

`ObjectType` is a physical/simulation classification only. Higher-level roles and arbitrary domain metadata remain outside OrbitEngine and are associated externally through `ObjectId`.

`ObjectType` is immutable for one registered object. A true category-changing physical transformation retires the old object and registers new physical object(s) with new IDs. Routine state changes, mass changes, damage, maneuvers, divergence, or propagator changes do not change `ObjectType`.

## Object record ownership

A registered object is conceptually partitioned into:

1. immutable identity/classification — `ObjectId`, `ObjectType`;
2. current optional physical properties;
3. motion/state authority and canonical state snapshots;
4. optional reference/provenance metadata.

Implementations may use efficient internal layouts, but these concerns must not collapse into one generic mutable record. TypeScript must not keep a second independently mutable authoritative copy of physical state.

## Canonical translational state

The common translation snapshot is:

```text
CartesianState
  position: Vec3<Meters>
  velocity: Vec3<MetersPerSecond>
  epoch: SimulationInstant
  referenceFrame: ReferenceFrameId
```

Position and velocity are valid together at exactly `epoch` in exactly `referenceFrame`. SI, binary64, and exact time semantics come from document 12.

For free/dynamic motion, Cartesian position + velocity + epoch + frame are the canonical handoff/anchor state after perturbation or propagator transition. Orbital elements, cached splines, integrator histories, and similar forms are derived/propagator-specific and must never erase a changed Cartesian state.

A reference/ephemeris object may use its reference source as future authority rather than one stored Cartesian state, but every queried state is still returned through this common Cartesian snapshot contract.

`ReferenceFrameId` and transform semantics are defined by issue #10. This document only requires every state to be frame-qualified.

### Orientation

Rotational state is optional. When present it carries orientation, angular velocity in radians/second, and an exact epoch. The exact orientation/quaternion/axis convention is defined once by issue #10 so object state and frame transforms cannot disagree.

### Surface/frame-attached objects

An object need not own an independently integrated Solar-System orbit. `surfaceObject` and other attached objects may use a parent/body-fixed motion model defined by issues #10/#11.

Attachment is independent from `ObjectType`; attached objects still use the normal identity model and must be able to produce Cartesian snapshots in requested frames/times.

## Optional physical properties

Only identity and type are universal definition fields. Missing optional properties mean “not supplied/not modeled”, which is distinct from numeric zero. All supplied continuous values must be finite SI binary64 values.

### Mass

`mass` is optional kilograms, finite and `>= 0`. Explicit `0 kg` is a supported massless/test-particle value; absent mass is not zero.

Mass may change over simulation time, so it is not immutable identity. A mass change is explicit, timestamped, and invalidates future calculations that depended on the old value.

### Gravitational parameter

Optional gravitational parameter `mu` is expressed in `m^3/s^2`, finite and `>= 0`.

The registry does not silently derive `mu` from mass or mass from `mu`. This permits authoritative astronomical `GM` data to remain explicit. Later force architecture defines how gravity models consume it.

### Physical radius

Optional physical/reference radius is expressed in metres. It is not automatically a collision radius.

### Collision envelope

The base object model exposes only minimal collision-side geometry: optional conservative spherical `collisionBoundingRadius` in metres, finite and `>= 0`.

Detailed collision shapes/contact response and pair-policy matrices are later collision architecture. A richer shape model may be attached later without changing object identity or canonical translational state.

### Property mutation

Physical properties change only through explicit engine operations at an exact simulation instant. There is no generic public “patch arbitrary object record” operation.

Retroactive mutation before the current simulation time is not allowed. Any change affecting propagation, forces, encounter/collision eligibility, or broad-phase bounds invalidates affected future derived data.

## Reference baseline and divergence

Reference-following status is not an object type. Conceptually:

```text
ReferenceStatus
  none
  followingReference
  diverged
```

- `none`: no authoritative imported/reference trajectory;
- `followingReference`: reference source/ephemeris is motion authority;
- `diverged`: original reference metadata remains for provenance/history, but simulated dynamic state is authoritative from the divergence point onward.

The exact reference source handle belongs to issue #11.

When a state-changing event affects a `followingReference` object at instant `T`, the transition is atomic:

1. evaluate reference state at exactly `T`;
2. apply the physical state change at `T`;
3. capture the resulting canonical Cartesian state at `T`;
4. set status to `diverged`;
5. make dynamic propagation from that state authoritative;
6. retain original reference data only as baseline/provenance;
7. invalidate future predictions based on the old reference future.

`followingReference -> diverged` is one-way during normal runtime. Fidelity demotion, analytical propagation, or later proximity to the original path never clears divergence.

## Artificial objects

Spacecraft, stations, satellites, debris, and surface objects use the same physical abstraction as natural bodies: stable ID, one type, optional physical properties, motion authority, canonical state queries, and later interaction metadata.

Game/domain concepts remain outside OrbitEngine. Higher layers provide only physical inputs needed by engine APIs.

## Registry lifecycle

### Registration

Registration is atomic: one complete valid object is created or no object is created.

The registry validates at least:

- valid non-zero canonical ID;
- ID is neither live nor retired;
- recognized object type;
- finite/range-valid supplied properties;
- structurally valid state/motion dependencies;
- no dangling engine object/frame references.

Frame/motion validation is extended by issues #10/#11.

### References

Public consumers identify objects only by `ObjectId`, never backend pointers or dense array indexes. Internal indexes may exist for performance but are not stable identity.

### Allowed mutation

Immutable in place: `ObjectId`, `ObjectType`.

Mutable only through explicit physical/motion APIs: physical properties, legitimate dynamic anchor-state changes, propagation/motion metadata, and collision envelope.

The registry does not expose a generic setter that bypasses divergence, dependency validation, cache invalidation, or event ordering.

### Removal

Removal permanently retires the ID for that simulation lineage.

Removal must:

1. reject when live structural dependents would become invalid;
2. never silently cascade-delete attached/child objects or frames;
3. cancel/invalidate future non-structural events, cached states, encounter candidates, and predictions referring to the object;
4. remove the live registry entry/indexes;
5. retain retired/no-reuse identity state.

Issue #10 defines structural frame dependencies; later event/encounter systems define their exact invalidation mechanisms.

## Interaction metadata boundary

The object model provides facts later policies may consume, including `ObjectType`, optional `mu`, optional mass, optional collision bounding radius, and reference/divergence status.

It does not decide pair interactions. Gravity, encounter detection, and collision participation remain separate configurable policies. Having mass/radius does not imply global all-pairs work.

## TypeScript / C++ / WASM contract

TypeScript exposes nominal/value-shaped IDs, object types, SI state/property values, and exact epochs. It owns public validation and error normalization.

The portable C++ core owns authoritative registry state, conceptually using:

```text
uint64_t ObjectId
uint16_t ObjectTypeCode
Vec3<double> positionMeters
Vec3<double> velocityMetersPerSecond
SimulationInstant epoch
```

Optional values use explicit presence state, never `NaN` sentinels.

Backend rules:

- IDs are exact integer high/low words or equivalent i64 transport;
- types use stable integer codes;
- physical values stay f64/binary64;
- epochs use document 12's exact time codec;
- optional values use explicit presence fields;
- high-volume registration/query paths should be batch-oriented;
- packing stays internal and cannot alter public semantics.

Native and WASM must accept/reject the same IDs, types, property ranges, and lifecycle operations.

## Determinism and errors

Registry semantics are deterministic for the same ordered inputs. Public behavior must distinguish malformed/out-of-range IDs, duplicate live IDs, retired-ID reuse, unknown types, invalid physical values, missing/dangling dependencies, blocked removal, and object-not-live errors.

Hash/container iteration order is not public semantics. When deterministic enumeration/persistence ordering is required, ascending numeric `ObjectId` is the default canonical order unless an API explicitly specifies another ordering.

## Rejected alternatives

- JavaScript `number` for full IDs: rejected because full uint64 values are not exactly representable.
- UUID/128-bit core identity: rejected as unnecessary overhead for a simulation-local namespace.
- Engine-generated random IDs by default: rejected because caller-supplied IDs preserve deterministic scenario mapping.
- Mutable `ObjectType`: rejected because it destabilizes physical classification and policy indexes.
- Mandatory mass/radius/rotation fields: rejected because missing is distinct from zero and many objects do not need every capability.
- Orbital elements as canonical state: rejected because Cartesian state is the universal perturbation/propagator handoff form.
- Reference/diverged as object types: rejected because divergence changes motion authority, not physical classification.
- Physical radius automatically used for collision: rejected because collision geometry/policy is separate.
- Automatic `mu`/mass derivation in the registry: rejected because source authority and force policy must stay explicit.
- Generic public record patching: rejected because it bypasses state/lifecycle invariants.

## Constraints on follow-up architecture

- Issue #10 must define `ReferenceFrameId`, frame-qualified Cartesian/attitude conventions, and attachment semantics without changing this object identity/type contract.
- Issue #11 must use canonical Cartesian snapshots for propagator handoff and implement the atomic reference-to-diverged transition.
- Propagation model and fidelity remain independent from `ObjectType`.
- Future force architecture consumes explicit mass/`mu` semantics and never invents missing values silently.
- Future encounter/collision architecture may use type/envelope/reference status as inputs while keeping gravity/encounter/collision policies separate.
- Future persistence preserves exact IDs and retired-ID no-reuse state.

## Validation requirements

Implementation must test at least:

- canonical ID parsing/formatting across 32-bit boundaries and at `uint64_t` maximum;
- rejection of zero, signs, whitespace, leading zeroes, malformed text, and overflow;
- exact native/WASM ID round trips above JavaScript safe-integer range;
- all object types and rejection of unknown/reserved codes;
- type immutability, duplicate-ID rejection, and retired-ID no-reuse;
- finite/range validation for optional physical properties;
- absent mass vs explicit zero mass;
- physical radius vs collision bounding radius separation;
- Cartesian state with exact epoch/SI binary64 once frame primitives exist;
- blocked removal with structural dependencies once frame attachment exists;
- native/WASM parity for exact discrete fields and lifecycle semantics;
- absence of game-domain metadata from portable object/core types.
