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
