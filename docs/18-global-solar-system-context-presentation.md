# 18 — Global Solar-System Context Presentation

## Status and scope

This document records the demo presentation invariant implemented by issue #72 and complements the adaptive rendering architecture in document 17.

The invariant exists entirely inside `apps/solar-system-demo`. It does not change OrbitEngine physics, propagation, reference frames, physical radii, object identity, or hierarchy.

## Core invariant

Changing the current focus changes local detail and render origin; it does not redefine which major Solar-System bodies exist as navigational context.

The browser demo therefore separates two presentation responsibilities:

1. **Global Solar-System context** — the Sun and major planets remain represented during normal navigation.
2. **Local-system detail** — moons and other subordinate bodies remain controlled by hierarchical LOD and may be hidden when their local system is unresolved.

For the committed Solar-System scenario, global context consists of the catalog star and `ObjectType.planet` entries: the Sun, Mercury, Venus, Earth, Mars, Jupiter, Saturn, Uranus, and Neptune.

## Representation policy

A global-context body has a normal minimum representation of `marker` once its current render position is available.

Normal adaptive LOD still applies above that floor:

```text
small / distant global body -> marker
locally useful global body  -> sphere
```

A global-context body must not transition to ordinary `hidden` solely because its projected physical diameter falls below the generic marker threshold.

This floor does not force large adaptive spheres globally. Markers remain bounded viewport-space presentation primitives rather than physical-radius substitutes.

## Local hierarchy remains authoritative for detail

The marker floor does not apply to ordinary moons or large-population objects.

Examples:

- Solar-System overview: Jupiter's moons may remain hidden.
- Jupiter focus: Jupiter's moon system becomes eligible for local marker/sphere LOD.
- Europa focus: Jupiter and the relevant Jovian moons remain eligible while Saturn's moons may stay hidden.
- Phobos focus: Mars and Phobos form the local context while unrelated moon systems remain culled.

Selection/focus ancestor overrides from document 17 remain valid and operate in addition to the global-context floor.

## Render-state integrity

Representation changes and marker positions must be coherent within the same presentation update.

When the batched marker membership changes, every newly admitted marker with a known current state must receive its current render-space position immediately. Rebuilding a GPU position buffer must not temporarily place a visible object at `(0, 0, 0)` until a later physics snapshot arrives.

Rendering remains downstream of authoritative engine state:

```text
OrbitEngine state snapshot
        |
        v
render-space conversion
        |
        +--> representation policy
        |
        +--> marker membership + current position
        |
        v
Three.js submission
```

No presentation policy may mutate the authoritative state to satisfy visibility.

## Regression validation

Tests for this behavior must distinguish internal representation state from renderer submission.

At minimum, browser-level coverage must verify the navigation sequence:

```text
Solar-System overview -> Jupiter -> Europa -> Phobos -> Solar-System overview
```

For each local focus, the test must verify that:

- the Sun and eight major planets remain `marker` or `sphere` and are submitted to the renderer;
- the focused target is projectable in the active viewport;
- the focused local hierarchy becomes eligible as specified by document 17;
- unrelated moon systems remain culled;
- marker positions correspond to the current render-space state in the same update rather than a stale/origin buffer.

A test that checks only `representationFor(...)` is insufficient for this regression class.

## Non-goals

This policy does not introduce:

- physics or propagation changes;
- fake body positions or renderer offsets;
- a global fixed world-space minimum sphere radius;
- global rendering of every moon;
- global rendering of every asteroid;
- removal of adaptive sizing or hierarchical LOD.
