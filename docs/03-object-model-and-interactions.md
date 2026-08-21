# 03 — Object Model and Interactions

## Stable object identity

Every registered OrbitEngine object has a stable, unique ID. The ID is the integration point between OrbitEngine and higher layers.

The engine does not need to know that an ID represents “Tycho Station” or a specific game ship. It only stores the physical and simulation-relevant properties supplied for that ID.

## Object type

Each object has exactly one physical `ObjectType`. The initial taxonomy may include:

- Star
- Planet
- DwarfPlanet
- Moon
- Asteroid
- Comet
- Spacecraft
- Station
- ArtificialSatellite
- SurfaceObject
- Debris

The taxonomy may evolve, but types should remain physical/simulation categories rather than gameplay roles. For example, “MilitaryStation” belongs to a game layer, while `Station` belongs to OrbitEngine.

## Physical state

A movable object should have, as applicable:

- stable ID;
- object type;
- mass;
- radius and/or collision geometry;
- position;
- velocity;
- orientation;
- angular velocity/rotation data;
- state epoch (the time at which the stored state is valid);
- reference frame;
- propagation model metadata;
- interaction policy metadata.

Position + velocity + state epoch form the essential dynamic state from which a new trajectory/orbit can be propagated after a perturbation.

## Reference vs. diverged astronomical objects

A known natural body may begin as a reference object following imported real-world ephemeris/orbital data.

If gameplay changes its physical state — for example, an asteroid receives an impulse from an explosion — the object becomes diverged. From that point onward the original reference trajectory is historical/reference data only. The current physical state becomes authoritative and a new orbit/trajectory is derived from it.

A diverged object can later return to a cheap analytical fidelity level. “Cheap” must never mean “snap back to the original NASA/JPL trajectory.”

## Game objects

Spacecraft, stations, satellites, and similar artificial entities are normal OrbitEngine objects. They are typically more interaction-relevant than untouched natural bodies because they can maneuver and gameplay outcomes depend on collisions or close approaches.

## Interaction policy

Object type acts as a key into configurable interaction rules. At minimum, gravity, encounter detection, and collision detection should be separable concerns.

Example conceptual policy:

| Pair | Gravity | Encounter | Collision |
|---|---|---|---|
| Planet ↔ Moon | reference/model dependent | usually no runtime search | usually no runtime search |
| Untouched Asteroid ↔ Asteroid | usually ignored | configurable | usually ignored |
| Spacecraft ↔ Planet | yes/relevant | yes | yes |
| Spacecraft ↔ Asteroid | asteroid gravity usually negligible | yes | yes |
| Spacecraft ↔ Station | local/relevant as configured | yes | yes |
| Diverged Asteroid ↔ Planet | yes | yes | yes |
| Station ↔ Asteroid | asteroid gravity usually negligible | yes | yes |

Exact defaults are an implementation decision, but the policy must be configurable and must avoid unnecessary all-pairs work.

## Collision relevance

Untouched astronomical reference bodies do not need continuous pairwise collision checks against every other reference body. Their known/reference trajectories already describe the baseline system.

Collision detection becomes especially relevant when:

- a gameplay object can hit a natural body or another gameplay object;
- an artificial object is maneuvering;
- a natural body has diverged from its reference trajectory;
- an encounter predictor identifies a credible future collision candidate.

This distinction is central to scaling the engine to large asteroid/comet catalogs.
