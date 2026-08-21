# 07 — TypeScript, Native C++, and WebAssembly

## Goal

OrbitEngine is consumed as one npm package through a TypeScript API while allowing performance-critical simulation code to execute in C++.

Two compiled backends wrap the same portable C++ core:

1. a native Node.js addon for the primary Node runtime path;
2. a WebAssembly build for fallback/portability.

The concrete repository, packaging, initialization, artifact, test, and CI decisions are defined in [11 — Build, Package, and Backend Architecture](11-build-package-and-backend-architecture.md).

Fundamental unit, time, precision, and marshalling semantics are defined in [12 — Simulation Time, Units, and Numerical Precision](12-simulation-time-units-and-precision.md). Object identity/state semantics are defined in [13 — Physical Object and State Model](13-physical-object-and-state-model.md).

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

- contain authoritative runtime object-registry state and physics/math/performance-critical algorithms where justified;
- use portable C++20 without direct Node-API or Emscripten dependencies;
- expose a narrow C++ interface suitable for multiple bindings;
- avoid game/domain concepts;
- be testable directly in C++.

Likely C++ candidates include:

- object registry/lifecycle and dense internal indexing;
- orbit/state propagation over large object sets;
- numerical integrators;
- encounter/broad-phase algorithms;
- reference-frame transformations;
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

Raw binding objects, Emscripten modules, artifact paths, backend implementation classes, dense object indexes, and pointer/handle internals are not exported from the normal public package entry point.

## Numeric, time, and object transfer contract

Canonical continuous physical values cross as IEEE-754 binary64 (`number` ↔ C++ `double` ↔ WASM `f64`) and are never silently down-cast to f32.

`SimulationInstant`/`Duration` cross through the exact integer codec from document 12, never floating total seconds.

`ObjectId` is a canonical nominal decimal string in the public TypeScript API and a `uint64_t` in the portable core. Native/WASM adapters preserve the full value exactly through unsigned high/low 32-bit words or an equivalent lossless i64 mechanism; IDs are never marshalled through binary64.

`ObjectType` uses the stable compact integer codes defined in document 13 at the backend boundary while TypeScript exposes the documented named values.

Optional physical properties use explicit presence state, never `NaN` sentinels. Batch interfaces use binary64 arrays for continuous data and integer typed arrays/exact fields for IDs, types, and time values.

Backend-specific packing is internal and must not leak into public value shapes.

## Performance boundary

Crossing JavaScript ↔ native/WASM boundaries has overhead. Prefer batch-oriented registration/state-query interfaces for large data sets rather than thousands of tiny calls.

Keep orchestration, public validation, canonical object-ID parsing/formatting, unit conversion, and API ergonomics in TypeScript unless measurement or architecture justifies moving work into C++.

The authoritative live/retired object registry belongs to the portable core so native and WASM cannot diverge in lifecycle semantics.

## Testing expectation

Where both backends implement the same feature, shared parity tests execute the same high-level scenario against native and WASM.

Exact integer/time/object-ID/type/lifecycle behavior must match exactly. Floating-point feature results use documented numerical tolerances; parity does not require unconditional bit-identical floating-point results across native and WASM.

Backend-specific tests additionally cover loading, initialization, marshalling, artifact resolution, and error translation. Portable core behavior is tested directly in C++ through CTest.
