# 30 — WidgetForge UI Architecture for the Solar-System Demo

## Status and scope

This document records the architecture decided by Architecture issue #245.

`apps/solar-system-demo` adopts `Kevni92/WidgetForge` as its primary application-UI framework. This is a **demo/consumer-layer decision** only. `orbit-engine`, the portable C++ core, and `orbit-engine-three` remain free of Vue and WidgetForge dependencies.

The target shell provides:

- one persistent top navigation for simulation date/time and time control;
- a WidgetForge Settings window;
- semantic celestial-object selection shared by the Three.js viewport and widgets;
- a WidgetForge Object Inspector window that follows the selected `ObjectId` and exposes context actions;
- a migration path for the remaining imperative `DemoPanel` UI into dedicated widgets.

This document supersedes document 16 only for the demo's current UI technology choice. The original vanilla-TypeScript UI was the correct bootstrap choice; the demo has now grown enough to justify Vue/WidgetForge. All simulation, WASM, reference-data, renderer-ownership and precision contracts from documents 16, 19, 20 and 27 remain in force.

## Decisions at a glance

- Vue 3 is the demo application-shell framework; WidgetForge is the UI/window/workspace framework.
- WidgetForge dependencies exist only in `apps/solar-system-demo`.
- The demo consumes WidgetForge only through its public package root and `widgetforge/style.css`.
- The production dependency must be an immutable built package artifact. A mutable `main`/branch source dependency and copied WidgetForge source are forbidden.
- A small demo-owned `DemoUiBridge` separates Vue/widgets from the imperative simulation/rendering controllers.
- `DemoUiBridge` is framework-neutral: it exposes snapshots/subscriptions plus explicit commands; a Vue provider/adaptor turns those notifications into Vue reactivity.
- The Three.js render loop remains outside Vue and continues to own renderer/camera/update cadence.
- The Three.js viewport is represented as a dedicated `orbit.viewport` WidgetForge widget hosted in one locked, chrome-less background window that fills the WorkspaceHost floating area. The Vue widget owns only the canvas DOM mount; the existing renderer/controller owns Three.js resources and behavior.
- The viewport background window uses a responsive layout specification anchored to all four workspace edges and is permanently below ordinary floating windows.
- A fixed, non-resizable top dock contains `orbit.time-controls`.
- Settings is `orbit.settings`, a singleton WidgetForge widget/window.
- The default inspector is `orbit.object-inspector`, also a singleton, and follows global semantic selection.
- Global celestial selection uses a WidgetForge `SelectionStore` channel containing stable OrbitEngine `ObjectId` values only.
- Selection and view focus/center are different state. Selection never implicitly changes camera focus.
- Existing `SolarSystemScene.selectFromPointer()` / package picking remains the source of viewport picks; WidgetForge never raycasts Three.js itself.
- The initial local demo does not use WidgetForge `DataClient`, `MutationClient`, WebSockets or a fake server. Widgets use the injected demo bridge and SelectionStore.
- Semantic UI changes publish immediately; continuously changing clock/selected-object telemetry is throttled to at most 4 Hz, and diagnostic/performance counters to at most 1 Hz. Rendering remains frame-rate driven.
- `DemoPanel` is transitional only and is removed area-by-area as controls move to widgets. There must never be two independent authorities for the same command/state.

## Hard dependency and authority boundary

Canonical dependency direction:

```text
portable C++ core
        |
        v
orbit-engine
        |
        +------------------------+
        |                        |
        v                        v
orbit-engine-three       apps/solar-system-demo
                                  |
                   +--------------+--------------+
                   |                             |
                Three.js                    Vue 3 + WidgetForge
                   |                             |
                   +---------- DemoUiBridge -----+
```

More precisely, the application owns the integration:

```text
OrbitEngine / SimulationClock / state coordinator
                    |
                    v
            demo controllers
                    |
              DemoUiBridge
              /          \
             v            v
     Three presentation   Vue/WidgetForge UI
```

Forbidden directions:

```text
orbit-engine -> vue
orbit-engine -> widgetforge
orbit-engine-three -> vue
orbit-engine-three -> widgetforge
WidgetForge -> OrbitEngine-specific widgets/types as framework knowledge
Vue reactive state -> authoritative orbital propagation state
THREE.Object3D -> semantic application identity
widget/window lifecycle -> simulation lifecycle
```

`ObjectId` remains the cross-layer identity. A widget may import public OrbitEngine value types because it is application code, but WidgetForge itself remains domain-agnostic.

## Application shell

### Selected composition

The top-level Vue application creates and owns the WidgetForge runtime objects:

- one `WidgetRegistry`;
- one `WindowManager`;
- one `DockManager`;
- one `SelectionStore`;
- one WidgetForge theme provider;
- one demo UI bridge provider.

The primary shell is a WidgetForge `WorkspaceHost`.

Conceptually:

```text
Vue App
  ThemeProvider
    SelectionProvider
      DemoUiProvider
        WorkspaceHost
          top dock
            orbit.time-controls
          floating area
            locked background window
              orbit.viewport
            normal floating windows
              orbit.settings
              orbit.object-inspector
              later demo widgets
```

### Why the viewport is a WidgetForge-hosted background window

`WorkspaceHost` owns dock geometry and its floating window surface; it does not expose a public arbitrary-background-content slot. Keeping a separate canvas physically behind the workspace would therefore require pointer-event tunneling or styling against WidgetForge's private DOM classes. Both approaches are rejected because they create a fragile dependency on framework internals and risk breaking OrbitControls/picking.

Instead, `orbit.viewport` is a registered application widget. It contains the canvas element but does **not** own simulation or renderer authority. On mount it passes its canvas/container to the existing demo render controller; on unmount it detaches through the controller's explicit lifecycle. Three.js state and the animation loop stay in the existing non-Vue controller layer.

The viewport window has these invariants:

- one fixed instance ID, `orbit.viewport.main`;
- non-closable, non-minimizable, non-maximizable by the user;
- non-movable and non-resizable by the user;
- header hidden and chrome `none`;
- layout locked;
- responsive layout anchored with zero offsets to workspace left/right/top/bottom edges;
- opened before ordinary floating windows;
- ordinary windows remain above locked/background windows according to WidgetForge stacking semantics.

The responsive layout, not ad-hoc DOM measurement, makes the viewport follow the current floating area after the top dock or browser size changes. The renderer still measures its actual mounted canvas/container and applies the existing camera/renderer resize policy.

### Top dock

`orbit.time-controls` is a registered widget placed in a WidgetForge top dock.

V1 dock policy:

- position: `top`;
- fixed thickness: 56 CSS px;
- `resizable: false`;
- not detachable in the default demo layout;
- always present while the application shell is running.

The current browser target remains desktop evergreen browsers from document 16. Mobile layout is not introduced by #245.

The persistent controls are:

- formatted current simulation civil date/time;
- Play/Pause;
- warp-factor selector/control;
- date/time jump control retained from the existing demo;
- Settings launcher.

Detailed renderer/debug controls do not remain in the top dock.

## DemoUiBridge

### Purpose

The bridge prevents Vue widgets from importing and mutating arbitrary state captured inside today's large `main.ts`. It also prevents the Three.js renderer from depending on Vue.

The bridge is a demo-owned, framework-neutral facade. It has no Vue, WidgetForge, Three.js or DOM types in its public contract except stable/public OrbitEngine value types such as `ObjectId` and `SimulationInstant` where appropriate.

### Read model

The bridge exposes immutable snapshots/subscriptions for these domains:

`lifecycle`
- bootstrap state: `loading | ready | error`;
- user-presentable initialization error when present.

`clock`
- exact current `SimulationInstant`;
- formatted civil display is derived in the Vue/UI layer from the existing civil-time helper;
- `playing`;
- `warpFactor`.

`focus`
- current view-center/focus `ObjectId`.

`presentation`
- radius mode;
- lighting mode;
- orbit visibility;
- reference-grid visibility;
- axes visibility.

`selectedObject`
- selected `ObjectId` is sourced from the SelectionStore rather than duplicated in this read model;
- when a selected object exists, the bridge exposes the latest inspector snapshot for that ID: name/type/parent, physical radius/mass, current state/derived speed, propagation/reference metadata, and renderer representation/diagnostics where available.

`diagnostics`
- optional engine/render/startup/performance data needed by later diagnostic widgets.

The implementation may use one aggregate immutable snapshot or a small set of domain snapshots. It must preserve the ownership and update-cadence rules below; it must not become a generic global mutable store.

### Command model

The bridge exposes explicit application commands corresponding to current demo behavior:

- toggle/set play state;
- set warp factor;
- jump to an exact simulation instant or validated civil-time input;
- set view focus/center to an `ObjectId`;
- center the camera on current focus/selected object as explicitly requested;
- set radius mode;
- set lighting mode;
- set orbit visibility;
- set reference-grid visibility;
- set axes visibility;
- later demo-only commands such as add/remove runtime asteroids.

Commands invoke the existing simulation/render controllers. They do not duplicate physics or derive an alternative authoritative state in Vue.

Commands are local synchronous/asynchronous application calls as appropriate. They are **not** modeled as network mutations in v1.

### Vue adapter

A `DemoUiProvider`/composable layer subscribes to the framework-neutral bridge and exposes shallow/read-only Vue state to widgets. Vue components never receive raw mutable engine/controller objects.

Unmounting a widget only releases that widget's subscription. It never stops the simulation or renderer unless the entire application/viewport controller is being disposed.

## State ownership matrix

| State | Authority | Vue/WidgetForge role |
| --- | --- | --- |
| physical object state, propagation, epochs | OrbitEngine | read-only projection |
| requested/current demo simulation time | `SimulationClock` + engine query path | display and explicit commands |
| Three.js renderer/camera/resources | demo rendering controller / `orbit-engine-three` | viewport DOM host + actions only |
| semantic selected celestial object | WidgetForge `SelectionStore<ObjectId>` | authoritative UI/application selection channel |
| view focus/center | demo navigation/render controller | bridge projection + explicit command |
| presentation modes/visibility | demo rendering/presentation controller | bridge projection + Settings commands |
| WidgetForge window/dock geometry/lifecycle | WidgetForge managers | authoritative UI workspace state |
| widget form drafts, temporary validation | individual Vue widget | local only |

No row has two authoritative owners.

## Semantic selection contract

### Selection key

The application creates one typed key equivalent to:

```text
channel = "orbit.object"
scope   = "solar-system-demo"
value   = ObjectId
```

Only a stable `ObjectId` is stored. Mesh references, instance indexes, `THREE.Object3D`, `RegisteredScenarioBody` objects and renderer representations are never stored as selection identity.

### Selection sources

All application selection sources converge on this channel:

- Three.js body/marker picking;
- existing/later celestial browser and search widgets;
- tables and lists;
- future command-palette/navigation actions that mean "select object".

A selection change updates presentation highlighting and inspector data, but **does not change view focus**.

### Three.js picking handoff

The current pipeline is retained:

```text
pointer gesture qualifies as click
        |
        v
SolarSystemScene.selectFromPointer(...)
        |
        v
orbit-engine-three / scene picking returns ObjectId
        |
        v
application selection handler
        |
        v
SelectionStore.select(objectSelectionKey, objectId)
```

The application-level handler also requests current selected-object inspector data and applies the selection to presentation highlighting as needed. `SolarSystemScene`/`orbit-engine-three` does not import WidgetForge.

The existing drag-vs-click threshold remains in force, so OrbitControls gestures do not create false selection events.

## Settings window

`orbit.settings` is a registered WidgetForge widget with `capabilities.multipleInstances = false`.

Initial window metadata should define a practical utility-window size and minimum useful size; exact pixel values are implementation detail as long as tests use the manifest rather than duplicate constants.

Initial settings:

- show/hide orbits;
- show/hide reference grid;
- show/hide axes;
- adaptive vs physical radius mode;
- Physical vs Enhanced lighting mode.

The Settings launcher simply invokes `WindowManager.open({ widgetId: "orbit.settings", ... })`. WidgetForge's singleton contract performs open/focus/restore semantics. Application code must not implement a parallel singleton registry.

Settings are session state in v1. Workspace/window-layout persistence is a WidgetForge concern if later enabled. Persisting rendering preferences across browser sessions is deferred until a dedicated preference policy is justified.

## Object Inspector

`orbit.object-inspector` is a registered singleton (`capabilities.multipleInstances = false`).

It follows the current `ObjectId` in the global selection channel and renders the latest selected-object bridge snapshot.

V1 information:

- object name;
- physical `ObjectType`/display category;
- central/parent body where present;
- physical radius;
- mass where present;
- current position/velocity context and derived speed;
- propagation/model/reference-source information already available to the current demo;
- current `orbit-engine-three` representation when useful as a presentation diagnostic.

V1 actions:

- `Center camera` — camera navigation only;
- `Set view center` — changes the demo focus/view center through the bridge;
- later object-specific actions may be added through the same explicit command boundary.

### Automatic opening behavior

The initial application selection (Sun at bootstrap) does not automatically show the inspector.

After UI initialization, every **new user/application selection event** uses this policy:

1. update the SelectionStore immediately;
2. if the inspector window does not exist, open it;
3. if it already exists, do not call `open()`/`focus()` merely because selection changed;
4. update its data through normal selection/bridge reactivity.

Therefore changing selection does not repeatedly steal keyboard/window focus. If the user closes the inspector, the next subsequent selection reopens it. This is deliberate and deterministic for v1.

A future explicit "pin/open another inspector" feature may introduce parameterized multi-instance inspector widgets, but is outside #245 and must not weaken the singleton default contract.

## Widget data access

### Selected v1 approach

Use:

- `SelectionStore` for semantic object selection;
- the demo-owned injected `DemoUiBridge` for local application read state and commands.

Do **not** instantiate WidgetForge `DataClient` or `MutationClient` merely to wrap in-process state.

Reasons:

- the demo has no transport boundary;
- the bridge already owns the application/controller boundary;
- high-frequency renderer data does not benefit from a network-resource cache abstraction;
- using Data/Mutation now would create protocol-shaped complexity without a second producer/consumer process.

If a later game/server architecture introduces shared remote resources, WidgetForge Data/Mutation may be adopted in that consumer without changing OrbitEngine simulation semantics.

## Update cadence and performance

The render loop remains unchanged in principle:

```text
requestAnimationFrame
  -> advance presentation clock/request authoritative state
  -> update Three.js presentation
  -> render
```

Vue is not notified on every animation frame.

The bridge uses these maximum notification rates:

- semantic state changes (play/pause, warp, selection, focus, settings, ready/error): immediate;
- changing displayed simulation time and selected-object telemetry: at most **4 Hz** while playing;
- engine/render/performance diagnostics intended for debug widgets: at most **1 Hz**;
- paused time, time jumps, selection changes and explicit commands force an immediate relevant snapshot regardless of throttle window.

A component may derive formatting from the latest snapshot, but it must not subscribe directly to `requestAnimationFrame` just to redraw text.

Renderer/camera updates caused by user interaction remain as responsive as today because they are not routed through Vue reactivity.

## WidgetForge package/distribution contract

WidgetForge is a separate repository and package. OrbitEngine must consume it as an external consumer, which is part of the architectural value of this integration.

Required contract:

- dependency declared only by `apps/solar-system-demo`;
- Vue 3.5+ declared by the demo as required by the WidgetForge peer contract;
- imports only from `widgetforge` plus the documented `widgetforge/style.css` export;
- no `src/*` subpath imports;
- no copied framework source or vendored `dist` directory;
- no mutable `github:Kevni92/WidgetForge#main`/branch dependency.

The normal target is an exact published npm package version, pinned by the repository lockfile.

At the time of #245, WidgetForge's repository declares package version `0.1.0` but has no GitHub release artifact. Therefore the first integration implementation issue has an explicit external prerequisite: a built immutable WidgetForge package artifact must exist before its dependency/lockfile change merges.

Allowed bootstrap artifact forms, in preference order:

1. exact public npm version (`widgetforge@0.1.x`, exact version in the demo manifest/lockfile);
2. immutable release tarball produced by WidgetForge's `npm pack`, referenced by immutable release URL and pinned by the pnpm lockfile/integrity metadata.

A local developer may temporarily use `pnpm link` while iterating across both repositories, but linked resolution must never be committed and is not CI/release behavior.

## `DemoPanel` migration

The imperative `DemoPanel` is transitional. Migration proceeds by ownership area, with the old control removed in the same implementation step that makes the WidgetForge replacement authoritative.

Order:

1. introduce Vue/WidgetForge shell, bridge and viewport widget while preserving the existing visible controls temporarily;
2. move simulation time controls to `orbit.time-controls`, then remove those controls/listeners from `DemoPanel`;
3. move rendering settings to `orbit.settings`, then remove the duplicated settings controls/listeners;
4. move selected-object summary/details/actions to `orbit.object-inspector`, then remove the corresponding panel section;
5. later migrate celestial browser/search to a dedicated WidgetForge widget/dock;
6. later split runtime asteroid controls and technical diagnostics into explicit debug/demo widgets;
7. remove obsolete static panel markup/CSS after the final consumers are migrated.

At no stage may both old and new controls keep independent state. During a staged PR, an area is either still `DemoPanel`-owned or bridge/widget-owned.

## Alternatives considered

### Keep vanilla DOM and use only WidgetForge windows

Rejected. WidgetForge's public widget contract is Vue-based; keeping a parallel imperative application UI would preserve two UI composition models and defeat the desired framework adoption.

### Put the canvas behind `WorkspaceHost` and make blank workspace areas click-through

Rejected. `WorkspaceHost` owns a full-size surface and no public background slot. Correct hit-through would depend on private WidgetForge DOM/CSS details or manual event tunneling, especially problematic for OrbitControls pointer capture.

### Let the viewport Vue component own OrbitEngine and Three.js controllers

Rejected. It would make component mount/lifecycle the authority for simulation and rendering and would encourage widgets to reach laterally into renderer state. The viewport widget is only a DOM/canvas adapter to application controllers.

### Use WidgetForge DataClient/MutationClient for every local value and command

Rejected for v1. There is no transport or shared remote-resource boundary. The in-process bridge is simpler, more testable and avoids fake network semantics.

### Store selected `RegisteredScenarioBody` or `THREE.Object3D` in SelectionStore

Rejected. Those values have lifecycle/representation coupling. Stable OrbitEngine `ObjectId` is the existing cross-layer identity contract.

### Make selection automatically focus the camera

Rejected. Inspection and navigation are separate user intents. Keeping them distinct preserves current UI flexibility and prevents list/table selection from unexpectedly moving the camera.

## Validation contract

### Architecture/bridge unit tests

Follow-up implementation must cover:

- bridge snapshots mirror authoritative clock/focus/presentation state;
- every bridge command reaches its intended controller exactly once;
- no Vue/WidgetForge type appears in the framework-neutral bridge module;
- object selection key accepts/stores `ObjectId` and renderer identity is never used;
- selection change does not change focus;
- immediate vs throttled notification behavior obeys 4 Hz / 1 Hz limits using a deterministic fake clock;
- viewport mount/unmount delegates to the renderer controller without recreating simulation authority.

### Widget/component tests

Cover:

- top controls render current bridge state and invoke commands;
- Settings widget reads current presentation state and invokes the matching bridge command;
- Settings manifest is singleton and repeated manager `open` focuses/restores rather than duplicates;
- Object Inspector follows SelectionStore and shows selected-object bridge data;
- inspector actions alter focus/camera only through explicit commands;
- a selection update does not focus an already-open inspector;
- closing the inspector followed by a new selection reopens it.

### Browser / Playwright tests

The existing demo browser/WASM tests remain required. Add scenarios proving:

1. WASM demo boots with WidgetForge top navigation and Three.js viewport visible;
2. viewport window fills the WidgetForge floating area below the top dock after initial layout and browser resize;
3. Play/Pause changes simulation progression/state;
4. warp changes simulation speed;
5. exact/civil time jump remains functional;
6. Settings opens exactly one window; repeated Settings clicks focus/restore it;
7. setting orbit/grid/axes/radius/lighting controls changes the corresponding presentation state;
8. a qualifying click on a visible celestial body selects its stable `ObjectId` through existing picking;
9. camera drag does not create a selection;
10. selection opens the inspector if absent and updates it without repeated focus stealing;
11. clicking UI windows/docks does not select objects in the viewport behind them;
12. Inspector `Center camera`/`Set view center` actions change only the intended navigation state;
13. resizing preserves top dock, viewport and floating-window usability;
14. existing renderer/reference/startup diagnostic test hooks remain available until a documented replacement is introduced.

Pixel-perfect snapshots are not required for WidgetForge chrome. Prefer semantic DOM/state assertions plus the existing renderer diagnostics.

## Follow-up implementation decomposition

Implementation should be split into these reviewable issues, in order:

1. **Vue + WidgetForge application shell, bridge and viewport integration**
   - immutable package dependency;
   - Vue/Vite bootstrap;
   - WidgetForge providers/registry/managers;
   - framework-neutral `DemoUiBridge`;
   - locked responsive `orbit.viewport` background window;
   - preserve current DemoPanel controls until subsequent issues.

2. **WidgetForge top navigation / time controls**
   - fixed top dock and `orbit.time-controls` widget;
   - date/time, Play/Pause, warp and time jump;
   - Settings launcher;
   - remove migrated time controls from DemoPanel.

3. **WidgetForge Settings window**
   - singleton `orbit.settings`;
   - orbit/grid/axes/radius/lighting controls;
   - remove migrated presentation settings from DemoPanel.

4. **Three.js semantic selection + Object Inspector**
   - typed `ObjectId` SelectionStore channel;
   - existing picker handoff;
   - singleton `orbit.object-inspector` and selected-object bridge projection;
   - center/view-focus actions;
   - deterministic auto-open behavior;
   - remove migrated selected-object panel UI.

Later issues may migrate celestial browsing, diagnostics and runtime asteroid tooling. They are not dependencies for the four core issues above.

## Acceptance invariants for implementation agents

Implementation is conforming only if all of these remain true:

1. no Vue/WidgetForge dependency is added to `orbit-engine` or `orbit-engine-three`;
2. WidgetForge is consumed as an immutable external package through public exports;
3. simulation/render authorities stay outside Vue widget state;
4. viewport is a canvas host/adapter, not a second engine/renderer implementation;
5. semantic selection is one stable `ObjectId` channel and remains distinct from focus;
6. Three.js picking remains the existing `ObjectId` picking path;
7. Settings and default Object Inspector are true WidgetForge singletons;
8. no fake WebSocket/server/DataClient layer is introduced for local state;
9. frame-rate rendering never causes frame-rate-wide Vue updates;
10. each migrated control area removes its old competing `DemoPanel` authority;
11. browser/WASM and renderer regression coverage remains intact.
