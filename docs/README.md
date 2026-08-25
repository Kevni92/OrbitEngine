# OrbitEngine Documentation

This directory is the canonical architectural documentation for OrbitEngine. Agents and contributors should begin here before changing implementation behavior.

## Contents

1. [Vision and Scope](01-vision-and-scope.md) — goals, boundaries, realism target, and non-goals.
2. [Architecture](02-architecture.md) — major subsystems and separation between engine, data ingestion, presentation, and game layers.
3. [Object Model and Interactions](03-object-model-and-interactions.md) — object/interaction summary and links to the canonical object contract.
4. [Propagation, Fidelity, and Events](04-propagation-fidelity-and-events.md) — propagation/fidelity overview, encounters, events, and time warp.
5. [Coordinates and Reference Frames](05-coordinates-and-reference-frames.md) — reference-frame overview and links to the canonical frame contract.
6. [Solar-System Data](06-solar-system-data.md) — external astronomical data boundary and reproducible import strategy.
7. [TypeScript, Native C++, and WebAssembly](07-typescript-native-wasm.md) — simulation npm API and dual C++ backend strategy.
8. [Development Workflow](08-development-workflow.md) — mandatory issue/branch/PR/CI/merge workflow.
9. [Glossary](09-glossary.md) — shared terminology.
10. [Task Types and Agent Routing](10-task-types-and-agent-routing.md) — Architecture, Implementation, Spike, Codex refusal/confirmation rules, and escalation.
11. [Build, Package, and Backend Architecture](11-build-package-and-backend-architecture.md) — concrete pnpm/CMake layout, backend selection, artifact distribution, platform support, tests, and CI contract.
12. [Simulation Time, Units, and Numerical Precision](12-simulation-time-units-and-precision.md) — SI unit contract, TDB/J2000 time model, exact durations, binary64 policy, time-warp semantics, and backend transfer rules.
13. [Physical Object and State Model](13-physical-object-and-state-model.md) — exact object identity/type contract, canonical Cartesian state, optional physical properties, divergence semantics, lifecycle, and backend representation.
14. [Reference Frames and Coordinate System](14-reference-frames-and-coordinate-system.md) — SSB/ICRS root, frame identity/graph, rigid-state transforms, quaternion convention, local/relative precision, surface attachment, lifecycle, caching, and backend contract.
15. [Propagation Contract and Model Switching](15-propagation-contract-and-model-switching.md) — motion authority/segments, common state-at-time contract, model taxonomy, permanent divergence, safe switching, fidelity boundary, forces/mass, caching, and backend ownership.
16. [Browser Solar-System Demo Architecture](16-browser-solar-system-demo.md) — private browser reference application, browser-WASM loading contract, engine-driven animation, render-space precision, scenario data, CI, and staged demo implementation.
17. [Adaptive Demo Rendering and Runtime Populations](17-adaptive-demo-rendering-and-runtime-populations.md) — runtime synthetic asteroid overlays, camera-aware screen-space sizing, separation-aware enhancement, hierarchical LOD, and batched large-population rendering.
18. [Global Solar-System Context Presentation](18-global-solar-system-context-presentation.md) — persistent major-body context across local focus, marker floors, and same-frame renderer-state invariants.
19. [Celestial Appearance, Atmospheres, and Stellar Lighting](19-celestial-appearance-atmospheres-and-lighting.md) — presentation-owned surface/atmosphere appearance data, optical derivation, stellar illumination, shader semantics, lighting modes, provenance, and LOD integration.
20. [Reference Ephemeris Data and Pipeline](20-reference-ephemeris-data-and-pipeline.md) — DE441 source strategy, JPL/NAIF offline acquisition, OrbitEngine Ephemeris Pack (OEP), source-center/barycenter semantics, bounded reference evaluation, packaging, versioning, and validation.
21. [Numerical Propagation, Force Models, and Coupled N-Body Integration](21-numerical-propagation-force-models-and-coupled-nbody.md) — DOP853 integration, error control, deterministic forces/gravity sources, numerical caches, coupled local systems, mass authority, frame dynamics, and backend parity.
22. [Event-Driven Advancement and Fidelity Management](22-event-driven-advancement-and-fidelity-management.md) — exact mutable time, deterministic scheduled work, atomic advancement transactions, semantic fidelity requirements, promotion/demotion, invalidation, time warp, and parity.
23. [Predictive Encounters and Close-Approach Scheduling](23-predictive-encounters-and-close-approach-scheduling.md) — explicit encounter policy, hierarchy-aware swept-bound broad phase, coarse/refined closest approach, fidelity/coupled scheduling, invalidation and scaling.
24. [Collision Policy, Continuous Detection, and Physical Response](24-collision-policy-detection-and-response.md) — explicit collision relevance/geometry, continuous sphere contact, exact records, detect-only or frictionless impulse response, simultaneous-contact limits and invalidation.
25. [Active Spacecraft Thrust, Mass Flow, and Maneuver Execution](25-active-spacecraft-thrust-mass-flow-and-maneuvers.md) — exact impulses, bounded finite-thrust stages, frame/body direction, prescribed attitude, integrated physical mass flow, maneuver editing, Fidelity handoff and parity.
26. [Trajectory Planning, Transfers, Rendezvous, and Intercepts](26-trajectory-planning-transfers-rendezvous-and-intercepts.md) — read-only zero-revolution Lambert planning, moving targets, explicit central-body/frame assumptions, bounded search, stale-plan validation, maneuver application and numerical analysis.
27. [Optional Reusable Three.js Visualization Package](27-optional-threejs-visualization-package.md) — separate `orbit-engine-three` package, snapshot-driven rendering, semantic appearance/lighting, render-space precision, LOD/batching, resource ownership, demo migration, packaging and CI.
28. [Higher-Order Perturbation and Semi-Analytical Propagation](28-higher-order-perturbation-and-semi-analytical-propagation.md) — bounded `semiAnalytical/j2Secular` middle tier, shared physical J2 source, numerical J2 reference force, pole dependency, validity certificates, Fidelity switching and parity/performance contracts.
29. [Natural-Body Orientation, Rotation, and Body-Fixed Sources](29-natural-body-orientation-rotation-and-body-fixed-sources.md) — IAU/IERS/JPL/NAIF source precedence, separate ORP dataset, normalized quaternion Chebyshev evaluation, angular velocity, body-fixed registration, surface motion, J2 dependency and parity/caching.
30. [WidgetForge UI Architecture for the Solar-System Demo](30-widgetforge-solar-system-demo-ui.md) — Vue/WidgetForge application shell, locked Three.js viewport widget, top time-control dock, Settings/Object Inspector windows, semantic `ObjectId` selection, bridge ownership, bounded UI reactivity, and staged `DemoPanel` migration.

Project-level ChatGPT architecture context is maintained in [`../CHATGPT_CONTEXT.md`](../CHATGPT_CONTEXT.md).

## Architectural principles

- OrbitEngine is a reusable physics/orbit library, not a game layer.
- The engine simulates registered objects; it does not invent or generate them.
- A stable, never-reused object ID is the boundary between OrbitEngine and consuming systems.
- Object physical classification is separate from propagation model, fidelity, frame attachment, and game role.
- Propagation model is how state-at-time is computed; fidelity is the required error/interaction detail. They remain independent.
- Every model returns the same canonical frame-qualified Cartesian state at an exact requested instant; model-specific elements/checkpoints never replace that physical handoff state.
- Model switching is an explicit exact-time transaction and cannot create an unphysical state jump or silently restore an original reference trajectory after divergence.
- Stable astronomical trajectories should be cheap to query across large time jumps.
- Expensive simulation is activated only where interaction, perturbation, maneuvering, or collision risk requires it.
- Production numerical translation uses local adaptive DOP853 authorities with explicit force/source configuration; true mutual interaction is represented by bounded coupled authorities rather than global ticking or cyclic single-object dependencies.
- The first production cheaper-than-numerical perturbation tier is an explicit `semiAnalytical/j2Secular` model for stable bound central-body motion; it uses the same revisioned J2 physical source as the numerical J2 force provider and never silently adds other perturbations.
- Mutable time advancement is exact and event-driven: the engine jumps between scheduled instants, drains deterministic same-time transactions, and keeps pure state-at-time queries separate from mutable event processing.
- Fidelity is a semantic accuracy/interaction requirement, not a rendering signal and not a direct propagator enum; promotion/demotion uses explicit exact-time authority transactions and anti-thrashing validation.
- Encounter prediction is revision-aware derived scheduling data built from explicit policy, conservative broad-phase bounds and bounded refinement; it never becomes motion authority or a second global pair loop.
- Collision relevance is a separate revisioned policy; v1 continuous sphere contact reuses encounter broad phase and any physical response is an explicit exact-time engine transaction rather than a gameplay outcome.
- Maneuvers are physical commands, not game propulsion models: exact impulses and bounded finite-burn stages feed the numerical force/mass authority with explicit frame/attitude semantics and exact event boundaries.
- Trajectory planning is read-only derived analysis until explicitly applied; v1 Lambert plans use authoritative moving-object states and explicit central-body/frame assumptions, then enter simulation only through ordinary maneuver transactions.
- Canonical physical values use SI units; absolute simulation time uses the exact TDB/J2000 representation defined in document 12 rather than wall-clock/civil time.
- Canonical dynamic translational handoff state is Cartesian position/velocity at an exact epoch in a defined frame.
- The canonical root is SSB-centered and ICRS/ICRF-aligned; local/reference-frame state is preserved so precision-sensitive work is not forced through giant root coordinates.
- Frame transforms are geometric and same-epoch; propagation changes time, frame transforms do not.
- Natural-body orientation is pinned reference data independent from translation: ORP sources reproduce explicit IAU/IERS/JPL/NAIF orientation baselines as quaternion + angular velocity and never fall back silently to constant spin.
- Body-fixed/surface-attached motion uses the ordinary frame graph; shared orientation sources are cached and also provide pole dependencies to J2/force models without introducing a second rotation authority.
- Public simulation behavior is exposed through TypeScript even when calculations execute in C++.
- The portable C++ core must not depend on Node.js or Emscripten APIs.
- Native and WASM backends must preserve equivalent public semantics.
- `orbit-engine` and the portable core remain free of Three.js/WebGL/DOM/rendering dependencies. Optional reusable rendering lives in the separate `orbit-engine-three` companion package defined by document 27.
- `orbit-engine-three` consumes authoritative snapshots/public read APIs and is never physical authority; visual size, camera, selection, shader state and render cadence cannot alter simulation semantics.
- The Solar-System demo may use Vue/WidgetForge as application UI, but those dependencies remain demo-only; simulation/render authority stays outside Vue and semantic selection crosses the UI/render boundary only as stable `ObjectId` values.
- Appearance/atmosphere/stellar-rendering metadata remains presentation/dataset data rather than `orbit-engine` physical state unless a separately designed physical engine capability explicitly requires equivalent physical information.
- Production reference ephemerides and orientation sources are pinned, offline-normalized scenario data evaluated by the shared portable core; live astronomy services and mutable external kernels never define normal runtime state.
- Every issue must declare exactly one authoritative task type before execution.

When an architectural decision changes, update the relevant document in the same pull request.
