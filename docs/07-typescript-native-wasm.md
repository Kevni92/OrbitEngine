# 07 — TypeScript, Native C++, and WebAssembly

## Goal

OrbitEngine is consumed as one npm package through a TypeScript API while allowing performance-critical simulation code to execute in C++.

Two compiled backends wrap the same portable C++ core:

1. a native Node.js addon for the primary Node runtime path;
2. a WebAssembly build for fallback/portability and browser reference-consumer execution.

The concrete repository, packaging, initialization, artifact, test, and CI decisions are defined in [11 — Build, Package, and Backend Architecture](11-build-package-and-backend-architecture.md). The browser reference-application extension is defined in [16 — Browser Solar-System Demo Architecture](16-browser-solar-system-demo.md).

Canonical physics/contracts are defined by:

- [12 — Simulation Time, Units, and Numerical Precision](12-simulation-time-units-and-precision.md);
- [13 — Physical Object and State Model](13-physical-object-and-state-model.md);
- [14 — Reference Frames and Coordinate System](14-reference-frames-and-coordinate-system.md);
- [15 — Propagation Contract and Model Switching](15-propagation-contract-and-model-switching.md).

## Layering

```text
TypeScript public API
        |
backend abstraction
   /          \
Node native   WASM adapter
binding       binding
   \          /
    portable C++ core
```

Browser/demo consumers sit above the same public TypeScript API; they do not import the WASM adapter directly.

## Portable C++ core rules

The core must:

- contain authoritative runtime object/frame registries, motion-segment/model authority, and physics/math/performance-critical algorithms where justified;
- use portable C++20 without direct Node-API or Emscripten dependencies;
- expose a narrow C++ interface suitable for multiple bindings;
- avoid game/domain concepts;
- be testable directly in C++.

Likely C++ candidates include:

- object and frame registry/lifecycle plus dense internal indexing;
- reference-frame transform composition and relative-state queries;
- authoritative propagation segments/model switching/reference divergence;
- analytical propagation and numerical integrators;
- deterministic force-provider execution;
- encounter/broad-phase algorithms;
- trajectory solvers;
- batch physics calculations.

Moving a feature into C++ still requires architectural or measured justification; C++ is not the default location merely because it is available.

## Native binding

The native backend uses Node-API through `node-addon-api`; direct V8 APIs and NAN are not part of the architecture.

Native code is limited to the binding/adapter layer plus the portable core it links. The initial release ships prebuilt Windows x64 and glibc Linux x64 addons. Consumers do not compile the addon during normal npm installation.

The initial binding targets Node-API version 8 to preserve ABI portability across the supported Node 22 and Node 24 LTS lines.

## WebAssembly binding

The WASM backend compiles the same portable core with Emscripten. WASM-specific exports, initialization, memory handling, and marshalling belong only in the WASM adapter/binding layer.

The WASM loading path must not statically depend on Node-only APIs.

The browser Solar-System reference application makes browser use of the packaged WASM backend an explicit supported project consumer shape. This does not create a second browser physics implementation: the browser still executes the same portable C++ core through the normal public TypeScript facade.

### Browser bundle-safe asset contract

A browser consumer must be able to use:

```text
await OrbitEngine.create({ backend: "wasm" })
```

without importing package internals or manually copying Emscripten artifacts.

The package owns resolution of its generated Emscripten module and `.wasm` binary. To remain compatible with modern ESM bundlers such as Vite/Rollup, the WASM loader uses statically discoverable package-relative references as defined by document 16:

- a literal dynamic ESM import specifier for the generated `orbit_engine_wasm.js` factory;
- a literal `new URL(..., import.meta.url)` reference for `orbit_engine_wasm.wasm`;
- explicit `locateFile` handling for the known generated binary filename;
- no runtime-concatenated arbitrary package path and no consumer-facing Vite-specific `?url` contract.

This preserves lazy backend initialization while allowing a consuming browser build to discover/rewrite the package-owned artifacts.

## TypeScript API and backend selection

Consumers initialize the engine through an asynchronous factory conceptually equivalent to:

```text
await OrbitEngine.create({ backend: "auto" | "native" | "wasm" })
```

The backend option is optional and defaults to `auto`.

Semantics:

- `auto` — prefer a supported native addon in Node.js; fall back to WASM only when native is unavailable before successful initialization;
- `native` — require native and fail clearly when unsupported, missing, unloadable, incompatible, or unable to initialize;
- `wasm` — initialize WASM directly and never probe/load native code.

Once a valid native module is loaded, protocol mismatch or backend initialization failures are surfaced rather than silently hidden by a WASM fallback.

The reference browser demo deliberately selects `wasm` rather than `auto` so it continuously validates the browser/WASM consumer path.

### Exact clock and scheduled work queue

`OrbitEngine` exposes one backend-neutral exact clock and one deterministic scheduled-work queue:

```ts
engine.currentTime
engine.clock()
engine.advanceTo(target)
engine.advanceBy(duration)
engine.scheduleWork({ instant, phase, sourceKind, sourceId, payload })
engine.replaceScheduledWork(id, generation, replacement)
engine.cancelScheduledWork(id, generation)
engine.listScheduledWorkDiagnostics()
```

The clock is represented as the normalized integer `SimulationInstant`, never as floating-point total seconds. Work records receive monotonically allocated, never-reused `ScheduledWorkId` values and an explicit generation. Queue ordering is by exact instant, semantic phase, source kind, source ID, source ordinal, and finally work ID. Cancellation and replacement require the exact ID/generation pair; past work is rejected and same-time work requires explicit opt-in while a timestamp transaction is being drained. Queue limits and all wire marshalling are shared by the native and WASM adapters; the portable C++ core contains no Node.js or Emscripten dependency.

Advancement jumps directly to the next due timestamp and drains that timestamp as one atomic transaction, including newly scheduled same-time work. A failed work item or exhausted transaction budget restores the queue and leaves the clock at the last committed instant; the returned backend-neutral `AdvanceResult` carries the failure category and work identity. `stateAt(...)` remains a pure query and does not participate in mutable advancement.

### Semantic fidelity management

The public fidelity API expresses physical accuracy and interaction requirements rather than a propagator enum:

```ts
engine.configureFidelityCandidates(objectId, candidates)
engine.setFidelitySignal(objectId, signalId, requirementOrNull)
engine.setMinimumFidelityRequirement(objectId, requirementOrNull)
engine.getFidelityStatus(objectId)
```

Requirements combine monotonically: stricter error budgets use the smaller bound, interaction capabilities combine by logical OR, gravity-source requirements use set union, and reason/re-evaluation metadata is retained deterministically. Candidate selection first preserves a satisfying current authority and otherwise chooses the cheapest satisfying configured candidate with stable tie-breaks. No camera, zoom, renderer, UI, ownership, or game-priority state participates. If no configured candidate can prove the effective physical requirement, the API reports an explicit `FidelitySelectionError` and never silently downgrades. This policy layer is backend-neutral, so native and WASM expose identical requirement, selection, and diagnostic semantics.

Configured executable candidates may additionally be bound to the existing exact-time `MotionAuthority` transaction. Promotion evaluates and validates the canonical handoff before committing; demotion requires the configured minimum dwell, quiet-window, bounded retry/backoff, and future acceptance-horizon representability checks. A failed promotion or demotion leaves the previous authority and segment history unchanged. The motion authority's one-way `followingReference` → `diverged` rule remains in force, including after later demotion or coupled-authority exit.

Raw binding objects, Emscripten modules, artifact paths, backend implementation classes, dense indexes, propagator/provider vtables, integrator work arrays, cache handles, and pointers are not exported from the normal public package entry point.

## Numeric, time, object, frame, and propagation transfer contract

Canonical continuous physical values cross as IEEE-754 binary64 (`number` ↔ C++ `double` ↔ WASM `f64`) and are never silently down-cast to f32.

`SimulationInstant`/`Duration` cross through the exact integer codec from document 12, never floating total seconds.

`ObjectId` and `ReferenceFrameId` are separate nominal canonical decimal strings in the public TypeScript API and `uint64_t` values in the portable core. Native/WASM adapters preserve each full value exactly through unsigned high/low 32-bit words or an equivalent lossless i64 mechanism; IDs are never marshalled through binary64.

`ObjectType` and `PropagationModelKind` expose stable named values at the TypeScript layer and stable compact integer codes at the backend boundary. Unknown/reserved codes are rejected rather than interpreted heuristically.

Cartesian states transfer f64 position/velocity plus exact epoch and exact frame ID. Frame rigid-state transforms transfer f64 translation, origin velocity, scalar-first quaternion `(w,x,y,z)`, and angular velocity plus exact epoch/IDs.

Propagation operations additionally transfer exact model/segment/revision/switch discrete state where public operations require it. Continuity/error tolerances remain explicit f64 SI values rather than one hidden global epsilon.

Optional physical/attitude values use explicit presence state, never `NaN` sentinels. Batch interfaces use binary64 arrays for continuous data and integer typed arrays/exact fields for IDs, model/type codes, revisions, and time values.

Backend-specific packing is internal and must not leak into public value shapes.

## Propagation API boundary

Normal TypeScript consumers use stable high-level operations such as:

- register/configure initial motion authority;
- create a numerical motion authority from an exact anchor, explicit DOP853 tolerances/step bounds, optional mass, constant acceleration, and explicit gravity sources through `OrbitEngine.numericalMotion(...)`;
- query state at exact time, optionally in a requested output frame;
- request an explicit model/configuration switch at an exact simulation time;
- apply supported exact-time physical impulses/state changes;
- provide supported deterministic force/mass/maneuver definitions;
- inspect intentionally exposed model/reference status metadata.

The numerical facade exposes `stateAt(T)`, `massAt(T)`, a backend-neutral propagation model declaration, and normalized propagation errors. It does not expose DOP853 stages, dense-output arrays, cache handles, native pointers, Emscripten modules, or per-stage JavaScript callbacks. The numerical operation is transferred as one validated f64/exact-time wire request and is evaluated by the same portable C++ core for native and WASM. Explicit work budgets (checkpoint stride/capacity, dense-step capacity, accepted/rejected-step limits) are part of the configuration so bounded resource exhaustion is observable rather than hidden.

For true mutual interaction, consumers use `OrbitEngine.coupledMotion(...)` with a bounded group of 2–32 members. Promotion, same-time batch evaluation, demotion, and removal are one model-neutral authority operation; `bindCoupledMotion(...)` exposes the resulting members through the normal state-query API. The coupled authority preserves exact member IDs, epochs, frames, masses, and revisions while keeping group bookkeeping and integration in the portable core.

TypeScript performs public input validation and error normalization, but the authoritative segment graph, switch transaction, reference-divergence transition, force evaluation order, and cache revisions live in portable C++.

The adapters must not maintain their own model-switch or divergence state machines.

## Browser rendering boundary

Browser rendering/UI frameworks remain consumers of the public API.

Three.js, DOM APIs, Vite, camera coordinates, visual scale, labels, textures, and render loops are not OrbitEngine concepts. A browser render loop may choose which `SimulationInstant` to request, but it must never integrate object positions locally and then treat those values as authoritative engine state.

For precision-sensitive views, browser consumers should use the same public local/relative frame queries as other consumers rather than materializing giant root coordinates and subtracting them in rendering code.

## Force callback boundary

The base numerical force hot loop executes in portable C++ or consumes normalized deterministic provider data owned by the core.

Arbitrary per-step JavaScript callbacks are not part of the base native/WASM contract. Introducing them later would require explicit architecture for re-entrancy, callback cost, deterministic ordering, WASM/native equivalence, and failure semantics.

## Performance boundary

Crossing JavaScript ↔ native/WASM boundaries has overhead. Prefer batch-oriented registration/state/frame/propagation-query interfaces for large data sets rather than thousands of tiny calls.

For many object queries at one epoch, the backend should reuse propagation dependencies and frame-edge transforms in the portable core rather than marshalling intermediate model/frame state through TypeScript repeatedly.

The browser reference demo follows this rule: once #20's batch same-epoch state API is available, one visual update should request the visible object set in a bounded batch rather than issue a backend call per body.

Keep orchestration, public validation, canonical ID parsing/formatting, unit conversion, and convenience coordinate conversions in TypeScript unless measurement or architecture justifies moving work into C++.

The authoritative live/retired object/frame registries and authoritative propagation motion-segment state belong to the portable core so native and WASM cannot diverge in lifecycle/topology/motion semantics.

## Testing expectation

Where both backends implement the same feature, shared parity tests execute the same high-level scenario against native and WASM.

Exact integer/time/object-ID/frame-ID/type/model-kind/segment-boundary/switch-outcome/lifecycle behavior must match exactly. Floating-point state/frame/propagation results use documented feature-specific numerical tolerances; parity does not require unconditional bit-identical floating-point results across native and WASM.

Quaternion parity is orientation-equivalent rather than sign-sensitive because `q` and `-q` represent the same rotation.

Propagation parity additionally checks deterministic provider ordering, exact invalidation boundaries, and that failed model switches leave the same authoritative state/revision untouched on both backends.

Backend-specific tests additionally cover loading, initialization, marshalling, artifact resolution, and error translation. Portable core behavior is tested directly in C++ through CTest.

Browser support adds a packaged-consumer smoke test in a real headless browser. It must initialize `OrbitEngine.create({ backend: "wasm" })` through the public package and fail if the generated Emscripten JS/WASM assets cannot be resolved by the browser bundle.
