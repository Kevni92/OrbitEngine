import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  UINT64_MASK,
  canonicalJson,
  compareInstants,
  compareNsToDouble,
  doubleToNanoseconds,
  fail,
  finite,
  instantToTotalNanoseconds,
  nonNegative,
  objectValue,
  readAndVerify,
  safeInteger,
  sanitizeFilePart,
  sha256Hex,
  text,
  totalNanosecondsToInstant,
  uint32,
  validateAcquisitionRecord,
  acquisitionCacheFilename,
} from './common.mjs';
import { extractDirectSpkSegment, inspectSpk, nearlySameEt } from './spk.mjs';

const DEFAULT_POSITION_ERROR_METERS = 1e-3;
const DEFAULT_VELOCITY_ERROR_METERS_PER_SECOND = 1e-6;
const SHARD_HEADER_BYTES = 24;
const RECORD_HEADER_BYTES = 64;

function oepOffset(totalNs, midpoint) {
  const instant = totalNanosecondsToInstant(totalNs);
  const floor = Math.floor(midpoint);
  return (instant.seconds - floor) + instant.nanoseconds / 1e9 - (midpoint - floor);
}

function inRecordDomain(totalNs, record) {
  const offset = oepOffset(totalNs, record.midpoint);
  return Number.isFinite(offset) && offset >= -record.radius && offset <= record.radius;
}

function edgeBoundary(rawEt, mode, record) {
  let candidate = doubleToNanoseconds(rawEt, mode);
  const direction = mode === 'ceil' ? 1n : -1n;
  for (let attempts = 0; attempts < 64; attempts += 1) {
    const conservative = mode === 'ceil' ? compareNsToDouble(candidate, rawEt) >= 0 : compareNsToDouble(candidate, rawEt) <= 0;
    if (conservative && inRecordDomain(candidate, record)) return candidate;
    candidate += direction;
  }
  fail('unrepresentableTimeBoundary', 'SPK boundary cannot be represented conservatively on the OrbitEngine nanosecond grid', { rawEt, mode });
}

function sharedBoundary(rawEt, previous, next) {
  const nearest = doubleToNanoseconds(rawEt, 'nearest');
  for (let distance = 0n; distance <= 64n; distance += 1n) {
    const candidates = distance === 0n ? [nearest] : [nearest - distance, nearest + distance];
    for (const candidate of candidates) if (inRecordDomain(candidate, previous) && inRecordDomain(candidate, next)) return candidate;
  }
  fail('unrepresentableTimeBoundary', 'shared SPK record boundary cannot be represented by one exact OrbitEngine instant', { rawEt });
}

function normalizeRotation(definition, frameCode) {
  if (frameCode === 1 && definition === undefined) {
    return Object.freeze({ sourceFrameConvention: 'SPICE J2000 (ICRF-aligned)', spiceFrameName: 'J2000', matrix: Object.freeze([1,0,0,0,1,0,0,0,1]) });
  }
  if (definition === undefined) fail('unsupportedFrame', `SPK frame ${frameCode} requires an explicit fixed rotation to ICRS/ICRF-aligned axes`, { frameCode });
  const sourceFrameConvention = text(definition.sourceFrameConvention, `frameRotations.${frameCode}.sourceFrameConvention`);
  const spiceFrameName = definition.spiceFrameName === undefined ? undefined : text(definition.spiceFrameName, `frameRotations.${frameCode}.spiceFrameName`);
  if (!Array.isArray(definition.matrix) || definition.matrix.length !== 9) fail('invalidRotation', `frameRotations.${frameCode}.matrix must contain 9 values`);
  const matrix = definition.matrix.map((value, index) => finite(value, `frame rotation[${index}]`));
  const dot = (a, b) => matrix[a*3] * matrix[b*3] + matrix[a*3+1] * matrix[b*3+1] + matrix[a*3+2] * matrix[b*3+2];
  for (let row = 0; row < 3; row += 1) {
    if (Math.abs(dot(row, row) - 1) > 1e-12) fail('invalidRotation', 'fixed frame rotation rows must be unit length');
    for (let other = row + 1; other < 3; other += 1) if (Math.abs(dot(row, other)) > 1e-12) fail('invalidRotation', 'fixed frame rotation rows must be orthogonal');
  }
  const [a,b,c,d,e,f,g,h,i] = matrix;
  const determinant = a*(e*i-f*h)-b*(d*i-f*g)+c*(d*h-e*g);
  if (Math.abs(determinant - 1) > 1e-12) fail('invalidRotation', 'fixed frame rotation must be proper and right-handed');
  return Object.freeze({ sourceFrameConvention, ...(spiceFrameName === undefined ? {} : { spiceFrameName }), matrix: Object.freeze(matrix) });
}

function rotateThree(components, matrix) {
  const count = components[0].length;
  const output = [new Array(count), new Array(count), new Array(count)];
  for (let index = 0; index < count; index += 1) {
    const x = components[0][index];
    const y = components[1][index];
    const z = components[2][index];
    output[0][index] = (matrix[0]*x + matrix[1]*y + matrix[2]*z) * 1000;
    output[1][index] = (matrix[3]*x + matrix[4]*y + matrix[5]*z) * 1000;
    output[2][index] = (matrix[6]*x + matrix[7]*y + matrix[8]*z) * 1000;
  }
  return output;
}

function normalizeCoefficients(record, representation, matrix) {
  const position = rotateThree(record.coefficients.slice(0, 3), matrix);
  const values = representation === 'positionChebyshev' ? position : [...position, ...rotateThree(record.coefficients.slice(3, 6), matrix)];
  return Object.freeze(values.map((component) => Object.freeze(component)));
}

function normalizeSegments(parts, rotation) {
  if (parts.length === 0) fail('missingSegment', 'no SPK segments selected');
  const representation = parts[0].extracted.representation;
  const centerNaifId = parts[0].extracted.descriptor.center;
  const frameCode = parts[0].extracted.descriptor.frame;
  for (const part of parts) {
    if (part.extracted.representation !== representation) fail('mixedRepresentation', 'one OEP source cannot mix SPK Type 2 and Type 3');
    if (part.extracted.descriptor.center !== centerNaifId) fail('mixedCenter', 'one OEP source cannot mix centers');
    if (part.extracted.descriptor.frame !== frameCode) fail('mixedFrame', 'one OEP source cannot mix source frames');
  }
  const flattened = [];
  for (const part of parts) {
    const descriptor = part.extracted.descriptor;
    const records = part.extracted.records;
    const clipStart = Math.max(descriptor.startEt, records[0].rawStartEt);
    const clipEnd = Math.min(descriptor.endEt, records[records.length - 1].rawEndEt);
    for (const record of records) {
      const rawStartEt = Math.max(record.rawStartEt, clipStart);
      const rawEndEt = Math.min(record.rawEndEt, clipEnd);
      if (rawEndEt > rawStartEt) flattened.push({ part, record, rawStartEt, rawEndEt });
    }
  }
  flattened.sort((a, b) => a.rawStartEt - b.rawStartEt || a.rawEndEt - b.rawEndEt || a.part.record.sourceProductId.localeCompare(b.part.record.sourceProductId) || a.record.recordIndex - b.record.recordIndex);
  if (flattened.length === 0) fail('emptyCoverage', 'selected SPK segments contain no usable records');
  const boundaries = new Array(flattened.length + 1);
  boundaries[0] = edgeBoundary(flattened[0].rawStartEt, 'ceil', flattened[0].record);
  for (let index = 1; index < flattened.length; index += 1) {
    const previous = flattened[index - 1];
    const current = flattened[index];
    if (!nearlySameEt(previous.rawEndEt, current.rawStartEt)) fail(previous.rawEndEt > current.rawStartEt ? 'overlappingCoverage' : 'coverageGap', 'selected SPK source parts must form one contiguous, non-overlapping interval');
    boundaries[index] = sharedBoundary((previous.rawEndEt + current.rawStartEt) / 2, previous.record, current.record);
  }
  boundaries[flattened.length] = edgeBoundary(flattened.at(-1).rawEndEt, 'floor', flattened.at(-1).record);
  const records = flattened.map((entry, index) => {
    if (!(boundaries[index] < boundaries[index + 1])) fail('emptyCoverage', 'nanosecond-normalized record has empty coverage', { index });
    return Object.freeze({
      start: totalNanosecondsToInstant(boundaries[index]),
      end: totalNanosecondsToInstant(boundaries[index + 1]),
      midpoint: entry.record.midpoint,
      radius: entry.record.radius,
      coefficients: normalizeCoefficients(entry.record, representation, rotation.matrix),
      sourceProductId: entry.part.record.sourceProductId,
      segmentId: entry.part.extracted.descriptor.segmentId,
      spkType: entry.part.extracted.descriptor.type,
      sourceRecordIndex: entry.record.recordIndex,
    });
  });
  return Object.freeze({ representation, centerNaifId, frameCode, records: Object.freeze(records), validity: Object.freeze({ start: records[0].start, end: records.at(-1).end }) });
}

function findSegment(inspection, selector) {
  const target = safeInteger(selector.targetNaifId, 'targetNaifId');
  const center = selector.centerNaifId === undefined ? undefined : safeInteger(selector.centerNaifId, 'centerNaifId');
  const segmentId = selector.segmentId === undefined ? undefined : text(selector.segmentId, 'segmentId');
  const type = selector.spkType === undefined ? undefined : safeInteger(selector.spkType, 'spkType');
  const matches = inspection.segments.filter((segment) => segment.target === target && (center === undefined || segment.center === center) && (segmentId === undefined || segment.segmentId === segmentId) && (type === undefined || segment.type === type));
  if (matches.length === 0) fail('missingSegment', `no SPK segment matches target ${target}`, { selector });
  if (matches.length !== 1) fail('ambiguousSegment', `SPK selector for target ${target} matched ${matches.length} segments; make the selector explicit`, { selector, segmentIds: matches.map((segment) => segment.segmentId) });
  return matches[0];
}

function budget(source) {
  const input = source.normalizationErrorBudget ?? {};
  return Object.freeze({
    positionMeters: nonNegative(input.positionMeters ?? DEFAULT_POSITION_ERROR_METERS, 'position normalization error budget'),
    velocityMetersPerSecond: nonNegative(input.velocityMetersPerSecond ?? DEFAULT_VELOCITY_ERROR_METERS_PER_SECOND, 'velocity normalization error budget'),
  });
}

function normalizePlan(input) {
  const plan = objectValue(input, 'import plan');
  if (plan.schemaVersion !== 1) fail('unsupportedSchema', 'import plan schemaVersion must be 1');
  const createdAt = text(plan.createdAt, 'createdAt');
  if (!Number.isFinite(Date.parse(createdAt))) fail('invalidInput', 'createdAt must be an ISO-compatible timestamp');
  if (!Array.isArray(plan.acquisitions) || plan.acquisitions.length === 0) fail('invalidInput', 'import plan requires acquisitions');
  const acquisitions = plan.acquisitions.map(validateAcquisitionRecord);
  const acquisitionIds = new Set();
  for (const record of acquisitions) {
    if (acquisitionIds.has(record.sourceProductId)) fail('invalidInput', `duplicate sourceProductId ${record.sourceProductId}`);
    acquisitionIds.add(record.sourceProductId);
  }
  if (!Array.isArray(plan.sourceNodes) || plan.sourceNodes.length === 0) fail('invalidInput', 'import plan requires sourceNodes');
  const sourceNodes = plan.sourceNodes.map((inputSource) => {
    const source = objectValue(inputSource, 'source node plan');
    const sourceNodeId = uint32(source.sourceNodeId, 'sourceNodeId', false);
    const targetNaifId = safeInteger(source.targetNaifId, 'targetNaifId');
    if (!Array.isArray(source.parts) || source.parts.length === 0) fail('invalidInput', `OEP source ${sourceNodeId} requires parts`);
    const parts = source.parts.map((inputPart) => {
      const part = objectValue(inputPart, 'source part');
      const sourceProductId = text(part.sourceProductId, 'sourceProductId');
      if (!acquisitionIds.has(sourceProductId)) fail('invalidInput', `source part references unknown acquisition ${sourceProductId}`);
      return Object.freeze({
        sourceProductId,
        targetNaifId: part.targetNaifId === undefined ? targetNaifId : safeInteger(part.targetNaifId, 'part targetNaifId'),
        ...(part.centerNaifId === undefined ? {} : { centerNaifId: safeInteger(part.centerNaifId, 'part centerNaifId') }),
        ...(part.segmentId === undefined ? {} : { segmentId: text(part.segmentId, 'part segmentId') }),
        ...(part.spkType === undefined ? {} : { spkType: safeInteger(part.spkType, 'part spkType') }),
      });
    });
    const namedValidationEpochs = (source.namedValidationEpochs ?? []).map((inputEpoch) => {
      const epoch = objectValue(inputEpoch, 'named validation epoch');
      return Object.freeze({ label: text(epoch.label, 'validation label'), etSeconds: finite(epoch.etSeconds, 'validation ET') });
    });
    return Object.freeze({
      sourceNodeId,
      targetNaifId,
      parts: Object.freeze(parts),
      normalizationErrorBudget: budget(source),
      ...(source.sourceLimitations === undefined ? {} : { sourceLimitations: text(source.sourceLimitations, 'sourceLimitations') }),
      ...(source.sourceUncertaintyNotes === undefined ? {} : { sourceUncertaintyNotes: text(source.sourceUncertaintyNotes, 'sourceUncertaintyNotes') }),
      namedValidationEpochs: Object.freeze(namedValidationEpochs),
    });
  });
  const sourceIds = new Set();
  for (const source of sourceNodes) {
    if (sourceIds.has(source.sourceNodeId)) fail('duplicateSource', `duplicate sourceNodeId ${source.sourceNodeId}`);
    sourceIds.add(source.sourceNodeId);
  }
  if (plan.objectBindings !== undefined && !Array.isArray(plan.objectBindings)) fail('invalidInput', 'objectBindings must be an array');
  return Object.freeze({
    schemaVersion: 1,
    datasetId: text(plan.datasetId, 'datasetId'),
    datasetVersion: text(plan.datasetVersion, 'datasetVersion'),
    normalizationPolicyVersion: text(plan.normalizationPolicyVersion, 'normalizationPolicyVersion'),
    importerVersion: text(plan.importerVersion, 'importerVersion'),
    importerCommit: text(plan.importerCommit, 'importerCommit'),
    createdAt,
    shardId: text(plan.shardId ?? 'ephemeris', 'shardId'),
    acquisitions: Object.freeze(acquisitions),
    sourceNodes: Object.freeze(sourceNodes),
    frameRotations: Object.freeze({ ...objectValue(plan.frameRotations ?? {}, 'frameRotations') }),
    objectBindings: Object.freeze([...(plan.objectBindings ?? [])]),
  });
}

function centerNode(centerNaifId, targetToNode) {
  if (centerNaifId === 0) return undefined;
  const value = targetToNode.get(centerNaifId);
  if (value === undefined) fail('missingCenter', `SPK center NAIF ID ${centerNaifId} is not represented by an OEP source node`);
  return value;
}

function validateGraph(sources) {
  const byId = new Map(sources.map((source) => [source.sourceNodeId, source]));
  const states = new Map();
  const visit = (id) => {
    if (states.get(id) === 1) fail('dependencyCycle', `OEP source-center cycle includes ${id}`);
    if (states.get(id) === 2) return;
    states.set(id, 1);
    const source = byId.get(id);
    if (!source) fail('missingCenter', `missing source ${id}`);
    if (source.centerSourceNodeId !== undefined) visit(source.centerSourceNodeId);
    states.set(id, 2);
  };
  for (const id of byId.keys()) visit(id);
}

function revisionFrom(value) {
  return (BigInt(`0x${sha256Hex(Buffer.from(value)).slice(0, 16)}`) & UINT64_MASK).toString(10);
}

function writeTime(view, offset, instant) {
  const value = BigInt(instant.seconds) & UINT64_MASK;
  view.setUint32(offset, Number((value >> 32n) & 0xffff_ffffn), true);
  view.setUint32(offset + 4, Number(value & 0xffff_ffffn), true);
  view.setUint32(offset + 8, instant.nanoseconds, true);
}

function serializeShard(sources) {
  const records = sources.flatMap((source) => source.records.map((record) => ({ source, record })))
    .sort((a, b) => a.source.sourceNodeId - b.source.sourceNodeId || compareInstants(a.record.start, b.record.start));
  const coefficientBytes = records.reduce((sum, { record }) => sum + record.coefficients.length * record.coefficients[0].length * 8, 0);
  const headerBytes = SHARD_HEADER_BYTES + records.length * RECORD_HEADER_BYTES;
  const totalBytes = headerBytes + coefficientBytes;
  if (totalBytes > 0xffff_ffff) fail('outputTooLarge', 'OEP shard exceeds uint32 byte length');
  const bytes = new Uint8Array(totalBytes);
  const view = new DataView(bytes.buffer);
  bytes.set(Buffer.from('OEPB'), 0);
  view.setUint16(4, 1, true);
  view.setUint16(6, 0, true);
  view.setUint32(8, totalBytes, true);
  view.setUint32(12, records.length, true);
  view.setBigUint64(16, 0n, true);
  let coefficientOffset = headerBytes;
  for (let index = 0; index < records.length; index += 1) {
    const { source, record } = records[index];
    const base = SHARD_HEADER_BYTES + index * RECORD_HEADER_BYTES;
    const componentCount = source.representation === 'positionChebyshev' ? 3 : 6;
    const count = record.coefficients[0].length;
    const coefficientByteCount = componentCount * count * 8;
    view.setUint32(base, source.sourceNodeId, true);
    view.setUint16(base + 4, source.representation === 'positionChebyshev' ? 1 : 2, true);
    view.setUint16(base + 6, componentCount, true);
    writeTime(view, base + 8, record.start);
    writeTime(view, base + 20, record.end);
    view.setFloat64(base + 32, record.midpoint, true);
    view.setFloat64(base + 40, record.radius, true);
    view.setUint32(base + 48, count, true);
    view.setUint32(base + 52, coefficientOffset, true);
    view.setUint32(base + 56, coefficientByteCount, true);
    view.setUint32(base + 60, 0, true);
    for (const component of record.coefficients) for (const coefficient of component) {
      view.setFloat64(coefficientOffset, coefficient, true);
      coefficientOffset += 8;
    }
  }
  if (coefficientOffset !== totalBytes) fail('internalError', 'OEP shard serialization size mismatch');
  return bytes;
}

function chebyshev(coefficients, x, derivative = false) {
  let tPrevious = 1;
  let dPrevious = 0;
  let value = coefficients[0];
  let derivativeValue = 0;
  if (coefficients.length === 1) return derivative ? [value, 0] : value;
  let tCurrent = x;
  let dCurrent = 1;
  value += coefficients[1] * tCurrent;
  derivativeValue += coefficients[1] * dCurrent;
  for (let index = 2; index < coefficients.length; index += 1) {
    const tNext = 2*x*tCurrent - tPrevious;
    const dNext = 2*tCurrent + 2*x*dCurrent - dPrevious;
    value += coefficients[index] * tNext;
    derivativeValue += coefficients[index] * dNext;
    tPrevious = tCurrent; tCurrent = tNext; dPrevious = dCurrent; dCurrent = dNext;
  }
  return derivative ? [value, derivativeValue] : value;
}

function contains(validity, instant) {
  return compareInstants(instant, validity.start) >= 0 && compareInstants(instant, validity.end) < 0;
}

export function evaluateImportedSource(source, instantInput) {
  const instant = Object.freeze({ seconds: safeInteger(instantInput.seconds, 'instant.seconds'), nanoseconds: uint32(instantInput.nanoseconds, 'instant.nanoseconds') });
  if (!contains(source.validity, instant)) fail('sourceOutOfRange', `target lies outside source ${source.sourceNodeId} validity`);
  const record = source.records.find((candidate) => contains(candidate, instant));
  if (!record) fail('sourceOutOfRange', `no record covers target for source ${source.sourceNodeId}`);
  const offset = oepOffset(instantToTotalNanoseconds(instant), record.midpoint);
  const x = offset / record.radius;
  if (!Number.isFinite(x) || x < -1 || x > 1) fail('malformedRecords', 'target lies outside Chebyshev record domain');
  const values = new Array(6).fill(0);
  if (source.representation === 'positionChebyshev') {
    for (let component = 0; component < 3; component += 1) {
      const [position, derivative] = chebyshev(record.coefficients[component], x, true);
      values[component] = position;
      values[component + 3] = derivative / record.radius;
    }
  } else {
    for (let component = 0; component < 6; component += 1) values[component] = chebyshev(record.coefficients[component], x);
  }
  if (values.some((value) => !Number.isFinite(value))) fail('nonFinite', 'imported source evaluation produced non-finite state');
  return Object.freeze(values);
}

function validationSamples(source, namedEpochs) {
  const start = instantToTotalNanoseconds(source.validity.start);
  const end = instantToTotalNanoseconds(source.validity.end);
  const samples = [];
  const seen = new Set();
  const add = (label, instant) => {
    if (!contains(source.validity, instant)) return;
    const key = `${instant.seconds}:${instant.nanoseconds}`;
    if (!seen.has(key)) { seen.add(key); samples.push({ label, instant }); }
  };
  add('source-near-start', source.validity.start);
  add('j2000', { seconds: 0, nanoseconds: 0 });
  const span = end - start;
  for (const [label, numerator, denominator] of [
    ['interior-quarter',1n,4n], ['interior-midpoint',1n,2n], ['interior-three-quarter',3n,4n],
    ['seeded-interior-a',173n,997n], ['seeded-interior-b',613n,997n], ['seeded-interior-c',887n,997n],
  ]) add(label, totalNanosecondsToInstant(start + span*numerator/denominator));
  if (span > 1n) add('source-near-end', totalNanosecondsToInstant(end - 1n));
  for (let index = 1; index < source.records.length; index += 1) {
    const boundary = instantToTotalNanoseconds(source.records[index].start);
    if (boundary > start) add(`record-boundary-${index}-before`, totalNanosecondsToInstant(boundary - 1n));
    add(`record-boundary-${index}`, source.records[index].start);
  }
  for (const named of namedEpochs) add(named.label, totalNanosecondsToInstant(doubleToNanoseconds(named.etSeconds, 'nearest')));
  return Object.freeze(samples.sort((a,b) => compareInstants(a.instant,b.instant) || a.label.localeCompare(b.label)).map(Object.freeze));
}

export async function validateSourceAgainstOracle(source, namedEpochs, oracle, errorBudget) {
  if (typeof oracle !== 'function') fail('invalidInput', 'oracle must be a function');
  let maxPositionErrorMeters = 0;
  let maxVelocityErrorMetersPerSecond = 0;
  const results = [];
  for (const sample of validationSamples(source, namedEpochs)) {
    const imported = evaluateImportedSource(source, sample.instant);
    const expected = await oracle(source, sample.instant, sample.label);
    if (!Array.isArray(expected) || expected.length !== 6 || expected.some((value) => !Number.isFinite(value))) fail('oracleFailure', `oracle returned invalid state for ${sample.label}`);
    const positionErrorMeters = Math.hypot(imported[0]-expected[0], imported[1]-expected[1], imported[2]-expected[2]);
    const velocityErrorMetersPerSecond = Math.hypot(imported[3]-expected[3], imported[4]-expected[4], imported[5]-expected[5]);
    maxPositionErrorMeters = Math.max(maxPositionErrorMeters, positionErrorMeters);
    maxVelocityErrorMetersPerSecond = Math.max(maxVelocityErrorMetersPerSecond, velocityErrorMetersPerSecond);
    results.push(Object.freeze({ label: sample.label, instant: sample.instant, positionErrorMeters, velocityErrorMetersPerSecond }));
  }
  if (maxPositionErrorMeters > errorBudget.positionMeters || maxVelocityErrorMetersPerSecond > errorBudget.velocityMetersPerSecond) fail('validationBudgetExceeded', `source ${source.sourceNodeId} exceeds OEP normalization error budget`, { maxPositionErrorMeters, maxVelocityErrorMetersPerSecond, errorBudget });
  return Object.freeze({
    positionBudgetMeters: errorBudget.positionMeters,
    velocityBudgetMetersPerSecond: errorBudget.velocityMetersPerSecond,
    maxPositionErrorMeters,
    maxVelocityErrorMetersPerSecond,
    samples: Object.freeze(results),
  });
}

export async function importDirectOep(planInput, sourceBytesInput, options = {}) {
  const plan = normalizePlan(planInput);
  const sourceBytes = sourceBytesInput instanceof Map ? sourceBytesInput : new Map(Object.entries(sourceBytesInput ?? {}));
  const acquisitionById = new Map(plan.acquisitions.map((record) => [record.sourceProductId, record]));
  const inspectionById = new Map();
  for (const acquisition of plan.acquisitions) {
    const bytes = sourceBytes.get(acquisition.sourceProductId);
    if (!(bytes instanceof Uint8Array) && !Buffer.isBuffer(bytes)) fail('missingSourceFile', `missing bytes for ${acquisition.sourceProductId}`);
    const actualHash = sha256Hex(bytes);
    if (actualHash !== acquisition.sha256) fail('checksumMismatch', `source bytes do not match pinned hash for ${acquisition.sourceProductId}`, { expectedHash: acquisition.sha256, actualHash });
    inspectionById.set(acquisition.sourceProductId, inspectSpk(bytes));
  }
  const targetToNode = new Map();
  for (const source of plan.sourceNodes) {
    if (targetToNode.has(source.targetNaifId)) fail('duplicateSourceTarget', `multiple OEP nodes map to NAIF target ${source.targetNaifId}`);
    targetToNode.set(source.targetNaifId, source.sourceNodeId);
  }
  const builds = [];
  for (const sourcePlan of [...plan.sourceNodes].sort((a,b) => a.sourceNodeId - b.sourceNodeId)) {
    const parts = sourcePlan.parts.map((selector) => {
      const record = acquisitionById.get(selector.sourceProductId);
      const bytes = sourceBytes.get(selector.sourceProductId);
      const segment = findSegment(inspectionById.get(selector.sourceProductId), selector);
      return { record, extracted: extractDirectSpkSegment(bytes, segment) };
    });
    const frameCode = parts[0].extracted.descriptor.frame;
    const rotation = normalizeRotation(plan.frameRotations[String(frameCode)] ?? plan.frameRotations[frameCode], frameCode);
    const normalized = normalizeSegments(parts, rotation);
    const centerSourceNodeId = centerNode(normalized.centerNaifId, targetToNode);
    const revisionMaterial = canonicalJson({
      normalizationPolicyVersion: plan.normalizationPolicyVersion,
      sourceNodeId: sourcePlan.sourceNodeId,
      targetNaifId: sourcePlan.targetNaifId,
      centerNaifId: normalized.centerNaifId,
      frameCode: normalized.frameCode,
      rotation,
      parts: parts.map(({ record, extracted }) => ({ sourceProductId: record.sourceProductId, sha256: record.sha256, segmentId: extracted.descriptor.segmentId, type: extracted.descriptor.type, startEt: extracted.descriptor.startEt, endEt: extracted.descriptor.endEt })),
    });
    builds.push(Object.freeze({
      sourceNodeId: sourcePlan.sourceNodeId,
      targetNaifId: sourcePlan.targetNaifId,
      centerNaifId: normalized.centerNaifId,
      ...(centerSourceNodeId === undefined ? {} : { centerSourceNodeId }),
      sourceFrameConvention: rotation.sourceFrameConvention,
      frameCode: normalized.frameCode,
      oracleFrameName: rotation.spiceFrameName,
      oracleRotationMatrix: rotation.matrix,
      representation: normalized.representation,
      validity: normalized.validity,
      sourceRevision: revisionFrom(revisionMaterial),
      normalizationErrorBudget: sourcePlan.normalizationErrorBudget,
      records: normalized.records,
      sourceLimitations: sourcePlan.sourceLimitations,
      sourceUncertaintyNotes: sourcePlan.sourceUncertaintyNotes,
      namedValidationEpochs: sourcePlan.namedValidationEpochs,
      sourceProducts: Object.freeze(parts.map(({ record, extracted }) => Object.freeze({ record, descriptor: extracted.descriptor }))),
    }));
  }
  validateGraph(builds);
  const validations = new Map();
  if (options.oracle !== undefined) for (const source of builds) validations.set(source.sourceNodeId, await validateSourceAgainstOracle(source, source.namedValidationEpochs, options.oracle, source.normalizationErrorBudget));
  const shardBytes = serializeShard(builds);
  const shardSha256 = sha256Hex(shardBytes);
  const sourceRecords = builds.map((source) => Object.freeze({
    sourceNodeId: source.sourceNodeId,
    targetNaifId: source.targetNaifId,
    centerNaifId: source.centerNaifId,
    sourceFrameCode: source.frameCode,
    sourceFrameConvention: source.sourceFrameConvention,
    normalizedFrameConvention: 'SSB + ICRS/ICRF-aligned',
    sourceTimeScale: 'TDB seconds past J2000',
    normalizedTimeScale: 'TDB',
    normalizedEpoch: 'J2000 TDB',
    sourceUnits: source.representation === 'positionChebyshev' ? 'km and TDB seconds' : 'km, km/s and TDB seconds',
    normalizedUnits: 'm, m/s and TDB seconds',
    conversionMethod: source.representation === 'positionChebyshev' ? 'spkType2DirectChebyshev' : 'spkType3DirectChebyshev',
    coverage: source.validity,
    normalizationErrorBudget: source.normalizationErrorBudget,
    ...(source.sourceLimitations === undefined ? {} : { sourceLimitations: source.sourceLimitations }),
    ...(source.sourceUncertaintyNotes === undefined ? {} : { sourceUncertaintyNotes: source.sourceUncertaintyNotes }),
    sourceProducts: Object.freeze(source.sourceProducts.map(({ record, descriptor }) => Object.freeze({
      sourceKind: record.sourceKind,
      sourceProductId: record.sourceProductId,
      sourceTargetIds: record.sourceTargetIds,
      sha256: record.sha256,
      retrievalTimestamp: record.retrievalTimestamp,
      sourceDeclaredVersion: record.sourceDeclaredVersion,
      requestedCoverage: record.requestedCoverage,
      sourceUrl: record.sourceUrl,
      request: record.request,
      redistribution: record.redistribution,
      segmentId: descriptor.segmentId,
      spkType: descriptor.type,
      sourceTargetId: descriptor.target,
      sourceCenterId: descriptor.center,
      sourceFrameId: descriptor.frame,
      sourceCoverageEtSeconds: Object.freeze({ start: descriptor.startEt, end: descriptor.endEt }),
    }))),
    ...(validations.has(source.sourceNodeId)
      ? { representationValidation: validations.get(source.sourceNodeId) }
      : { representationValidation: Object.freeze({ status: 'notRun', reason: 'CSPICE/source oracle was not configured for this import invocation' }) }),
  }));
  const manifest = Object.freeze({
    schemaVersion: 1,
    datasetId: plan.datasetId,
    datasetVersion: plan.datasetVersion,
    createdAt: plan.createdAt,
    importerVersion: plan.importerVersion,
    importerCommit: plan.importerCommit,
    normalizationPolicyVersion: plan.normalizationPolicyVersion,
    canonicalTimeScale: 'TDB',
    canonicalEpoch: 'J2000 TDB',
    canonicalSpatialFrame: 'SSB + ICRS/ICRF-aligned',
    sourceNodes: Object.freeze(builds.map((source) => Object.freeze({
      id: source.sourceNodeId,
      ...(source.centerSourceNodeId === undefined ? {} : { center: source.centerSourceNodeId }),
      representation: source.representation,
      validity: source.validity,
      sourceRevision: source.sourceRevision,
      normalizedAxes: 'ICRS/ICRF-aligned',
      sourceFrameConvention: source.sourceFrameConvention,
      normalizationErrorBudget: source.normalizationErrorBudget,
    }))),
    shards: Object.freeze([Object.freeze({ id: plan.shardId, sha256: shardSha256 })]),
    sourceRecords: Object.freeze(sourceRecords),
    objectBindings: plan.objectBindings,
  });
  const manifestText = canonicalJson(manifest);
  const manifestBytes = Buffer.from(manifestText);
  return Object.freeze({
    manifest,
    manifestText,
    manifestBytes,
    manifestSha256: sha256Hex(manifestBytes),
    shards: Object.freeze([Object.freeze({ id: plan.shardId, bytes: shardBytes, sha256: shardSha256 })]),
    sourceBuilds: Object.freeze(builds),
  });
}

export async function writeImportedOep(output, outDir) {
  await mkdir(outDir, { recursive: true });
  const manifestPath = join(outDir, `${sanitizeFilePart(output.manifest.datasetId)}-${sanitizeFilePart(output.manifest.datasetVersion)}.oep.json`);
  await writeFile(manifestPath, output.manifestBytes);
  const shardPaths = [];
  for (const shard of output.shards) {
    const path = join(outDir, `${sanitizeFilePart(output.manifest.datasetId)}-${sanitizeFilePart(shard.id)}.oepb`);
    await writeFile(path, shard.bytes);
    shardPaths.push(path);
  }
  return Object.freeze({ manifestPath, shardPaths: Object.freeze(shardPaths) });
}

export async function readAcquisitionBytes(planInput, cacheDir) {
  const plan = normalizePlan(planInput);
  const map = new Map();
  for (const record of plan.acquisitions) map.set(record.sourceProductId, await readAndVerify(join(cacheDir, acquisitionCacheFilename(record)), record.sha256));
  return map;
}
