import assert from "node:assert/strict";

import type { Backend } from "../../src/internal/backends/contract.js";
import { objectId, ObjectType } from "../../src/objects.js";
import { ObjectRegistry, RegistryError, ReferenceStatus } from "../../src/registry.js";
import { meters, metersPerSecond } from "../../src/units.js";
import {
  PropagationDirection,
  PropagationModelKind,
  propagationState,
  revisionId,
} from "../../src/propagation.js";
import { referenceFrameId } from "../../src/frames.js";
import { simulationInstant } from "../../src/time.js";

export function assertRegistryLifecycle(backend: Backend): void {
  const registry = new ObjectRegistry(backend);
  const id = objectId("9007199254740993");
  const frame = referenceFrameId("18446744073709551615");
  const state = propagationState({
    position: { x: meters(1), y: meters(2), z: meters(3) },
    velocity: { x: metersPerSecond(4), y: metersPerSecond(5), z: metersPerSecond(6) },
    epoch: simulationInstant(123, 456),
    referenceFrame: frame,
  });
  const referenceMotion = {
    modelKind: PropagationModelKind.referenceEphemeris,
    direction: PropagationDirection.bidirectional,
    propagationFrame: frame,
    segmentStart: simulationInstant(100),
    segmentEnd: simulationInstant(200),
    configurationRevision: revisionId("18446744073709551614"),
    motionRevision: revisionId("7"),
  } as const;

  const registered = registry.register({
    id,
    type: ObjectType.spacecraft,
    properties: {},
    state,
    motion: referenceMotion,
    referenceStatus: ReferenceStatus.followingReference,
  });
  assert.equal(registered.id, id);
  assert.equal(registered.type, ObjectType.spacecraft);
  assert.equal(registered.state.epoch.seconds, 123);
  assert.equal(registered.state.epoch.nanoseconds, 456);
  assert.equal(registered.state.referenceFrame, frame);
  assert.equal(registered.motion.modelKind, PropagationModelKind.referenceEphemeris);
  assert.equal(registered.referenceStatus, ReferenceStatus.followingReference);
  assert.equal(registered.propertyRevision, "1");
  assert.equal(registered.properties.mass, undefined);

  assert.throws(
    () => registry.register({ id, type: ObjectType.spacecraft, state, motion: referenceMotion }),
    (error: unknown) => error instanceof RegistryError && error.code === "duplicateLiveId",
  );

  const updated = registry.updateProperties(id, simulationInstant(123, 456), { mass: 0 });
  assert.equal(updated.properties.mass, 0);
  assert.equal(updated.propertyRevision, "2");

  const dynamicMotion = {
    ...referenceMotion,
    modelKind: PropagationModelKind.twoBodyAnalytical,
    segmentStart: simulationInstant(123, 456),
    motionRevision: revisionId("8"),
  } as const;
  const diverged = registry.diverge(id, simulationInstant(123, 456), {
    state: propagationState({
      ...state,
      position: { x: meters(10), y: meters(2), z: meters(3) },
    }),
    motion: dynamicMotion,
  });
  assert.equal(diverged.referenceStatus, ReferenceStatus.diverged);
  assert.equal(diverged.state.position.x, 10);
  assert.equal(diverged.motion.modelKind, PropagationModelKind.twoBodyAnalytical);
  assert.throws(
    () => registry.diverge(id, simulationInstant(123, 456), { state, motion: dynamicMotion }),
    (error: unknown) => error instanceof RegistryError && error.code === "invalidTransition",
  );
  assert.equal(registry.get(id).state.position.x, 10);

  registry.setCurrentTime(simulationInstant(200));
  assert.throws(
    () => registry.updateProperties(id, simulationInstant(199), { mass: 5 }),
    (error: unknown) => error instanceof RegistryError && error.code === "retroactiveChange",
  );
  assert.equal(registry.get(id).properties.mass, 0);

  const childId = objectId("18446744073709551614");
  registry.register({
    id: childId,
    type: ObjectType.artificialSatellite,
    state,
    motion: dynamicMotion,
    structuralParent: id,
  });
  assert.throws(
    () => registry.remove(id),
    (error: unknown) => error instanceof RegistryError && error.code === "blockedRemoval",
  );
  registry.remove(childId);
  registry.remove(id);
  assert.throws(
    () => registry.get(id),
    (error: unknown) => error instanceof RegistryError && error.code === "retiredId",
  );
  assert.throws(
    () => registry.register({ id, type: ObjectType.spacecraft, state, motion: dynamicMotion }),
    (error: unknown) => error instanceof RegistryError && error.code === "retiredId",
  );
}
