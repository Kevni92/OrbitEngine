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

The `/presentation` entry point contains renderer-neutral appearance records,
optical-library fallbacks, atmosphere optics, blackbody chromaticity,
inverse-square stellar illumination, bounded contributor selection, and
display-exposure derivation. It accepts authoritative SI snapshot positions
and returns plain semantic values; it does not import Three.js or create a
DOM/WebGL context.

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
