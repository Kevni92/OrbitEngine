import assert from "node:assert/strict";

import type { Backend } from "../../src/internal/backends/contract.js";
import {
  FrameProviderKind,
  FrameRegistry,
  FrameRegistryError,
  FrameRegistryErrorCode,
  type FrameStateQuerySource,
} from "../../src/frame-registry.js";
import { objectId } from "../../src/objects.js";
import { propagationState } from "../../src/propagation.js";
import {
  identityRigidStateTransform,
  quaternion,
  referenceFrameId,
  rigidStateTransform,
} from "../../src/frames.js";
import { simulationInstant } from "../../src/time.js";
import { meters, metersPerSecond, radiansPerSecond } from "../../src/units.js";

function state(x: number, velocityX: number, frame: string, epoch = simulationInstant(10)) {
  return propagationState({
    position: { x: meters(x), y: meters(0), z: meters(0) },
    velocity: { x: metersPerSecond(velocityX), y: metersPerSecond(0), z: metersPerSecond(0) },
    epoch,
    referenceFrame: referenceFrameId(frame),
  });
}

function staticTransform(x: number, velocityX = 0) {
  return rigidStateTransform({
    translation: { x: meters(x), y: meters(0), z: meters(0) },
    originVelocity: { x: metersPerSecond(velocityX), y: metersPerSecond(0), z: metersPerSecond(0) },
    rotation: quaternion(1, 0, 0, 0),
    angularVelocity: { x: radiansPerSecond(0), y: radiansPerSecond(0), z: radiansPerSecond(0) },
    epoch: simulationInstant(0),
  });
}

export async function assertFrameGraph(backend: Backend): Promise<void> {
  const frames = new FrameRegistry(backend);
  const root = frames.root();
  const epoch = simulationInstant(10);

  assert.equal(frames.get(root).parent, root);
  assert.throws(
    () => frames.remove(root),
    (error: unknown) => error instanceof FrameRegistryError && error.code === FrameRegistryErrorCode.rootProtected,
  );

  const parent = referenceFrameId("9007199254740993");
  const child = referenceFrameId("18446744073709551614");
  frames.register({
    id: parent,
    parent: root,
    provider: { kind: FrameProviderKind.staticRigid, transform: staticTransform(10, 1) },
  });
  frames.register({
    id: child,
    parent,
    provider: { kind: FrameProviderKind.staticLocal, transform: staticTransform(5, 2) },
  });
  assert.equal(frames.transform(child, root, epoch).translation.x, 15);
  assert.equal(frames.transform(child, root, epoch).originVelocity.x, 3);
  assert.equal(frames.transform(root, child, epoch).translation.x, -15);
  assert.equal(frames.cacheSize(), 2);
  assert.throws(
    () => frames.register({ id: child, parent: root, provider: { kind: FrameProviderKind.staticRigid, transform: staticTransform(1) } }),
    (error: unknown) => error instanceof FrameRegistryError && error.code === FrameRegistryErrorCode.duplicateLiveId,
  );
  assert.throws(
    () => frames.remove(parent),
    (error: unknown) => error instanceof FrameRegistryError && error.code === FrameRegistryErrorCode.blockedRemoval,
  );
  frames.invalidateFrameFrom(parent, epoch);
  assert.equal(frames.cacheSize(), 0);

  const centered = referenceFrameId("100");
  const source: FrameStateQuerySource = {
    objectId: objectId("42"),
    stateAt: (target) => state(20, 3, root, target),
  };
  frames.register({ id: centered, parent: root, provider: { kind: FrameProviderKind.objectCentered, source } });
  const centeredTransform = frames.transform(centered, root, epoch);
  assert.equal(centeredTransform.translation.x, 20);
  assert.equal(centeredTransform.originVelocity.x, 3);
  assert.equal(frames.queryObjectState(source, epoch, centered).position.x, 0);

  const body = referenceFrameId("101");
  frames.register({
    id: body,
    parent: root,
    provider: {
      kind: FrameProviderKind.bodyFixed,
      source: { objectId: objectId("43"), stateAt: (target) => state(0, 0, root, target) },
      orientation: {
        id: "body-orientation",
        evaluate: (target) => ({
          epoch: target,
          orientation: quaternion(Math.SQRT1_2, 0, 0, Math.SQRT1_2),
          angularVelocity: { x: radiansPerSecond(0), y: radiansPerSecond(0), z: radiansPerSecond(1) },
        }),
      },
    },
  });
  const rotated = frames.transformState(state(1, 0, body, epoch), root);
  assert.ok(Math.abs(rotated.position.x) < 1e-12);
  assert.ok(Math.abs(rotated.position.y - 1) < 1e-12);
  assert.ok(Math.abs(rotated.velocity.x + 1) < 1e-12);

  const relative = frames.relativeState(state(25, 4, parent, epoch), state(5, 1, root, epoch));
  assert.equal(relative.referenceFrame, root);
  assert.equal(relative.position.x, 30);
  assert.equal(relative.velocity.x, 4);

  const cycleFrame = referenceFrameId("102");
  frames.register({
    id: cycleFrame,
    parent: root,
    provider: { kind: FrameProviderKind.objectAttached, source: source },
  });
  assert.throws(
    () => frames.setObjectPropagationFrame(objectId("42"), cycleFrame),
    (error: unknown) => error instanceof FrameRegistryError && error.code === FrameRegistryErrorCode.dependencyCycle,
  );

  const propagationFrame = referenceFrameId("103");
  frames.register({ id: propagationFrame, parent: root, provider: { kind: FrameProviderKind.staticRigid, transform: identityRigidStateTransform(epoch) } });
  frames.setObjectPropagationFrame(objectId("99"), propagationFrame);
  assert.throws(
    () => frames.remove(propagationFrame),
    (error: unknown) => error instanceof FrameRegistryError && error.code === FrameRegistryErrorCode.blockedRemoval,
  );
}
