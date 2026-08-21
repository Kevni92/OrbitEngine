# 11 — Build, Package, and Backend Architecture

## Status and scope

This document records the build, package, and backend architecture decided by Architecture issue #5. It is the implementation contract for bootstrapping the repository and toolchain. It deliberately does not define orbital, object-model, time, units, reference-frame, or trajectory algorithms.

The architectural objective is one normal TypeScript/npm package whose public semantics do not depend on whether work is executed by a native Node.js addon or by WebAssembly. Both compiled backends wrap the same portable C++20 core.

Architecture issue #30 later extends the workspace with a private browser reference application and makes packaged browser/WASM consumption an explicit consumer shape. That extension is canonical in [16 — Browser Solar-System Demo Architecture](16-browser-solar-system-demo.md) and does not change the one-public-package rule.

## Decisions at a glance

- Repository orchestration uses a `pnpm` workspace.
- The only public npm package lives at `packages/orbit-engine`.
- Private applications/tooling may live elsewhere in the workspace without becoming public packages; the browser demo lives at `apps/solar-system-demo`.
- The initial public package is ESM-only and is built with TypeScript without a mandatory JavaScript bundler.
- Public initialization is asynchronous and factory-based: `OrbitEngine.create(options?)`.
- `options.backend` accepts `auto`, `native`, or `wasm`; the default is `auto`.
- `auto` prefers a supported native addon in Node.js and falls back to WASM only when native is unavailable before successful backend initialization.
- The portable C++ core is C++20, built by CMake, and contains no Node-API, Emscripten, JavaScript, TypeScript, Three.js, Vite, DOM, or WebGL dependencies.
- The native adapter uses Node-API through `node-addon-api` and explicitly targets Node-API version 8 unless a future architecture change requires newer APIs.
- The WASM adapter is built with Emscripten from the same core target/source definitions.
- Consumers do not compile C++ during package installation. Release packages contain prebuilt native artifacts plus the WASM fallback.
- Initial officially supported Node.js lines are Node 22 LTS and Node 24 LTS.
- Initial native release targets are Windows x64 and glibc-based Linux x64. macOS, ARM64, and musl-native prebuilds are deferred, but the layout permits adding them without changing the public API.
- CMake owns all C++ compilation. `pnpm` owns repository-level orchestration and invokes CMake/native/WASM build tooling.
- C++ unit tests, TypeScript unit/API tests, native integration tests, WASM integration tests, and shared backend parity tests are separate layers.
- Browser reference-app work additionally validates a packaged WASM consumer build in a real browser.
- CI must validate supported Node lines, both native operating systems, the WASM backend, backend parity, the installable package artifact, and the browser consumer smoke path where relevant.

## Repository structure

The bootstrap implementation established the core structure below. The browser-demo architecture extends it with a private `apps/` workspace area:

```text
OrbitEngine/
├── package.json                     # private workspace root; orchestration only
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── tsconfig.base.json               # shared TS defaults, no package public API
├── CMakeLists.txt                   # C++ build entry point
├── CMakePresets.json                # reproducible native/core presets where useful
├── packages/
│   └── orbit-engine/
│       ├── package.json             # the only public npm package
│       ├── tsconfig.json
│       ├── src/
│       │   ├── index.ts             # public exports
│       │   └── internal/
│       │       └── backends/        # backend contract, selection, loaders
│       ├── tests/
│       │   ├── unit/
│       │   ├── integration/
│       │   └── parity/
│       ├── dist/                    # generated JS/declarations; ignored by git
│       ├── prebuilds/               # generated native package artifacts; ignored
│       │   ├── linux-x64/
│       │   └── win32-x64/
│       └── wasm/                    # generated Emscripten artifacts; ignored
├── apps/
│   └── solar-system-demo/           # private Vite/Three.js browser consumer
├── cpp/
│   ├── CMakeLists.txt
│   ├── core/
│   │   ├── CMakeLists.txt
│   │   ├── include/
│   │   └── src/
│   ├── bindings/
│   │   ├── node/
│   │   │   └── CMakeLists.txt
│   │   └── wasm/
│   │       └── CMakeLists.txt
│   └── tests/
│       └── CMakeLists.txt
├── cmake/                            # shared CMake modules/helpers only
├── docs/
└── .github/
    └── workflows/
```

`cpp/` is not a separate pnpm package. The C++ tree is owned by CMake and invoked from workspace scripts.

Private applications under `apps/` consume `orbit-engine` through the same public TypeScript API as an external consumer. They must not become public backend packages or gain privileged access to internal bindings.

Additional internal tooling packages may be added under `packages/` later, but they must not become public backend packages merely to mirror the native/WASM split.

## pnpm workspace ownership

The root `package.json` is private and exists to pin the package manager/tool versions and provide repository-wide scripts. It is not published.

`pnpm-workspace.yaml` includes:

```yaml
packages:
  - packages/*
  - apps/*
```

The lockfile is committed. The root `packageManager` field pins the exact pnpm version chosen by the bootstrap task so local development and CI use the same package-manager release; routine version updates do not require an architecture change.

The public package owns:

- TypeScript public exports;
- backend selection and initialization;
- backend-neutral validation/orchestration;
- generated declarations and JavaScript;
- packaged native/WASM artifacts;
- TypeScript/API, integration, and parity tests.

A private application package owns only its application dependencies, UI/rendering code, scenarios, and app-specific tests. Three.js/Vite dependencies belong to `apps/solar-system-demo`, never to `packages/orbit-engine` merely because that app uses them.

The workspace root owns orchestration commands. The engine script contract provides equivalents of:

- `build` — build the current-host native backend, WASM backend, and TypeScript package;
- `build:ts` — compile TypeScript/declarations only;
- `build:core` — configure/build the portable native C++ core;
- `build:native` — build and stage the current-host Node addon;
- `build:wasm` — build and stage Emscripten output;
- `test:cpp` — run portable C++ tests through CTest;
- `test:ts` — TypeScript unit/API tests;
- `test:native` — native binding integration tests;
- `test:wasm` — WASM binding integration tests;
- `test:parity` — the same high-level scenarios against both backends;
- `test` or `check` — the appropriate aggregate validation for a fully provisioned developer/CI environment.

The demo extension adds convenient app equivalents such as `demo`, `demo:build`, `demo:test`, and `demo:smoke` as defined in document 16. App build commands must not redefine engine build ownership.

## TypeScript package contract

### Module format

The public package is ESM-only (`type: module`) with explicit `exports` and generated `.d.ts` declarations. Node 22/24 are modern enough that dual CommonJS output is not justified initially. Adding a CommonJS compatibility entry later is allowed if demand appears, provided it does not fork API semantics.

The engine package should prefer `tsc` for its TypeScript compilation. Vite is an application bundler for the private browser demo and does not become the build system for the public engine package.

### Public initialization

Initialization is asynchronous for every backend so consumers do not need separate sync/async code paths:

```text
await OrbitEngine.create()
await OrbitEngine.create({ backend: "auto" })
await OrbitEngine.create({ backend: "native" })
await OrbitEngine.create({ backend: "wasm" })
```

The default is `auto`.

The backend-selection option is a public configuration concept. Backend implementation classes, binding handles, raw native exports, Emscripten modules, and artifact paths are internal and must not be exported from the normal package entry point.

### Internal backend contract

The TypeScript facade owns public argument validation, stable API semantics, backend selection, and public error normalization. Each compiled adapter satisfies one internal backend contract. Feature-specific operations are added to that contract only when their public semantics have been defined.

The contract has these invariants:

1. Native and WASM adapters expose equivalent observable behavior for the same supported operation.
2. Backend-specific marshalling does not leak into public value shapes.
3. A backend may use different internal memory/layout strategies, but it must not change public semantics to optimize one backend.
4. Batch-oriented backend calls are preferred when crossing JS/native or JS/WASM boundaries for large datasets.
5. The TypeScript facade must not duplicate physics/simulation algorithms merely to support one backend.
6. Browser consumers use the same public facade; there is no browser-only physics API.

Tests may import internal backend factories through test-only/internal paths inside the source tree, but those paths are not npm public exports. Private reference applications must not rely on those test-only imports.

## Backend selection and failure semantics

### `native`

`native` means native is required.

The loader must:

1. verify that the runtime is Node.js;
2. map `process.platform` and `process.arch` to a supported prebuild location;
3. load the `.node` addon;
4. verify the internal binding protocol/version handshake;
5. initialize the backend.

If any required native artifact is unsupported, absent, unloadable, version-incompatible, or fails initialization, `OrbitEngine.create({ backend: "native" })` rejects with a clear initialization error preserving the underlying cause. It never falls back to WASM.

### `wasm`

`wasm` never probes or loads native code. It initializes the packaged Emscripten module and rejects clearly if the WASM artifact cannot be loaded or initialized.

The WASM loading path must not statically depend on Node-only APIs.

Browser consumption is now an explicit reference-app requirement. The package must therefore resolve its own Emscripten JS and `.wasm` artifacts in both direct Node package execution and modern ESM browser bundlers without requiring the consumer to import package internals or copy files manually.

The exact browser-bundle-safe loading rule is defined in document 16: use literal package-relative ESM/`new URL(..., import.meta.url)` references so the module and binary are statically discoverable while preserving lazy initialization.

### `auto`

`auto` prefers native only when running under Node.js on a tuple for which a native artifact is expected.

It falls back to WASM when native is unavailable before a valid backend has been established, including:

- non-Node runtime;
- unsupported OS/architecture tuple;
- native artifact not present;
- operating-system loader failure while loading the native binary.

It must not silently fall back after the native module has loaded successfully but then reveals a package-integrity or backend defect. Examples that must fail rather than being hidden by WASM fallback include:

- binding protocol/version mismatch;
- native backend initialization failure after a valid module is loaded;
- an operational error thrown by a successfully initialized native backend.

This distinction keeps `auto` convenient without masking broken releases.

No fallback attempt should emit console output by default. Diagnostic causes belong in returned/thrown error information, not unsolicited logging.

The browser reference demo intentionally uses explicit `wasm`, not `auto`, so its CI proves that path directly.

## Binding compatibility handshake

The TypeScript wrapper and both compiled adapters must share a small internal binding protocol version. On load, each adapter reports the protocol version it implements and the TypeScript wrapper requires an exact compatible value.

This protocol is internal to one OrbitEngine package release; it is not a stable public ABI. Its purpose is to catch mixed/stale generated artifacts during development or release assembly instead of producing undefined behavior.

The portable C++ ABI is also private. OrbitEngine does not ship a separately supported C++ shared library ABI in this architecture.

## Portable C++ core and CMake ownership

The portable core is a C++20 library target, conceptually `orbit_engine_core`.

The core target must:

- compile without Node.js headers;
- compile without Emscripten-specific headers or preprocessor requirements;
- expose portable C++ interfaces to binding targets;
- contain no JavaScript/TypeScript types or game-domain types;
- contain no Three.js/Vite/DOM/WebGL application types;
- be directly linkable by native C++ tests;
- be compiled from the same source definitions for native and Emscripten builds.

The repository/root CMake configuration owns all C++ compilation. CMake options/presets must allow these build shapes without source duplication:

- portable core + C++ tests on a normal host compiler;
- portable core + Node binding on a normal host compiler;
- portable core + WASM binding under the Emscripten toolchain.

The Node and WASM binding targets may use backend-specific APIs only inside `cpp/bindings/node` and `cpp/bindings/wasm` respectively.

CMake helper logic shared by targets belongs under `cmake/`; simulation code does not.

## Native backend

The native adapter uses Node-API through `node-addon-api`. Direct V8 APIs and NAN are prohibited.

The addon explicitly targets Node-API version 8 initially. Node-API 8 is intentionally older than the minimum Node runtime so a single prebuilt addon has a stable ABI across the supported Node 22 and Node 24 lines and can remain compatible with future Node lines unless OrbitEngine actually needs a newer Node-API feature.

Native build orchestration may use `cmake-js` to supply Node headers/runtime metadata to CMake. If the bootstrap implementation uses an equivalent thin helper instead, CMake must still own the target definition and compilation; there must not be a second hand-written native build system.

The produced file is named consistently (for example `orbit_engine.node`) and is staged under:

```text
packages/orbit-engine/prebuilds/<platform>-<arch>/
```

Initial release tuples:

- `win32-x64`;
- `linux-x64` on glibc-based Linux.

Native ARM64, macOS, and musl builds are deferred. Adding a tuple later means adding a prebuild and CI/release coverage; it does not require a public API change.

## WebAssembly backend

The WASM adapter is built by Emscripten from the same `orbit_engine_core` sources/target definitions used by the native build.

Emscripten-specific exports, module initialization, memory views, and marshalling remain under `cpp/bindings/wasm` and the TypeScript WASM loader.

Generated artifacts are staged under:

```text
packages/orbit-engine/wasm/
```

The expected package shape is an ES-module loader plus its `.wasm` binary. Asset resolution must be relative to the installed module/package location rather than the consumer's current working directory.

The package loader must additionally make those artifacts statically discoverable to modern browser ESM bundlers as defined by document 16. A browser consumer must not need Vite aliases, manual file copies, or public Emscripten handles.

The Emscripten SDK version used by CI/release is pinned by the bootstrap implementation and updated deliberately. The exact patch version is a toolchain maintenance choice, not public architecture.

The bootstrap workflow pins Emscripten to `3.1.74` through `mymindstorm/setup-emsdk` and uses Ubuntu 22.04 (`glibc 2.35`) as the deliberate Linux native-release baseline. These are reproducibility choices for the initial toolchain and may be updated deliberately without changing the public backend contract.

## Artifact and package distribution

### No consumer compilation

The normal npm install path must not invoke CMake, a C++ compiler, Python, Visual Studio Build Tools, Emscripten, or `node-gyp`/equivalent compilation on the consumer machine.

Release packaging includes:

- compiled TypeScript JavaScript and declarations;
- Windows x64 native prebuild;
- Linux x64 native prebuild;
- Emscripten JS/module output;
- WASM binary;
- normal package metadata/license/readme files.

There is no required `postinstall` compilation step.

### Single public package

The release ships these artifacts in the one `orbit-engine` package rather than platform-specific public/optional-dependency packages. Private workspace applications do not change package publication topology.

If package size later becomes material, native binaries may be split into platform-specific optional dependency packages as a packaging optimization. Such a change must preserve the main package's public API and backend-selection semantics.

### Generated artifacts

`dist/`, `prebuilds/`, WASM outputs, CMake build directories, object files, and local native binaries are generated and gitignored. They are never hand-edited or committed as source.

Release CI builds artifacts from a tagged/selected source commit, transfers them between jobs as CI artifacts, assembles the package layout, and creates the npm tarball only after all required platform artifacts are present.

The demo's Vite `dist` output is likewise generated and ignored; it is not shipped inside the npm package.

## Development build flow

A normal developer flow is:

1. use a supported Node LTS line and the repository-pinned pnpm version;
2. `pnpm install` with the committed lockfile;
3. build/test TypeScript without requiring compiled backends when working only on facade code;
4. build the native backend for the current supported host when native integration is needed;
5. install/configure the pinned Emscripten SDK and build WASM when WASM/parity or browser-demo work is needed;
6. for browser-demo work, build the public package/WASM artifacts before launching the private Vite consumer as required by its scripts;
7. run the aggregate validation before a backend-affecting PR is considered complete.

Local native development only needs the current host's prebuild. Developers are not expected to create all release platform binaries locally.

## Release build flow

Release automation is responsible for reproducibility and cross-platform assembly:

1. checkout one immutable commit/tag and install dependencies with the frozen lockfile;
2. build/test `orbit_engine_core` on Linux and Windows;
3. build the Node-API 8 native addon for `linux-x64` and `win32-x64` in separate jobs;
4. build the WASM adapter once with the pinned Emscripten toolchain;
5. upload native/WASM outputs as CI artifacts;
6. assemble them into `packages/orbit-engine/prebuilds` and `packages/orbit-engine/wasm` together with compiled TypeScript;
7. create the npm tarball;
8. install that tarball into clean smoke-test consumers on supported Node/OS combinations;
9. exercise explicit native, explicit WASM, and normal `auto` initialization where applicable;
10. publish only the already-tested assembled tarball.

A release must never rebuild different binaries after package smoke testing and then publish those untested binaries.

A browser-demo deployment, if added later, consumes its own already-tested static Vite artifact and is separate from npm package publishing.

## Node.js and platform support policy

At the time of this decision, the supported Node runtime lines are:

- Node 22 LTS;
- Node 24 LTS.

The package `engines` constraint should express those supported major lines rather than promising untested Current/non-LTS releases. When a newer even-numbered Node line becomes LTS, support is added by updating CI and package metadata after tests pass.

Native support initially means:

| OS/runtime tuple | Native | WASM | `auto` |
|---|---:|---:|---|
| Windows x64 + supported Node | supported | supported | native preferred |
| glibc Linux x64 + supported Node | supported | supported | native preferred |
| macOS + supported Node | no native guarantee | structurally possible | WASM if it initializes |
| ARM64 + supported Node | no native guarantee | structurally possible | WASM if it initializes |
| musl Linux + supported Node | no native guarantee | structurally possible | WASM if it initializes |
| non-Node runtime | unavailable | supported only where separately validated | WASM only |

Only Windows x64 and glibc Linux x64 are required native CI/release targets initially. Other rows describe fallback architecture, not an initial support guarantee.

The browser reference demo separately targets current evergreen desktop browsers with ES modules, WebAssembly, and WebGL 2; details are in document 16. That demo support statement does not turn every non-Node runtime into a generally supported public platform automatically.

For Linux release binaries, CI should build on a deliberately selected glibc baseline runner rather than whichever newest distribution happens to be available. The bootstrap implementation must document that baseline in CI so binary compatibility does not drift accidentally.

## Test architecture

### 1. Portable C++ unit tests

C++ tests link directly against `orbit_engine_core` and run through CTest. They validate portable algorithms/types without JavaScript, Node-API, or Emscripten. A C++ test framework may be selected by the bootstrap implementation, but CTest remains the build-system-level test entry point.

### 2. TypeScript unit/API tests

These test public validation/facade behavior and backend-selection logic. Backend factories/loaders should be replaceable internally in tests so fallback/error semantics can be tested deterministically without corrupting real binaries.

### 3. Native binding integration tests

These require a real built `.node` addon. They validate loading, protocol handshake, marshalling, lifetime/error translation, and each implemented backend operation.

A missing required native artifact in the native CI job is a failure, not a skipped test.

### 4. WASM binding integration tests

These require the real packaged/generated Emscripten artifacts. They validate module instantiation, asset resolution, protocol handshake, marshalling, lifetime/error translation, and each implemented backend operation.

### 5. Backend parity tests

Parity tests are high-level scenario tests parameterized by backend factory. The same test body runs once with `native` and once with `wasm`.

Parity means equivalent public semantics, not bit-identical floating-point output. Numerical features introduced later must define their own accepted tolerances in the relevant architecture/implementation issue; the parity harness consumes those tolerances rather than inventing global ones.

### Package smoke tests

In addition to the five required layers, release/CI must test the packed npm tarball from a clean temporary consumer project. This catches missing `files` entries, broken `exports`, wrong asset paths, and release-assembly mistakes that source-tree tests cannot detect.

### Browser packaged-consumer smoke

The browser-demo architecture adds a real-browser consumer test. It builds/serves a private Vite consumer, imports only the public `orbit-engine` package entry, calls `OrbitEngine.create({ backend: "wasm" })`, and executes at least one real supported operation.

The smoke must fail if the browser bundle cannot resolve the package-owned Emscripten module or `.wasm` binary. It must not succeed by importing `src/internal` or copying the WASM files manually.

Headless Chromium/Playwright is the initial automation baseline. WebGL rendering capability is checked separately from the physics/WASM initialization result as defined by document 16.

## CI responsibilities

The core CI architecture is:

### TypeScript quality job

On Linux, using supported Node lines as appropriate:

- frozen `pnpm install`;
- formatting/lint checks once configured;
- TypeScript typecheck/build;
- TypeScript unit/API tests.

### Portable C++ matrix

On Windows x64 and the chosen glibc Linux x64 baseline:

- configure CMake;
- build portable core;
- run CTest.

### Native integration matrix

On Windows x64 and glibc Linux x64, covering Node 22 and Node 24:

- build the addon with Node-API 8;
- run native integration tests;
- ensure explicit `native` initialization succeeds.

### WASM integration matrix

On Linux with the pinned Emscripten SDK, covering Node 22 and Node 24 as the initial test hosts:

- build WASM;
- run WASM integration tests;
- ensure explicit `wasm` initialization succeeds.

### Parity job

On Linux for Node 22 and Node 24:

- make both native and WASM backends available;
- run the shared parity suite against both.

### Package assembly/smoke job

For release workflows, and preferably for relevant PRs once cost is acceptable:

- collect both native prebuilds plus WASM output;
- compile TypeScript;
- create the npm tarball;
- inspect package contents;
- install the tarball in clean Windows/Linux consumers;
- run initialization smoke tests.

### Browser demo jobs

On Linux for changes affecting the public/WASM consumer path or the demo:

- demo TypeScript/unit tests;
- Vite production build;
- real headless-browser WASM consumer smoke.

These application jobs do not need to multiply across the Windows native matrix. They complement rather than replace the existing WASM/parity/package checks.

Required branch-protection checks should eventually correspond to these responsibilities. CI optimization may reuse artifacts or avoid rebuilding identical WASM output, but it must not remove coverage implied by the supported platform/runtime matrix.

## Rejected alternatives and trade-offs

### Separate public `native` and `wasm` npm packages

Rejected initially because it exposes deployment detail to consumers, complicates version coordination, and weakens the single TypeScript facade. Internal code may be physically separated; public installation remains one package.

### Put the browser demo or Three.js inside `packages/orbit-engine`

Rejected because it reverses the consumer dependency boundary, bloats the public package, and risks turning rendering concerns into engine concepts. The demo is a private `apps/` consumer.

### Let the demo import/copy raw WASM artifacts

Rejected because the reference app must prove the package's real public browser-consumer contract. Package-owned asset resolution is part of the WASM backend responsibility.

### Compile native code during consumer install

Rejected because it makes installation depend on host compiler/toolchain availability, increases support burden, and makes reproducibility worse. Prebuilds plus WASM fallback provide a cleaner normal install path.

### Synchronous `create()` for native and asynchronous `create()` for WASM

Rejected because it creates backend-dependent consumer semantics. One asynchronous factory makes selection/fallback transparent.

### Fallback to WASM after every native error

Rejected because a broken or mismatched native release would be silently hidden. `auto` falls back only while native is unavailable; package-integrity/backend failures after a valid native module is established are surfaced.

### Node/Emscripten conditionals inside the portable core

Rejected because they would turn one shared implementation into platform-conditioned implementations and erode direct C++ testability. Platform code remains in adapters/build targets.

### Dual ESM/CommonJS output from day one

Rejected as unnecessary complexity for Node 22/24 and the Emscripten ESM loading path. CommonJS compatibility can be added later if a real consumer requirement appears.

## Invariants for follow-up implementation

The build/package architecture remains valid only if it preserves all of these invariants:

1. Consumers import one TypeScript/npm package.
2. The normal public entry point never exposes raw binding modules or artifact paths.
3. `OrbitEngine.create()` is asynchronous and defaults to `auto`.
4. `native` never falls back; `wasm` never probes native; `auto` follows the failure rules above.
5. Both adapters wrap one portable C++20 core source implementation.
6. The core builds and tests without Node/Emscripten/application dependencies.
7. CMake owns C++ targets; pnpm orchestrates them.
8. Release npm installation performs no C++ compilation.
9. Windows x64 and glibc Linux x64 native artifacts plus WASM are assembled into one release package.
10. Node 22 and Node 24 are tested supported lines.
11. Backend parity tests reuse the same high-level scenarios.
12. Generated binaries/build directories are not committed.
13. Private apps do not become public engine packages or import engine internals.
14. Browser consumers can initialize packaged WASM through the public API without manual asset copying.
15. Three.js/Vite/rendering concepts never enter portable core or authoritative physics state.
