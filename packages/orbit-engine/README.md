# orbit-engine

The public OrbitEngine package is an ESM-only TypeScript facade. Backend artifacts are assembled separately by the
repository build and release workflows.

~~~ts
import { OrbitEngine } from "orbit-engine";

const engine = await OrbitEngine.create({ backend: "auto" });
console.log(engine.backend, engine.health());
~~~

Physical scalar constructors return finite JavaScript numbers with compile-time SI brands. Simulation times and
durations are immutable normalized (seconds, nanoseconds) values relative to the documented J2000 TDB origin.

~~~ts
import { meters, simulationInstant, duration, addDurationToInstant } from "orbit-engine";

const radius = meters(6_371_000);
const start = simulationInstant(0);
const later = addDurationToInstant(start, duration(86_400));
~~~
