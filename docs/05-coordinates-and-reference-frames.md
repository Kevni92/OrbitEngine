# 05 — Coordinates and Reference Frames

## Requirement

OrbitEngine must be able to provide the position and velocity of any registered object in an appropriate absolute/root frame while also supporting convenient local representations.

A single flat coordinate system is insufficient for everything from solar-system scale to surface buildings. The engine should therefore use hierarchical reference frames.

## Expected frame hierarchy

Examples:

```text
Solar System Barycentric Frame
├── Sun-centered frame
├── Earth-centered inertial frame
│   ├── Earth-fixed rotating frame
│   │   └── surface/local frames
│   └── Moon-centered frame
└── Mars-centered inertial frame
    ├── Mars-fixed rotating frame
    │   └── settlement/building local frames
    └── Phobos-centered frame
```

This is conceptual; exact frame names and standards remain implementation decisions.

## Surface objects

A building on Mars should not need to be numerically integrated around the Sun. It can be represented relative to a Mars-fixed rotating frame using local coordinates such as latitude, longitude, and elevation or an equivalent Cartesian representation.

Given time T, OrbitEngine can transform:

1. local/surface coordinates → Mars-fixed frame;
2. Mars-fixed frame → Mars-centered inertial frame;
3. Mars-centered frame → root solar-system frame.

The result is the object's absolute position and, where needed, velocity caused by Mars rotation and orbital motion.

## Parent attachment vs. physics

An object may be attached to another object's frame without the engine understanding its gameplay meaning. A surface structure is simply an object whose motion model is constrained relative to a body-fixed parent frame.

## Precision considerations

Frame design must avoid unnecessary loss of floating-point precision at very different spatial scales. [12 — Simulation Time, Units, and Numerical Precision](12-simulation-time-units-and-precision.md) establishes IEEE-754 binary64 for continuous coordinates and shows that root-frame spacing grows from roughly 0.03 mm at 1 AU to millimetres across the outer planetary system and centimetres by roughly 1000 AU.

Therefore local calculations must remain local where possible. The later frame architecture must preserve local/reference-frame state and relative-state query paths so close-range operations are not forced to subtract two huge barycentric vectors. Absolute/root coordinates should be computed for queries and interactions that actually require them.

## API expectations

The public API should eventually support concepts such as:

- query object state in its native frame;
- query/transform state into another frame;
- query absolute/root-frame state at time T;
- query relative state without unnecessary root-frame subtraction;
- register local/body-fixed objects;
- register orbiting/free objects;
- transform positions and velocities consistently across frame boundaries.

The engine should treat frame transformations as first-class simulation functionality, not presentation-only helpers.
