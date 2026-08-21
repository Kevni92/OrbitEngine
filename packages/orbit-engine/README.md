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

Object identity is represented as a canonical decimal string, so full unsigned 64-bit IDs remain exact without
requiring `number` or public `bigint`. Object types are a closed physical taxonomy, and optional physical properties
keep absence distinct from explicit zero values.

~~~ts
import { ObjectType, objectId, physicalProperties } from "orbit-engine";

const id = objectId("18446744073709551615");
const properties = physicalProperties({ mass: 0, collisionBoundingRadius: 12 });
const type = ObjectType.spacecraft;
~~~

Registered motion can be bound to its production propagation model through the normal `OrbitEngine` facade. Consumers
can then request exact state-at-time snapshots by `ObjectId`, query multiple objects at one exact epoch, request
relative state through the frame graph, and obtain engine-created object state sources for dynamic frame providers.
The engine resolves declared object dependencies internally; applications do not provide a second authoritative
motion-state machine or a `resolveDependencyState` callback for registered production objects.
