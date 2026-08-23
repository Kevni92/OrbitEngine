import assert from 'node:assert/strict';

import { importDirectOep } from '../lib.mjs';
import { makeImportFixture } from './fixtures.mjs';

const backend = process.argv[2] ?? 'native';
if (backend !== 'native' && backend !== 'wasm') throw new Error(`unsupported runtime backend ${backend}`);

const {
  OrbitEngine,
  ROOT_REFERENCE_FRAME_ID,
  evaluatePropagationModel,
  referenceFrameId,
  simulationInstant,
} = await import('../../../packages/orbit-engine/dist/src/index.js');

const fixture = makeImportFixture();
const imported = await importDirectOep(fixture.plan, fixture.sourceBytes);
const engine = await OrbitEngine.create({ backend });
const dataset = await engine.loadEphemerisPack({
  manifest: imported.manifest,
  manifestSha256: imported.manifestSha256,
  shards: imported.shards.map((shard) => ({ id: shard.id, bytes: shard.bytes })),
});

assert.equal(dataset.identity.datasetId, 'direct-import-test');
assert.equal(dataset.identity.sourceCount, 2);
assert.equal(dataset.sourceInfo(2).centerSourceNodeId, 1);

const rootHandle = dataset.referenceModel(1, ROOT_REFERENCE_FRAME_ID);
const localHandle = dataset.referenceModel(2, referenceFrameId('7001'));
try {
  const center = evaluatePropagationModel(rootHandle.model, simulationInstant(0), { currentTime: simulationInstant(0) });
  assert.deepEqual([center.position.x, center.position.y, center.position.z, center.velocity.x, center.velocity.y, center.velocity.z], [100, 0, 0, 2, 0, 0]);
  const child = evaluatePropagationModel(localHandle.model, simulationInstant(0), { currentTime: simulationInstant(0) });
  assert.deepEqual([child.position.x, child.position.y, child.position.z, child.velocity.x, child.velocity.y, child.velocity.z], [10, 20, 30, 1, 2, 3]);
} finally {
  rootHandle.release();
  localHandle.release();
  dataset.unload();
}

console.log(`OEP importer runtime compatibility passed on ${backend}`);
