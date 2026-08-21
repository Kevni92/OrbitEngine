# orbit-engine

The public OrbitEngine package is an ESM-only TypeScript facade. Backend artifacts are assembled separately by the
repository build and release workflows.

```ts
import { OrbitEngine } from "orbit-engine";

const engine = await OrbitEngine.create({ backend: "auto" });
console.log(engine.backend, engine.health());
```
