# 05 — Coordinates and Reference Frames

## Requirement

OrbitEngine must be able to provide the position and velocity of any registered object in an appropriate absolute/root frame while also supporting convenient local representations.

A single flat coordinate system is insufficient for everything from solar-system scale to surface buildings. The engine should therefore use hierarchical reference frames.

Object identity and canonical state semantics are defined in [13 — Physical Object and State Model](13-physical-object-and-state-model.md). Every Cartesian state is qualified by an exact epoch and a reference-frame association.

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

This is conceptual; exact frame names and standards remain implementation decisions for Architecture issue #10.

## Surface objects

A building on Mars should not need to be numerically integrated around the Sun. It can be represented relative to a Mars-fixed rotating frame using local coordinates such as latitude, longitude, and elevation or an equivalent Cartesian representation.

Given time T, OrbitEngine can transform:

1. local/surface coordinates → Mars-fixed frame;
2. Mars-fixed frame → Mars-centered inertial frame;
3. Mars-centered frame → root solar-system frame.

The result is the object's absolute position and, where needed, velocity caused by Mars rotation and orbital motion.

## Parent attachment vs. object type

Attachment is a motion/reference-frame relationship, not an object identity hierarchy. `ObjectType` remains the immutable physical classification defined in document 13.

A `surfaceObject` will commonly be frame-attached, but object type must not be used as a hidden propagator selector. Other objects may also use attached/fixed motion where physically appropriate. Attached objects still produce the normal frame-qualified Cartesian state snapshot when queried.

The engine does not need to know an attached object's gameplay meaning.

## Precision considerations

Frame design must avoid unnecessary loss of floating-point precision at very different spatial scales. [12 — Simulation Time, Units, and Numerical Precision](12-simulation-time-units-and-precision.md) establishes IEEE-754 binary64 for continuous coordinates and shows that root-frame spacing grows from roughly 0.03 mm at 1 AU to millimetres across the outer planetary system and centimetres by roughly 1000 AU.

Therefore local calculations must remain local where possible. Issue #10 must preserve local/reference-frame state and relative-state query paths so close-range operations are not forced to subtract two huge barycentric vectors. Absolute/root coordinates should be computed for queries and interactions that actually require them.

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
