import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { objectId } from "orbit-engine";
import {
  computeTrailAlphas,
  nearestOrbitSampleIndex,
  OrbitRenderer,
} from "../src/rendering/orbit-renderer.js";
import type { OrbitPath } from "../src/simulation/path-sampling.js";
import { propagationState, meters, metersPerSecond, referenceFrameId, revisionId, simulationInstant } from "orbit-engine";

test("directional orbit gradient peaks at the current phase and fades behind it", () => {
  const alphas = computeTrailAlphas(20, 10);
  assert.equal(alphas.length, 20);
  assert.ok(alphas[10]! > alphas[11]!);
  assert.ok(alphas[10]! > alphas[9]!);
  assert.ok(alphas[9]! > alphas[8]!);
  assert.equal(alphas[0], 0);
});

test("nearest orbit sample determines the current phase", () => {
  const points = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(10, 0, 0), new THREE.Vector3(20, 0, 0)];
  assert.equal(nearestOrbitSampleIndex(points, new THREE.Vector3(11, 0, 0)), 1);
});

test("orbit renderer anchors relative geometry and exposes selected direction state", () => {
  const scene = new THREE.Scene();
  const renderer = new OrbitRenderer(scene);
  const bodyId = objectId("1003");
  const centralId = objectId("1000");
  const frame = referenceFrameId("1");
  const path: OrbitPath = {
    objectId: bodyId,
    focusId: centralId,
    outputFrame: frame,
    interval: { start: simulationInstant(0), end: simulationInstant(10) },
    sampleCount: 4,
    motionRevision: revisionId("1"),
    configurationRevision: revisionId("1"),
    samples: [0, 1, 2, 3].map((second) => ({
      instant: simulationInstant(second),
      state: propagationState({
        position: { x: meters(second * 149_597_870_700), y: meters(0), z: meters(0) },
        velocity: { x: metersPerSecond(1), y: metersPerSecond(0), z: metersPerSecond(0) },
        epoch: simulationInstant(second),
        referenceFrame: frame,
      }),
    })),
  };
  renderer.setPath(path, 0x4f83cc);
  renderer.updateBodyPositions(new Map([
    [centralId, new THREE.Vector3(5, 0, 0)],
    [bodyId, new THREE.Vector3(105, 0, 0)],
  ]));
  renderer.setSelected(bodyId);
  assert.equal(renderer.pathCount(), 1);
  assert.equal(renderer.phaseIndexFor(bodyId), 1);
  assert.equal(renderer.group.userData.selectedOrbitActive, true);
  renderer.setVisible(false);
  assert.equal(renderer.group.visible, false);
  renderer.dispose();
  assert.equal(renderer.pathCount(), 0);
});

test("orbit renderer rebases distant geometry before GPU upload", () => {
  const scene = new THREE.Scene();
  const renderer = new OrbitRenderer(scene);
  const bodyId = objectId("2004");
  const centralId = objectId("1000");
  const frame = referenceFrameId("1");
  const path: OrbitPath = {
    objectId: bodyId,
    focusId: centralId,
    outputFrame: frame,
    interval: { start: simulationInstant(0), end: simulationInstant(10) },
    sampleCount: 2,
    motionRevision: revisionId("1"),
    configurationRevision: revisionId("1"),
    samples: [0, 1].map((second) => ({
      instant: simulationInstant(second),
      state: propagationState({
        position: { x: meters(4_000 * 149_597_870_700), y: meters(0), z: meters(0) },
        velocity: { x: metersPerSecond(0), y: metersPerSecond(1), z: metersPerSecond(0) },
        epoch: simulationInstant(second),
        referenceFrame: frame,
      }),
    })),
  };

  renderer.setPath(path, 0x4f83cc);
  renderer.updateBodyPositions(new Map([[centralId, new THREE.Vector3(-4_000 * 100, 0, 0)]]));

  const group = renderer.group.getObjectByName(`Orbit ${bodyId}`)!;
  const line = group.children[0] as THREE.LineLoop;
  const position = line.geometry.getAttribute("position") as THREE.BufferAttribute;
  assert.deepEqual(group.position.toArray(), [0, 0, 0]);
  assert.ok(Math.abs(position.getX(0)) < 1e-5, "large opposing parent/vertex coordinates are resolved before Float32 upload");

  renderer.dispose();
});

test("orbit guide roles emphasize the active hierarchy without rebuilding geometry", () => {
  const scene = new THREE.Scene();
  const renderer = new OrbitRenderer(scene);
  const sunId = objectId("1000");
  const jupiterId = objectId("1006");
  const europaId = objectId("1202");
  const ganymedeId = objectId("1203");
  const earthId = objectId("1003");
  const frame = referenceFrameId("1");
  const basePath: OrbitPath = {
    objectId: earthId,
    focusId: sunId,
    outputFrame: frame,
    interval: { start: simulationInstant(0), end: simulationInstant(10) },
    sampleCount: 4,
    motionRevision: revisionId("1"),
    configurationRevision: revisionId("1"),
    samples: [0, 1, 2, 3].map((second) => ({
      instant: simulationInstant(second),
      state: propagationState({
        position: { x: meters(second), y: meters(0), z: meters(0) },
        velocity: { x: metersPerSecond(1), y: metersPerSecond(0), z: metersPerSecond(0) },
        epoch: simulationInstant(second),
        referenceFrame: frame,
      }),
    })),
  };
  renderer.setPath(basePath, 0x4f83cc);
  renderer.setPath({ ...basePath, objectId: europaId, focusId: jupiterId }, 0x4f83cc, "child");
  renderer.setPath({ ...basePath, objectId: ganymedeId, focusId: jupiterId }, 0x4f83cc, "child");
  renderer.setLocalSystemRoot(jupiterId);

  assert.equal(renderer.guideRoleFor(earthId), "background");
  assert.equal(renderer.guideRoleFor(europaId), "local-system");
  const earthGeometry = (renderer.group.getObjectByName(`Orbit ${earthId}`)!.children[0] as THREE.LineLoop).geometry;
  const europaGeometry = (renderer.group.getObjectByName(`Orbit ${europaId}`)!.children[0] as THREE.LineLoop).geometry;
  const background = renderer.guideDiagnostics().find((orbit) => orbit.objectId === earthId)!;
  const local = renderer.guideDiagnostics().find((orbit) => orbit.objectId === europaId)!;
  assert.ok(background.opacity < local.opacity);
  assert.equal(local.opacity, 0.3);
  assert.equal(local.kind, "child");

  renderer.setSelected(europaId);
  const selected = renderer.guideDiagnostics().find((orbit) => orbit.objectId === europaId)!;
  assert.equal(selected.role, "selected");
  assert.equal(selected.opacity, 1);
  assert.equal(renderer.guideDiagnostics().find((orbit) => orbit.objectId === ganymedeId)?.opacity, 0.3);
  renderer.setSelected(ganymedeId);
  assert.equal(renderer.guideDiagnostics().find((orbit) => orbit.objectId === europaId)?.opacity, 0.3);
  assert.equal(renderer.guideDiagnostics().find((orbit) => orbit.objectId === ganymedeId)?.opacity, 1);
  renderer.setSelected(undefined);
  assert.ok(renderer.guideDiagnostics()
    .filter((orbit) => orbit.kind === "child")
    .every((orbit) => orbit.opacity === 0.3));
  assert.equal((renderer.group.getObjectByName(`Orbit ${earthId}`)!.children[0] as THREE.LineLoop).geometry, earthGeometry);
  assert.equal((renderer.group.getObjectByName(`Orbit ${europaId}`)!.children[0] as THREE.LineLoop).geometry, europaGeometry);

  renderer.setVisible(false);
  assert.equal(renderer.group.visible, false);
  assert.ok(renderer.guideDiagnostics().every((orbit) => orbit.visible));
  renderer.setVisible(true);
  assert.equal(renderer.guideRoleFor(europaId), "local-system");
  renderer.dispose();
});
