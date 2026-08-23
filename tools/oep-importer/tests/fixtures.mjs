import { createHash } from 'node:crypto';

const RECORD_BYTES = 1024;

export function buildSpkFixture({
  littleEndian = true,
  target = 5,
  center = 0,
  frame = 1,
  type = 2,
  segmentId = 'TEST SEGMENT',
  midpoint = 0,
  radius = 10,
  coefficients,
  internalName = 'ORBITENGINE TEST SPK',
} = {}) {
  const componentCount = type === 3 ? 6 : 3;
  const defaultCoefficients = type === 3
    ? [[0.01, 0.005], [0.02, 0], [0.03, 0], [0.001, 0.0005], [0.002, 0], [0.003, 0]]
    : [[0.1, 0.02], [0, 0], [0, 0]];
  const values = coefficients ?? defaultCoefficients;
  const coefficientCount = values[0].length;
  if (values.length !== componentCount || values.some((part) => part.length !== coefficientCount)) throw new Error('bad fixture coefficients');
  const recordSize = 2 + componentCount * coefficientCount;
  const segmentWords = recordSize + 4;
  const dataRecord = 5;
  const initialAddress = ((dataRecord - 1) * RECORD_BYTES) / 8 + 1;
  const finalAddress = initialAddress + segmentWords - 1;
  const freeAddress = finalAddress + 1;
  const bytes = new Uint8Array(dataRecord * RECORD_BYTES + segmentWords * 8);
  const view = new DataView(bytes.buffer);
  const ascii = (offset, text, length) => {
    const encoded = Buffer.from(text, 'ascii');
    bytes.fill(32, offset, offset + length);
    bytes.set(encoded.subarray(0, length), offset);
  };
  ascii(0, 'DAF/SPK', 8);
  view.setInt32(8, 2, littleEndian);
  view.setInt32(12, 6, littleEndian);
  ascii(16, internalName, 60);
  view.setInt32(76, 3, littleEndian);
  view.setInt32(80, 3, littleEndian);
  view.setInt32(84, freeAddress, littleEndian);
  ascii(88, littleEndian ? 'LTL-IEEE' : 'BIG-IEEE', 8);
  ascii(699, 'FTPSTR:\r:\n:\r\n:\x00:\x81:\x10\xce:ENDFTP', 28);

  const summaryBase = (3 - 1) * RECORD_BYTES;
  view.setFloat64(summaryBase, 0, littleEndian);
  view.setFloat64(summaryBase + 8, 0, littleEndian);
  view.setFloat64(summaryBase + 16, 1, littleEndian);
  const descriptor = summaryBase + 24;
  view.setFloat64(descriptor, midpoint - radius, littleEndian);
  view.setFloat64(descriptor + 8, midpoint + radius, littleEndian);
  const ints = [target, center, frame, type, initialAddress, finalAddress];
  for (let index = 0; index < ints.length; index += 1) view.setInt32(descriptor + 16 + index * 4, ints[index], littleEndian);
  const nameBase = (4 - 1) * RECORD_BYTES;
  ascii(nameBase, segmentId, 40);

  const dataBase = (dataRecord - 1) * RECORD_BYTES;
  let word = 0;
  const put = (value) => { view.setFloat64(dataBase + word * 8, value, littleEndian); word += 1; };
  put(midpoint);
  put(radius);
  for (const component of values) for (const value of component) put(value);
  put(midpoint - radius);
  put(radius * 2);
  put(recordSize);
  put(1);
  if (word !== segmentWords) throw new Error(`segment words mismatch ${word} != ${segmentWords}`);
  return bytes;
}

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function acquisitionFor(bytes, overrides = {}) {
  return Object.freeze({
    sourceKind: overrides.sourceKind ?? 'de441',
    sourceProductId: overrides.sourceProductId ?? 'test-de441',
    sourceTargetIds: overrides.sourceTargetIds ?? [5],
    sourceUrl: overrides.sourceUrl ?? 'https://example.invalid/test.bsp',
    retrievalTimestamp: overrides.retrievalTimestamp ?? '2026-08-23T00:00:00Z',
    sourceDeclaredVersion: overrides.sourceDeclaredVersion ?? 'test-v1',
    requestedCoverage: overrides.requestedCoverage ?? { startEtSeconds: -10, endEtSeconds: 10 },
    sha256: sha256(bytes),
    redistribution: overrides.redistribution ?? { class: 'test-fixture', notes: 'Synthetic deterministic SPK fixture for OrbitEngine importer tests.' },
  });
}

export function makeImportFixture() {
  const de441 = buildSpkFixture({
    target: 5,
    center: 0,
    type: 2,
    segmentId: 'DE441 TEST JUP BARY',
    midpoint: 0,
    radius: 10,
    coefficients: [[0.1, 0.02], [0, 0], [0, 0]],
  });
  const jup365 = buildSpkFixture({
    target: 501,
    center: 5,
    type: 3,
    segmentId: 'JUP365 TEST IO',
    midpoint: 0,
    radius: 5,
    coefficients: [[0.01, 0.005], [0.02, 0], [0.03, 0], [0.001, 0.0005], [0.002, 0], [0.003, 0]],
  });
  const acquisitions = [
    acquisitionFor(de441, { sourceKind: 'de441', sourceProductId: 'de441-test', sourceTargetIds: [5] }),
    acquisitionFor(jup365, { sourceKind: 'planetary-satellite-spk', sourceProductId: 'jup365-test', sourceTargetIds: [501] }),
  ];
  const plan = Object.freeze({
    schemaVersion: 1,
    datasetId: 'direct-import-test',
    datasetVersion: '1.0.0-test',
    normalizationPolicyVersion: 'oep-direct-v1',
    importerVersion: 'test-importer-v1',
    importerCommit: '0123456789abcdef',
    createdAt: '2026-08-23T00:00:00Z',
    shardId: 'direct',
    acquisitions,
    sourceNodes: [
      {
        sourceNodeId: 1,
        targetNaifId: 5,
        parts: [{ sourceProductId: 'de441-test', targetNaifId: 5, centerNaifId: 0, segmentId: 'DE441 TEST JUP BARY', spkType: 2 }],
        namedValidationEpochs: [{ label: 'modern-scenario-era', etSeconds: 1 }, { label: 'decades-from-fixture', etSeconds: 2 }],
      },
      {
        sourceNodeId: 2,
        targetNaifId: 501,
        parts: [{ sourceProductId: 'jup365-test', targetNaifId: 501, centerNaifId: 5, segmentId: 'JUP365 TEST IO', spkType: 3 }],
      },
    ],
    frameRotations: {},
    objectBindings: [],
  });
  return { de441, jup365, acquisitions, plan, sourceBytes: new Map([['de441-test', de441], ['jup365-test', jup365]]) };
}
