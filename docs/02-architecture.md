# 02 — Architecture

## High-level structure

OrbitEngine should be designed as a reusable library with strict boundaries between simulation, data ingestion, and consuming game systems.

```text
Game / domain layers
(population, economy, stations, ships, combat, resources)
                    |
             stable object IDs
                    |
          TypeScript public API
                    |
            OrbitEngine facade
                    |
       backend-neutral contracts
          /                 \
Native Node-API         WebAssembly
          \                 /
           portable C++ core
                    |
   propagation / frames / events /
   encounters / trajectories / math

External solar-system data
(JPL/NASA etc.)
        |
offline import/build tooling
        |
versioned solar-system dataset
        |
OrbitEngine registration/configuration
```

## Proposed engine subsystems

### Time System
Owns the exact simulation instant/duration model and supports efficient jumps over long intervals. Time must not be tied to render ticks or wall-clock time. The canonical contract is [12 — Simulation Time, Units, and Numerical Precision](12-simulation-time-units-and-precision.md): TDB relative to the J2000 TDB origin, represented as normalized whole seconds plus nanoseconds. Mutable advancement is monotonic/event-driven; civil-time and leap-second conversion remain outside the portable runtime core.

### Object Registry
Owns authoritative live/retired object identity and lifecycle in the portable core. The canonical contract is [13 — Physical Object and State Model](13-physical-object-and-state-model.md): caller-supplied never-reused `ObjectId`, immutable physical `ObjectType`, optional physical properties, frame-qualified Cartesian state snapshots, and explicit reference/divergence metadata.

Identity/classification remains separate from propagation, fidelity, frame attachment, and game-domain metadata.

### Reference Frame System
Owns the explicit frame graph, stable frame IDs, structural dependency validation, rigid-state transform math, local/relative queries, and transform caching. The canonical contract is [14 — Reference Frames and Coordinate System](14-reference-frames-and-coordinate-system.md): SSB/ICRS root, immutable parent relationships, same-epoch geometric transforms, quaternion/rotation conventions, and local-precision-preserving composition.

Frame transforms do not propagate time. They transform a state at its exact epoch.

### Propagation System
Owns authoritative exact-time motion segments and computes canonical object state at requested instants. The canonical contract is [15 — Propagation Contract and Model Switching](15-propagation-contract-and-model-switching.md).

Initial models are reference ephemeris, analytical two-body, numerical, and attached motion. All return the common frame-qualified Cartesian state contract. Model-specific orbital elements, source records, or integrator histories remain derived/internal.

Model switches are exact-time transactions that validate state continuity before authority changes. Reference divergence is permanent for normal runtime and cannot be cleared by switching back to a cheaper model.

### Fidelity Manager
Chooses the accuracy/interaction detail justified for an object or local interaction. Fidelity is independent from propagation model: it may request a model/configuration satisfying an error budget, but it does not redefine physical object type or state.

The automatic manager/promotion heuristics remain later architecture.

### Encounter System
Finds potentially relevant future close approaches without testing every pair every simulation tick. It performs broad-phase filtering, schedules candidates, and refines them as the event approaches.

### Collision System
Evaluates actual collision risk only for object pairs allowed by configured interaction policies. Collision checks are especially relevant for artificial/gameplay-relevant and astronomically diverged objects.

### Force / Maneuver System
Provides deterministic physical force/acceleration, impulse, and supported mass-evolution inputs to motion authority.

Continuous forces feed numerical propagation in deterministic order. Instantaneous impulses are exact-time state changes and create new motion handoff segments. Game-specific drive names, fuel-item inventories, and module concepts do not belong here.

### Trajectory Planner
Plans physically valid transfers toward moving targets using object state, mass, propulsion constraints, time, and destination motion. Planning and authoritative trajectory propagation are separate responsibilities.

## Separation rules

1. The C++ core must not import game concepts.
2. The C++ core must not depend directly on Node.js or Emscripten.
3. Bindings translate between TypeScript-facing data and portable core types without changing canonical units, time semantics, object/frame identity, propagation semantics, or binary64 precision.
4. Data importers may know JPL/NASA formats; OrbitEngine core should not require network access or vendor-specific schemas. Importers normalize source time scales/epochs, spatial frame conventions, source trajectory representations, and physical units before runtime use.
5. Frame transforms are geometric/same-epoch; propagation alone supplies state at a different time.
6. Propagation model, fidelity, `ObjectType`, and reference-divergence status are separate concepts.
7. Numerical force providers may depend on normalized deterministic engine data; arbitrary game logic is not executed as portable-core hot-loop physics implicitly.
8. A game layer may attach arbitrary metadata to an OrbitEngine ID outside the engine.
9. Architectural changes require documentation updates in the same PR.
