# 03 — Object Model and Interactions

The canonical object/state contract is defined in [13 — Physical Object and State Model](13-physical-object-and-state-model.md). This document summarizes how that model relates to interactions.

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

## Reference vs. diverged astronomical objects

Reference-following vs. diverged is propagation metadata, not an object type.

When a simulation event changes a reference object's state, OrbitEngine evaluates the reference state at that exact instant, applies the physical change, captures the resulting Cartesian handoff state, marks the object diverged, and makes dynamic propagation authoritative. The original reference source remains provenance/history only.

The transition is one-way during normal runtime. Returning to cheap analytical propagation or low fidelity never means snapping back to the original astronomical reference future.

## Artificial and surface objects

Spacecraft, stations, satellites, debris, and surface objects use the same ID/type/property/state abstraction as natural bodies. OrbitEngine does not attach ownership, economy, population, role, cargo, or other game-domain data to them.

Surface/frame attachment is a motion/reference-frame relationship, not a second object hierarchy. Attached objects can remain cheap while still producing normal Cartesian state snapshots when queried.

## Lifecycle

Registration and removal are explicit and atomic. IDs and types are immutable in place; mutable physical properties/state change only through explicit physical APIs at exact simulation instants.

Removal retires the ID permanently for the simulation lineage. It does not silently cascade through structural dependents; structural dependents must be removed/reparented first. Future cached predictions/events referring to a removed object are invalidated by their owning subsystems.

## Interaction policy boundary

Object-side facts such as `ObjectType`, optional gravitational parameter/mass, collision bounding radius, and reference/divergence status may be inputs to later interaction policies.

Gravity, encounter detection, and collision detection remain separate configurable concerns. Having mass or radius never implies continuous all-pairs work.

Untouched astronomical reference bodies generally do not need wasteful mutual collision searches when their reference evolution already defines the baseline. Collision/encounter relevance increases for artificial objects, maneuvering objects, diverged natural bodies, and predicted close approaches.
