import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

import { acquisitionCacheFilename, importDirectOep, inspectSpk } from '../lib.mjs';
import { createSpiceyPyOracle } from '../spice-oracle.mjs';
import { acquisitionFor } from './fixtures.mjs';

const execFileAsync = promisify(execFile);
const generator = fileURLToPath(new URL('./generate_spice_fixtures.py', import.meta.url));
const python = process.env.ORBIT_ENGINE_SPICE_PYTHON ?? 'python3';

test('CSPICE-written DE441/satellite/Pluto Type 2/3 fixtures round-trip through direct OEP and source oracle', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oep-spice-'));
  const sourceDir = join(root, 'generated');
  const cacheDir = join(root, 'cache');
  await execFileAsync(python, [generator, sourceDir], { windowsHide: true });

  const paths = {
    de441: join(sourceDir, 'de441-fixture.bsp'),
    jup365: join(sourceDir, 'jup365-fixture.bsp'),
    plu060: join(sourceDir, 'plu060-fixture.bsp'),
  };
  const bytes = {
    de441: new Uint8Array(await readFile(paths.de441)),
    jup365: new Uint8Array(await readFile(paths.jup365)),
    plu060: new Uint8Array(await readFile(paths.plu060)),
  };
  const acquisitions = [
    acquisitionFor(bytes.de441, { sourceKind: 'de441', sourceProductId: 'de441-fixture', sourceTargetIds: [5, 9], sourceUrl: 'https://naif.jpl.nasa.gov/example/de441_part-1.bsp' }),
    acquisitionFor(bytes.jup365, { sourceKind: 'planetary-satellite-spk', sourceProductId: 'jup365-fixture', sourceTargetIds: [501], sourceUrl: 'https://naif.jpl.nasa.gov/example/jup365.bsp' }),
    acquisitionFor(bytes.plu060, { sourceKind: 'pluto-system-spk', sourceProductId: 'plu060-fixture', sourceTargetIds: [999], sourceUrl: 'https://naif.jpl.nasa.gov/example/plu060.bsp' }),
  ];

  await mkdir(cacheDir, { recursive: true });
  for (const acquisition of acquisitions) {
    const sourcePath = acquisition.sourceProductId === 'de441-fixture' ? paths.de441 : acquisition.sourceProductId === 'jup365-fixture' ? paths.jup365 : paths.plu060;
    await copyFile(sourcePath, join(cacheDir, acquisitionCacheFilename(acquisition)));
  }

  assert.deepEqual(inspectSpk(bytes.de441).segments.map((segment) => [segment.target, segment.center, segment.type]), [[5, 0, 2], [9, 0, 2]]);
  assert.deepEqual(inspectSpk(bytes.jup365).segments.map((segment) => [segment.target, segment.center, segment.type]), [[501, 5, 3]]);
  assert.deepEqual(inspectSpk(bytes.plu060).segments.map((segment) => [segment.target, segment.center, segment.type]), [[999, 9, 2]]);

  const plan = {
    schemaVersion: 1,
    datasetId: 'spice-oracle-direct-test',
    datasetVersion: '1',
    normalizationPolicyVersion: 'oep-direct-v1',
    importerVersion: 'issue-124-test',
    importerCommit: 'spice-fixture',
    createdAt: '2026-08-23T00:00:00Z',
    shardId: 'source-families',
    acquisitions,
    sourceNodes: [
      { sourceNodeId: 1, targetNaifId: 5, parts: [{ sourceProductId: 'de441-fixture', targetNaifId: 5, centerNaifId: 0, segmentId: 'DE441 TEST JUP BARY', spkType: 2 }], namedValidationEpochs: [{ label: 'modern-scenario-era', etSeconds: 1 }, { label: 'decades-from-old-anchor', etSeconds: 2 }] },
      { sourceNodeId: 2, targetNaifId: 501, parts: [{ sourceProductId: 'jup365-fixture', targetNaifId: 501, centerNaifId: 5, segmentId: 'JUP365 TEST IO', spkType: 3 }] },
      { sourceNodeId: 3, targetNaifId: 9, parts: [{ sourceProductId: 'de441-fixture', targetNaifId: 9, centerNaifId: 0, segmentId: 'DE441 TEST PLU BARY', spkType: 2 }] },
      { sourceNodeId: 4, targetNaifId: 999, parts: [{ sourceProductId: 'plu060-fixture', targetNaifId: 999, centerNaifId: 9, segmentId: 'PLU060 TEST PLUTO', spkType: 2 }] },
    ],
    frameRotations: {},
    objectBindings: [],
  };
  const sourceBytes = new Map([
    ['de441-fixture', bytes.de441],
    ['jup365-fixture', bytes.jup365],
    ['plu060-fixture', bytes.plu060],
  ]);
  const oracle = createSpiceyPyOracle(plan, cacheDir, { pythonExecutable: python });
  const output = await importDirectOep(plan, sourceBytes, { oracle });

  assert.equal(output.manifest.sourceNodes.length, 4);
  assert.equal(output.manifest.sourceNodes[1].center, 1);
  assert.equal(output.manifest.sourceNodes[3].center, 3);
  for (const sourceRecord of output.manifest.sourceRecords) {
    assert.ok(sourceRecord.representationValidation.maxPositionErrorMeters <= 1e-3, `${sourceRecord.sourceNodeId} position error`);
    assert.ok(sourceRecord.representationValidation.maxVelocityErrorMetersPerSecond <= 1e-6, `${sourceRecord.sourceNodeId} velocity error`);
    assert.notEqual(sourceRecord.representationValidation.status, 'notRun');
  }
});
