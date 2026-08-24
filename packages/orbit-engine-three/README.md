# orbit-engine-three

`orbit-engine-three` is the optional public Three.js presentation companion for
OrbitEngine. It is separate from the physics package: `orbit-engine` does not
depend on this package or on Three.js.

The package is ESM-only and exposes two public entry points:

```ts
import { ORBIT_ENGINE_THREE_PACKAGE_NAME } from "orbit-engine-three";
import { presentationPackageInfo } from "orbit-engine-three/presentation";
```

Rendering resources and renderer-neutral appearance APIs are added in the
subsequent companion-package implementation stages. Importing the bootstrap
package is safe in Node.js and does not create a DOM/WebGL context.

Install compatible peer dependencies explicitly:

```sh
pnpm add orbit-engine orbit-engine-three three
```
