import { open, stat } from 'node:fs/promises';

import { fail, finite, text } from './common.mjs';

const RECORD_BYTES = 1024;
const SUMMARY_BYTES = 40;
const NAME_BYTES = 40;

function ascii(bytes, offset, length) {
  if (offset < 0 || offset + length > bytes.byteLength) fail('truncated', 'DAF text field exceeds file bounds');
  return Buffer.from(bytes.buffer, bytes.byteOffset + offset, length).toString('ascii');
}

function endian(bff) {
  if (bff === 'LTL-IEEE') return true;
  if (bff === 'BIG-IEEE') return false;
  fail('unsupportedBinaryFormat', `unsupported DAF binary format: ${bff}`);
}

function recordOffset(record) {
  if (!Number.isInteger(record) || record <= 0) fail('malformedDaf', `invalid DAF record number ${record}`);
  return (record - 1) * RECORD_BYTES;
}

function range(bytes, offset, length, context) {
  if (offset < 0 || length < 0 || offset + length > bytes.byteLength) fail('truncated', `${context} exceeds DAF file bounds`, { offset, length, fileBytes: bytes.byteLength });
}

function f64(view, bytes, offset, little, context) {
  range(bytes, offset, 8, context);
  const value = view.getFloat64(offset, little);
  if (!Number.isFinite(value)) fail('nonFinite', `${context} is non-finite`);
  return value;
}

function addressOffset(address) {
  if (!Number.isSafeInteger(address) || address <= 0) fail('malformedDaf', `invalid DAF address ${address}`);
  return (address - 1) * 8;
}

async function readExact(handle, offset, length, context) {
  const bytes = Buffer.alloc(length);
  let cursor = 0;
  while (cursor < length) {
    const result = await handle.read(bytes, cursor, length - cursor, offset + cursor);
    if (result.bytesRead === 0) fail('truncated', `${context} exceeds SPK file bounds`, { offset, length });
    cursor += result.bytesRead;
  }
  return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function inspectionHeader(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const idword = ascii(bytes, 0, 8).replace(/\0.*$/, '').trimEnd();
  if (idword !== 'DAF/SPK') fail('badMagic', `expected DAF/SPK idword, got ${JSON.stringify(idword)}`);
  const bff = ascii(bytes, 88, 8).replace(/\0.*$/, '').trimEnd();
  const little = endian(bff);
  const nd = view.getInt32(8, little);
  const ni = view.getInt32(12, little);
  if (nd !== 2 || ni !== 6) fail('unsupportedSpkLayout', `SPK requires ND=2 NI=6, got ND=${nd} NI=${ni}`);
  const forwardRecord = view.getInt32(76, little);
  const backwardRecord = view.getInt32(80, little);
  const freeAddress = view.getInt32(84, little);
  if (forwardRecord <= 0 || backwardRecord <= 0 || freeAddress <= 0) fail('malformedDaf', 'invalid DAF summary/free pointers');
  return Object.freeze({
    idword,
    binaryFormat: bff,
    littleEndian: little,
    internalName: ascii(bytes, 16, 60).replace(/\0.*$/, '').trimEnd(),
    forwardRecord,
    backwardRecord,
    freeAddress,
  });
}

function parseSummaryPage(bytes, summaryRecord, little, fileBytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const next = view.getFloat64(0, little);
  const previous = view.getFloat64(8, little);
  const count = view.getFloat64(16, little);
  if (![next, previous, count].every(Number.isInteger) || count < 0 || count > 25) fail('malformedDaf', 'invalid DAF summary control words');
  const segments = [];
  for (let index = 0; index < count; index += 1) {
    const summary = 24 + index * SUMMARY_BYTES;
    const startEt = view.getFloat64(summary, little);
    const endEt = view.getFloat64(summary + 8, little);
    if (endEt < startEt) fail('malformedDaf', 'segment end precedes start');
    const ints = Array.from({ length: 6 }, (_, i) => view.getInt32(summary + 16 + i * 4, little));
    const [target, center, frame, type, initialAddress, finalAddress] = ints;
    if (initialAddress <= 0 || finalAddress < initialAddress || addressOffset(finalAddress) + 8 > fileBytes) fail('malformedDaf', 'segment DAF addresses are invalid');
    segments.push(Object.freeze({
      ordinal: segments.length,
      segmentId: ascii(bytes, RECORD_BYTES + index * NAME_BYTES, NAME_BYTES).replace(/\0.*$/, '').trimEnd(),
      startEt, endEt, target, center, frame, type, initialAddress, finalAddress,
    }));
  }
  return { next, segments };
}

export function inspectSpk(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength < RECORD_BYTES) fail('truncated', 'DAF/SPK file is shorter than one file record');
  const idword = ascii(bytes, 0, 8).replace(/\0.*$/, '').trimEnd();
  if (idword !== 'DAF/SPK') fail('badMagic', `expected DAF/SPK idword, got ${JSON.stringify(idword)}`);
  const bff = ascii(bytes, 88, 8).replace(/\0.*$/, '').trimEnd();
  const little = endian(bff);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const nd = view.getInt32(8, little);
  const ni = view.getInt32(12, little);
  if (nd !== 2 || ni !== 6) fail('unsupportedSpkLayout', `SPK requires ND=2 NI=6, got ND=${nd} NI=${ni}`);
  const forwardRecord = view.getInt32(76, little);
  const backwardRecord = view.getInt32(80, little);
  const freeAddress = view.getInt32(84, little);
  if (forwardRecord <= 0 || backwardRecord <= 0 || freeAddress <= 0) fail('malformedDaf', 'invalid DAF summary/free pointers');
  const segments = [];
  const seen = new Set();
  let summaryRecord = forwardRecord;
  while (summaryRecord !== 0) {
    if (seen.has(summaryRecord)) fail('malformedDaf', 'DAF summary record cycle detected', { summaryRecord });
    seen.add(summaryRecord);
    const base = recordOffset(summaryRecord);
    range(bytes, base, RECORD_BYTES * 2, 'summary/name record pair');
    const next = f64(view, bytes, base, little, 'summary next record');
    const previous = f64(view, bytes, base + 8, little, 'summary previous record');
    const count = f64(view, bytes, base + 16, little, 'summary count');
    if (![next, previous, count].every(Number.isInteger) || count < 0 || count > 25) fail('malformedDaf', 'invalid DAF summary control words');
    const nameBase = recordOffset(summaryRecord + 1);
    for (let index = 0; index < count; index += 1) {
      const summary = base + 24 + index * SUMMARY_BYTES;
      const startEt = f64(view, bytes, summary, little, 'segment start ET');
      const endEt = f64(view, bytes, summary + 8, little, 'segment end ET');
      if (endEt < startEt) fail('malformedDaf', 'segment end precedes start');
      const ints = Array.from({ length: 6 }, (_, i) => view.getInt32(summary + 16 + i * 4, little));
      const [target, center, frame, type, initialAddress, finalAddress] = ints;
      if (initialAddress <= 0 || finalAddress < initialAddress || addressOffset(finalAddress) + 8 > bytes.byteLength) fail('malformedDaf', 'segment DAF addresses are invalid');
      segments.push(Object.freeze({
        ordinal: segments.length,
        segmentId: ascii(bytes, nameBase + index * NAME_BYTES, NAME_BYTES).replace(/\0.*$/, '').trimEnd(),
        startEt, endEt, target, center, frame, type, initialAddress, finalAddress,
      }));
    }
    summaryRecord = next;
  }
  return Object.freeze({
    idword,
    binaryFormat: bff,
    littleEndian: little,
    internalName: ascii(bytes, 16, 60).replace(/\0.*$/, '').trimEnd(),
    forwardRecord,
    backwardRecord,
    freeAddress,
    segments: Object.freeze(segments),
  });
}

export async function inspectSpkFile(pathInput) {
  const path = text(pathInput, 'SPK path');
  const file = await open(path, 'r');
  try {
    const fileBytes = Number((await stat(path)).size);
    if (!Number.isSafeInteger(fileBytes) || fileBytes < RECORD_BYTES) fail('truncated', 'DAF/SPK file is too short or too large');
    const header = inspectionHeader(await readExact(file, 0, RECORD_BYTES, 'DAF/SPK header'));
    const segments = [];
    const seen = new Set();
    let summaryRecord = header.forwardRecord;
    while (summaryRecord !== 0) {
      if (seen.has(summaryRecord)) fail('malformedDaf', 'DAF summary record cycle detected', { summaryRecord });
      seen.add(summaryRecord);
      const page = await readExact(file, recordOffset(summaryRecord), RECORD_BYTES * 2, 'summary/name record pair');
      const parsed = parseSummaryPage(page, summaryRecord, header.littleEndian, fileBytes);
      segments.push(...parsed.segments.map((segment) => Object.freeze({ ...segment, ordinal: segments.length })));
      summaryRecord = parsed.next;
    }
    return Object.freeze({ ...header, segments: Object.freeze(segments) });
  } finally {
    await file.close();
  }
}

function near(a, b) {
  return Object.is(a, b) || Math.abs(a - b) <= Number.EPSILON * Math.max(1, Math.abs(a), Math.abs(b)) * 8;
}

export function extractDirectSpkSegment(input, selector) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const inspection = inspectSpk(bytes);
  const segment = typeof selector === 'number' ? inspection.segments[selector] : selector;
  if (!segment) fail('missingSegment', 'SPK segment not found');
  if (segment.type !== 2 && segment.type !== 3) fail('unsupportedSpkType', `SPK type ${segment.type} is not directly normalizable to OEP v1`, { type: segment.type, segmentId: segment.segmentId });
  const start = addressOffset(segment.initialAddress);
  const end = addressOffset(segment.finalAddress) + 8;
  range(bytes, start, end - start, 'SPK segment data');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const words = [];
  for (let offset = start; offset < end; offset += 8) words.push(f64(view, bytes, offset, inspection.littleEndian, 'SPK segment word'));
  if (words.length < 5) fail('malformedSpkSegment', 'SPK type 2/3 segment is too short');
  const [init, intervalLength, recordSize, recordCount] = words.slice(-4);
  if (!Number.isInteger(recordSize) || !Number.isInteger(recordCount) || intervalLength <= 0) fail('malformedSpkSegment', 'invalid SPK type 2/3 trailer');
  const componentCount = segment.type === 2 ? 3 : 6;
  if (recordCount <= 0 || recordSize <= 2 || (recordSize - 2) % componentCount !== 0 || recordCount * recordSize + 4 !== words.length) fail('malformedSpkSegment', 'SPK trailer dimensions do not match array length');
  const coefficientCount = (recordSize - 2) / componentCount;
  const records = [];
  for (let recordIndex = 0; recordIndex < recordCount; recordIndex += 1) {
    const base = recordIndex * recordSize;
    const midpoint = finite(words[base], 'record midpoint');
    const radius = finite(words[base + 1], 'record radius');
    if (radius <= 0) fail('malformedSpkSegment', 'SPK record radius must be positive');
    const coefficients = [];
    let cursor = base + 2;
    for (let component = 0; component < componentCount; component += 1) {
      coefficients.push(Object.freeze(words.slice(cursor, cursor + coefficientCount)));
      cursor += coefficientCount;
    }
    records.push(Object.freeze({ recordIndex, midpoint, radius, rawStartEt: midpoint - radius, rawEndEt: midpoint + radius, coefficients: Object.freeze(coefficients) }));
  }
  if (!near(init, records[0].rawStartEt) || !near(intervalLength, records[0].radius * 2)) fail('malformedSpkSegment', 'SPK trailer INIT/INTLEN disagrees with first record');
  for (let i = 1; i < records.length; i += 1) if (!near(records[i - 1].rawEndEt, records[i].rawStartEt)) fail('malformedSpkSegment', 'SPK records are not contiguous', { recordIndex: i });
  return Object.freeze({
    descriptor: segment,
    representation: segment.type === 2 ? 'positionChebyshev' : 'stateChebyshev',
    componentCount,
    coefficientCount,
    init,
    intervalLength,
    recordSize,
    recordCount,
    records: Object.freeze(records),
  });
}

function selectedSegment(inspection, selector) {
  const segment = typeof selector === 'number' ? inspection.segments[selector] : selector;
  if (!segment) fail('missingSegment', 'SPK segment not found');
  return segment;
}

function validateSegmentShape(segment, wordsLength) {
  const [init, intervalLength, recordSize, recordCount] = wordsLength.slice(-4);
  if (!Number.isInteger(recordSize) || !Number.isInteger(recordCount) || intervalLength <= 0) fail('malformedSpkSegment', 'invalid SPK type 2/3 trailer');
  const componentCount = segment.type === 2 ? 3 : 6;
  if (recordCount <= 0 || recordSize <= 2 || (recordSize - 2) % componentCount !== 0 || (wordsLength.length > 4 && recordCount * recordSize + 4 !== wordsLength.length)) fail('malformedSpkSegment', 'SPK trailer dimensions do not match array length');
  return { init, intervalLength, recordSize, recordCount, componentCount, coefficientCount: (recordSize - 2) / componentCount };
}

export async function extractDirectSpkSegmentFile(pathInput, selector, options = {}) {
  const path = text(pathInput, 'SPK path');
  const inspection = await inspectSpkFile(path);
  const segment = selectedSegment(inspection, selector);
  if (segment.type !== 2 && segment.type !== 3) fail('unsupportedSpkType', `SPK type ${segment.type} is not directly normalizable to OEP v1`, { type: segment.type, segmentId: segment.segmentId });
  const file = await open(path, 'r');
  try {
    const dataStart = addressOffset(segment.initialAddress);
    const dataEnd = addressOffset(segment.finalAddress) + 8;
    const trailer = await readExact(file, dataEnd - 32, 32, 'SPK segment trailer');
    const trailerView = new DataView(trailer.buffer, trailer.byteOffset, trailer.byteLength);
    const trailerWords = Array.from({ length: 4 }, (_, index) => trailerView.getFloat64(index * 8, inspection.littleEndian));
    const shape = validateSegmentShape(segment, trailerWords);
    const coverage = options.coverageEtSeconds;
    const coverageStart = coverage?.startEt ?? segment.startEt;
    const coverageEnd = coverage?.endEt ?? segment.endEt;
    finite(coverageStart, 'source coverage start ET');
    finite(coverageEnd, 'source coverage end ET');
    if (!(coverageStart < coverageEnd)) fail('invalidInput', 'source coverage must have startEt < endEt');
    const first = Math.max(0, Math.min(shape.recordCount - 1, Math.floor((coverageStart - shape.init) / shape.intervalLength)));
    const last = Math.max(0, Math.min(shape.recordCount - 1, Math.ceil((coverageEnd - shape.init) / shape.intervalLength) - 1));
    if (last < first) fail('emptyCoverage', 'requested source coverage contains no SPK records');
    const firstOffset = dataStart + first * shape.recordSize * 8;
    const byteLength = (last - first + 1) * shape.recordSize * 8;
    if (firstOffset + byteLength > dataEnd - 32) fail('malformedSpkSegment', 'selected SPK record range exceeds segment data');
    const bytes = await readExact(file, firstOffset, byteLength, 'SPK selected record range');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const records = [];
    for (let localIndex = 0; localIndex <= last - first; localIndex += 1) {
      const base = localIndex * shape.recordSize * 8;
      const midpoint = finite(view.getFloat64(base, inspection.littleEndian), 'record midpoint');
      const radius = finite(view.getFloat64(base + 8, inspection.littleEndian), 'record radius');
      if (radius <= 0) fail('malformedSpkSegment', 'SPK record radius must be positive');
      const coefficients = [];
      let cursor = base + 16;
      for (let component = 0; component < shape.componentCount; component += 1) {
        const values = [];
        for (let coefficient = 0; coefficient < shape.coefficientCount; coefficient += 1) {
          values.push(finite(view.getFloat64(cursor, inspection.littleEndian), 'SPK coefficient'));
          cursor += 8;
        }
        coefficients.push(Object.freeze(values));
      }
      records.push(Object.freeze({ recordIndex: first + localIndex, midpoint, radius, rawStartEt: midpoint - radius, rawEndEt: midpoint + radius, coefficients: Object.freeze(coefficients) }));
    }
    return Object.freeze({
      descriptor: segment,
      representation: segment.type === 2 ? 'positionChebyshev' : 'stateChebyshev',
      componentCount: shape.componentCount,
      coefficientCount: shape.coefficientCount,
      init: shape.init,
      intervalLength: shape.intervalLength,
      recordSize: shape.recordSize,
      recordCount: records.length,
      records: Object.freeze(records),
    });
  } finally {
    await file.close();
  }
}

export function nearlySameEt(a, b) {
  return near(a, b);
}
