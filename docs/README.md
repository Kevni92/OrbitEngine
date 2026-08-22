# OrbitEngine Documentation

This directory is the canonical architectural documentation for OrbitEngine. Agents and contributors should begin here before changing implementation behavior.

## Contents

1. [Vision and Scope](01-vision-and-scope.md) — goals, boundaries, realism target, and non-goals.
2. [Architecture](02-architecture.md) — major subsystems and separation between engine, data ingestion, and game layers.
3. [Object Model and Interactions](03-object-model-and-interactions.md) — object/interaction summary and links to the canonical object contract.
4. [Propagation, Fidelity, and Events](04-propagation-fidelity-and-events.md) — propagation/fidelity overview, encounters, events, and time warp.
5. [Coordinates and Reference Frames](05-coordinates-and-reference-frames.md) — reference-frame overview and links to the canonical frame contract.
6. [Solar-System Data](06-solar-system-data.md) — external astronomical data boundary and reproducible import strategy.
7. [TypeScript, Native C++, and WebAssembly](07-typescript-native-wasm.md) — npm API and dual C++ backend strategy.
8. [Development Workflow](08-development-workflow.md) — mandatory issue/branch/PR/CI/merge workflow.
9. [Glossary](09-glossary.md) — shared terminology.
10. [Task Types and Agent Routing](10-task-types-and-agent-routing.md) — Architecture, Implementation, Spike, Codex refusal/confirmation rules, and escalation.
11. [Build, Package, and Backend Architecture](11-build-package-and-backend-architecture.md) — concrete pnpm/CMake layout, backend selection, artifact distribution, platform support, tests, and CI contract.
12. [Simulation Time, Units, and Numerical Precision](12-simulation-time-units-and-precision.md) — SI unit contract, TDB/J2000 time model, exact durations, binary64 policy, time-warp semantics, and backend transfer rules.
13. [Physical Object and State Model](13-physical-object-and-state-model.md) — exact object identity/type contract, canonical Cartesian state, optional physical properties, divergence semantics, lifecycle, and backend representation.
14. [Reference Frames and Coordinate System](14-reference-frames-and-coordinate-system.md) — SSB/ICRS root, frame identity/graph, rigid-state transforms, quaternion convention, local/relative precision, surface attachment, lifecycle, caching, and backend contract.
15. [Propagation Contract and Model Switching](15-propagation-contract-and-model-switching.md) — motion authority/segments, common state-at-time contract, model taxonomy, permanent divergence, safe switching, fidelity boundary, forces/mass, caching, and backend ownership.
16. [Browser Solar-System Demo Architecture](16-browser-solar-system-demo.md) — private Vite/Three.js reference application, browser-WASM loading contract, engine-driven animation, render-space precision, scenario data, CI, and staged demo implementation.
17. [Adaptive Demo Rendering and Runtime Populations](17-adaptive-demo-rendering-and-runtime-populations.md) — runtime synthetic asteroid overlays, camera-aware screen-space sizing, separation-aware enhancement, hierarchical LOD, and batched large-population rendering.

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
- Canonical physical values use SI units; absolute simulation time uses the exact TDB/J2000 representation defined in document 12 rather than wall-clock/civil time.
- Canonical dynamic translational handoff state is Cartesian position/velocity at an exact epoch in a defined frame.
- The canonical root is SSB-centered and ICRS/ICRF-aligned; local/reference-frame state is preserved so precision-sensitive work is not forced through giant root coordinates.
- Frame transforms are geometric and same-epoch; propagation changes time, frame transforms do not.
- Public behavior is exposed through TypeScript even when calculations execute in C++.
- The portable C++ core must not depend on Node.js or Emscripten APIs.
- Native and WASM backends must preserve equivalent public semantics.
- Browser/reference applications consume the public package from outside the engine boundary; rendering frameworks never become engine dependencies or authoritative physics state.
- Every issue must declare exactly one authoritative task type before execution.

When an architectural decision changes, update the relevant document in the same pull request.
