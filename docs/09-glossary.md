# 09 — Glossary

## OrbitEngine object
An abstract physical entity registered in the engine and identified by a stable ID.

## ObjectType
Exactly one physical/simulation category assigned to an object, such as Star, Planet, Moon, Asteroid, Spacecraft, or Station.

## Reference object
A natural body still following the imported baseline/reference trajectory.

## Diverged object
A body whose simulated physical state has departed from the imported reference trajectory due to an in-simulation perturbation or maneuver.

## Physical state
The state required to describe an object's motion at an epoch, primarily position, velocity, time, frame, and other relevant physical properties.

## State epoch
The simulation time at which a stored position/velocity state is valid.

## Propagation model
The mathematical method used to advance/query an object's state through time.

## Fidelity
The amount of computational effort/precision currently allocated to propagation or interaction handling. Fidelity is independent of propagation model.

## Reference frame
A coordinate frame relative to which a position, velocity, or orientation is expressed.

## Encounter
A predicted close approach that may require refinement or increased fidelity.

## Broad phase
A cheap filtering stage that eliminates object pairs that cannot produce relevant encounters/collisions before expensive calculations are attempted.

## Interaction policy
Configuration that determines which classes/types of object pairs participate in gravity, encounter prediction, or collision detection.

## Trajectory planner
A subsystem that determines a physically valid path/manoeuvre plan from an initial state to a moving destination under propulsion and mass constraints.

## Game/domain layer
Any consuming system that maps OrbitEngine object IDs to semantic concepts such as ships, stations, settlements, population, ownership, or economy.
