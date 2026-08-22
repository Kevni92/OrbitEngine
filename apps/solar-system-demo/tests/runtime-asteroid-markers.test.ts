import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { objectId } from "orbit-engine";
import type { RegisteredScenarioBody } from "../src/scenario/load-solar-system.js";
import { BatchedMarkerLayer, MARKER_PIXEL_SIZE } from "../src/rendering/runtime-asteroid-markers.js";

function fixture(idValue: string): RegisteredScenarioBody {
  return { definition: { id: objectId(idValue) } } as unknown as RegisteredScenarioBody;
}

test("batched LOD markers use a per-body point-size attribute", () => {
  const root = new THREE.Scene();
  const markers = new BatchedMarkerLayer(root);
  const points = root.children[0];

  assert.ok(points instanceof THREE.Points);
  assert.ok(points.material instanceof THREE.ShaderMaterial);
  assert.equal(points.material.uniforms.uSize, undefined);
  assert.match(points.material.vertexShader, /attribute float markerSize/);
  assert.match(points.material.vertexShader, /gl_PointSize = markerSize/);
  assert.match(points.material.fragmentShader, /gl_PointCoord/);
  assert.match(points.material.fragmentShader, /discard/);

  markers.dispose();
});

test("marker sizes default to adaptive pixels and accept independent physical diameters", () => {
  const root = new THREE.Scene();
  const markers = new BatchedMarkerLayer(root);
  const first = fixture("123456");
  const second = fixture("123457");
  const firstId = first.definition.id;
  const secondId = second.definition.id;

  markers.setBodies([first, second]);
  assert.equal(markers.sizeFor(firstId), MARKER_PIXEL_SIZE);
  assert.equal(markers.sizeFor(secondId), MARKER_PIXEL_SIZE);

  markers.updateSizes(new Map([
    [firstId, 0.125],
    [secondId, 3.75],
  ]));
  assert.equal(markers.sizeFor(firstId), 0.125);
  assert.equal(markers.sizeFor(secondId), 3.75);
  assert.notEqual(markers.sizeFor(firstId), MARKER_PIXEL_SIZE);
  assert.throws(() => markers.updateSizes(new Map([[firstId, -1]])), /finite and non-negative/);

  markers.dispose();
});

test("marker membership rebuild seeds current positions in the same presentation update", () => {
  const root = new THREE.Scene();
  const markers = new BatchedMarkerLayer(root);
  const body = fixture("123456");
  const id = body.definition.id;
  const currentPosition = new THREE.Vector3(12.5, -34.25, 56.75);

  markers.setBodies([body], new Map([[id, currentPosition]]));

  assert.equal(markers.contains(id), true);
  assert.deepEqual(markers.positionFor(id)?.toArray(), currentPosition.toArray());
  markers.dispose();
});