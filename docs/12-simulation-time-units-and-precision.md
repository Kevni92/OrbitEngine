# 12 — Simulation Time, Units, and Numerical Precision

## Status and scope

This document records the architecture decided by Architecture issue #8. It is the implementation contract for OrbitEngine's fundamental units, simulation-time representation, numerical-precision policy, time advancement semantics, and TypeScript/native/WASM transfer rules.

It deliberately does not define object schemas, reference-frame hierarchy, propagation algorithms, encounter/collision scheduling, trajectory planning, astronomical-data import implementation, or game/UI calendar formatting.

## Decisions at a glance

- Canonical physical units are SI: metres, seconds, kilograms, radians, and their SI-derived units.
- Public TypeScript unit-bearing scalars use nominal/opaque number types rather than undifferentiated raw `number` parameters. They remain ordinary JavaScript numbers at runtime and cross backend boundaries as IEEE-754 binary64.
- The authoritative absolute time is a normalized `(seconds, nanoseconds)` pair relative to `2000-01-01 12:00:00 TDB` (J2000 TDB origin).
- `seconds` is signed 64-bit in the portable C++ core; `nanoseconds` is an unsigned integer in `[0, 1_000_000_000)`.
- Durations use the same normalized pair representation and may be negative.
- The canonical internal astronomical time scale is TDB. UTC, TAI, TT, civil calendars, leap seconds, and source-specific epoch formats are conversion-boundary concerns rather than core simulation-time representations.
- JavaScript `Date`, floating-point Julian Date, and one floating-point count of seconds are not authoritative simulation clocks.
- Continuous physical quantities use IEEE-754 binary64 unless a later architecture decision documents a stronger requirement.
- Absolute times are never converted to one `double` and then subtracted. Exact instant subtraction produces a `Duration`; algorithms may then convert that duration to binary64 seconds when appropriate.
- Mutable simulation advancement is monotonic and event-driven. Large jumps advance to the next relevant event or the requested target, not through a mandatory global tick loop.
- Native and WASM adapters must transfer time losslessly using integer fields; physical binary64 values must not be down-cast to `float`/f32.
- Cross-backend integer/time semantics are exact. Floating-point behavior is parity-by-documented-tolerance, not a blanket bit-identical guarantee.

## Canonical unit system

OrbitEngine uses SI units internally and at the backend boundary.

| Quantity | Canonical unit |
|---|---|
| distance / position | metre (`m`) |
| velocity | metre per second (`m/s`) |
| acceleration | metre per second squared (`m/s²`) |
| mass | kilogram (`kg`) |
| duration / time interval | second (`s`) plus exact nanosecond subdivision |
| angle | radian (`rad`) |
| angular velocity | radian per second (`rad/s`) |
| force, energy, gravitational parameter, etc. | normal SI-derived units |

Astronomical units, kilometres, days, degrees, Julian dates, and similar external conventions may be accepted by importer/conversion utilities, but they are converted before entering the portable simulation core.

### TypeScript unit safety

The public TypeScript API must not use indistinguishable raw `number` types for semantically different unit-bearing quantities. It should expose nominal/opaque scalar aliases (for example metre, metre-per-second, kilogram, radian, and seconds-style value types) plus explicit constructors/converters.

These types are a TypeScript safety mechanism, not heap-allocated runtime wrapper objects. Their runtime representation remains a JavaScript `number`, preserving straightforward batching and zero-copy/low-overhead marshalling where possible.

Public validation must reject non-finite physical inputs (`NaN`, `+Infinity`, `-Infinity`). Unit conversion belongs in TypeScript/import tooling; backend contracts receive only canonical units.

## Absolute simulation instant

### Epoch and time scale

OrbitEngine defines its zero instant as:

```text
2000-01-01 12:00:00 TDB
```

This is the J2000 TDB origin used by JPL/NAIF SPICE ephemeris time conventions. NAIF describes numeric ephemeris time as TDB seconds past J2000 and identifies J2000 as `2000 Jan 1 12:00:00 TDB`.

Reference: [NAIF SPICE Time Required Reading](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/req/time.html).

The epoch is intentionally specified with its time scale. It must not be silently treated as the similarly named J2000/Julian epoch expressed in TT or UTC.

### Representation

The authoritative instant is a normalized pair:

```text
SimulationInstant
  seconds: signed 64-bit whole TDB seconds relative to J2000 TDB
  nanoseconds: unsigned integer, 0 <= nanoseconds < 1_000_000_000
```

Its mathematical value is:

```text
seconds + nanoseconds / 1_000_000_000
```

The representation is canonical: there is exactly one pair for each representable instant. Negative instants use floor-style normalization; for example, `-0.5 s` is represented as `seconds = -1`, `nanoseconds = 500_000_000`.

### Why this representation

A single signed 64-bit nanosecond counter spans only about ±292 years and therefore cannot cover the intended roughly ±1000-year horizon.

A binary64 count of seconds from J2000 has an ulp of roughly 3.8 microseconds at a 1000-year offset. A binary64 Julian Date near J2000 has roughly 40 microseconds of representational spacing when converted to seconds. Both unnecessarily couple absolute epoch magnitude to sub-second precision.

The split representation provides exact nanosecond ordering/arithmetic across the intended horizon while keeping the core implementation simple and portable.

The storage type has vastly more range than OrbitEngine's scientific validity target. The architecture only promises that simulation/data/propagation behavior will be validated for approximately ±1000 years around the chosen scenario/J2000-era use case unless a later feature documents a wider validity window.

## Duration and time arithmetic

`Duration` uses the same normalized `(seconds, nanoseconds)` representation and may be positive, zero, or negative.

Required semantics:

- `Instant - Instant -> Duration` is exact while representable.
- `Instant + Duration -> Instant` and `Instant - Duration -> Instant` are checked operations.
- `Duration + Duration`, subtraction, negation, and comparison are checked/exact while representable.
- Comparison is lexicographic on canonical `(seconds, nanoseconds)` fields.
- Overflow is an error; arithmetic must not wrap.
- Constructing non-normalized input normalizes or rejects it at the owning API boundary; stored/core values are always normalized.
- Conversion to binary64 seconds is explicit and is for algorithmic intervals, not authoritative absolute timestamps.

A propagation/integration algorithm may convert a bounded `Duration` to `double` seconds after subtracting exact instants. It must not first convert two absolute instants to `double` and subtract them.

## Astronomical time scales and conversion boundary

### Canonical runtime scale: TDB

TDB is the engine's canonical physics/ephemeris coordinate time. This aligns the simulation clock with the time argument commonly used by Solar-System ephemerides such as SPICE. TDB has no leap-second discontinuities.

### UTC, TAI, and TT

OrbitEngine distinguishes the concepts but does not make all of them runtime clock types:

- **UTC** is a civil time scale with leap seconds and is not suitable as the core simulation clock.
- **TAI** is continuous atomic time and is useful as an intermediate civil/astronomical conversion scale.
- **TT** is a continuous terrestrial dynamical time scale closely related to TAI and appears in astronomical source data.
- **TDB** is the canonical OrbitEngine runtime scale for Solar-System physics/ephemeris time.

The portable runtime core does not own a leap-second table and does not parse civil timestamps.

### Importer/converter responsibility

External data tooling must normalize all source epochs to OrbitEngine `SimulationInstant` values in TDB before runtime registration/use. The normalized dataset must retain enough provenance to reproduce the conversion, including the source time scale and the version/source of leap-second or astronomical time-conversion data where applicable.

For UTC input, conversion tooling is responsible for the UTC/leap-second boundary and for converting through appropriate astronomical scales to TDB. Updating a leap-second table must not retroactively reinterpret already-normalized runtime instants without rebuilding/reconverting the dataset deliberately.

A future TypeScript convenience API may offer UTC/calendar conversion, but it belongs outside the portable physics core and must make its conversion-data dependency explicit. JavaScript `Date` may be accepted only by such a convenience layer; it is never authoritative engine time.

## Numerical precision policy

### Binary64 for continuous physical quantities

Positions, velocities, accelerations, masses, angles, forces, orbital parameters, and related continuous values use IEEE-754 binary64 (`double` in C++, `number` in JavaScript, `f64` in WebAssembly) unless a later architecture decision demonstrates a concrete need for another representation.

Binary64 provides about 15–16 decimal digits of precision. Representative position spacing is approximately:

| Root-frame magnitude | Approximate binary64 spacing |
|---:|---:|
| 1 AU (`1.5e11 m`) | `3.1e-5 m` (~0.03 mm) |
| 40 AU (`6e12 m`) | `9.8e-4 m` (~1 mm) |
| 100 AU (`1.5e13 m`) | `2.0e-3 m` (~2 mm) |
| 1000 AU (`1.5e14 m`) | `3.1e-2 m` (~3 cm) |

This is adequate for Solar-System-scale storage/query work, but subtracting two nearby positions expressed as huge root-frame coordinates can discard local detail at roughly the root-coordinate ulp.

### Constraint on reference-frame architecture

Issue #10 must therefore preserve local/reference-frame coordinates and provide relative-state queries/transforms so close-range calculations such as rendezvous, docking, local collisions, and surface operations are not forced to subtract large barycentric coordinates unnecessarily.

This issue does not design the frame hierarchy; it establishes that local-coordinate computation is a numerical requirement, not merely an API convenience.

### Time in numerical algorithms

Exact `SimulationInstant`/`Duration` values own event ordering and authoritative endpoints. Numerical algorithms may use binary64 `dt` values derived from exact durations.

Algorithms operating over long spans must choose their own segmentation/integration strategy rather than expecting one enormous floating-point time coordinate to preserve nanosecond detail. Exact target/event instants remain available even when internal numerical steps are coarser.

### No global floating-point epsilon

OrbitEngine does not define one universal `epsilon` for all physics comparisons. Each numerical algorithm must document tolerances appropriate to its units and scale, normally as an explicit combination of absolute and relative tolerance.

Tests for propagation, transforms, encounters, and trajectories must state their domain-specific error budgets. Exact integer/time values should be asserted exactly.

## Determinism and backend parity

The portable C++ core is shared by native and WASM, but equivalent floating-point semantics do not imply unconditional bit-identical results across toolchains/platforms. Differences may arise from libm implementations, fused operations, compiler code generation, or later numerical algorithms.

Required rules:

- Do not enable unsafe/fast-math modes that relax IEEE-754 semantics for production core builds without a later explicit architecture decision.
- Do not rely on unspecified container/iteration order when that order can affect physical/event results.
- Integer time representation, comparison, normalization, and wire encoding must be exact across all backends.
- Transfer of binary64 values must preserve all 64 bits; adapters must not silently use `float`, f32, or decimal truncation.
- Shared native/WASM tests compare exact discrete outputs exactly and floating outputs with feature-specific documented tolerances.
- Event processing must have deterministic ordering for equal timestamps; the later event architecture defines the secondary ordering key/priority policy.
- For identical initial state, external commands, event ordering, and propagation policies, changing only UI/game tick frequency must not define a different physical model. Floating trajectories are required to agree within the owning algorithm's tolerance, not necessarily bit-for-bit.

## TypeScript, C++, and WASM representation contract

### Public TypeScript shape

At the public TypeScript layer, instant/duration fields use safe integer JavaScript numbers:

```text
seconds      integer and Number.isSafeInteger(...)
nanoseconds  integer, 0 <= value < 1_000_000_000
```

The intended ±1000-year horizon is far inside JavaScript's exact safe-integer range when seconds and nanoseconds are split. Public time APIs therefore do not require `bigint`.

### Portable C++ shape

The portable core uses:

```text
int64_t  seconds
uint32_t nanoseconds
```

with the normalization and checked-arithmetic invariants defined above.

### Backend wire shape

Low-level native/WASM adapters must not serialize `int64_t seconds` through a floating-point total-seconds value. The backend-neutral lossless wire representation is conceptually:

```text
secondsHigh: signed 32-bit high word
secondsLow:  unsigned 32-bit low word
nanoseconds: unsigned 32-bit
```

The high/low words encode the signed 64-bit seconds value in two's-complement form. Backend implementations may use native `BigInt`/i64 facilities internally, but their observable transfer semantics must be equivalent to this lossless representation and must not require `BigInt` in the normal public API.

Batch physical data uses binary64/f64 representations (`Float64Array`-compatible layouts where appropriate). Batch time data uses exact integer fields/typed arrays rather than packed floating-point seconds.

Text/JSON persistence, when introduced, must serialize instant/duration components as integer fields rather than a floating-point Julian Date or decimal total-seconds value.

## Simulation clock, advancement, and time warp

### Mutable clock semantics

The engine owns one authoritative mutable `currentTime: SimulationInstant` for stateful simulation advancement.

- `advanceTo(target)` permits `target >= currentTime`.
- `advanceTo(currentTime)` is a no-op once all due work at the current timestamp has been drained.
- `target < currentTime` is rejected for mutable advancement; mutable history is not implicitly rewound.
- `advanceBy(duration)` is equivalent to checked addition followed by `advanceTo` and requires a non-negative duration.

Backward/negative-time **queries** are a separate concept. A propagator/reference model may support querying state at an earlier instant without mutating the engine clock. Whether a particular model supports backward queries is defined by the propagation contract, not by clock rewind semantics.

### Event-driven advancement

Advancing from `t0` to `t1` processes relevant scheduled events in the interval:

```text
(t0, t1]
```

The clock may jump directly to the next event and then to the final target. It does not iterate all intermediate UI/game ticks.

All events at a reached timestamp must be resolved according to the event system's deterministic same-time ordering before the clock is considered advanced past that timestamp. If handling one event schedules additional work for the same timestamp, the event system drains that timestamp before continuing.

Event prediction/refinement or numerical integration may evaluate internal intermediate times. Those evaluation points are algorithmic details, not mandatory global simulation ticks.

### Time warp semantics

Time warp is represented by choosing a farther target instant or advancing targets more aggressively. OrbitEngine does not multiply physical equations by a warp factor and does not change the definition of a second.

If there are no state-changing external commands between two instants, advancing `A -> B` in one public call versus partitioning the request into multiple calls must not make UI call frequency part of the physical model. Numerical algorithms own their stepping policy and must satisfy their documented tolerances under such partitioning.

## Rejected alternatives

### JavaScript `Date`

Rejected as authoritative time because it is a civil/UTC-oriented millisecond API with limited semantics for astronomical time scales and leap seconds.

### One binary64 absolute timestamp

Rejected because absolute epoch magnitude unnecessarily consumes fractional precision and encourages catastrophic cancellation when nearby times are subtracted.

### Floating-point Julian Date as core time

Rejected for the same precision/cancellation reason and because Julian Date is an interchange convention rather than the engine's most useful arithmetic representation.

### Signed 64-bit nanoseconds since epoch

Rejected because its ~±292-year range does not meet the intended ±1000-year horizon.

### TT as the canonical runtime scale

TT is valid and continuous, but TDB is preferred because OrbitEngine's primary domain is Solar-System dynamics and ephemeris interoperability. TT/TAI/UTC remain explicit conversion-boundary formats.

### Raw untyped SI numbers in the TypeScript API

Rejected because metre/second/kilogram/radian values are otherwise trivially mixed by consumers. Nominal TypeScript scalar types provide compile-time unit separation without changing the runtime numeric representation.

## Constraints imposed on follow-up architecture

- Issue #9 must use `SimulationInstant` for state epochs and the SI/binary64 quantity policy for physical state/properties.
- Issue #10 must preserve local/reference-frame computation paths and must not require precision-sensitive local work to subtract giant root-frame coordinates.
- Issue #11 must accept exact source/target instants, derive numerical `dt` from exact durations, and keep caller/UI tick segmentation separate from physical integration/event semantics.
- Future ephemeris/import work must normalize source epochs/time scales to TDB `SimulationInstant` values before the runtime core consumes them.
- Future event/encounter architecture must use exact instants for scheduling and define a deterministic secondary ordering for equal timestamps.

## Validation requirements for implementation

Fundamental implementation must include tests for at least:

- normalization around zero, including negative fractional durations;
- nanosecond carry/borrow at second boundaries;
- exact comparison before/after J2000;
- checked overflow/underflow;
- round-trip TypeScript ↔ native and TypeScript ↔ WASM time transfer with values near the intended ±1000-year limits and near relevant integer boundaries;
- exact lossless high/low-word wire round trips;
- unit-brand/conversion behavior in TypeScript;
- rejection of non-finite continuous inputs;
- binary64 backend transfer without f32 truncation;
- `advanceTo` monotonicity and `(current, target]` event-window semantics once the engine clock/event scaffold exists;
- shared backend parity for exact time/discrete behavior and tolerance-based continuous values.
