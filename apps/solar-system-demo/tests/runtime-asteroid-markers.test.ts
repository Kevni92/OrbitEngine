import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { objectId } from "orbit-engine";
import type { RegisteredScenarioBody } from "../src/scenario/load-solar-system.js";
import { BatchedMarkerLayer, MARKER_PIXEL_SIZE } from "../src/rendering/runtime-asteroid-markers.js";

test("batched LOD markers stay round and viewport-sized at compact focus distances", () => {
  const root = new THREE.Scene();
  const markers = new BatchedMarkerLayer(root);
  const points = root.children[0];

  assert.ok(points instanceof THREE.Points);
  assert.ok(points.material instanceof THREE.ShaderMaterial);
  assert.equal(points.material.uniforms.uSize?.value, MARKER_PIXEL_SIZE);
  assert.match(points.material.vertexShader, /gl_PointSize = uSize/);
  assert.match(points.material.fragmentShader, /gl_PointCoord/);
  assert.match(points.material.fragmentShader, /discard/);

  markers.dispose();
});

test("marker membership rebuild seeds current positions in the same presentation update", () => {
  const root = new THREE.Scene();
  const markers = new BatchedMarkerLayer(root);
  const id = objectId("123456");
  const body = { definition: { id } } as unknown as RegisteredScenarioBody;
  const currentPosition = new THREE.Vector3(12.5, -34.25, 56.75);

  markers.setBodies([body], new Map([[id, currentPosition]]));

  assert.equal(markers.contains(id), true);
  assert.deepEqual(markers.positionFor(id)?.toArray(), currentPosition.toArray());
  markers.dispose();
});
