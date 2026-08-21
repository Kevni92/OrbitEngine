# 07 — TypeScript, Native C++, and WebAssembly

## Goal

OrbitEngine is consumed as an npm package through a TypeScript API while allowing performance-critical simulation code to execute in C++.

The architecture should support two compiled backends from the same portable C++ core:

1. a native Node.js addon for maximum server/runtime performance;
2. a WebAssembly build for portability and future non-native environments.

The current game target is Node.js, so the native backend is the primary production path. WebAssembly capability is designed in from the beginning to avoid coupling the core to Node-specific APIs.

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

- contain physics/math/performance-critical algorithms;
- use portable C++ without direct Node-API or Emscripten dependencies;
- expose a narrow C++ interface suitable for multiple bindings;
- avoid game/domain concepts;
- be testable directly in C++ where valuable.

Likely C++ candidates include:

- orbit/state propagation over large object sets;
- numerical integrators;
- encounter/broad-phase algorithms;
- reference-frame transformations;
- trajectory solvers;
- batch physics calculations.

## Native binding

The native Node.js backend should use Node-API (preferably through an appropriate C++ wrapper if adopted) and translate between JavaScript/TypeScript-facing values and core data structures.

Native distribution will eventually require a strategy for supported Node versions/platforms and prebuilt binaries or fallback compilation. That is a packaging decision, not a core-physics concern.

## WebAssembly binding

The WASM backend should compile the same portable core with Emscripten or an equivalent toolchain. WASM-specific marshalling belongs in its adapter/binding layer only.

## TypeScript API

Consumers should not need to understand which backend performs a calculation. Public contracts should be backend-neutral.

Backend selection may eventually be explicit or automatic, but equivalent operations must have equivalent semantics.

## Performance boundary

Crossing JavaScript ↔ native/WASM boundaries has overhead. Prefer batch-oriented interfaces for large data sets rather than thousands of tiny calls. Data ownership and transfer formats should be designed deliberately once profiling data is available.

Do not move code to C++ merely because C++ is available. Keep orchestration and ergonomic API work in TypeScript unless measurement or architectural reasons justify native implementation.

## Testing expectation

Where both backends implement the same feature, shared conformance tests should verify equivalent results within defined numerical tolerances. Backend-specific tests may additionally cover memory, marshalling, and build behavior.
