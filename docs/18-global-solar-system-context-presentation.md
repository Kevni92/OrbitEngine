# 18 — Global Solar-System Context Presentation

## Status and scope

This document records the demo presentation invariant implemented by issue #72 and complements the adaptive rendering architecture in document 17. Architecture issue #99 refines the invariant so the user-selected body-size mode applies globally across sphere and marker LOD.

The invariant exists entirely inside `apps/solar-system-demo`. It does not change OrbitEngine physics, propagation, reference frames, physical radii, object identity, or hierarchy.

## Core invariant

Changing the current focus changes local detail and render origin; it does not redefine which major Solar-System bodies exist as navigational context.

The browser demo therefore separates two presentation responsibilities:

1. **Global Solar-System context** — the Sun and major planets remain represented during normal navigation.
2. **Local-system detail** — moons and other subordinate bodies remain controlled by hierarchical LOD and may be hidden when their local system is unresolved.

For the committed Solar-System scenario, global context consists of the catalog star and `ObjectType.planet` entries: the Sun, Mercury, Venus, Earth, Mars, Jupiter, Saturn, Uranus, and Neptune.

## Global body-size mode

The `Body size` / `RadiusMode` selection is a **global body-rendering contract**. It is not limited to `sphere` meshes.

### Adaptive mode

In `adaptive` mode, a global-context body has a normal minimum representation of `marker` once its current render position is available.

Normal adaptive LOD still applies above that floor:

```text
small / distant global body -> viewport-legible marker
locally useful global body  -> adaptive/physical-converged sphere
```

A global-context body must not transition to ordinary `hidden` solely because its projected physical diameter falls below the generic marker threshold.

The fixed marker size is an adaptive navigation aid. It is deliberately not interpreted as physical angular size.

### True physical scale

In `physical` mode, the renderer must not use a fixed-size marker to enlarge a celestial body. Every submitted body primitive, including a batched point/marker primitive used for performance, must use the body's true projected physical diameter derived from physical radius, camera projection, and viewport.

Therefore:

```text
physical mode
    =>
no artificial visible-radius floor
no fixed 7 px body substitute
no adaptive marker inflation
```

A distant body may become sub-pixel or effectively invisible as a body. That is correct for true physical scale.

The global-context responsibility still exists, but navigation context must not be achieved by falsifying body size. Context may be retained through orbit guides, catalog/search/navigation controls, labels, or explicit selection/focus indicators. Selection halos and similar indicators are separate non-body presentation primitives and may remain viewport-stable.

The representation label `marker` may still be used internally for batched rendering in physical mode, but its visual point size must equal the current projected physical diameter rather than the adaptive marker size.

## Local hierarchy remains authoritative for detail

The adaptive marker floor does not apply to ordinary moons or large-population objects.

Examples:

- Solar-System overview: Jupiter's moons may remain hidden.
- Jupiter focus: Jupiter's moon system becomes eligible for local marker/sphere LOD.
- Europa focus: Jupiter and the relevant Jovian moons remain eligible while Saturn's moons may stay hidden.
- Phobos focus: Mars and Phobos form the local context while unrelated moon systems remain culled.

Selection/focus ancestor overrides from document 17 remain valid and operate in addition to the global-context policy. Those overrides control whether an object is eligible/submitted; they must not override `physical` mode by inflating the object's visible body size.

## Render-state integrity

Representation changes, marker positions, marker sizes, and the selected radius mode must be coherent within the same presentation update.

When the batched marker membership changes, every newly admitted marker with a known current state must receive its current render-space position immediately. Rebuilding a GPU position buffer must not temporarily place a visible object at `(0, 0, 0)` until a later physics snapshot arrives.

When `RadiusMode` changes, existing marker membership must immediately receive the matching size policy in the same presentation update. A marker that remains in the batch must not keep an adaptive fixed pixel size for one or more frames after switching to `physical`, or retain a physical sub-pixel size after switching back to `adaptive`.

Rendering remains downstream of authoritative engine state:

```text
OrbitEngine state snapshot
        |
        v
render-space conversion
        |
        +--> representation policy
        |
        +--> radius-mode visual-size policy
        |
        +--> marker membership + current position + current size
        |
        v
Three.js submission
```

No presentation policy may mutate the authoritative state to satisfy visibility.

## Regression validation

Tests for this behavior must distinguish internal representation state from renderer submission and rendered size policy.

At minimum, browser-level coverage must verify the navigation sequence:

```text
Solar-System overview -> Jupiter -> Europa -> Uranus -> Solar-System overview
```

For adaptive mode, the test must verify that:

- the Sun and eight major planets remain `marker` or `sphere` and are submitted to the renderer;
- the focused target is projectable in the active viewport;
- the focused local hierarchy becomes eligible as specified by document 17;
- unrelated moon systems remain culled;
- marker positions correspond to the current render-space state in the same update rather than a stale/origin buffer.

For physical mode, the test must additionally verify that:

- distant major planets no longer use the fixed adaptive marker diameter;
- marker-rendered bodies receive their projected physical diameter for the active camera/viewport;
- locally resolved moons and distant planets obey the same global radius-mode policy;
- switching `adaptive -> physical -> adaptive` updates existing batched markers immediately without requiring a new physics snapshot or marker-membership change.

A test that checks only `representationFor(...)` is insufficient for this regression class.

## Non-goals

This policy does not introduce:

- physics or propagation changes;
- fake body positions or renderer offsets;
- a global fixed world-space minimum sphere radius;
- global rendering of every moon;
- global rendering of every asteroid;
- removal of adaptive sizing or hierarchical LOD.
