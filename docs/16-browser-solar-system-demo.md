# 16 — Browser Solar-System Demo Architecture

## Status and scope

This document records the browser demo architecture decided by Architecture issue #30.

The demo is a private in-repository reference application. It is deliberately **not** part of the published `orbit-engine` package and is not a rendering subsystem of OrbitEngine. Its purpose is to consume the public TypeScript API the same way a real application would and make engine state, reference frames, propagation, and later high-fidelity behavior visible in a browser.

The initial visual stack is TypeScript + Vite + Three.js. Browser execution uses the real OrbitEngine WebAssembly backend compiled from the same portable C++ core as the Node native backend.

This document defines application boundaries, browser/WASM loading, render-space precision, simulation-time animation, scenario data, UI scope, tests, and staging. It does not define new orbital physics.

## Decisions at a glance

- The demo lives at `apps/solar-system-demo` and is a private pnpm workspace package.
- The workspace expands from `packages/*` to `packages/*` plus `apps/*`.
- `apps/solar-system-demo` depends on `orbit-engine` through `workspace:*`; `orbit-engine` never depends on the demo, Three.js, Vite, DOM, or WebGL.
- Vite is the demo dev server and production bundler. The initial UI uses vanilla TypeScript/DOM modules rather than a frontend framework.
- Three.js is rendering-only. It never integrates or owns authoritative orbital state.
- The browser demo always initializes OrbitEngine with `backend: "wasm"` so it explicitly proves the browser/WASM path.
- The OrbitEngine package owns browser-safe resolution of its Emscripten module and `.wasm` asset. The demo must not copy, reach into, or hard-code package-internal WASM paths.
- The WASM loader must use statically discoverable package-relative ESM/asset references suitable for Vite/Rollup-style bundling while preserving direct package execution.
- OrbitEngine `SimulationInstant` remains authoritative. Browser wall-clock time only determines the next exact requested instant.
- `requestAnimationFrame` renders snapshots; it is not a physics tick or integrator.
- One bounded query coordinator owns state requests. It never creates an unbounded queue of stale time queries.
- Once #20 is available, the visualizer uses same-epoch batch and relative-state queries across the JS↔WASM boundary.
- Render coordinates are camera/focus-relative whenever possible. Large SSB coordinates are not blindly copied into Three.js for local views.
- OrbitEngine state remains ICRS/ICRF-aligned; the demo applies one explicit J2000-ecliptic presentation rotation at the render-space boundary and uses +Z as scene/camera up.
- Distances are converted from SI metres to presentation-only scene units. Body-size exaggeration is presentation-only and explicitly separate from physical radius.
- The first deterministic scenario is offline and committed. It contains the Sun, eight planets, and Earth's Moon, normalized to OrbitEngine contracts with source/provenance metadata.
- The first useful Solar-System motion demo depends on #20 and #23. Browser-WASM packaging/smoke work may be implemented earlier.
- Initial CI includes unit/build tests plus a real headless-browser WASM smoke test. WebGL availability is capability-checked and produces a clear unsupported message rather than a crash.
- The production demo build is static-hosting compatible. Deployment to GitHub Pages or another host is a separate operational task.

## Architectural boundary

The dependency direction is permanently one-way:

```text
apps/solar-system-demo
  ├── orbit-engine public TypeScript API
  ├── three
  └── vite (development/build only)
             |
             v
      browser application
             |
      OrbitEngine WASM backend
             |
      portable C++ core
```

Forbidden dependency direction:

```text
orbit-engine -> three
orbit-engine -> vite
portable C++ -> DOM/WebGL/browser UI
```

The demo is allowed to expose deficiencies in the public consumer contract. When it does, the fix belongs in the appropriate OrbitEngine public/backend contract rather than in a demo-only internal binding escape hatch.

## Repository and workspace layout

The target repository shape is:

```text
OrbitEngine/
├── packages/
│   └── orbit-engine/
├── apps/
│   └── solar-system-demo/
│       ├── index.html
│       ├── package.json
│       ├── tsconfig.json
│       ├── vite.config.ts
│       ├── src/
│       │   ├── main.ts
│       │   ├── engine/
│       │   ├── scenario/
│       │   ├── simulation/
│       │   ├── rendering/
│       │   └── ui/
│       ├── tests/
│       └── public/                 # only assets that must retain exact public names
├── cpp/
├── docs/
└── .github/
```

`pnpm-workspace.yaml` includes:

```yaml
packages:
  - packages/*
  - apps/*
```

The demo package:

- has `private: true`;
- is never published to npm;
- depends on `orbit-engine: workspace:*`;
- owns `three` and its own browser-only development dependencies;
- pins dependency resolution through the repository lockfile;
- does not add browser dependencies to `packages/orbit-engine`.

Routine Three.js/Vite patch/minor upgrades are dependency maintenance, not architecture changes, provided the contracts in this document remain intact.

The root orchestration adds convenient equivalents of:

```text
pnpm demo            # development server
pnpm demo:build      # deterministic production build
pnpm demo:test       # demo unit tests
pnpm demo:smoke      # browser/WASM smoke path
```

Exact script spelling may be refined mechanically, but the demo remains independently buildable/testable from the engine package.

## Frontend technology choice

### Vite

Vite is the selected browser dev server and bundler.

Reasons:

- the repository already uses ESM TypeScript;
- Vite works naturally in a monorepo and with npm package dependencies;
- it has first-class static asset and `import.meta.url` handling;
- a static production build is sufficient for the demo;
- it introduces no runtime framework into OrbitEngine.

The demo uses a relative production base (`base: "./"`) unless a deployment task deliberately chooses a fixed host path. This keeps the built artifact usable from generic static hosting and nested paths.

### Three.js

Three.js owns only scene rendering and interaction. Use the normal npm package plus explicit addons such as:

```text
three/addons/controls/OrbitControls.js
```

The initial renderer is `WebGLRenderer`. Current Three.js requires WebGL 2 for this renderer, so WebGL 2 is an explicit demo capability requirement.

### No frontend framework initially

The first demo uses vanilla TypeScript modules and DOM controls. React/Vue/Svelte are not justified for the initial scope and would add application complexity unrelated to validating OrbitEngine.

A later UI framework adoption is allowed only if the demo grows enough to justify it; it must not alter the engine boundary.

## Browser support baseline

The demo targets current evergreen desktop browsers that support all of:

- native ES modules;
- WebAssembly;
- `import.meta.url`;
- WebGL 2.

The intended browser families are current Chrome/Chromium, Edge, Firefox, and Safari. The demo does not initially promise support for legacy browsers, WebGL 1, mobile GPUs, embedded webviews, or browsers with WebAssembly/WebGL disabled.

Runtime capability failures must be visible and descriptive:

- WASM unavailable/initialization failure → engine initialization error panel;
- WebGL 2 unavailable → rendering capability message;
- scenario registration/query failure → explicit scenario error rather than silently drawing guessed positions.

CI uses Chromium as the initial automated browser baseline. Cross-browser automation can be added later without changing the architecture.

## Browser WASM package contract

### Public initialization

The demo initializes:

```ts
await OrbitEngine.create({ backend: "wasm" });
```

It does not use `auto` in the reference demo. The purpose is to continuously prove that the browser can load and run the WASM backend.

The normal public `OrbitEngine` facade remains the only application-facing engine entry point. The demo must not import:

- `src/internal/*`;
- raw Emscripten factories;
- binding objects;
- C++ memory views;
- internal protocol codecs;
- generated WASM files by package-relative filesystem path.

### Asset ownership

`packages/orbit-engine` owns the Emscripten module and `.wasm` asset resolution.

A browser consumer must not need to:

- copy `node_modules/orbit-engine/wasm` manually;
- configure a Vite alias to an OrbitEngine internal directory;
- know generated file layout;
- call Emscripten APIs directly.

### Bundle-safe loader rule

The existing conceptual package layout remains:

```text
orbit-engine/
├── dist/
└── wasm/
    ├── orbit_engine_wasm.js
    └── orbit_engine_wasm.wasm
```

The implementation must make the WASM backend statically discoverable to modern ESM bundlers.

The required approach is:

1. keep the Emscripten output as an ES-module factory;
2. load the generated JS module through a **literal package-relative dynamic import specifier**, not a runtime-constructed `import(url.href)` string;
3. resolve the `.wasm` binary through a **literal package-relative `new URL(..., import.meta.url)` reference**;
4. pass that resolved binary URL through Emscripten's `locateFile` hook for the known generated WASM filename;
5. reject unexpected runtime sidecar filenames rather than dynamically concatenating arbitrary package paths;
6. retain lazy loading so selecting another backend does not eagerly execute WASM initialization.

Conceptually:

```text
await import("../../../../wasm/orbit_engine_wasm.js")
new URL("../../../../wasm/orbit_engine_wasm.wasm", import.meta.url)
```

The exact number of relative path segments follows the emitted `dist/src/internal/backends` layout and is implementation-verified by package smoke tests.

A TypeScript ambient declaration/generated declaration for the Emscripten JS module is allowed so the tsc-only package build remains typed. Vite-specific query suffixes such as `?url` must not become part of the OrbitEngine public package contract.

This rule preserves two properties simultaneously:

- direct installed-package Node/WASM use continues to resolve package-owned assets;
- Vite/Rollup-style browser bundlers can discover and include/rewrite the module and `.wasm` assets during a consumer build.

### Package smoke coverage

The existing Node tarball smoke remains required. Browser support adds a second consumer shape: build/install the package into the demo or a minimal browser fixture and prove that the compiled package, not source-tree internals, initializes WASM successfully.

## Application module responsibilities

Recommended internal demo decomposition:

```text
src/main.ts
  |
  +-- engine/create-engine.ts
  +-- scenario/load-solar-system.ts
  +-- simulation/simulation-clock.ts
  +-- simulation/state-query-coordinator.ts
  +-- rendering/render-space.ts
  +-- rendering/solar-system-scene.ts
  +-- rendering/body-visual.ts
  +-- ui/controls.ts
  +-- ui/selected-object-panel.ts
```

These are demo modules, not public OrbitEngine modules.

### `engine/`

Owns public OrbitEngine initialization only. It may normalize demo error presentation but does not wrap raw bindings.

### `scenario/`

Owns deterministic application metadata and registration orchestration:

- human-readable names;
- visual colors/material choices;
- initial camera/focus preference;
- committed normalized physical/state/frame records;
- source/provenance metadata.

Names/colors are demo metadata keyed by `ObjectId`; they do not become physical engine properties.

### `simulation/`

Owns wall-clock-to-requested-time mapping and bounded query scheduling. It does not implement orbital equations.

### `rendering/`

Owns metres→scene-unit conversion, camera-relative origin, presentation-frame conversion, meshes, labels, selection raycasting, visual trails, and Three.js resources.

### `ui/`

Owns buttons, sliders/selects, debug panels, and user-visible formatting. Civil/calendar display conversion is presentation logic and must not replace canonical TDB `SimulationInstant` state.

## Authoritative data flow

For every visual frame that needs new physical state:

```text
wall-clock presentation delta
          |
          v
SimulationClock computes requested SimulationInstant
          |
          v
OrbitEngine public state query at exact T
          |
          v
canonical/relative Cartesian state snapshot
          |
          v
RenderSpace converts SI state to presentation coordinates
          |
          v
Three.js updates meshes and renders
```

The forbidden flow is:

```text
requestAnimationFrame
       |
       v
position += velocity * dt
       |
       v
pretend this is authoritative physics
```

The demo may interpolate **purely visual camera motion or UI transitions**, but it must not interpolate/extrapolate object physical state and then present that result as an OrbitEngine state. If a future optimization visually interpolates between authoritative snapshots, it must be explicitly marked as render interpolation and periodically re-anchor to engine results; that optimization is outside v1.

## Simulation time controller

### Authoritative instant

The controller stores an exact OrbitEngine `SimulationInstant` as its current requested/displayed physics instant.

JavaScript `Date` is never the simulation clock. The demo may use it only at the UI boundary for the explicit TDB/J2000-to-local-civil formatter and local date-time input. The exact `SimulationInstant` seconds/nanoseconds pair remains authoritative; the civil formatter applies the documented J2000 UTC offset and known UTC leap-second table, while the exact seconds/nanoseconds controls remain available for diagnostic jumps.

Browser elapsed time comes from `performance.now()` or the animation callback timestamp. This elapsed number has only presentation-clock meaning.

### Advancing time

When playing:

```text
wall elapsed duration × selected warp factor
                    |
                    v
normalized OrbitEngine Duration
                    |
                    v
previous exact requested SimulationInstant + Duration
```

The conversion rounds to the demo's nanosecond representation boundary and then uses the canonical duration/instant constructors. Accumulated authoritative simulation time is not stored as one growing floating-point seconds value.

Supported initial controls:

- pause/play;
- direction is forward-only in the animated play control initially;
- exact jump to a supported instant through an explicit input/control;
- selectable positive time-warp rates.

Read-only backward state queries may later be exposed through a scrubber when the active propagation models support them. Mutable engine rewind semantics are not introduced by the demo.

### Frame-rate independence

Changing browser refresh rate changes only how often the requested instant is sampled/rendered. It must not change the intended simulation-time advancement over the same wall elapsed duration.

There is no fixed physics tick in the demo.

## Query coordinator

The query coordinator is intentionally bounded.

Rules:

1. At most one state request generation is authoritative for a requested instant.
2. If public engine queries are asynchronous, at most one query is in flight by default.
3. While a query is in flight, newer requested time replaces a single pending target rather than appending to an unbounded queue.
4. A completed result carries/generates the exact target instant it represents.
5. Results older than the newest accepted generation are discarded.
6. Rendering continues using the last complete snapshot while a newer query is pending.
7. Paused mode issues no repeated identical queries unless camera/focus/output-frame requirements changed.

This structure remains valid if current WASM calls are synchronous and allows later worker-based execution without changing simulation semantics.

## Batch and relative-state strategy

### Batch first

For a Solar-System frame containing multiple visible objects, the preferred public engine operation is one same-epoch batch query rather than one JS↔WASM call per body.

Conceptually:

```ts
engine.getStatesAtTime(objectIds, instant, outputFrame)
```

or the final equivalent API from #20.

The demo follows the actual public API established by #20; it does not add a demo-only backend method.

### Relative/local first

The renderer should request states relative to the current focus/reference context when #20 supports it.

Examples:

- Solar-System overview focused on Sun → Sun-relative states;
- Earth/Moon view focused on Earth → Earth-relative states;
- spacecraft view focused on spacecraft/local frame → local relative states when available.

This avoids forcing a local visualization through large SSB coordinates and then subtracting nearly equal values in JavaScript.

If the first batch API cannot directly batch relative queries, #20's public/common-ancestor relative-state semantics remain authoritative. The demo implementation may temporarily perform a small number of public relative queries, but it must not bypass the frame system.

## Three.js coordinate convention

OrbitEngine's root orientation remains SSB-centered and ICRS/ICRF-aligned with +Z toward the north celestial pole. Canonical engine/scenario `PropagationState` values are never rotated or mutated for rendering.

For presentation, the demo applies one explicit fixed rotation at the `RenderSpace` boundary from ICRS/ICRF axes to J2000-ecliptic axes. The rotation is the inverse of the J2000 ecliptic-obliquity normalization used by the deterministic primary-planet fixture, using the shared `23.43928°` convention. Conceptually:

```text
ICRS/ICRF state
   |
   | rotate about +X by -23.43928°
   v
J2000-ecliptic presentation state
   |
   v
Three.js scene
```

The presentation mapping keeps +X fixed and makes scene `z = 0` the J2000 ecliptic reference plane. Three.js cameras used with OrbitControls keep +Z as their up vector before controls are initialized.

The transform is centralized and applied consistently to body positions, relative/focus positions, and sampled orbit/path points before the metres→scene-unit scale. Debug/technical UI continues to display the unmodified canonical engine coordinates. Rendering the same physical vector through body and path code must yield the same scene-space vector.

This is a presentation transform only. It is not an OrbitEngine reference frame, does not alter public API/frame semantics, and must never be written back into engine state.

## Render-space origin and scale

### Focus-relative origin

The selected/focused body is normally rendered at scene origin.

The camera and other meshes use engine-relative state around that focus. Changing focus changes the render-space origin, not physical state.

The scene therefore behaves like a floating origin without mutating OrbitEngine frames or object positions.

### Distance scale

Canonical physics stays in metres.

The demo defines one presentation conversion such as:

```text
1 astronomical unit = 100 Three.js scene units
```

with the astronomical unit used only as a render conversion constant. The exact SI astronomical-unit value belongs in the demo render module, not in engine state.

All object-position conversions use the same linear distance scale within a view.

### Body radius modes

Two presentation modes are allowed:

1. **physical scale** — body radius uses the same linear metres→scene conversion as distance;
2. **visible/exaggerated** — a documented clamp/exaggeration makes planets selectable/visible at Solar-System scale.

The default overview may use visible/exaggerated radii. The UI must make that mode discoverable; it must never claim exaggerated geometry is physically to scale.

The renderer may retain both:

```text
physicalRadiusMeters
visualRadiusSceneUnits
```

but only the first originates from OrbitEngine.

### Camera depth

Because the scene uses a focus-relative origin and a bounded metres→scene conversion, v1 should use ordinary perspective depth rather than enabling logarithmic/reversed depth by default.

Camera near/far values are chosen per view scale and may be updated when focus/view mode changes. If later views require extreme near/far ratios, a rendering-only depth strategy may be revisited without altering physics.

## Deterministic Solar-System demo scenario

### Required bodies

The first complete scenario contains at least:

- Sun;
- Mercury;
- Venus;
- Earth;
- Moon;
- Mars;
- Jupiter;
- Saturn;
- Uranus;
- Neptune.

Additional dwarf planets/asteroids/spacecraft belong in follow-ups.

### Data form

The scenario is committed as normalized data compatible with the public OrbitEngine contracts. It includes, as required by the active models:

- stable caller-supplied `ObjectId` values;
- `ObjectType`;
- explicit mass and/or gravitational parameter where available/required;
- physical radius for rendering/reference;
- exact anchor `SimulationInstant`;
- canonical Cartesian position/velocity;
- `ReferenceFrameId` and required frame definitions;
- propagation configuration;
- source/provenance notes.

The first motion scenario uses the production engine model implemented by #23 rather than a JavaScript ellipse approximation.

Expected initial model use:

- planets: `twoBodyAnalytical` relative to a declared Sun-centered non-rotating frame;
- Moon: `twoBodyAnalytical` relative to a declared Earth-centered non-rotating frame;
- Sun: root/reference/appropriate anchor authority according to the available public contracts.

Exact registration details follow documents 13–15 and the public APIs delivered by #16/#20/#23.

### Provenance

The committed fixture must state:

- source(s);
- source retrieval/version date where applicable;
- source epoch/time scale;
- source spatial frame;
- normalization steps;
- known accuracy/validity limitations.

The demo must not imply the small fixture is the future production ephemeris database.

Runtime demo execution never calls NASA/JPL over the network.

### Replaceability

The application scenario loader consumes a normalized demo-scenario shape. Later importer output should be able to produce equivalent registration inputs without changing rendering code.

## Visual/UI v1

The first complete engine-driven demo provides:

- full-canvas Three.js Solar-System view;
- Sun, eight planets, and Moon;
- basic procedural materials/colors; external textures are not required for v1;
- OrbitControls camera orbit/pan/zoom;
- click/select body;
- focus selected body;
- always-available body names through a lightweight label/list UI;
- play/pause;
- several preset positive time-warp rates;
- exact engine time/debug instant display;
- backend indicator showing `WASM`;
- current focus/output frame information;
- selected-object `ObjectId`, `ObjectType`, physical radius/mass/µ when present;
- selected object's current position/velocity snapshot and propagation metadata exposed by the public API;
- a clear indicator when body radii are visually exaggerated.

The demo should remain useful with procedural spheres; photorealistic textures are deferred so rendering assets/licensing do not block the engine reference application.

## Orbit/path visualization

Orbit/path lines are derived visualization, never an independent orbital model.

When added, a path is generated by sampling OrbitEngine state-at-time queries over an explicit interval and rendering the returned points. The demo must not derive a Kepler ellipse from its own orbital-element math as a substitute for engine results.

Path samples carry the source time interval/model revision so they can be invalidated/recomputed when authoritative motion changes.

Path visualization is a follow-up feature after the initial engine-driven body view is working.

## Later numerical/N-body visualization

The demo is intentionally structured so later propagation features can be displayed without changing the rendering authority boundary.

For example:

```text
twoBodyAnalytical
       |
       v
numerical / N-body near encounter
       |
       v
new post-encounter motion authority
```

The renderer still asks only for canonical state at `T`. Optional debug UI may show active `PropagationModelKind`, fidelity, force sources, or switch events when those public metadata become available.

The demo never implements N-body gravity itself.

## Main-thread policy

V1 runs the small Solar-System WASM workload on the browser main thread. Ten-ish bodies and one bounded batch query do not justify a worker architecture yet.

The simulation/query coordinator must nevertheless expose an asynchronous application boundary so the engine can later move into a Web Worker if profiling shows main-thread stalls. Moving to a worker must preserve exact query/result semantics.

SharedArrayBuffer, cross-origin isolation, WASM threads, and browser worker physics are non-goals for v1.

## Testing strategy

### Demo unit tests

Unit tests cover pure application logic, including:

- wall-clock delta + warp → normalized `Duration`/`SimulationInstant` advancement;
- pause behavior;
- direct time jump;
- stale query generation discard;
- bounded pending-target replacement;
- metres→scene-unit conversion;
- reversible ICRS/ICRF → J2000-ecliptic presentation rotation and sign convention;
- focus-relative coordinate mapping;
- physical vs exaggerated radius policy;
- demo metadata keyed by `ObjectId` without mutating engine objects.

Mocked engine tests verify that body mesh updates consume returned public state snapshots and do not calculate orbital motion locally. Rendering tests also verify that body meshes, sampled paths, and camera centering use the same transformed presentation coordinates while raw scenario/engine states remain unchanged.

### Engine/package browser smoke

A real browser smoke test is required in initial browser-support implementation.

It must:

1. build/use the packaged/workspace `orbit-engine` output, not import internal source files;
2. run under a real headless Chromium page served by Vite/preview or an equivalent static server;
3. call `OrbitEngine.create({ backend: "wasm" })`;
4. verify backend initialization succeeds;
5. execute at least one real registry/state operation available at that implementation stage;
6. after #20/#23 integration, register/load the demo scenario and verify at least one state-at-time result;
7. fail on missing/misresolved Emscripten JS/WASM assets.

Playwright Chromium is the selected initial automation tool for this smoke path. Browser-specific test tooling remains in the private demo/application dev dependencies.

### Rendering smoke

The application capability-checks WebGL 2.

The browser smoke should assert one of:

- WebGL 2 is available and the demo reaches a rendered/ready state; or
- the application shows the explicit unsupported-renderer message.

CI correctness of the OrbitEngine WASM query must not depend on GPU-driver-specific pixel snapshots. Pixel-perfect screenshot regression testing is not part of v1.

### Production build

CI builds the static Vite artifact and treats unresolved imports/assets, TypeScript errors, or browser bundle failures as test failures.

Existing portable C++, native, WASM, parity, and npm tarball checks remain independent and are not weakened by adding the demo.

## CI ownership

The demo adds application-focused jobs/steps rather than multiplying every existing engine matrix job.

Initial expected validation:

```text
Demo unit/type tests          Linux + supported repository Node
Demo production build        Linux
Browser/WASM smoke            Linux + headless Chromium
```

Engine/native Windows jobs do not need to run Three.js/browser tests merely because the demo exists.

When OrbitEngine backend/public API code changes, existing engine CI plus browser smoke together protect both Node and browser consumer shapes.

## Static deployment boundary

`vite build` produces a self-contained static application directory containing hashed JS/assets and the bundled/copied OrbitEngine WASM artifacts.

The static artifact must not require:

- an application server;
- runtime Node.js;
- live astronomical APIs;
- access to the source monorepo.

A deployment workflow (for example GitHub Pages) is intentionally separate from the first implementation. Adding deployment must consume the already-tested static artifact rather than rebuilding different bytes after validation.

## Staged implementation plan

Architecture #30 decomposes into separate Implementation tasks.

### Stage A — browser-safe OrbitEngine WASM consumer path

Can be implemented independently of the final frame/propagator demo.

Scope:

- make package-owned Emscripten module/binary statically discoverable to browser bundlers;
- add a minimal Vite/headless-browser consumer smoke path;
- preserve existing Node WASM behavior and package smoke.

### Stage B — demo application shell

Depends on Stage A.

Scope:

- private `apps/solar-system-demo` workspace;
- Vite + Three.js + vanilla TS shell;
- WebGL2 capability/error UI;
- public OrbitEngine WASM initialization;
- render-space/time/query coordinator unit-tested infrastructure;
- no fake orbital motion.

The shell may display backend/engine readiness before the full Solar-System motion APIs are available.

### Stage C — engine-driven Solar-System scenario

Depends on #20, #23, and Stages A/B.

Scope:

- committed normalized Sun/planets/Moon scenario with provenance;
- real object/frame/model registration;
- same-epoch engine state queries;
- Three.js body visualization from engine state only;
- selection/focus and debug state.

### Stage D — time warp, relative focus, and sampled paths

Depends on Stage C.

Scope:

- polished time-warp controls;
- frame/focus switching using #20 relative queries;
- engine-sampled orbit/path lines;
- model/debug metadata display.

Later numerical/N-body/encounter/trajectory features extend the demo through additional issues; they do not modify this boundary.

## Explicit non-goals

This architecture does not add:

- rendering APIs to OrbitEngine;
- Three.js/Vite dependencies to the public engine package;
- a JavaScript orbit solver;
- a second authoritative simulation clock;
- live NASA/JPL calls;
- production ephemeris import tooling;
- N-body/numerical propagation;
- encounter/collision systems;
- trajectory optimization;
- WebGPU requirement;
- WASM threads/SharedArrayBuffer;
- server-side rendering;
- a frontend framework;
- photorealistic texture pipeline;
- deployment credentials/workflow.

## Acceptance contract

A conforming demo implementation satisfies all of the following:

1. removing `apps/solar-system-demo` leaves the published OrbitEngine package architecture intact;
2. removing Three.js/Vite cannot affect portable C++ or engine physics behavior;
3. the demo can initialize the packaged OrbitEngine WASM backend from a browser using only public API;
4. all visible body positions originate from engine state queries at explicit `SimulationInstant` values;
5. animation frame rate cannot become a hidden physics integration step;
6. focus-relative rendering preserves local precision and does not mutate physical state;
7. render scale/body exaggeration are presentation-only and explicitly distinguishable from physical values;
8. the committed scenario is offline, deterministic, normalized, and provenance-documented;
9. browser/WASM asset resolution is tested through a real consumer build;
10. later numerical/N-body features can be visualized through the same state-at-time boundary without redesigning the app/engine separation.
