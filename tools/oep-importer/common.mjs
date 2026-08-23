import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const NS_PER_SECOND = 1_000_000_000n;
export const UINT64_MASK = (1n << 64n) - 1n;
const INT64_MIN = -(1n << 63n);
const INT64_MAX = (1n << 63n) - 1n;

export class OepImporterError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'OepImporterError';
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

export function fail(code, message, details = {}) {
  throw new OepImporterError(code, message, details);
}

export function objectValue(value, name) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail('invalidInput', `${name} must be an object`);
  return value;
}

export function text(value, name) {
  if (typeof value !== 'string' || value.length === 0) fail('invalidInput', `${name} must be a non-empty string`);
  return value;
}

export function safeInteger(value, name) {
  if (!Number.isSafeInteger(value)) fail('invalidInput', `${name} must be a safe integer`);
  return value;
}

export function uint32(value, name, allowZero = true) {
  if (!Number.isInteger(value) || value < (allowZero ? 0 : 1) || value > 0xffff_ffff) fail('invalidInput', `${name} must be an integer in ${allowZero ? '0' : '1'}..uint32_max`);
  return value;
}

export function finite(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail('nonFinite', `${name} must be finite`);
  return value;
}

export function nonNegative(value, name) {
  finite(value, name);
  if (value < 0) fail('invalidInput', `${name} must be non-negative`);
  return value;
}

export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function sha256Text(value, name = 'sha256') {
  if (typeof value !== 'string' || !/^[0-9a-fA-F]{64}$/.test(value)) fail('invalidInput', `${name} must be 64 hexadecimal characters`);
  return value.toLowerCase();
}

export function canonicalJson(value) {
  const active = new Set();
  const encode = (item) => {
    if (item === null) return 'null';
    if (typeof item === 'string' || typeof item === 'boolean') return JSON.stringify(item);
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) fail('nonFinite', 'canonical JSON cannot contain non-finite numbers');
      return JSON.stringify(item);
    }
    if (Array.isArray(item)) return `[${item.map(encode).join(',')}]`;
    if (typeof item === 'object') {
      if (active.has(item)) fail('invalidInput', 'canonical JSON cannot contain cycles');
      active.add(item);
      const keys = Object.keys(item).filter((key) => item[key] !== undefined).sort();
      const result = `{${keys.map((key) => `${JSON.stringify(key)}:${encode(item[key])}`).join(',')}}`;
      active.delete(item);
      return result;
    }
    fail('invalidInput', `unsupported canonical JSON value: ${typeof item}`);
  };
  return `${encode(value)}\n`;
}

export function validateAcquisitionRecord(input) {
  const record = objectValue(input, 'acquisition record');
  const sourceKind = text(record.sourceKind, 'sourceKind');
  const sourceProductId = text(record.sourceProductId, 'sourceProductId');
  if (!Array.isArray(record.sourceTargetIds) || record.sourceTargetIds.length === 0) fail('invalidInput', 'sourceTargetIds must be a non-empty array');
  const sourceTargetIds = Object.freeze(record.sourceTargetIds.map((value, index) => safeInteger(value, `sourceTargetIds[${index}]`)));
  const sourceUrl = record.sourceUrl === undefined ? undefined : text(record.sourceUrl, 'sourceUrl');
  const request = record.request === undefined ? undefined : objectValue(record.request, 'request');
  if ((sourceUrl === undefined) === (request === undefined)) fail('invalidInput', 'exactly one of sourceUrl or request is required');
  const retrievalTimestamp = text(record.retrievalTimestamp, 'retrievalTimestamp');
  if (!Number.isFinite(Date.parse(retrievalTimestamp))) fail('invalidInput', 'retrievalTimestamp must be an ISO-compatible timestamp');
  const sourceDeclaredVersion = record.sourceDeclaredVersion === undefined ? undefined : text(record.sourceDeclaredVersion, 'sourceDeclaredVersion');
  const requestedCoverage = record.requestedCoverage === undefined ? undefined : objectValue(record.requestedCoverage, 'requestedCoverage');
  const sha256 = sha256Text(record.sha256);
  const redistribution = objectValue(record.redistribution, 'redistribution');
  return Object.freeze({
    sourceKind,
    sourceProductId,
    sourceTargetIds,
    ...(sourceUrl === undefined ? { request: Object.freeze({ ...request }) } : { sourceUrl }),
    retrievalTimestamp,
    ...(sourceDeclaredVersion === undefined ? {} : { sourceDeclaredVersion }),
    ...(requestedCoverage === undefined ? {} : { requestedCoverage: Object.freeze({ ...requestedCoverage }) }),
    sha256,
    redistribution: Object.freeze({ class: text(redistribution.class, 'redistribution.class'), notes: text(redistribution.notes, 'redistribution.notes') }),
  });
}

export function sanitizeFilePart(value) {
  return value.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'source';
}

export function acquisitionCacheFilename(recordInput) {
  const record = validateAcquisitionRecord(recordInput);
  return `${sanitizeFilePart(record.sourceProductId)}-${record.sha256}.bsp`;
}

export async function readAndVerify(path, expectedHash) {
  const bytes = await readFile(path);
  const actualHash = sha256Hex(bytes);
  if (actualHash !== expectedHash) fail('checksumMismatch', `cached source checksum mismatch for ${path}`, { expectedHash, actualHash });
  return bytes;
}

function requestUrl(request) {
  const url = new URL(text(request.endpoint, 'request.endpoint'));
  const params = objectValue(request.params ?? {}, 'request.params');
  for (const [key, raw] of Object.entries(params).sort(([a], [b]) => a.localeCompare(b))) {
    if (Array.isArray(raw)) for (const item of raw) url.searchParams.append(key, String(item));
    else url.searchParams.set(key, String(raw));
  }
  return url.toString();
}

export async function acquirePinnedSource(recordInput, options = {}) {
  const record = validateAcquisitionRecord(recordInput);
  const cacheDir = text(options.cacheDir, 'cacheDir');
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') fail('invalidInput', 'fetch implementation is required');
  await mkdir(cacheDir, { recursive: true });
  const path = join(cacheDir, acquisitionCacheFilename(record));
  try {
    await stat(path);
    return Object.freeze({ record, path, bytes: await readAndVerify(path, record.sha256), fromCache: true });
  } catch (error) {
    if (error instanceof OepImporterError) throw error;
    if (error?.code !== 'ENOENT') throw error;
  }
  const url = record.sourceUrl ?? requestUrl(record.request);
  const response = await fetchImpl(url, { redirect: 'follow' });
  if (!response || response.ok !== true) fail('acquisitionFailed', `source acquisition failed for ${record.sourceProductId}`, { url, status: response?.status });
  const bytes = Buffer.from(await response.arrayBuffer());
  const actualHash = sha256Hex(bytes);
  if (actualHash !== record.sha256) fail('checksumMismatch', `downloaded source checksum mismatch for ${record.sourceProductId}`, { expectedHash: record.sha256, actualHash });
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, bytes);
  await rename(temporary, path);
  return Object.freeze({ record, path, bytes, fromCache: false });
}

function exactScaledNanoseconds(value) {
  finite(value, 'SPK ET');
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setFloat64(0, value, false);
  const bits = view.getBigUint64(0, false);
  const negative = (bits >> 63n) !== 0n;
  const exponentBits = Number((bits >> 52n) & 0x7ffn);
  const fraction = bits & ((1n << 52n) - 1n);
  if (exponentBits === 0x7ff) fail('nonFinite', 'non-finite time');
  if (exponentBits === 0 && fraction === 0n) return { numerator: 0n, denominator: 1n };
  const mantissa = exponentBits === 0 ? fraction : (1n << 52n) | fraction;
  const shift = exponentBits === 0 ? -1074 : exponentBits - 1075;
  let numerator = mantissa * NS_PER_SECOND;
  let denominator = 1n;
  if (shift >= 0) numerator <<= BigInt(shift); else denominator <<= BigInt(-shift);
  return { numerator: negative ? -numerator : numerator, denominator };
}

export function floorDiv(numerator, denominator) {
  let quotient = numerator / denominator;
  if (numerator < 0n && numerator % denominator !== 0n) quotient -= 1n;
  return quotient;
}

function ceilDiv(numerator, denominator) {
  let quotient = numerator / denominator;
  if (numerator > 0n && numerator % denominator !== 0n) quotient += 1n;
  return quotient;
}

export function doubleToNanoseconds(value, mode) {
  const { numerator, denominator } = exactScaledNanoseconds(value);
  if (mode === 'floor') return floorDiv(numerator, denominator);
  if (mode === 'ceil') return ceilDiv(numerator, denominator);
  if (mode === 'nearest') {
    const base = floorDiv(numerator, denominator);
    const remainder = numerator - base * denominator;
    if (remainder * 2n < denominator) return base;
    if (remainder * 2n > denominator) return base + 1n;
    return (base & 1n) === 0n ? base : base + 1n;
  }
  fail('invalidInput', `unknown nanosecond rounding mode ${mode}`);
}

export function totalNanosecondsToInstant(totalNanoseconds) {
  const seconds = floorDiv(totalNanoseconds, NS_PER_SECOND);
  const nanoseconds = totalNanoseconds - seconds * NS_PER_SECOND;
  if (seconds < INT64_MIN || seconds > INT64_MAX || !Number.isSafeInteger(Number(seconds))) fail('timeOutOfRange', 'SPK time exceeds OrbitEngine supported public time range');
  return Object.freeze({ seconds: Number(seconds), nanoseconds: Number(nanoseconds) });
}

export function instantToTotalNanoseconds(instant) {
  return BigInt(instant.seconds) * NS_PER_SECOND + BigInt(instant.nanoseconds);
}

export function compareNsToDouble(totalNs, value) {
  const { numerator, denominator } = exactScaledNanoseconds(value);
  const left = totalNs * denominator;
  return left < numerator ? -1 : left > numerator ? 1 : 0;
}

export function compareInstants(a, b) {
  return a.seconds - b.seconds || a.nanoseconds - b.nanoseconds;
}
