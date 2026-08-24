# orbit-engine-three

`orbit-engine-three` is the optional public Three.js presentation companion for
OrbitEngine. It is separate from the physics package: `orbit-engine` does not
depend on this package or on Three.js.

The package is ESM-only and exposes two public entry points:

```ts
import { ORBIT_ENGINE_THREE_PACKAGE_NAME } from "orbit-engine-three";
import {
  presentationPackageInfo,
  resolveSurfaceAppearance,
  resolveStellarIllumination,
} from "orbit-engine-three/presentation";
```

The package root also exports the snapshot-driven `CelestialSystemView`,
immutable `CelestialRenderSnapshot` contracts, and origin-relative render-space
conversion helpers. The consumer inserts `view.root` into its own scene and
continues to own the `WebGLRenderer`, camera, render loop, and animation
lifecycle. `view.update(snapshot)` only stages and commits package-owned
resources; it never renders or advances simulation time.

The `/presentation` entry point contains renderer-neutral appearance records,
optical-library fallbacks, atmosphere optics, blackbody chromaticity,
inverse-square stellar illumination, bounded contributor selection, and
display-exposure derivation. It accepts authoritative SI snapshot positions
and returns plain semantic values; it does not import Three.js or create a
DOM/WebGL context.

Atmosphere shells are allocated only for bodies submitted with a sphere
representation and resolved atmosphere optics. `dispose()` removes and
releases package-created geometry/material/atmosphere resources while texture
ownership is explicit through the optional surface-texture provider: caller
owned textures are never disposed.

The root also provides generic physical/adaptive CSS-pixel sizing,
hierarchy-aware `hidden`/`marker`/`sphere` policy with hysteresis, and a typed
batched marker layer. Consumers supply camera/viewport context, selected or
focused ObjectIds, and optional context-priority IDs; no Solar-System names or
IDs are embedded in the package. Physical-mode marker sizes remain the true
projected physical diameter, while adaptive markers use the configured
viewport-stable size. `CelestialSystemView.pick()` maps sphere and batched
marker hits back to stable ObjectIds.

The reusable package does not contain Solar-System scenario data. A consumer
supplies its own `CelestialAppearance` records and adapts axis transforms at
the renderer boundary. Stellar illumination keeps all physical contributors
in `allContributions` and `additiveLinearLight`; `contributions` is the
deterministically selected presentation set (four by default), with omitted
ObjectIds reported in `diagnostics.truncatedEmitterIds`.

Install compatible peer dependencies explicitly:

```sh
pnpm add orbit-engine orbit-engine-three three
```
