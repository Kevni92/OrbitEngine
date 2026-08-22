# 17 — Adaptive Demo Rendering and Runtime Populations

## Status and scope

This document records the browser-demo architecture decided by Architecture issue #61.

It defines presentation behavior for camera-aware body sizing, representation level of detail (LOD), hierarchical child visibility, and runtime synthetic asteroid populations in `apps/solar-system-demo`.

These rules are **demo/application architecture only**. They do not change OrbitEngine physical state, propagation, object lifecycle, physical radii, collision semantics, or public physics ownership.

The browser demo remains a consumer of public OrbitEngine TypeScript APIs. Three.js remains rendering-only.

## Decisions at a glance

- The committed Solar-System catalog remains immutable reference/demo fixture data.
- Runtime-generated asteroids live in a mutable **session overlay** owned by the demo application.
- Every runtime asteroid is still a real OrbitEngine object with a stable caller-supplied `ObjectId`, `ObjectType.asteroid`, exact Cartesian anchor state, physical properties, and explicit propagation model.
- Synthetic asteroid generation creates initial physical inputs only. It never becomes a JavaScript propagator.
- The legacy fixed world-space `physical × multiplier + minimum scene radius` enhanced-visibility policy is replaced by a camera-aware **adaptive** policy based on projected CSS-pixel size.
- `physical` remains available as an exact visual-radius mode.
- Adaptive enhancement is monotonic with physical radius, converges to physical size for already-resolved bodies, and is capped by projected separation from nearby bodies.
- Body representation is independent from physics and has three conceptual levels: `hidden`, `marker`, and `sphere`.
- Representation transitions use hysteresis so zooming near a threshold does not flicker.
- Child systems are hierarchical: unresolved planets do not expose all moons merely because each moon could be inflated to a marker.
- Selected/focused bodies and their required ancestor/local context can override normal LOD culling.
- Large asteroid populations use batched marker rendering; the architecture forbids one permanent unique mesh/geometry/material per unresolved asteroid.
- Registered count, queried count, and rendered count are separate quantities.

## Architectural boundary

The authoritative flow stays:

```text
application/scenario creates physical inputs
              |
              v
       OrbitEngine registry
              |
       OrbitEngine propagation
              |
      public state-at-time query
              |
              v
     demo presentation policy
       /        |          \
 projected   adaptive      LOD
   size       radius    representation
       \        |          /
              v
          Three.js scene
```

Forbidden flow:

```text
Three.js visual size / LOD
          |
          v
change physical radius, collision radius,
propagation state, or engine object identity
```

A presentation-only hidden object remains registered and physically queryable. A body promoted from marker to sphere remains the same `ObjectId` and the same physical object.

## Runtime asteroid session overlay

### Why an overlay

The committed celestial catalog represents deterministic fixture/reference data. Runtime stress bodies are different: they are user-created, synthetic, mutable session content.

The demo therefore composes two application collections:

```text
committed immutable CelestialCatalog
            +
runtime mutable SessionObjectOverlay
            =
current demo object set
```

The overlay is not a second physical registry. It stores only application metadata needed to locate/name/render/manage runtime-created objects. OrbitEngine's registry remains the physical authority.

### Identity

Runtime object IDs are caller-supplied and monotonically allocated from a demo-reserved range that cannot collide with committed fixture IDs.

Within one engine/session lineage:

- an ID is allocated once;
- removal permanently retires it through the normal OrbitEngine lifecycle;
- the demo allocator never reuses a removed ID;
- visible names such as `Synthetic Asteroid 42` are metadata and never serve as engine identity.

The implementation may choose the concrete reserved numeric range, but it must validate against all currently loaded IDs and must not infer physical meaning from the number.

### Synthetic generation

The demo may generate deterministic synthetic asteroid **initial conditions** for testing and visualization. Generation must be seedable so the same input settings produce the same sequence of physical definitions before ID assignment.

A generated asteroid definition contains at least:

- `ObjectType.asteroid`;
- physical radius;
- optional mass/`mu` only when deliberately modeled;
- exact epoch;
- Cartesian position and velocity in an explicit frame;
- explicit central body / propagation context;
- explicit `twoBodyAnalytical` configuration for the initial implementation;
- presentation metadata identifying it as synthetic stress/demo data.

It is acceptable for the application generator to derive a valid initial Cartesian state from user/stress parameters. It is **not** acceptable for the demo to integrate or advance that state itself afterward. Once registered, all later authoritative state comes from OrbitEngine.

Synthetic data must never be presented as JPL/MPC/reference astronomy.

### Registration/removal transaction

Runtime creation uses the same public registration and motion-binding APIs as committed scenario bodies.

For each object, application state is published to the session overlay only after the engine registration + propagation-model binding succeeds. If creation fails partway through one object, the demo must not expose a half-created application entry.

Batch creation reports success/failure deterministically. Implementations should avoid silently continuing with an unknown partial count.

Removal first validates the engine lifecycle operation, then removes presentation/session metadata and rendering resources. IDs are not returned to the allocator.

## Screen-space sizing model

### Why projected pixels are authoritative for visibility

A body's usefulness on screen depends on camera projection and viewport size, not a global Three.js world-space minimum.

The adaptive sizing policy therefore begins with the body's **physical projected radius in CSS pixels**.

For a perspective camera the implementation may compute this analytically from camera-space depth and vertical field of view or by projecting an equivalent offset point. The result must be equivalent to:

```text
physical radius in scene units
        + camera projection
        + body camera-space depth
        + viewport CSS-pixel height
                  |
                  v
       physical projected radius P
               [CSS px]
```

Device pixel ratio is not allowed to change the semantic visibility thresholds; thresholds are expressed in CSS pixels. The renderer may of course render at device resolution internally.

Bodies behind the camera or outside valid projection are culled by normal view/frustum rules before enhancement decisions matter.

### Adaptive radius mapping

Two user-facing radius policies are canonical:

- `physical` — sphere radius is the physical radius converted to scene units;
- `adaptive` — physical projected size is enhanced only when needed for visual legibility.

The old `visible` policy based on one fixed world-space multiplier/minimum is retired rather than kept as a third competing production policy.

For `adaptive`, define:

- `P` = physical projected radius in CSS pixels;
- `F` = unresolved-body radius floor used by the enhancement curve;
- `R` = radius at/above which the body is considered sufficiently resolved and enhancement converges to physical size;
- `α`, `0 < α < 1`, = compression exponent.

The initial implementation should use one shared tuned policy in the approximate range:

```text
F = 1.5–2.5 CSS px radius
R = 5–8 CSS px radius
α = 0.35–0.6
```

The preferred mapping for `0 <= P < R` is:

```text
E(P) = F + (R - F) * (P / R)^α
```

and for `P >= R`:

```text
E(P) = P
```

The implementation then applies spacing/LOD constraints described below.

This mapping is selected because it is:

- monotonic;
- continuous at `R`;
- strongly compressive for tiny bodies without making all small bodies mathematically identical;
- exactly physical once an object is already visually resolved.

Constants are presentation tuning, not public API. Tests should assert invariants/ranges rather than freeze arbitrary tuning constants unless a regression depends on them.

### Monotonic size invariant

Within the same camera/presentation context, before separation capping:

```text
physicalRadius(A) > physicalRadius(B)
        =>
adaptiveProjectedRadius(A) >= adaptiveProjectedRadius(B)
```

This means Ganymede remains visually at least as large as Europa, and Jupiter remains larger than its moons. Enhancement compresses scale differences; it does not invert them.

### Selection visualization

Selection does not multiply the physical-looking sphere radius by a large factor.

Selection emphasis should use a separate presentation primitive such as:

- outline;
- halo/ring;
- emissive/accent marker;
- label.

A small bounded sphere-scale nudge is allowed only if it cannot violate separation constraints, but a halo is preferred. This avoids selected bodies physically-looking larger than nearby siblings.

## Separation-aware enhancement cap

### Problem

Screen-space enhancement can still create false overlap in compact systems if every small body is independently pushed toward a minimum size.

### Neighbor set

For adaptive sizing, the renderer evaluates a local projected neighbor set. At minimum it contains:

- the body's physical parent/central body when present;
- siblings sharing that central body;
- optionally other nearby visible bodies discovered through a bounded spatial/projected-neighbor pass.

The hierarchy comes from application catalog/session metadata, not name conventions.

### Cap

Let `D` be the minimum projected center-to-center distance in CSS pixels to a relevant visible neighbor.

The enhanced sphere radius receives a spacing cap conceptually equivalent to:

```text
C = separationFraction * D
```

with an initial `separationFraction` in the approximate range `0.25–0.35`.

The final sphere target is bounded by `C` so two independently enhanced neighbors retain visible space between their spheres.

The cap is not allowed to shrink below the physical projected radius when the physical geometry itself legitimately overlaps/occludes in projection. In that case the physical projection wins; the renderer does not falsify physical geometry to manufacture a gap.

If the spacing cap would reduce an unresolved enhanced sphere below a useful sphere threshold, representation LOD chooses `marker` or `hidden` instead of forcing overlapping spheres.

## Representation LOD

### Levels

Each body has one presentation representation for the frame/context:

1. `hidden`
   - no body primitive is submitted;
   - physical object remains registered;
   - metadata remains searchable/selectable through UI;
   - path/orbit rendering is normally also suppressed unless explicitly needed for selection/navigation.

2. `marker`
   - cheap screen-readable point/billboard/instanced representation;
   - used for unresolved but contextually relevant bodies;
   - marker sizing is bounded in CSS pixels and is not interpreted as physical radius;
   - large populations should batch this level.

3. `sphere`
   - normal 3D body sphere using `physical` or separation-bounded `adaptive` radius;
   - used when the body/local context is sufficiently resolved or explicitly inspected.

### Threshold direction

The exact tuned thresholds are implementation details, but the initial target should be approximately:

```text
sphere promotion: physical/adaptive presentation is useful at >= 4–6 px diameter
marker band:      about 1–6 px contextual prominence
hidden:           below marker relevance or hierarchy-gated
```

The implementation may distinguish physical projected diameter from enhanced target diameter when choosing representation. Hierarchy gating is evaluated before a child is promoted merely because enhancement could make it large.

### Hysteresis

Every representation boundary must have separate enter/exit thresholds. Example:

```text
marker -> sphere at >= 6 px
sphere -> marker at < 4 px

hidden -> marker at >= 1.5 px relevance
marker -> hidden at < 1.0 px relevance
```

Exact numbers may be tuned, but promotion thresholds must be stricter than demotion thresholds. Representation state therefore persists across frames and cannot be a stateless threshold comparison that flickers while zooming.

## Hierarchical local-system LOD

### Parent-resolution gate

A moon is not independently promoted just because adaptive enhancement could make it visible.

For a normal Solar-System overview, child-body rendering is gated by whether its parent/local system is resolved enough to be useful.

Conceptually:

```text
parent/local-system unresolved
        =>
children hidden by default

parent/local-system resolved
        =>
children eligible for normal hidden/marker/sphere LOD
```

For the initial implementation, a parent may be considered resolved using a combination of:

- parent's projected physical/adaptive diameter;
- projected angular extent of the child system;
- whether the parent is the current focus/view-center;
- whether the selected object lies inside that hierarchy.

The key invariant is behavioral rather than one magic number: **if Jupiter itself is approximately a pixel-sized object in the full-system view, its ordinary moons are not rendered.** Zooming into Jupiter progressively makes the moon system eligible.

### Focus and selection overrides

The current selected/focused body must never disappear solely because normal hierarchy LOD says its parent is unresolved.

Override rules:

- selected body is at least `marker` when it is projectable/in front of the camera;
- focused/view-center body is at least `marker`, normally `sphere` when close enough;
- ancestors needed to understand the selected body's local context remain visible;
- when a selected moon forces its system open, only the required local context is forced; this does not globally reveal every moon of every planet.

The UI/catalog remains capable of selecting a body that is currently hidden in the scene. Navigation to it then changes focus/camera context, after which its local system becomes eligible.

### Orbit/path LOD

Orbit/path rendering follows the same context policy:

- hidden bodies do not receive background orbit/path rendering merely because they are registered;
- selected/focused orbit paths may override normal suppression;
- path sampling remains bounded/lazy;
- adding thousands of asteroids must not automatically create thousands of orbit line geometries.

## Large asteroid rendering

### Batched unresolved population

Runtime stress populations are expected to contain hundreds to tens of thousands of objects. Unresolved asteroids therefore use a batched representation.

Preferred initial direction:

- one or a small bounded number of `THREE.Points` drawables, or an equivalent instanced marker layer;
- packed positions/colors/selection metadata updated from authoritative state snapshots;
- no unique `SphereGeometry` per unresolved runtime asteroid;
- no unique material per unresolved runtime asteroid;
- no orbit path per asteroid by default.

A runtime asteroid may promote out of the batch into an individual selected/resolved sphere/halo representation while preserving the same `ObjectId`.

The exact batching primitive is an implementation choice as long as it preserves the above constraints and supports picking/selection or a documented fallback selection path.

### Curated vs runtime asteroids

Curated catalog asteroids and runtime synthetic asteroids share physical semantics. They may use different default presentation metadata, but representation policy must be driven by visibility/context, not by pretending one category is less physical.

## Query workload and rendering workload

Three counts must remain conceptually distinct:

```text
registered objects
queried objects for the current state generation
rendered objects for the current frame
```

LOD immediately controls the third count.

The first implementation may still query more objects than it renders if the existing public batch-query coordinator makes that the simplest correct path. That is acceptable for correctness but must be measurable.

A future performance issue may reduce query count by requesting only objects needed for the current frame/context. Such an optimization must:

- use public OrbitEngine query APIs;
- keep selected/focused/navigation-required objects available;
- avoid stale-state presentation when an object is promoted;
- preserve deterministic state-at-time semantics;
- never make rendering state authoritative physics.

No new engine query API is introduced by this architecture decision alone.

## Performance instrumentation expectations

The large-population implementation should expose or test at least:

- number of registered runtime asteroids;
- number of objects queried per state generation;
- number of visible markers;
- number of visible spheres;
- state-query duration where practical;
- render/update duration or frame rate where practical.

These metrics are diagnostics, not physical state.

## Failure and edge cases

- Missing physical radius: a body cannot use physical/adaptive sphere sizing; it may use an explicitly non-physical marker if application metadata allows it.
- Camera inside a body sphere: physical geometry dominates; projected-radius heuristics must avoid division/NaN errors.
- Body behind camera: hidden from scene representation regardless of enhancement.
- Near-zero projected sibling separation: do not inflate both spheres into overlap; use marker/hidden policy unless physical geometry itself overlaps.
- Selected hidden child: force selected/local context visibility, do not globally disable LOD.
- Removed runtime object: remove its marker/sphere/path/picking metadata after successful engine removal and never reuse its ID.
- Batch creation failure: report deterministic created/failed state; do not expose app metadata for objects that did not complete engine registration/binding.

## Rejected alternatives

### Fixed world-space enhanced radius

Rejected because a fixed scene-unit minimum changes apparent angular size as the camera moves and causes compact systems to overlap.

### One global physical-radius multiplier

Rejected because it preserves neither local readability nor meaningful behavior across Solar-System and moon-system scales.

### Inflate every sub-pixel object to the same screen size

Rejected because it destroys size ordering and makes dense systems unreadable.

### Render all moons whenever their individual marker floor is visible

Rejected because it leaks local-system detail into distant overview views and creates both clutter and unnecessary GPU/CPU work.

### One Mesh/SphereGeometry per generated asteroid

Rejected as the default large-population representation because it scales drawables/resources with object count unnecessarily.

### Let Three.js/LOD determine which objects physically exist

Rejected because rendering is not authoritative lifecycle or simulation state.

## Implementation staging

### Stage A — runtime populations + adaptive sizing

Implement:

- runtime asteroid session overlay and monotonic ID allocator;
- deterministic synthetic asteroid initial-condition generator;
- public OrbitEngine registration/binding/removal flow;
- demo controls for adding/removing seeded asteroid populations;
- camera/viewport-aware adaptive size computation for existing individual body spheres;
- separation-aware sphere cap;
- selection halo rather than large sphere inflation;
- diagnostics sufficient to observe runtime population count and visual sizing behavior.

This stage must not create one orbit path per generated asteroid.

### Stage B — hierarchical LOD + batched marker rendering

Implement:

- persistent hidden/marker/sphere representation state with hysteresis;
- parent-resolution gating for moon systems;
- selected/focused hierarchy overrides;
- batched marker layer for unresolved asteroid populations;
- promotion of selected/resolved asteroids to individual representation;
- orbit/path LOD integration;
- performance diagnostics/tests for visible vs registered vs queried counts.

Stage B may refine Stage A's temporary runtime-asteroid rendering path, but it must preserve object/session contracts and public-engine ownership.

## Validation requirements

Implementation must test at least:

- adaptive mapping is finite, continuous at the resolved threshold, and monotonic;
- already-resolved bodies use physical projected size;
- smaller siblings cannot become larger than physically larger siblings solely from enhancement;
- projected neighbor caps prevent avoidable enhanced-sphere overlap;
- physical overlap is not artificially separated;
- adaptive scale changes appropriately as the camera zooms;
- selected highlighting does not break spacing policy;
- Jupiter-moon children are hidden in an unresolved overview and become eligible when Jupiter/local system resolves;
- selected moon remains visible and reveals required local context;
- LOD hysteresis prevents repeated threshold flip-flopping;
- runtime asteroid IDs are unique and never reused after removal;
- same seed/settings produce the same generated initial conditions;
- runtime asteroid authoritative motion comes from OrbitEngine state queries;
- large unresolved runtime populations use batched rendering rather than one permanent mesh/geometry/material per body;
- hidden objects do not automatically receive orbit paths;
- native/WASM engine semantics remain unchanged.
