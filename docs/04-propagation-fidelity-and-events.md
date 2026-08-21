# 04 — Propagation, Fidelity, and Events

## Two independent concepts

OrbitEngine must keep **propagation model** and **simulation fidelity** separate.

A propagation model answers: “How is this object's state advanced to time T?”

Fidelity answers: “How much computational effort/precision is justified for the current situation?”

A diverged asteroid may therefore use a newly derived analytical orbit at low fidelity, while the same object temporarily switches to high-fidelity numerical treatment during a close encounter.

## Propagation models

Expected model families include:

- imported/reference ephemeris;
- analytical two-body/Kepler propagation;
- analytical or semi-analytical propagation with selected perturbations;
- numerical multi-body integration;
- active thrust trajectory propagation;
- parent/body-fixed propagation for surface-attached objects.

The exact algorithms remain implementation decisions and should be selected based on accuracy, stability, and performance requirements.

## Fidelity concept

A provisional fidelity ladder:

- **F0 — analytical/reference:** cheap long-range propagation/query.
- **F1 — refined analytical:** selected perturbations or improved encounter estimates.
- **F2 — numerical interaction:** numerically integrate relevant gravitating bodies.
- **F3 — local dynamic system:** jointly simulate a small interaction set.
- **F4 — precision interaction:** collision, rendezvous, docking, close flyby, explosion/impulse, or active maneuver where high precision is required.

These names and thresholds are not API commitments yet. What matters is automatic movement both upward and downward in fidelity without discontinuities in physical state.

## Promotion and demotion

Promotion may be triggered by:

- predicted close approach;
- collision risk;
- proximity to a dominant gravity source;
- active thrust or maneuver;
- external impulse/explosion;
- explicit high-precision query.

After the interaction stabilizes, the engine should derive an appropriate cheaper representation from the current state and demote the object again. Position and velocity at the handoff epoch must remain continuous.

## Encounter detection

The engine must not compare every object pair on every tick. Encounter detection is hierarchical:

1. Broad-phase orbital/spatial filtering eliminates impossible pairs.
2. Candidate pairs receive coarse temporal close-approach estimates.
3. Credible future encounters are scheduled.
4. Estimates are refined as the event approaches.
5. Fidelity is increased only if necessary.
6. After the event, changed trajectories invalidate and rebuild affected future predictions.

Only pair types enabled by interaction policy need to participate.

## Event-driven time warp

Large time jumps should not require executing millions of fixed simulation ticks. Stable trajectories can be queried directly at future times while the engine maintains a queue/index of relevant scheduled events.

Conceptually:

```text
current time ---- event A ---- event B ---------------- target time
      cheap jump     refine       high fidelity             jump
```

If an event changes an object's trajectory, future encounter predictions involving that object must be invalidated and recomputed.

## Example: redirected asteroid

1. Asteroid follows imported reference trajectory at F0.
2. A spacecraft approaches; fidelity is promoted.
3. An explosion applies an impulse and changes position/velocity state.
4. The asteroid is marked diverged.
5. After local effects settle, a new analytical orbit is derived from the new state and the asteroid returns to F0.
6. Broad-phase/encounter data is rebuilt for the new orbit.
7. A possible Mars encounter 200 years later is discovered and scheduled.
8. As that encounter approaches, fidelity increases again automatically.

This provides persistent physical consequences without paying high-fidelity cost for the intervening centuries.
