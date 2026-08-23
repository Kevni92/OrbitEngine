# 03 — Object Model and Interactions

The canonical object/state contract is defined in [13 — Physical Object and State Model](13-physical-object-and-state-model.md). This document summarizes how that model relates to interactions. Predictive encounter architecture is defined in [23 — Predictive Encounters and Close-Approach Scheduling](23-predictive-encounters-and-close-approach-scheduling.md), and collision semantics are defined in [24 — Collision Policy, Continuous Detection, and Physical Response](24-collision-policy-detection-and-response.md).

## Stable object identity

Every registered OrbitEngine object has one stable, non-zero `ObjectId`. IDs are supplied by the registering layer, are exact unsigned 64-bit logical values, and are never reused after retirement within the same simulation lineage.

The ID is the integration point between OrbitEngine and higher layers. It carries no game or physical semantics; higher layers associate their own metadata externally.

## Object type

Every object has exactly one immutable physical `ObjectType` from the closed initial taxonomy:

- Star
- Planet
- DwarfPlanet
- Moon
- Asteroid
- Comet
- Spacecraft
- Station
- ArtificialSatellite
- SurfaceObject
- Debris

Types are physical/simulation categories rather than gameplay roles. Changing propagation model, fidelity, state, mass, or reference/divergence status does not change `ObjectType`.

## Physical state and properties

The common translational state snapshot is Cartesian position + velocity + exact `SimulationInstant` + reference-frame association. Orbital elements and other propagator-specific forms are derived data, not authoritative identity/state.

Only ID and type are universal definition fields. Mass, gravitational parameter, physical radius, collision bounding radius, and rotational state are optional and explicitly modeled. Missing is distinct from zero.

Physical radius and collision radius are separate concepts. Mass and gravitational parameter are also explicit separate properties; the registry does not silently derive one from the other.

Document 24 makes `collisionBoundingRadius` the only v1 spherical collision geometry when explicitly present. Physical radius, atmospheric/visual radius, camera-aware size and marker size never substitute for it. A missing collision radius means no v1 sphere geometry; zero is an explicit point geometry.

## Reference vs. diverged astronomical objects

Reference-following vs. diverged is propagation metadata, not an object type.

When a simulation event changes a reference object's state, OrbitEngine evaluates the reference state at that exact instant, applies the physical change, captures the resulting Cartesian handoff state, marks the object diverged, and makes dynamic propagation authoritative. The original reference source remains provenance/history only.

The transition is one-way during normal runtime. Returning to cheap analytical propagation or low fidelity never means snapping back to the original astronomical reference future. A state-changing collision response follows this same rule.

## Artificial and surface objects

Spacecraft, stations, satellites, debris, and surface objects use the same ID/type/property/state abstraction as natural bodies. OrbitEngine does not attach ownership, economy, population, role, cargo, or other game-domain data to them.

Surface/frame attachment is a motion/reference-frame relationship, not a second object hierarchy. Attached objects can remain cheap while still producing normal Cartesian state snapshots when queried.

## Lifecycle

Registration and removal are explicit and atomic. IDs and types are immutable in place; mutable physical properties/state change only through explicit physical APIs at exact simulation instants.

Removal retires the ID permanently for the simulation lineage. It does not silently cascade through structural dependents; structural dependents must be removed/reparented first. Future cached predictions/events referring to a removed object are invalidated by their owning subsystems.

Collision detection does not implicitly merge, remove, destroy, fragment or replace objects. Such lifecycle operations remain explicit and dependency-checked; a future physical merge must use a new caller-supplied never-reused `ObjectId` rather than silently reusing one participant.

## Interaction policy boundary

Object-side facts such as `ObjectType`, optional gravitational parameter/mass, collision bounding radius, and reference/divergence status may be inputs to interaction policies.

Gravity, predictive encounter monitoring, and collision detection remain separate revisioned configurable concerns. Having mass, radius, an object type, or mere registration never enables continuous all-pairs work by itself.

Document 23 requires explicit encounter-policy resolution and hierarchy-aware conservative broad-phase indexing. Encounter records are derived predictions only; they may request future fidelity/coupled treatment through document 22 but never become propagation authority.

Document 24 reuses that predictive/broad-phase infrastructure for explicitly collision-enabled pairs, then performs continuous sphere-sphere contact refinement. Physical contact records contain engine-level physical data only; gameplay damage/destruction remains outside OrbitEngine.

Untouched astronomical reference bodies generally do not need wasteful mutual collision/encounter searches when their reference evolution already defines the baseline. Policy can instead enable relevant combinations such as artificial/diverged objects against selected natural populations while leaving unrelated catalog pairs disabled.
