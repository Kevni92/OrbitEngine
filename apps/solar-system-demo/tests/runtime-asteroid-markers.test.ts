import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
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
