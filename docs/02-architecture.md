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
Owns the exact simulation instant/duration model and supports efficient jumps over long intervals. Time must not be tied to render ticks or wall-clock time. The canonical contract is defined in [12 — Simulation Time, Units, and Numerical Precision](12-simulation-time-units-and-precision.md): TDB relative to the J2000 TDB origin, represented as normalized whole seconds plus nanoseconds. Mutable advancement is monotonic/event-driven; civil-time and leap-second conversion remain outside the portable runtime core.

### Object Registry
Stores stable IDs, object type, physical state, propagation metadata, reference-frame relationship, and interaction configuration.

### Reference Frame System
Represents hierarchical frames and transforms positions/velocities between them. Examples include the solar-system barycentric frame, body-centered inertial frames, rotating body-fixed frames, and local frames.

### Propagation System
Computes state at time T using an appropriate propagation model. Models may include reference ephemerides, analytical/Keplerian propagation, perturbed analytical approaches, and numerical integration.

### Fidelity Manager
Chooses how much computational effort is justified for an object or local interaction. Fidelity is not the same thing as propagation model.

### Encounter System
Finds potentially relevant future close approaches without testing every pair every simulation tick. It performs broad-phase filtering, schedules candidates, and refines them as the event approaches.

### Collision System
Evaluates actual collision risk only for object pairs allowed by configured interaction policies. Collision checks are especially relevant for gameplay objects and astronomically diverged objects.

### Force / Maneuver System
Applies gravity models, thrust, impulses, and other supported physical forces. Game-specific drive names do not belong here; only physical inputs do.

### Trajectory Planner
Plans physically valid transfers toward moving targets using object state, mass, propulsion constraints, time, and destination motion. Planning and actual trajectory propagation are separate responsibilities.

## Separation rules

1. The C++ core must not import game concepts.
2. The C++ core must not depend directly on Node.js or Emscripten.
3. Bindings translate between TypeScript-facing data and portable core types without changing canonical units, time semantics, or binary64 precision.
4. Data importers may know JPL/NASA formats; OrbitEngine core should not require network access or vendor-specific schemas. Importers normalize source time scales/epochs to the canonical TDB instant contract before runtime use.
5. A game layer may attach arbitrary metadata to an OrbitEngine ID outside the engine.
6. Architectural changes require documentation updates in the same PR.
