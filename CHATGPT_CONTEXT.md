# ChatGPT Project Context — OrbitEngine Architecture

Use this file as the persistent context for the ChatGPT Project that plans and executes OrbitEngine architecture work.

## Project

Repository: `Kevni92/OrbitEngine`

OrbitEngine is a standalone astronomical/orbital simulation engine intended to be consumed as an npm package through a TypeScript API. It exists to provide physically plausible time, position, orbit, trajectory, reference-frame, encounter, and collision behavior for a larger space-simulation game.

The motivating game is a deep 4X/simulation game inspired in simulation depth by Aurora 4X and in setting/physical plausibility by The Expanse. Travel inside the Solar System should take realistic amounts of time, and the game may simulate roughly ±1000 years around its chosen era. The game layer will eventually contain deep population, economy, logistics, resources, settlements, ships, stations, and warfare systems, but those systems are deliberately outside OrbitEngine.

## Core boundary

OrbitEngine is a reusable physics/orbit library, not the game simulation.

OrbitEngine may know:

- stable object IDs;
- physical object types such as star, planet, moon, dwarf planet, asteroid, comet, spacecraft, station, artificial satellite, debris, and surface-bound objects;
- mass, radius/collision geometry, position, velocity, rotation, epoch, reference frame, and motion/propagation state;
- time and time advancement;
- hierarchical coordinate/reference frames;
- orbit propagation;
- numerical force/integration models;
- thrust/external impulses;
- trajectories and transfers;
- encounter detection;
- collision policies and collision detection;
- fidelity/precision management;
- mapping between local and absolute positions.

OrbitEngine must not know game-domain concepts such as:

- population;
- housing;
- jobs;
- economy;
- goods/resources as economic entities;
- ownership/factions;
- mines/factories as gameplay concepts;
- military doctrine;
- settlement logic.

The game associates its own entities with OrbitEngine objects through stable IDs.

## Object and data principles

The engine does not generate celestial bodies. A separate importer/generator/scenario layer creates object definitions and registers them with OrbitEngine.

For the primary game scenario, a reproducible Solar-System database/import process should use authoritative astronomical data (for example JPL/NASA sources) to provide known bodies and their physical/orbital properties. Runtime simulation must not depend on live external APIs.

Known natural objects may initially follow high-quality reference ephemerides/known trajectories. If gameplay physically changes an object's state, that object becomes a diverged/dynamic object and must continue from its new physical state rather than snapping back to its original reference ephemeris.

A body's physical state is fundamentally position + velocity + epoch in a defined reference frame, with additional physical properties as required. Orbital elements may be derived/used for efficient propagation but must not erase state changes caused by gameplay.

## Propagation and fidelity are separate

Do not conflate the chosen propagation model with simulation fidelity.

Possible propagation approaches include:

- reference ephemeris lookup/interpolation;
- analytic/Kepler propagation;
- perturbed analytic/semi-analytic propagation;
- numerical integration;
- active-thrust trajectory propagation;
- parent/surface-fixed motion in a reference frame.

Fidelity describes how much computation/precision/interactions are activated for the current situation. An object can be dynamically changed, receive a new orbit, and later return to cheap analytic propagation without returning to its original real-world trajectory.

High precision should activate only when required by encounters, maneuvers, collisions, strong perturbations, rendezvous, etc.

## Event-driven performance model

OrbitEngine must not rely on globally ticking every object at high precision or testing every pair continuously.

Expected principles:

- cheap propagation for stable trajectories;
- broad-phase spatial/orbital filtering;
- future encounter/event prediction;
- event queues/time windows;
- progressive refinement as an encounter approaches;
- high-fidelity local simulation only where needed;
- recompute future encounters when relevant trajectories change;
- support large time jumps/time warp without stepping through every tiny simulation tick.

Collision/interaction behavior should be configurable by object type/policy. Game-relevant dynamic objects such as spacecraft and stations are especially collision-relevant. Stable reference celestial bodies do not need wasteful mutual collision checks when their known evolution already excludes such interactions. A gameplay-diverged body can become collision/encounter relevant.

Gravity interaction and collision interaction are conceptually separate policies.

## Coordinates and reference frames

The engine must support hierarchical reference frames rather than relying on one naive giant coordinate system for every local operation.

Examples:

- Solar System barycentric frame;
- heliocentric frame;
- planet-centered inertial frames;
- rotating planet-fixed frames;
- moon-centered frames;
- local surface frames;
- object/vehicle local frames where needed.

A building may be surface-fixed to Mars using local/geographic coordinates while the engine can still return its absolute position in the Solar-System frame at any requested simulation time.

## Trajectories and spacecraft

Spacecraft are abstract physical OrbitEngine objects. The game provides the physical inputs derived from gameplay systems, such as mass, available thrust, fuel/propellant parameters, engine limits, orientation, and commands.

OrbitEngine calculates the resulting motion/trajectory. Trajectory planning and trajectory execution/simulation should remain conceptually separable.

The long-term target is physically plausible spacecraft transfer calculation based on actual positions, velocities, mass, thrust capability, and time rather than abstract instant travel.

## Technology architecture

Public consumer API: TypeScript/npm.

Performance-sensitive core: portable C++ where justified.

The C++ core must remain independent from Node.js and Emscripten-specific APIs so the same core can be wrapped by:

- a native Node.js addon through Node-API/N-API;
- a WebAssembly build through Emscripten.

TypeScript is the stable public-facing API/adapter layer. Native and WASM backends should expose equivalent semantics and should not fork the underlying physics implementation.

Do not prematurely move everything into C++. Keep boundaries designed for native acceleration, but use profiling/evidence to decide where native code is justified. Spikes are appropriate for uncertain performance/interop questions.

## Documentation source of truth

Before making architecture decisions, read the repository documentation, especially:

- `docs/README.md`
- `docs/01-vision-and-scope.md`
- `docs/02-architecture.md`
- `docs/03-object-model-and-interactions.md`
- `docs/04-propagation-fidelity-and-events.md`
- `docs/05-coordinates-and-reference-frames.md`
- `docs/06-solar-system-data.md`
- `docs/07-typescript-native-wasm.md`
- `docs/08-development-workflow.md`
- `docs/10-task-types-and-agent-routing.md`
- `AGENTS.md`
- `CLOUD.md`

Repository documentation is canonical. If a new architecture decision changes previous documentation, update the affected documents in the same architecture PR.

## Working model: ChatGPT plans, Codex implements

The normal project workflow is:

1. Discuss requirements and architecture in this ChatGPT Project.
2. Refine tasks until they are clear enough to classify and create as GitHub issues.
3. Create detailed issues here in ChatGPT.
4. Execute Architecture issues here in the ChatGPT architecture workflow.
5. Execute Implementation issues locally with Codex.
6. Execute Spikes either here or locally; local Codex requires explicit confirmation first.
7. Every repository-changing task follows the mandatory Git workflow and ends with a merged PR.

The goal is to reserve expensive architectural reasoning for Architecture tasks while keeping Implementation issues deterministic enough for a faster/token-efficient local coding model.

## Mandatory issue task types

Every issue must contain exactly one authoritative marker near the top of the issue body:

`Task Type: Architecture`

or

`Task Type: Implementation`

or

`Task Type: Spike`

Use the matching issue template/title prefix. Matching GitHub labels should be applied when available, but the body marker is authoritative.

### Architecture

Architecture issues contain consequential design decisions, subsystem boundaries, contracts, algorithm choices, numerical strategies, or architecture-level trade-offs.

They may be executed only in this ChatGPT architecture workflow. Local Codex must refuse them.

A good Architecture result should make implementation substantially mechanical. Expected outcomes can include:

- selected approach;
- relevant rejected alternatives/trade-offs;
- invariants and responsibilities;
- data ownership;
- API/contracts;
- numerical/performance constraints;
- architecture documentation/ADR-like record;
- follow-up Implementation issues.

When an Architecture issue requires repository changes, ChatGPT performs them under the same Git workflow as any other task.

### Implementation

Implementation issues are primarily execution tasks whose architecture has already been decided.

They are intended for local Codex. ChatGPT should discuss/refine/create them, but normally should not implement them unless the user explicitly changes the workflow.

Implementation issues should be detailed enough that Codex does not need to invent consequential architecture. Include relevant docs/contracts, exact behavior, non-goals, edge cases, validation/tests, and objective acceptance criteria.

If Codex discovers an unresolved non-trivial architecture decision, it must stop and report the blocker instead of silently deciding. The decision returns to this ChatGPT Project and may become an Architecture issue.

### Spike

Spikes reduce uncertainty through research, prototype, benchmark, or experiment.

They may be executed here or locally. Local Codex must ask the user for explicit confirmation once after identifying the issue as a Spike and before substantive work begins.

Spike results should separate evidence/observations from recommendations and unresolved questions. A Spike does not automatically establish production architecture.

## How to classify work

Use **Implementation** when the task can be completed correctly from existing documented contracts without a consequential design decision.

Use **Architecture** when the consequential design decision is itself the work.

Use **Spike** when evidence or experimentation is needed before deciding which architecture/technology is viable.

If an issue appears to mix Architecture and Implementation, split it: resolve the architecture first, then create one or more Implementation issues.

## GitHub issue authoring standard

When the user says an issue is ready, create it in `Kevni92/OrbitEngine` with:

- correct task type marker near the top;
- matching title prefix (`[ARCH]`, `[IMPL]`, `[SPIKE]` or an equivalent clear convention);
- concise goal/background;
- explicit scope;
- architecture references/constraints;
- non-goals where useful;
- implementation/decision requirements;
- edge cases and performance/numerical constraints where relevant;
- required tests/validation;
- objective acceptance criteria;
- dependencies/follow-ups if known.

Do not put `Closes #...` in the issue itself. The implementing PR must contain `Closes #<issue-number>`.

## Mandatory repository workflow

For every repository-changing task that is permitted to execute:

1. Read `AGENTS.md`, relevant docs, and the full issue.
2. Start from a clean, current `main`.
3. Create a dedicated branch from `main` for that issue.
4. Keep changes limited to the issue scope.
5. Update tests and documentation as required.
6. Run all relevant local checks that actually exist.
7. Fix known failures.
8. Commit and push the issue branch.
9. Open a PR targeting `main`.
10. Put `Closes #<issue-number>` in the PR body.
11. Wait for all configured/required CI checks.
12. Fix failures on the same branch and rerun checks as needed.
13. Merge to `main` only when acceptance criteria are met and required CI is green.
14. Verify the linked issue closes automatically.

Opening a PR is not completion. Merge is part of the task.

If CI does not exist, state that explicitly; never describe nonexistent checks as green.

## Architecture-session procedure

When working through an Architecture issue in this ChatGPT Project:

1. Restate the architectural problem and hard constraints.
2. Identify existing repository decisions that constrain the answer.
3. Identify open decisions explicitly rather than mixing them with implementation details.
4. Compare meaningful options where there is a real trade-off.
5. Prefer the simplest design that satisfies realism, correctness, scalability, portability, and testability requirements.
6. Define invariants and ownership boundaries before concrete class/module names where possible.
7. Decide how the architecture is validated: reference data, numerical tolerances, deterministic tests, benchmarks, or Spikes.
8. Record the decision in repository documentation on the Architecture issue branch.
9. Create/identify the follow-up Implementation issues needed to realize it.
10. Open the PR with `Closes #...`, verify CI/checks, and merge when complete.

Do not leave important architecture implicit in chat history. Durable decisions belong in repository docs.

## Design priorities

When trade-offs arise, prioritize:

1. correct and explicit simulation semantics;
2. deterministic/testable behavior;
3. scalability to large Solar-System object counts and time warp;
4. clean separation between OrbitEngine and game layers;
5. backend-independent C++ core and stable TypeScript API;
6. performance optimization based on evidence rather than premature complexity.

Do not sacrifice physical consistency merely to simplify one current implementation task. Equally, do not pursue scientific precision that has no gameplay or architectural value when a documented approximation provides stable, plausible results within required tolerances.
