import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  OepImporterError,
  acquirePinnedSource,
  acquisitionCacheFilename,
  canonicalJson,
  evaluateImportedSource,
  extractDirectSpkSegment,
  importDirectOep,
  inspectSpk,
  sha256Hex,
  validateAcquisitionRecord,
} from '../lib.mjs';
import { acquisitionFor, buildSpkFixture, makeImportFixture } from './fixtures.mjs';

function errorCode(code) {
  return (error) => error instanceof OepImporterError && error.code === code;
}

test('validates deterministic acquisition records and checksum-pinned cache names', () => {
  const bytes = buildSpkFixture();
  const record = acquisitionFor(bytes);
  const normalized = validateAcquisitionRecord(record);
  assert.equal(normalized.sha256, sha256Hex(bytes));
  assert.match(acquisitionCacheFilename(normalized), /^test-de441-[0-9a-f]{64}\.bsp$/);
  assert.equal(canonicalJson({ z: 1, a: { y: 2, x: 1 } }), '{"a":{"x":1,"y":2},"z":1}\n');
});

test('acquires pinned bytes and rejects checksum drift before caching', async () => {
  const bytes = buildSpkFixture();
  const record = acquisitionFor(bytes);
  const cacheDir = await mkdtemp(join(tmpdir(), 'oep-acquire-'));
  let fetches = 0;
  const fetchImpl = async () => ({ ok: true, status: 200, arrayBuffer: async () => { fetches += 1; return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); } });
  const first = await acquirePinnedSource(record, { cacheDir, fetchImpl });
  const second = await acquirePinnedSource(record, { cacheDir, fetchImpl });
  assert.equal(first.fromCache, false);
  assert.equal(second.fromCache, true);
  assert.equal(fetches, 1);
  assert.deepEqual(new Uint8Array(await readFile(first.path)), bytes);

  const bad = { ...record, sha256: '00'.repeat(32) };
  await assert.rejects(() => acquirePinnedSource(bad, { cacheDir, fetchImpl }), errorCode('checksumMismatch'));
});

test('inspects little and big endian DAF/SPK descriptors deterministically', () => {
  for (const littleEndian of [true, false]) {
    const bytes = buildSpkFixture({ littleEndian, target: 501, center: 5, type: 3, segmentId: 'IO DIRECT' });
    const inspection = inspectSpk(bytes);
    assert.equal(inspection.binaryFormat, littleEndian ? 'LTL-IEEE' : 'BIG-IEEE');
    assert.equal(inspection.segments.length, 1);
    assert.deepEqual({ ...inspection.segments[0] }, {
      ordinal: 0,
      segmentId: 'IO DIRECT',
      startEt: -10,
      endEt: 10,
      target: 501,
      center: 5,
      frame: 1,
      type: 3,
      initialAddress: inspection.segments[0].initialAddress,
      finalAddress: inspection.segments[0].finalAddress,
    });
  }
});

test('extracts SPK Type 2 and Type 3 Chebyshev records without sampled refitting', () => {
  const type2 = buildSpkFixture({ type: 2 });
  const extracted2 = extractDirectSpkSegment(type2, 0);
  assert.equal(extracted2.representation, 'positionChebyshev');
  assert.equal(extracted2.coefficientCount, 2);
  assert.deepEqual(extracted2.records[0].coefficients[0], [0.1, 0.02]);

  const type3 = buildSpkFixture({ type: 3 });
  const extracted3 = extractDirectSpkSegment(type3, 0);
  assert.equal(extracted3.representation, 'stateChebyshev');
  assert.equal(extracted3.records[0].coefficients.length, 6);

  const unsupported = buildSpkFixture({ type: 21 });
  assert.throws(() => extractDirectSpkSegment(unsupported, 0), errorCode('unsupportedSpkType'));
});

test('imports source-center graph, converts km/km-s to SI, and emits runtime-compatible OEP bytes deterministically', async () => {
  const fixture = makeImportFixture();
  const first = await importDirectOep(fixture.plan, fixture.sourceBytes);
  const second = await importDirectOep(fixture.plan, fixture.sourceBytes);
  assert.equal(first.manifestText, second.manifestText);
  assert.equal(first.manifestSha256, second.manifestSha256);
  assert.deepEqual(first.shards[0].bytes, second.shards[0].bytes);

  assert.equal(first.manifest.sourceNodes[0].center, undefined);
  assert.equal(first.manifest.sourceNodes[1].center, 1);
  assert.equal(first.manifest.sourceNodes[0].representation, 'positionChebyshev');
  assert.equal(first.manifest.sourceNodes[1].representation, 'stateChebyshev');
  assert.equal(first.manifest.sourceRecords[0].conversionMethod, 'spkType2DirectChebyshev');
  assert.equal(first.manifest.sourceRecords[1].conversionMethod, 'spkType3DirectChebyshev');
  assert.equal(first.manifest.sourceRecords[0].sourceTimeScale, 'TDB seconds past J2000');
  assert.equal(first.manifest.sourceRecords[0].normalizedUnits, 'm, m/s and TDB seconds');
  assert.equal(first.manifest.sourceRecords[0].representationValidation.status, 'notRun');

  const source1 = first.sourceBuilds[0];
  const source2 = first.sourceBuilds[1];
  assert.deepEqual(evaluateImportedSource(source1, { seconds: 0, nanoseconds: 0 }), [100, 0, 0, 2, 0, 0]);
  assert.deepEqual(evaluateImportedSource(source2, { seconds: 0, nanoseconds: 0 }), [10, 20, 30, 1, 2, 3]);
  assert.equal(Buffer.from(first.shards[0].bytes.subarray(0, 4)).toString('ascii'), 'OEPB');
  assert.equal(sha256Hex(first.shards[0].bytes), first.manifest.shards[0].sha256);
});

test('validates direct import against deterministic oracle and enforces error budgets', async () => {
  const fixture = makeImportFixture();
  const oracle = async (source, instant) => evaluateImportedSource(source, instant);
  const output = await importDirectOep(fixture.plan, fixture.sourceBytes, { oracle });
  for (const record of output.manifest.sourceRecords) {
    assert.equal(record.representationValidation.maxPositionErrorMeters, 0);
    assert.equal(record.representationValidation.maxVelocityErrorMetersPerSecond, 0);
    assert.ok(record.representationValidation.samples.length >= 5);
  }

  await assert.rejects(
    () => importDirectOep(fixture.plan, fixture.sourceBytes, { oracle: async (source, instant) => {
      const state = [...evaluateImportedSource(source, instant)];
      state[0] += 0.01;
      return state;
    } }),
    errorCode('validationBudgetExceeded'),
  );
});

test('requires explicit fixed-frame rotation and applies it coefficient-wise once', async () => {
  const fixture = makeImportFixture();
  const rotated = buildSpkFixture({ target: 5, center: 0, frame: 100, type: 2, segmentId: 'ROTATED', coefficients: [[0.1, 0], [0.2, 0], [0.3, 0]] });
  const acquisition = acquisitionFor(rotated, { sourceProductId: 'rotated', sourceTargetIds: [5] });
  const plan = {
    ...fixture.plan,
    acquisitions: [acquisition],
    sourceNodes: [{ sourceNodeId: 1, targetNaifId: 5, parts: [{ sourceProductId: 'rotated', targetNaifId: 5, centerNaifId: 0, segmentId: 'ROTATED', spkType: 2 }] }],
    frameRotations: {},
  };
  await assert.rejects(() => importDirectOep(plan, new Map([['rotated', rotated]])), errorCode('unsupportedFrame'));
  plan.frameRotations = {
    100: {
      sourceFrameConvention: 'TEST FIXED FRAME',
      matrix: [0, -1, 0, 1, 0, 0, 0, 0, 1],
    },
  };
  const output = await importDirectOep(plan, new Map([['rotated', rotated]]));
  assert.deepEqual(evaluateImportedSource(output.sourceBuilds[0], { seconds: 0, nanoseconds: 0 }).slice(0, 3), [-200, 100, 300]);
});

test('rejects missing center mapping and corrupted pinned source bytes', async () => {
  const fixture = makeImportFixture();
  const planMissingCenter = { ...fixture.plan, sourceNodes: [fixture.plan.sourceNodes[1]] };
  await assert.rejects(() => importDirectOep(planMissingCenter, fixture.sourceBytes), errorCode('missingCenter'));

  const corrupted = new Uint8Array(fixture.de441);
  corrupted[corrupted.length - 1] ^= 0xff;
  const sourceBytes = new Map(fixture.sourceBytes);
  sourceBytes.set('de441-test', corrupted);
  await assert.rejects(() => importDirectOep(fixture.plan, sourceBytes), errorCode('checksumMismatch'));
});
