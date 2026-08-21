# 01 — Vision and Scope

## Purpose

OrbitEngine is a standalone astronomical simulation engine intended to support a detailed, physically plausible solar-system simulation over game-relevant timescales. The initial target use case is a hard-science-fiction 4X simulation with travel times measured in days or longer and a simulation horizon of roughly ±1000 years around the scenario epoch.

The engine must remain useful independently of that game.

## Core responsibilities

OrbitEngine owns:

- simulation time;
- registration and removal of abstract physical objects;
- physical state such as position, velocity, mass, radius/collision shape, orientation, and rotation where required;
- propagation of natural and artificial objects through time;
- hierarchical reference frames and coordinate transformations;
- absolute position/velocity queries at a requested time;
- spacecraft trajectory planning and execution from physical propulsion/mass constraints;
- encounter prediction and refinement;
- collision-relevant simulation according to configurable interaction policies;
- external impulses and other explicitly supported force inputs;
- dynamic selection of appropriate propagation/fidelity strategies.

## Explicit non-responsibilities

OrbitEngine does not own:

- generation of stars, planets, moons, asteroids, comets, or systems;
- economy, resources, geology, population, buildings, ownership, factions, combat rules, or AI;
- semantic concepts such as “mine”, “city”, “military station”, or “freighter”;
- procedural content generation;
- online queries to astronomical services during normal simulation.

Those concerns belong to generators, data-import tooling, or game/domain layers that feed physical objects into OrbitEngine.

## Realism philosophy

The target is physically plausible and highly accurate behavior where it affects gameplay, not an unrestricted scientific N-body simulator for millions of years.

Known natural bodies should reproduce stable, believable trajectories without accumulating integration drift that causes impossible outcomes such as a moon crashing into its planet due solely to numerical error. At the same time, game-caused changes must be allowed to diverge from the real-world reference trajectory permanently.

Performance comes from choosing the cheapest valid model for a situation rather than reducing the whole system to one low-fidelity approximation.

## Fundamental abstraction

To OrbitEngine, every registered entity is an abstract physical object identified by a stable ID. A consuming layer may map that ID to Mars, a station, a spacecraft, a surface building, or another domain object. OrbitEngine only needs the physical properties and policies required for simulation.
