import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { sha256Hex } from '../lib.mjs';
import {
  ROOT_REFERENCE_FRAME_ID,
  OrbitEngine,
  evaluatePropagationModel,
  simulationInstant,
} from '../../../packages/orbit-engine/dist/src/index.js';

const root = new URL('../../../data/solar-system-oep/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('solar-system-reference-1.0.0-de441-major.oep.json', root), 'utf8'));
const manifestSha256 = '302dafc2d4091a6047e1a9026a9308ece1baead7f46891e43040f4de666c8640';
const oracle = JSON.parse(await readFile(new URL('eclipse-oracle.json', root), 'utf8'));
const shardBytes = await Promise.all(manifest.shards.map(async (shard) => {
  const bytes = new Uint8Array(await readFile(new URL(`${shard.id === 'de441-mercury-venus' ? 'solar-system-reference-de441-mercury-venus' : shard.id === 'de441-earth-emb' ? 'solar-system-reference-de441-earth-emb' : shard.id === 'de441-moon-sun' ? 'solar-system-reference-de441-moon-sun' : 'solar-system-reference-de441-outer-planets'}.oepb`, root)));
  assert.equal(sha256Hex(bytes), shard.sha256, `shard checksum ${shard.id}`);
  return { id: shard.id, bytes };
}));

function stateArray(state) {
  return [state.position.x, state.position.y, state.position.z, state.velocity.x, state.velocity.y, state.velocity.z];
}

function add(left, right) {
  return left.map((value, index) => value + right[index]);
}

function subtract(left, right) {
  return left.map((value, index) => value - right[index]);
}

function closeVector(actual, expected, tolerance, label) {
  const error = Math.hypot(...actual.map((value, index) => value - expected[index]));
  assert.ok(error <= tolerance, `${label} error ${error} exceeds ${tolerance}`);
}

test('production Solar-System OEP is checksum-pinned and eclipse geometry is source-faithful', async () => {
  assert.equal(manifest.datasetId, 'solar-system-reference');
  assert.equal(manifest.datasetVersion, '1.0.0-de441-major');
  assert.equal(manifest.objectBindings.length, 11);
  const engine = await OrbitEngine.create({ backend: 'wasm' });
  const dataset = await engine.loadEphemerisPack({ manifest, manifestSha256, shards: shardBytes });
  const instant = simulationInstant(oracle.event.normalizedInstant.seconds, oracle.event.normalizedInstant.nanoseconds);
  const handles = [5, 6, 7, 14].map((sourceNodeId) => dataset.referenceModel(sourceNodeId, ROOT_REFERENCE_FRAME_ID));
  try {
    const states = new Map(handles.map((handle) => [handle.identity.sourceNodeId, stateArray(evaluatePropagationModel(handle.model, instant, { currentTime: instant }))]));
    closeVector(states.get(14), oracle.sourceStates.sunSsb, oracle.tolerance.statePositionMeters, 'Sun SSB');
    const earthSsb = add(states.get(5), states.get(6));
    const moonSsb = add(states.get(5), states.get(7));
    closeVector(earthSsb, oracle.sourceStates.earthSsb, oracle.tolerance.statePositionMeters, 'Earth SSB');
    closeVector(moonSsb, oracle.sourceStates.moonSsb, oracle.tolerance.statePositionMeters, 'Moon SSB');
    const sunEarth = subtract(states.get(14), earthSsb);
    const moonEarth = subtract(moonSsb, earthSsb);
    closeVector(sunEarth, oracle.sourceStates.sunEarth, oracle.tolerance.geometryPositionMeters, 'Sun Earth-centered');
    closeVector(moonEarth, oracle.sourceStates.moonEarth, oracle.tolerance.geometryPositionMeters, 'Moon Earth-centered');
    const cosine = sunEarth.slice(0, 3).reduce((sum, value, index) => sum + value * moonEarth[index], 0)
      / (Math.hypot(...sunEarth.slice(0, 3)) * Math.hypot(...moonEarth.slice(0, 3)));
    assert.ok(Math.abs(Math.acos(cosine) - oracle.earthCenteredGeometry.angularSeparationRadians) <= oracle.tolerance.geometryDirectionRadians);
    const validity = dataset.sourceInfo(14).effectiveValidity;
    assert.throws(() => evaluatePropagationModel(handles[3].model, simulationInstant(validity.end.seconds, validity.end.nanoseconds), { currentTime: instant }), /outside.*validity/i);
  } finally {
    for (const handle of handles) handle.release();
    dataset.unload();
  }
});
