# OrbitEngine Documentation

This directory is the canonical architectural documentation for OrbitEngine. Agents and contributors should begin here before changing implementation behavior.

## Contents

1. [Vision and Scope](01-vision-and-scope.md) — goals, boundaries, realism target, and non-goals.
2. [Architecture](02-architecture.md) — major subsystems and separation between engine, data ingestion, and game layers.
3. [Object Model and Interactions](03-object-model-and-interactions.md) — stable IDs, object types, physical state, reference vs. diverged objects, and collision/interaction policies.
4. [Propagation, Fidelity, and Events](04-propagation-fidelity-and-events.md) — propagation models, dynamic fidelity, encounters, collisions, and time warp.
5. [Coordinates and Reference Frames](05-coordinates-and-reference-frames.md) — hierarchical frames, surface-fixed objects, and absolute positions.
6. [Solar-System Data](06-solar-system-data.md) — external astronomical data boundary and reproducible import strategy.
7. [TypeScript, Native C++, and WebAssembly](07-typescript-native-wasm.md) — npm API and dual C++ backend strategy.
8. [Development Workflow](08-development-workflow.md) — mandatory issue/branch/PR/CI/merge workflow.
9. [Glossary](09-glossary.md) — shared terminology.
10. [Task Types and Agent Routing](10-task-types-and-agent-routing.md) — Architecture, Implementation, Spike, Codex refusal/confirmation rules, and escalation.
11. [Build, Package, and Backend Architecture](11-build-package-and-backend-architecture.md) — concrete pnpm/CMake layout, backend selection, artifact distribution, platform support, tests, and CI contract.
12. [Simulation Time, Units, and Numerical Precision](12-simulation-time-units-and-precision.md) — SI unit contract, TDB/J2000 time model, exact durations, binary64 policy, time-warp semantics, and backend transfer rules.

Project-level ChatGPT architecture context is maintained in [`../CHATGPT_CONTEXT.md`](../CHATGPT_CONTEXT.md).

## Architectural principles

- OrbitEngine is a reusable physics/orbit library, not a game layer.
- The engine simulates registered objects; it does not invent or generate them.
- A stable object ID is the boundary between OrbitEngine and consuming systems.
- Fidelity is independent from the chosen propagation model.
- Stable astronomical trajectories should be cheap to query across large time jumps.
- Expensive simulation is activated only where interaction, perturbation, maneuvering, or collision risk requires it.
- Canonical physical values use SI units; absolute simulation time uses the exact TDB/J2000 representation defined in document 12 rather than wall-clock/civil time.
- Public behavior is exposed through TypeScript even when calculations execute in C++.
- The portable C++ core must not depend on Node.js or Emscripten APIs.
- Native and WASM backends must preserve equivalent public semantics.
- Every issue must declare exactly one authoritative task type before execution.

When an architectural decision changes, update the relevant document in the same pull request.
