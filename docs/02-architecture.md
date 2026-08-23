# 02 — Architecture

## High-level structure

OrbitEngine should be designed as a reusable library with strict boundaries between simulation, data ingestion, consuming applications, and game systems.

```text
Game / domain layers                  Reference/demo applications
(population, economy, stations,       (browser Solar-System demo etc.)
 ships, combat, resources)                       |
                    \                           /
                     \   stable public API     /
                      \          |             /
                         TypeScript public API
                                  |
                         OrbitEngine facade
                                  |
                     backend-neutral contracts
                        /                 \
                 Native Node-API       WebAssembly
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
Owns semantic accuracy/interaction requirements and deterministic promotion/demotion under [22 — Event-Driven Advancement and Fidelity Management](22-event-driven-advancement-and-fidelity-management.md). Fidelity is independent from propagation model: it requests capabilities/error budgets, while a separate selector chooses a compatible authority/configuration.

### Encounter System
Finds potentially relevant future close approaches without testing every pair every simulation tick. The canonical predictive architecture is [23 — Predictive Encounters and Close-Approach Scheduling](23-predictive-encounters-and-close-approach-scheduling.md): explicit monitoring policy, conservative hierarchy-aware broad phase, bounded closest-approach refinement, event/Fidelity integration and revision-aware invalidation.

### Collision System
Evaluates actual collision risk only for object pairs allowed by configured interaction policies. [24 — Collision Policy, Continuous Detection, and Physical Response](24-collision-policy-detection-and-response.md) defines explicit sphere geometry, continuous contact detection, exact contact records, detect-only/frictionless-impulse response ownership, simultaneous-contact limits and invalidation.

### Force / Maneuver System
Provides deterministic physical force/acceleration, impulse, and supported mass-evolution inputs to motion authority. [25 — Active Spacecraft Thrust, Mass Flow, and Maneuver Execution](25-active-spacecraft-thrust-mass-flow-and-maneuvers.md) defines exact impulses, bounded finite-burn stages, explicit frame/body direction, prescribed attitude dependencies, integrated physical mass flow and exact event integration.

Continuous forces feed numerical propagation in deterministic order. Instantaneous impulses are exact-time state changes and create new motion handoff segments. Game-specific drive names, fuel-item inventories, and module concepts do not belong here.

### Trajectory Planner
Provides read-only derived trajectory analysis over authoritative moving-object state. [26 — Trajectory Planning, Transfers, Rendezvous, and Intercepts](26-trajectory-planning-transfers-rendezvous-and-intercepts.md) defines the initial zero-revolution impulsive Lambert solver, explicit central-body/frame assumptions, intercept/rendezvous/flyby semantics, bounded departure/time-of-flight search, stale-plan identity and detached numerical validation.

Planning never makes a trajectory authoritative. A selected plan enters simulation only through an explicit maneuver application transaction using the normal Force/Maneuver System.

## Reference/demo applications

Reference applications are consumers of OrbitEngine, not engine subsystems.

The canonical first reference application is the browser Solar-System demo defined by [16 — Browser Solar-System Demo Architecture](16-browser-solar-system-demo.md). It lives in `apps/`, consumes the same public `orbit-engine` TypeScript package as an external application, explicitly exercises the WASM backend in a browser, and renders state with Three.js.

Reference applications may own UI, camera state, render scaling, labels, visual metadata, and application-specific scenarios. They must not own authoritative physical state or implement replacement orbital physics.

A reference application is allowed to reveal a missing public consumer capability. The fix belongs in the appropriate public/backend OrbitEngine contract rather than through an application-only import of package internals.

## Separation rules

1. The C++ core must not import game concepts.
2. The C++ core must not depend directly on Node.js or Emscripten.
3. Bindings translate between TypeScript-facing data and portable core types without changing canonical units, time semantics, object/frame identity, propagation semantics, or binary64 precision.
4. Data importers may know JPL/NASA formats; OrbitEngine core should not require network access or vendor-specific schemas. Importers normalize source time scales/epochs, spatial frame conventions, source trajectory representations, and physical units before runtime use.
5. Frame transforms are geometric/same-epoch; propagation alone supplies state at a different time.
6. Propagation model, fidelity, `ObjectType`, and reference-divergence status are separate concepts.
7. Numerical force providers may depend on normalized deterministic engine data; arbitrary game logic is not executed as portable-core hot-loop physics implicitly.
8. A game layer may attach arbitrary metadata to an OrbitEngine ID outside the engine.
9. Reference/demo applications may attach presentation metadata to an OrbitEngine ID outside the engine, but Three.js/Vite/DOM/WebGL/render-space concepts must not leak into the engine package or portable core.
10. Browser animation/render cadence must not become an authoritative physics tick; browser consumers request engine state at explicit simulation instants.
11. Planner queries are derived/read-only; only explicit maneuver application may turn a selected plan into future authoritative physical work.
12. Architectural changes require documentation updates in the same PR.
