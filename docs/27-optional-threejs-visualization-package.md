# 27 — Optional Reusable Three.js Visualization Package

## Status and scope

This document records the architecture decided by Architecture issue #114 after the issue was deliberately rescheduled by the user following completion of the #115–#120 architecture sequence.

OrbitEngine will provide a **separate optional public companion package** named `orbit-engine-three`. The existing `orbit-engine` package and portable C++ core remain authoritative simulation components and remain free of Three.js, DOM, WebGL, camera, shader, render-LOD, and presentation dependencies.

The companion package turns caller-supplied/public-API-derived OrbitEngine state plus optional appearance metadata into reusable presentation state and Three.js resources. It is non-authoritative: no visual radius, marker position, shader value, selection state, camera state, orbit line, or renderer-local transform may become physical truth.

This document replaces the previous architectural assumption that all reusable Three.js rendering must remain private to `apps/solar-system-demo`. The demo remains a private reference application, but it will migrate to become the primary real consumer of `orbit-engine-three`.

This architecture does not itself implement the package, migrate the demo, add new simulation physics, create a game UI framework, ship large texture assets, or make rendering authoritative.

## Decisions at a glance

- Add a second independent public workspace package: `packages/orbit-engine-three`.
- `orbit-engine-three` has peer dependencies on compatible `orbit-engine` and `three` versions. `orbit-engine` has no dependency on the companion package or on Three.js.
- The companion package is ESM-only, TypeScript-first and does not require Vite as its package build system.
- Renderer-neutral presentation types/derivation live **inside the companion package**, exposed through a stable `orbit-engine-three/presentation` subpath; a third public presentation package is not created in v1.
- The primary integration mode is **snapshot-driven**. The consumer owns simulation/update cadence and passes one prepared `CelestialRenderSnapshot` to the renderer.
- A convenience `OrbitEngineSnapshotSource` adapter may build snapshots from a real `OrbitEngine` instance, but it only uses public bounded/batched read APIs and never owns a render loop or advances engine time.
- Consumer owns `THREE.WebGLRenderer`, scene, camera, post-processing, application loop and UI. The package owns one root `THREE.Group` plus every Three.js resource it creates beneath that root.
- Render-space origin, scale and axis transform are presentation configuration. Authoritative state stays SI/frame-qualified; the renderer should consume origin-relative positions to avoid giant-coordinate precision loss.
- Visual bodies are capability-composed rather than one class hierarchy per `ObjectType`: sphere + optional atmosphere + optional stellar emission + optional orbit + representation/selection capabilities.
- Existing physical/adaptive sizing, `hidden | marker | sphere` LOD, hysteresis, separation caps and marker batching become reusable generic mechanisms with configurable strategy/policy inputs.
- Scenario-specific global-context rules such as “Sun and eight planets” are not hardcoded. Consumers supply context/priority ObjectIds or a typed policy.
- Large unresolved populations use bounded batched marker resources with stable ObjectId-to-instance mapping; the package never assumes all registered objects must be rendered or queried each frame.
- Appearance/atmosphere/stellar metadata becomes a public **companion-package semantic contract**, still distinct from OrbitEngine physical properties.
- Surface/atmosphere illumination is derived from authoritative SI-space star/body geometry and semantic stellar data. Adaptive render radius/marker positions never affect irradiance.
- Atmosphere rendering becomes a first-class optional companion capability using the existing bounded shell approach; shader uniforms remain private implementation details.
- Orbit rendering consumes engine-derived sampled paths. The companion contains no local Kepler/ephemeris solver and performs no per-frame orbit resampling.
- Picking returns stable `ObjectId` references and may update presentation selection/focus inputs only; it never mutates simulation state.
- Procedural/default materials require no external assets. Consumers may provide already-loaded textures/material inputs through typed providers; large reference texture packs are not mandatory package content.
- Package and demo browser tests become part of CI. A physics-only install/import of `orbit-engine` remains unaffected and does not install/load Three.js because of this feature.

## Public package topology

The canonical workspace becomes:

```text
packages/
├── orbit-engine/          # authoritative simulation package
└── orbit-engine-three/    # optional presentation/Three.js companion

apps/
└── solar-system-demo/     # private reference consumer of both packages
```

A package subpath such as `orbit-engine/three` is rejected because it would blur dependency/release ownership and make a browser/rendering concern appear to be part of the base simulation package.

A single package with optional Three.js imports is also rejected. Tree shaking is not a sufficient architectural boundary for Node/server consumers, dependency installation, release integrity, and long-term package ownership.

A private-only package is rejected because the purpose of #114 is reusable external-consumer functionality rather than merely reorganizing demo source.

## Dependency direction

Canonical dependency direction:

```text
portable C++ core
        |
        v
orbit-engine TypeScript facade
        |
        +----------------------+
        |                      |
        v                      v
consumer simulation      orbit-engine-three
state/catalog             presentation layer
                               |
                               v
                           Three.js
                               |
                               v
                    consumer scene/application
```

Forbidden directions:

```text
orbit-engine -> orbit-engine-three
orbit-engine -> three
portable C++ -> Three.js / WebGL / DOM
render LOD -> physical radius
renderer-local motion -> authoritative state
selection/focus -> propagation/fidelity semantics
shader/material state -> simulation state
```

`orbit-engine-three` may import stable public values/types from `orbit-engine`; it may not import `orbit-engine/src/internal/*`, raw bindings, WASM modules, C++ handles, cache objects, or backend-specific representations.

## Package dependencies and version compatibility

### Peer dependencies

`orbit-engine-three` uses peer dependencies rather than bundling private copies of its foundational runtime libraries:

```text
peerDependencies
  orbit-engine: compatible declared range
  three: compatible declared range
```

The initial Three.js compatibility line is the currently used `0.185.x` family. Because Three.js releases can change renderer/shader APIs between `0.x` minors, the initial package range should be equivalent to `^0.185.0` rather than claiming broad untested compatibility.

`@types/three` is a development dependency of the companion package, not a runtime dependency.

### Versioning policy

`orbit-engine-three` has independent semantic versioning. It does not need a release merely because the simulation package receives an unrelated patch.

Every companion release declares an explicit `orbit-engine` peer range. CI always tests the workspace versions together. If a public OrbitEngine snapshot/state API change is incompatible with the companion package, the companion peer range and implementation must be updated before claiming compatibility.

During the current pre-1.0 phase, compatibility is deliberately narrow. A new incompatible `orbit-engine` minor may require a new companion release/range even if both remain `0.x`.

## Package/module shape

Initial package exports are conceptually:

```text
orbit-engine-three
orbit-engine-three/presentation
```

The root export owns Three.js resource/coordinator APIs.

`/presentation` owns renderer-neutral semantic value types and pure derivation functions such as appearance resolution, stellar illumination, adaptive sizing inputs/outputs and representation decisions. These APIs must not expose GLSL uniform names or Three.js material properties.

A third `orbit-engine-presentation` package is rejected for v1 because no non-Three consumer currently justifies the release/dependency overhead. The semantic layer remains factored internally so it can be extracted later without changing its conceptual contracts.

## Snapshot-driven state boundary

### Primary contract

The reusable renderer receives a prepared immutable snapshot for one exact presentation instant:

```text
CelestialRenderSnapshot
  instant: SimulationInstant
  origin: RenderSnapshotOrigin
  bodies: CelestialBodyRenderState[]
  orbitPaths?: OrbitPathSnapshot[]
  revision/fingerprint
```

Each body contains only public/semantic data required by presentation, conceptually:

```text
CelestialBodyRenderState
  objectId: ObjectId
  objectType?: ObjectType
  parentId?: ObjectId
  positionRelativeToOriginMeters: Vec3
  velocityRelativeToOriginMetersPerSecond?: Vec3
  physicalRadiusMeters?: number
  stateRevision?
  propertyRevision?
  appearanceKey/object-associated appearance?
```

The precise public value names may be refined mechanically. The invariants are mandatory:

- one exact instant per snapshot;
- every submitted position uses one declared physical frame/origin convention;
- values are SI/binary64 before render conversion;
- stable ObjectId association is preserved;
- missing optional physical/presentation data is explicit;
- renderer updates never query hidden authoritative state merely to fill an omitted required value.

Snapshot membership is consumer-controlled. The renderer does not enumerate every object in the engine registry by default.

### Why snapshot-driven is primary

Snapshot ownership keeps application responsibilities explicit:

- games decide when simulation advances;
- games decide which objects are visible/relevant;
- one prepared state can feed rendering, UI and diagnostics;
- renderer tests need no live engine;
- rendering cannot accidentally create duplicate state queries;
- historical/replay/precomputed frames are renderable;
- the renderer does not become an event/fidelity scheduler.

## Optional OrbitEngine snapshot adapter

The companion package provides an optional convenience adapter conceptually equivalent to:

```text
createOrbitEngineSnapshotSource(engine, catalogAdapter?)
```

The returned source may expose bounded read operations such as:

```text
snapshot({ instant, objectIds, origin, include })
sampleOrbitPath({ objectId, parentId?, interval, sampleCount, frame })
```

Rules:

- uses only public `orbit-engine` APIs;
- uses same-epoch batch and relative-state queries where available;
- never calls `advanceTo`/`advanceBy` implicitly;
- never installs fidelity requirements merely because something is visible/selected;
- object sets and sample counts are explicit/bounded;
- no internal polling/requestAnimationFrame loop;
- no one-backend-per-object query loop when a batch API exists;
- query failures are returned to the caller rather than replaced with renderer-local extrapolation.

The adapter is an integration convenience, not a second renderer-owned simulation service.

## Appearance and presentation metadata ownership

Appearance remains separate from simulation physical properties.

The companion package promotes the semantic contracts described by document 19 into reusable public types, including concepts equivalent to:

```text
CelestialAppearance
VisibleLayerAppearance
AtmosphereAppearance
StellarEmission
AppearanceProvenance
ResolvedSurfaceAppearance
AtmosphereOptics
StellarIllumination
```

These types belong to `orbit-engine-three`/`presentation`, not to `orbit-engine` or portable C++.

An appearance provider is keyed by stable `ObjectId` or by a consumer-defined catalog mapping that ultimately resolves to an ObjectId.

The package supports:

1. complete consumer appearance records;
2. partial records with deterministic semantic fallbacks;
3. no appearance record, producing a basic fallback body from physical type/radius plus configured fallback accent;
4. external/reference appearance datasets through the same provider interface.

V1 does **not** hardcode a Solar-System ObjectId catalog into the reusable package. The existing demo dataset remains scenario/application data during migration. A future optional reference dataset/assets package may be added if multiple consumers justify it.

Rendering atmosphere metadata never becomes aerodynamic/drag input. If simulation later needs atmosphere physics, that remains a separate OrbitEngine physical contract.

## Renderer-neutral derivation boundary

Pure semantic derivation must be usable without constructing Three.js resources.

Examples:

```text
resolveSurfaceAppearance(...)
resolveAtmosphereOptics(...)
resolveStellarIllumination(...)
computeProjectedPhysicalRadius(...)
computeAdaptiveVisualRadius(...)
resolveRepresentation(...)
```

Semantic outputs use physical/presentation concepts, not implementation variables such as:

```text
uRayleigh
uMie
material.opacity
ShaderMaterial.uniforms
```

The Three.js layer translates semantic values into materials, geometry, shader parameters, draw-order and batching.

This lets shader implementations change without changing public appearance semantics.

The initial `/presentation` implementation exposes these semantic families as
plain TypeScript values: `CelestialAppearance` validation and deterministic
optical-library fallbacks, `ResolvedSurfaceAppearance`, `AtmosphereOptics`,
`StellarIllumination`, lighting-mode diagnostics, blackbody chromaticity,
inverse-square irradiance, and bounded display exposure. Stellar resolution
uses authoritative SI snapshot positions only. Its `allContributions` and
additive total preserve every configured emitter; `contributions` is the
default-four deterministic presentation selection and
`diagnostics.truncatedEmitterIds` makes any cap observable. No public semantic
type contains Three.js, GLSL, material, or uniform details.

## Scene, renderer, camera, and loop ownership

The consumer owns:

- `THREE.WebGLRenderer`;
- the top-level `THREE.Scene`;
- active camera(s);
- post-processing/composer;
- animation/render loop;
- resize/device-pixel-ratio policy;
- application UI and camera navigation.

The package constructs a scoped coordinator conceptually equivalent to:

```text
CelestialSystemView
  root: THREE.Group
  update(snapshot, viewContext)
  setConfiguration(config)
  pick(...)
  diagnostics()
  dispose()
```

The consumer inserts `root` into its own scene.

The first resource-coordinator implementation exposes this contract from the
package root as `CelestialSystemView`, `CelestialRenderSnapshot`,
`createCelestialRenderSnapshot`, and render-space conversion helpers. The view
stages body anchors, sphere materials, stellar-emission state, and atmosphere
shells from one immutable snapshot. A failed staged allocation returns
structured diagnostics and leaves the previous committed resource membership
intact. Package-created geometry/material/shell resources are disposed by the
view; surface textures carry explicit caller/package ownership and caller-owned
textures remain untouched.

`CelestialSystemView` owns resources it creates beneath that root and removes/disposes them deterministically. It does not call `renderer.render`, own `requestAnimationFrame`, or take over the consumer scene.

## Update transaction and failure containment

An `update` consumes one coherent snapshot and view context. Semantic validation happens before mutating committed visual membership where practical.

Representation/resource changes are staged so a failed allocation/validation does not intentionally leave duplicate marker+sphere representations or half-registered ObjectId mappings. Newly allocated resources from a failed staged update are disposed.

Rendering is non-authoritative, so a failed visual update reports structured diagnostics and may retain the previous committed visual state. It must never repair the failure by inventing new physics state.

## Render-space precision and coordinate contract

### Origin-relative physical input

The preferred snapshot carries object positions relative to a caller-chosen physical origin already produced by public relative-state/frame APIs. This avoids subtracting very large SSB coordinates after precision has already been lost in presentation code.

`RenderSnapshotOrigin` records the physical origin identity/context used by the snapshot, for example a focus ObjectId or explicit frame origin. It is metadata for interpreting relative positions, not a new physical frame in OrbitEngine.

### Scene conversion

A presentation configuration defines:

```text
metersPerSceneUnit > 0
presentationRotation / axis transform
```

Default axis transform is identity. The Solar-System demo supplies its existing J2000-ecliptic presentation rotation explicitly; the reusable package does not globally declare ecliptic coordinates to be OrbitEngine's physical root.

Render conversion is:

```text
relative physical metres
  -> configured axis transform
  -> divide by metresPerSceneUnit
  -> Three.js position
```

The reverse path never writes these scene values into OrbitEngine.

### Camera/viewport context

The Three.js update receives an explicit view context containing at least:

- camera;
- viewport CSS width/height;
- selected/focused ObjectIds;
- optional context-priority ObjectIds;
- current radius/lighting/visibility modes.

CSS-pixel LOD thresholds are independent from device pixel ratio, preserving document 17 semantics.

The package may provide near/far clipping guidance helpers, but it does not own camera navigation or silently rewrite consumer camera settings.

## Composable celestial visual capabilities

The Three.js implementation favors composition:

```text
body anchor
  + sphere surface capability
  + optional atmosphere capability
  + optional stellar-emission/glow capability
  + optional orbit capability
  + representation/marker capability
  + optional selection indicator
```

A dedicated class per `ObjectType` is not required. Object type may inform fallback appearance/policy, but capabilities are enabled from actual physical/appearance/presentation data.

A `planet` does not automatically get an atmosphere. A `star` with no supplied stellar-emission appearance record does not silently become a physically calibrated light source.

## Surface and stellar lighting

The reusable semantic layer derives:

- resolved visible-layer reflectance;
- stellar chromaticity from effective temperature;
- irradiance from supplied luminosity and authoritative SI center-to-center distance;
- normalized body-to-star directions from physical snapshot coordinates;
- additive multi-star illumination;
- Physical versus Enhanced presentation mode.

`Physical` contains only configured stellar illumination. `Enhanced` adds bounded presentation-only inspection fill after the physical solution.

To keep shader cost bounded, a body uses at most a configured `maxStellarContributors` in one pass; the initial default is 4. If more emitters are present, the semantic resolver deterministically keeps the highest physical irradiance contributors with ObjectId tie-breaking and reports truncation diagnostics.

The Three.js implementation should use its own physically motivated surface shader/material path rather than relying on an arbitrary scene-global `PointLight` as the sole illumination source. Consumers remain free to use additional lights for unrelated scene/game art, but those do not redefine the package's `Physical` celestial-lighting result.

Adaptive body radius, marker size, render-space scale and atmosphere-shell exaggeration never enter inverse-square irradiance.

## Atmosphere capability

Atmosphere rendering is a first-class optional package capability following document 19.

Semantic separation is mandatory:

```text
AtmosphereAppearance / physical-looking source metadata
        -> AtmosphereOptics
        -> presentation shell policy
        -> Three.js shader implementation
```

The default implementation uses the existing bounded transparent shell with view/light-dependent Rayleigh/Mie-like approximation rather than high-cost global volumetric raymarching.

Atmosphere resources exist only while a body uses a sphere representation. Marker/hidden representations own no atmosphere mesh/material.

Presentation-only minimum rim thickness may be applied in adaptive mode, but it is never interpreted as a physical atmosphere radius or fed back to simulation.

Surface and atmosphere paths consume the same resolved physical stellar directions/contributors for one snapshot.

## Adaptive sizing and representation LOD

The companion package extracts the generic mechanisms from documents 17/18:

- `physical` and `adaptive` radius modes;
- projected CSS-pixel physical size;
- monotonic adaptive enhancement;
- separation-aware enhancement caps;
- `hidden | marker | sphere` representation;
- hysteresis;
- parent/child hierarchy eligibility;
- selection/focus/context overrides;
- resource promotion/demotion.

The package root now exposes the reusable sizing/LOD/picking pieces through
`resolveBodySizing`, `createRepresentationPolicy`,
`resolveRepresentationDecisions`, `BatchedMarkerLayer`, and the camera-aware
`CelestialSystemView` update context. The policy is driven only by immutable
body state, parent ObjectIds, CSS-pixel projection metrics, and caller-supplied
selection/focus/context-priority sets. It contains no Solar-System identity
rules. Marker membership is sorted deterministically and rendered through one
bounded `THREE.Points` resource; the view maps marker and sphere hits back to
stable ObjectIds without changing engine state.

### Default policy versus application policy

The package ships a documented generic default strategy equivalent to current demo behavior but without Solar-System-specific identities.

Stable semantic configuration includes concepts such as:

```text
radiusMode
markerEnter/Exit thresholds
sphereEnter/Exit thresholds
adaptive floor/resolved thresholds
separation fraction
selected/focused overrides
resource budgets
```

Exact tuning defaults may evolve within documented compatibility bounds; public contracts should not expose every shader/tuning constant.

Consumers may supply a typed `RepresentationPolicy` strategy when a game needs another policy. The strategy receives immutable presentation inputs and returns semantic representation decisions; it cannot mutate engine state or package-internal resource ownership directly.

### Global context

Document 18's committed “Sun + major planets” set remains demo policy. The generic package instead accepts context priority/minimum-representation ObjectIds (or a typed context policy). The demo configures its major bodies explicitly.

`physical` mode still forbids fixed-size body inflation. Context can be preserved with orbit/selection/navigation primitives rather than falsifying physical body size.

## Large populations and marker batching

The package provides a generic batched unresolved-body representation for asteroid/debris/other caller-selected populations.

Required semantics:

- stable ObjectId-to-instance/point mapping;
- deterministic membership updates;
- bounded geometry/material count;
- batch position/size update from the current snapshot;
- adaptive markers may use viewport-stable configured size;
- physical-mode batch point size equals true projected physical size;
- picking maps batch hit -> ObjectId;
- promotion to individual sphere removes the corresponding marker in the same committed presentation update;
- no automatic unique orbit/mesh/material allocation for every registered object;
- caller controls which population members are included in the snapshot/render set.

Batched rendering is presentation performance only and has no effect on engine registration or fidelity.

## Orbit visualization

The companion renderer consumes `OrbitPathSnapshot` values containing explicit engine-derived samples and physical context:

```text
OrbitPathSnapshot
  objectId
  parentId?
  frame/origin context
  sampleInstants/range
  relative sample positions in metres
  motion/source revision fingerprint
  closed/open metadata
```

The package draws these samples with configurable opacity/emphasis/direction styling.

The renderer itself does not run Kepler, Lambert, ephemeris or numerical propagation to invent the path.

The optional OrbitEngine snapshot adapter may provide bounded orbit sampling through public state APIs. Sample count/time range are explicit. Orbit cache identity includes object motion/source revision, parent/frame/origin, sample interval and sampling configuration.

The package exposes `OrbitPathSnapshot`, `OrbitPathCache`, `sampleOrbitPath`,
`OrbitPathRenderer`, `SelectionIndicator`, and
`createOrbitEngineSnapshotSource`. The adapter uses only public
`statesAt`, `stateAt`, `relativeStateAt`, and registry metadata reads. It
returns immutable same-epoch snapshots, uses parent-relative queries when the
path origin is an object, and propagates query failures instead of
extrapolating locally. The renderer combines parent-relative samples with the
current presentation positions before Float32 upload, so distant paths do not
reintroduce large opposing coordinates in GPU geometry. Selection halos and
orbit picking carry stable ObjectIds and never alter body radius or simulation
state.

No orbit is resampled every frame unless its declared cache dependency/input actually changes. Large populations do not receive orbits automatically.

## Selection, focus, and picking

Reusable interaction support includes:

- ObjectId association on sphere/marker/orbit representations;
- raycast/picking helpers;
- deterministic mapping from batched marker hit to ObjectId;
- selection/focus presentation inputs;
- selection halo/indicator;
- selected-orbit emphasis;
- configured LOD/context override.

The package may return a result such as `PickResult { objectId, representation, distance... }`. The consumer decides what a selection means.

The package never interprets a click as permission to mutate OrbitEngine, issue a maneuver, change fidelity, select a game faction entity, or open UI.

## Configuration model

Public configuration expresses stable presentation choices rather than internal shader details.

Initial semantic configuration groups include:

- render-space scale/axis transform;
- radius mode and adaptive/physical policy;
- representation thresholds/hysteresis;
- hierarchy/context policy;
- orbit visibility/sample/render policy;
- marker batching/resource budgets;
- atmosphere quality/rim presentation policy;
- Physical/Enhanced lighting and max stellar contributors;
- fallback appearance;
- selection-indicator policy.

Shader step counts, uniform names, material defines, WebGL render-order integers and internal geometry segment counts are implementation details unless a proven consumer requirement requires a stable semantic quality setting.

## Consumer customization hooks

Supported typed hooks/providers may include:

```text
AppearanceProvider
TextureProvider
RepresentationPolicy
OrbitStylePolicy
FallbackAppearanceProvider
```

Hooks receive stable semantic inputs. They do not receive mutable internal renderer stores by default.

Texture/material customization ownership must be explicit. Consumer-provided textures are caller-owned unless a provider explicitly returns a transferable/disposable resource handle. The package must not dispose arbitrary externally owned resources.

Game-specific overlays should normally remain sibling/application scene resources driven by the same snapshot/ObjectIds rather than mutating internal package groups.

## Texture and asset boundary

The companion package must render useful default bodies without external texture downloads or bundled large assets.

V1 defaults are procedural/parameter-based.

Consumers may provide already loaded texture assets through documented providers. The package does not define an art-pipeline URL loader as authoritative behavior.

Large Solar-System texture collections, if added later, belong in a separate optional assets/dataset artifact or the consuming application. Installing `orbit-engine-three` must not force every consumer to ship those assets.

## Node/server import behavior

Importing `orbit-engine-three` must not read `window`, `document`, create a WebGL context, or initialize a renderer at module-evaluation time.

This permits build tools, SSR-capable application code and unit tests to import semantic APIs in Node. Actual WebGL rendering remains a browser/runtime capability of the consumer-provided Three.js renderer.

The base `orbit-engine` package remains fully usable without installing `orbit-engine-three` or `three`.

## Demo extraction and migration

The current demo contains concrete reusable extraction candidates, including the existing modules around:

- `rendering/adaptive-sizing.ts`;
- `rendering/representation-lod.ts`;
- `rendering/render-space.ts`;
- `rendering/celestial-appearance-rendering.ts`;
- `rendering/atmosphere-rendering.ts`;
- `rendering/lighting-mode.ts`;
- `rendering/orbit-renderer.ts`;
- `rendering/runtime-asteroid-markers.ts`;
- `rendering/selection-halo.ts`;
- generic portions of `rendering/solar-system-scene.ts` and scene-resource lifecycle logic.

These files are extraction inputs, not guaranteed one-to-one future package modules. Implementation should refactor by semantic responsibility rather than preserving demo filenames/classes unnecessarily.

Demo-owned responsibilities remain:

- app bootstrap/Vite configuration;
- simulation/time controls;
- celestial browser and inspection panels;
- camera navigation UX;
- scenario/OEP selection and provenance UI;
- runtime stress-object generation UI;
- Solar-System-specific global-context ObjectId set;
- scenario appearance catalog contents;
- demo diagnostics/user-facing error panels.

Migration stages:

1. bootstrap public companion package and CI without changing demo behavior;
2. extract pure presentation/appearance/lighting derivation with tests;
3. extract sphere/star/atmosphere/render-space resources;
4. extract adaptive sizing, LOD and marker batching;
5. extract orbit rendering, selection and snapshot adapter;
6. migrate demo imports to the public companion package and delete private duplicates;
7. make packaged demo/browser regression coverage the reference integration gate.

The migrated demo uses `orbit-engine-three` through workspace/public exports only; no privileged internal source imports are allowed.

## Build and release architecture

`packages/orbit-engine-three` is:

- public;
- ESM-only;
- TypeScript/declaration output built with `tsc` unless a later asset requirement justifies a package bundler;
- free of C++/native/WASM binaries of its own;
- independent from DOM/WebGL at import time;
- distributed with only source-derived JS/declarations and any small shader/procedural resources required at runtime.

Shader source should initially live as typed/static string modules or otherwise package-owned static resources with bundler-neutral ESM references. Vite-specific `?raw`/`?url` syntax must not become a public package requirement.

The workspace root gains explicit build/test/package-smoke scripts for the companion package. `orbit-engine` packaging remains independently testable.

## CI and testing

### Pure/unit tests

Cover at least:

- appearance validation/fallback/derivation;
- optical-library determinism;
- blackbody color and inverse-square irradiance;
- multi-star selection/truncation;
- render-space transforms;
- physical/adaptive projected sizing;
- separation cap and monotonicity;
- LOD/hysteresis/hierarchy/context decisions;
- orbit cache identity;
- selection/picking identity mapping.

### Three.js resource tests

Cover:

- creation/removal/disposal ownership;
- marker batch membership/update;
- sphere/marker promotion/demotion without duplicate representation;
- atmosphere allocation only for spheres;
- consumer-owned resource non-disposal;
- stable ObjectId association.

### Package/tarball tests

Install the packed companion with a packed compatible `orbit-engine` package into a clean fixture and verify:

- public ESM/declaration imports;
- peer resolution;
- no source-tree/internal imports;
- Node import performs no DOM/WebGL side effect.

A separate regression verifies installing/using the base `orbit-engine` tarball still requires no Three.js package.

### Browser/Playwright tests

A real packaged consumer must verify representative WebGL rendering with:

- star + planet + moon;
- authoritative snapshot positioning;
- correct physical star/body light direction;
- atmosphere orientation/visibility;
- orbit and child-orbit placement;
- physical/adaptive sizing;
- LOD transitions and marker batching;
- selection/picking mapping;
- resource disposal/recreation.

Pixel assertions should be targeted/tolerant. Semantic renderer diagnostics remain the main defense against brittle GPU/driver variation.

### Demo integration

After migration, the existing Solar-System demo build/unit/smoke tests consume the public package and remain required CI. This proves the reusable package against the real browser WASM engine path and realistic hierarchy/appearance data.

## Backward compatibility

Existing `orbit-engine` imports, initialization, package artifacts and backend semantics do not change merely because the companion exists.

No existing physics API requires rendering setup.

Consumers that do not install `orbit-engine-three` receive no Three.js dependency.

During demo migration, existing application appearance metadata may be adapted to the new public companion semantic types. This is a presentation-data migration only and must not change `PhysicalPropertiesInput` or engine state.

## Updated architectural boundaries

The durable rule is no longer “all Three.js logic is private demo code.” It becomes:

```text
orbit-engine
  authoritative simulation only

orbit-engine-three
  optional generic presentation + Three.js resources

application/demo
  scenario data + UI + camera UX + game-specific presentation policy
```

The portable core boundary does not change.

## Validation contract

Architecture implementation must ultimately prove at least:

1. a Node/server project installs and uses `orbit-engine` without Three.js;
2. a clean browser project installs `orbit-engine` + `orbit-engine-three` + compatible `three` and renders a snapshot;
3. snapshot rendering performs no simulation-time mutation;
4. optional Engine snapshot adapter uses bounded batch reads and does not advance time;
5. physical radius stays unchanged while adaptive visual size changes;
6. global/context LOD is configurable by ObjectId rather than hardcoded Solar-System names;
7. thousands of marker candidates remain batched and do not allocate one mesh/material each;
8. stellar irradiance uses SI distance and is unchanged by render scale/radius mode;
9. atmosphere resources follow sphere representation lifecycle;
10. orbit lines use supplied/engine-sampled states and contain no local orbital solver;
11. picking returns the correct stable ObjectId without mutating engine state;
12. `dispose()` releases package-owned Three.js resources and preserves caller-owned resources;
13. packaged-consumer browser test works without repository-internal imports;
14. migrated Solar-System demo passes existing browser/WASM behavior with the companion package;
15. physics/backend tests remain unaffected by companion-package changes.

## Follow-up implementation decomposition

Implementation should be split into reviewable issues:

1. bootstrap `orbit-engine-three`, exports, peer dependencies, packaging and CI;
2. extract/publicize renderer-neutral appearance, optical and stellar-lighting derivation;
3. implement snapshot contract, render-space helpers, body/star/atmosphere resource composition and disposal;
4. implement adaptive sizing, generic hierarchy LOD and batched marker/picking system;
5. implement orbit-path rendering/cache, selection indicators and public OrbitEngine snapshot/orbit-sampling adapter;
6. migrate `apps/solar-system-demo` to consume the public companion package and remove duplicate generic renderer code;
7. add clean-tarball/browser packaged-consumer regressions plus full demo integration/performance coverage.

The Implementation issues must not move physics into presentation code or introduce new architecture choices around package ownership, state authority or renderer lifecycle.
