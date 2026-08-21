# 07 — TypeScript, Native C++, and WebAssembly

## Goal

OrbitEngine is consumed as one npm package through a TypeScript API while allowing performance-critical simulation code to execute in C++.

Two compiled backends wrap the same portable C++ core:

1. a native Node.js addon for the primary Node runtime path;
2. a WebAssembly build for fallback/portability.

The concrete repository, packaging, initialization, artifact, test, and CI decisions are defined in [11 — Build, Package, and Backend Architecture](11-build-package-and-backend-architecture.md).

Canonical contracts are defined by:

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

The WASM loading path must not statically depend on Node-only APIs. Browser support is not currently a product requirement, but the WASM backend must not be needlessly prevented from running in a non-Node environment.

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
- query state at exact time, optionally in a requested output frame;
- request an explicit model/configuration switch at an exact simulation time;
- apply supported exact-time physical impulses/state changes;
- provide supported deterministic force/mass/maneuver definitions;
- inspect intentionally exposed model/reference status metadata.

TypeScript performs public input validation and error normalization, but the authoritative segment graph, switch transaction, reference-divergence transition, force evaluation order, and cache revisions live in portable C++.

The adapters must not maintain their own model-switch or divergence state machines.

## Force callback boundary

The base numerical force hot loop executes in portable C++ or consumes normalized deterministic provider data owned by the core.

Arbitrary per-step JavaScript callbacks are not part of the base native/WASM contract. Introducing them later would require explicit architecture for re-entrancy, callback cost, deterministic ordering, WASM/native equivalence, and failure semantics.

## Performance boundary

Crossing JavaScript ↔ native/WASM boundaries has overhead. Prefer batch-oriented registration/state/frame/propagation-query interfaces for large data sets rather than thousands of tiny calls.

For many object queries at one epoch, the backend should reuse propagation dependencies and frame-edge transforms in the portable core rather than marshalling intermediate model/frame state through TypeScript repeatedly.

Keep orchestration, public validation, canonical ID parsing/formatting, unit conversion, and convenience coordinate conversions in TypeScript unless measurement or architecture justifies moving work into C++.

The authoritative live/retired object/frame registries and authoritative propagation motion-segment state belong to the portable core so native and WASM cannot diverge in lifecycle/topology/motion semantics.

## Testing expectation

Where both backends implement the same feature, shared parity tests execute the same high-level scenario against native and WASM.

Exact integer/time/object-ID/frame-ID/type/model-kind/segment-boundary/switch-outcome/lifecycle behavior must match exactly. Floating-point state/frame/propagation results use documented feature-specific numerical tolerances; parity does not require unconditional bit-identical floating-point results across native and WASM.

Quaternion parity is orientation-equivalent rather than sign-sensitive because `q` and `-q` represent the same rotation.

Propagation parity additionally checks deterministic provider ordering, exact invalidation boundaries, and that failed model switches leave the same authoritative state/revision untouched on both backends.

Backend-specific tests additionally cover loading, initialization, marshalling, artifact resolution, and error translation. Portable core behavior is tested directly in C++ through CTest.
