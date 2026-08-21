# 05 — Coordinates and Reference Frames

## Requirement

OrbitEngine must provide consistent geometric position, velocity, and optional attitude transforms from Solar-System scale down to local surface operations without forcing all authoritative state into one giant global coordinate vector.

The canonical architecture is defined in [14 — Reference Frames and Coordinate System](14-reference-frames-and-coordinate-system.md). Object identity and canonical frame-qualified state semantics are defined in [13 — Physical Object and State Model](13-physical-object-and-state-model.md).

## Canonical root and hierarchy

OrbitEngine uses one explicit frame graph rooted at the Solar System Barycenter with fixed ICRS/ICRF-aligned right-handed axes.

Representative hierarchy:

```text
SSB / ICRS root
├── Sun-centered non-rotating frame
├── Earth-centered non-rotating frame
│   ├── Earth body-fixed frame
│   │   └── ENU/local surface frames
│   └── Moon-centered non-rotating frame
└── Mars-centered non-rotating frame
    ├── Mars body-fixed frame
    │   └── settlement/building local frames
    └── Phobos-centered frame
```

Every non-root frame has one immutable parent and evaluates one rigid-state transform relative to that parent at an exact `SimulationInstant`.

## Transform semantics

A frame edge provides translation, origin velocity, unit-quaternion rotation, and angular velocity. Position/velocity transformation includes the rotating-frame `omega x r` velocity contribution.

Frame transformation is a same-epoch operation only. It does not propagate an object to another time. A high-level state-at-time query first obtains the object's state at the requested time from its motion/propagation authority and only then transforms that state into the requested output frame.

Core frame/object states are geometric. Observer-dependent light-time, stellar aberration, apparent-position, rendering, and camera transformations are separate concerns.

## Surface objects

A building on Mars does not need independent Solar-System integration. It may remain fixed in a Mars body-fixed frame or a static local child frame.

Runtime canonical surface representation is Cartesian in that body-fixed/local frame. Latitude/longitude/height are convenience/import representations whose meaning depends on an explicit shape/coordinate convention and are converted before the portable core relies on them.

A standard local topocentric frame uses right-handed ENU axes: +X east, +Y north, +Z outward/up. Irregular-body tooling may provide a custom local tangent basis while preserving the same rigid-transform contract.

## Parent attachment vs. object type

Attachment is a motion/reference-frame relationship, not an object identity hierarchy. `ObjectType` remains the immutable physical classification defined in document 13.

A `surfaceObject` will commonly be frame-attached, but object type must not be used as a hidden frame or propagator selector. Other objects may also use attached/fixed motion where physically appropriate.

## Precision considerations

Document 12 establishes binary64 for coordinates and requires local computation paths. Document 14 therefore makes relative-state queries first-class and requires transform composition through the nearest useful common frame rather than unconditional conversion of both objects to root coordinates followed by subtraction.

Absolute/root coordinates are computed on demand when they are actually required.

## Dependency safety

A frame may depend on an object's propagated state to define its origin or attitude, but the combined frame/motion dependency graph must remain acyclic. An object cannot depend for its own authoritative motion on a frame whose transform already depends on that same object or one of its descendants.

## API expectations

The public API may expose high-level operations such as:

- query object state at time `T` in a requested frame;
- transform a supplied state into another frame at the state's exact epoch;
- query absolute/root state;
- query relative state without unnecessary root-frame cancellation;
- register supported body-centered/body-fixed/local/object-attached frame definitions;
- register surface/local objects through the common object model.

The portable C++ core owns authoritative graph validation/composition/caching; TypeScript owns backend-neutral value shapes, validation, and convenience conversions.
