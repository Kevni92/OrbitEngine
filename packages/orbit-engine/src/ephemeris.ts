import { FrameProviderKind, type EphemerisSourceCenteredFrameProvider } from "./frame-registry.js";
import { ROOT_REFERENCE_FRAME_ID, referenceFrameId, type ReferenceFrameId } from "./frames.js";
import type { ObjectId } from "./objects.js";
import {
  PropagationError,
  PropagationErrorCode,
  createReferenceEphemerisModel,
  propagationState,
  propagationTimeInterval,
  revisionId,
  type PropagationModel,
  type PropagationTimeInterval,
  type ReferenceEphemerisSource,
  type RevisionId,
} from "./propagation.js";
import { simulationInstant, type SimulationInstant } from "./time.js";
import { meters, metersPerSecond } from "./units.js";
import { loadEphemerisBackend, type EphemerisBackend } from "./internal/ephemeris-backend.js";
import {
  OepEvaluationModeCode,
  OepRepresentationCode,
  OepResultCode,
  oepWordsToDecimal,
  type OepDatasetInfoWire,
  type OepEvaluationWire,
  type OepSourceInfoWire,
} from "./internal/oep-wire.js";
import { decodeSimulationInstant, encodeSimulationInstant, type TimeWire } from "./internal/time-wire.js";
import type { BackendKind } from "./internal/backends/contract.js";

const UINT32_MAX = 4_294_967_295;
const MAX_LOAD_BYTES = 2_147_483_647;
const textEncoder = new TextEncoder();

declare const ephemerisSourceNodeIdBrand: unique symbol;
export type EphemerisSourceNodeId = number & { readonly [ephemerisSourceNodeIdBrand]: "EphemerisSourceNodeId" };

export function ephemerisSourceNodeId(value: number): EphemerisSourceNodeId {
  if (!Number.isInteger(value) || value <= 0 || value > UINT32_MAX) {
    throw new RangeError("EphemerisSourceNodeId must be an integer in 1..uint32_max; 0 is reserved for SSB");
  }
  return value as EphemerisSourceNodeId;
}

export const OepRepresentation = Object.freeze({
  positionChebyshev: "positionChebyshev",
  stateChebyshev: "stateChebyshev",
} as const);
export type OepRepresentation = (typeof OepRepresentation)[keyof typeof OepRepresentation];

export interface OepNormalizationErrorBudget {
  readonly positionMeters: number;
  readonly velocityMetersPerSecond: number;
}

export interface OepSourceNodeManifest {
  readonly id: EphemerisSourceNodeId | number;
  readonly center?: EphemerisSourceNodeId | number;
  readonly representation: OepRepresentation;
  readonly validity: PropagationTimeInterval;
  readonly sourceRevision: RevisionId | string;
  readonly normalizedAxes: "ICRS/ICRF-aligned";
  readonly sourceFrameConvention?: string;
  readonly normalizationErrorBudget: OepNormalizationErrorBudget;
}

export interface OepShardManifest {
  readonly id: string;
  readonly sha256: string;
}

export interface OepManifestV1 {
  readonly schemaVersion: 1;
  readonly datasetId: string;
  readonly datasetVersion: string;
  readonly normalizationPolicyVersion: string;
  readonly canonicalTimeScale: "TDB";
  readonly canonicalEpoch: "J2000 TDB";
  readonly canonicalSpatialFrame: "SSB + ICRS/ICRF-aligned";
  readonly sourceNodes: readonly OepSourceNodeManifest[];
  readonly shards: readonly OepShardManifest[];
  readonly createdAt?: string;
  readonly importerVersion?: string;
  readonly importerCommit?: string;
  readonly sourceRecords?: readonly unknown[];
  readonly objectBindings?: readonly unknown[];
}

export interface OepShardBytes {
  readonly id: string;
  readonly bytes: Uint8Array;
}

export interface OepLoadInput {
  readonly manifest: OepManifestV1;
  readonly manifestSha256: string;
  readonly shards: readonly OepShardBytes[];
}

export interface OepDatasetIdentity {
  readonly schemaVersion: 1;
  readonly datasetId: string;
  readonly datasetVersion: string;
  readonly manifestSha256: string;
  readonly normalizationPolicyVersion: string;
  readonly datasetRevision: RevisionId;
  readonly sourceCount: number;
}

export interface OepSourceIdentity {
  readonly dataset: OepDatasetIdentity;
  readonly sourceNodeId: EphemerisSourceNodeId;
  readonly centerSourceNodeId?: EphemerisSourceNodeId;
  readonly sourceRevision: RevisionId;
  readonly representation: OepRepresentation;
  readonly validity: PropagationTimeInterval;
  readonly effectiveValidity: PropagationTimeInterval;
  readonly normalizationErrorBudget: OepNormalizationErrorBudget;
}

export const OepErrorCode = Object.freeze({
  invalidInput: "invalidInput",
  badMagic: "badMagic",
  unsupportedSchema: "unsupportedSchema",
  truncated: "truncated",
  outOfBounds: "outOfBounds",
  nonFinite: "nonFinite",
  invalidCode: "invalidCode",
  duplicateSource: "duplicateSource",
  missingCenter: "missingCenter",
  dependencyCycle: "dependencyCycle",
  missingShard: "missingShard",
  checksumMismatch: "checksumMismatch",
  sourceOutOfRange: "sourceOutOfRange",
  missingDataset: "missingDataset",
  missingSource: "missingSource",
  datasetInUse: "datasetInUse",
  malformedRecords: "malformedRecords",
} as const);
export type OepErrorCode = (typeof OepErrorCode)[keyof typeof OepErrorCode];

const RESULT_ERROR: Readonly<Record<number, OepErrorCode>> = Object.freeze({
  [OepResultCode.invalidInput]: OepErrorCode.invalidInput,
  [OepResultCode.badMagic]: OepErrorCode.badMagic,
  [OepResultCode.unsupportedSchema]: OepErrorCode.unsupportedSchema,
  [OepResultCode.truncated]: OepErrorCode.truncated,
  [OepResultCode.outOfBounds]: OepErrorCode.outOfBounds,
  [OepResultCode.nonFinite]: OepErrorCode.nonFinite,
  [OepResultCode.invalidCode]: OepErrorCode.invalidCode,
  [OepResultCode.duplicateSource]: OepErrorCode.duplicateSource,
  [OepResultCode.missingCenter]: OepErrorCode.missingCenter,
  [OepResultCode.dependencyCycle]: OepErrorCode.dependencyCycle,
  [OepResultCode.missingShard]: OepErrorCode.missingShard,
  [OepResultCode.checksumMismatch]: OepErrorCode.checksumMismatch,
  [OepResultCode.sourceOutOfRange]: OepErrorCode.sourceOutOfRange,
  [OepResultCode.missingDataset]: OepErrorCode.missingDataset,
  [OepResultCode.missingSource]: OepErrorCode.missingSource,
  [OepResultCode.datasetInUse]: OepErrorCode.datasetInUse,
  [OepResultCode.malformedRecords]: OepErrorCode.malformedRecords,
});

export class OepError extends Error {
  readonly code: OepErrorCode;
  readonly resultCode: number;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: OepErrorCode, message: string, resultCode: number, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "OepError";
    this.code = code;
    this.resultCode = resultCode;
    this.details = Object.freeze({ ...details });
  }
}

function failResult(resultCode: number, operation: string, details: Record<string, unknown> = {}): never {
  const code = RESULT_ERROR[resultCode] ?? OepErrorCode.invalidInput;
  throw new OepError(code, `OEP ${operation} failed: ${code}`, resultCode, details);
}

function successful<T extends { readonly resultCode: number }>(wire: T, operation: string): T {
  if (wire.resultCode !== OepResultCode.success) failResult(wire.resultCode, operation);
  return wire;
}

function nonEmpty(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) throw new TypeError(`${name} must be a non-empty string`);
  return value;
}

function nonNegativeFinite(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a finite non-negative number`);
  }
  return value;
}

function sha256Bytes(value: unknown, name: string): Uint8Array {
  if (typeof value !== "string" || !/^[0-9a-fA-F]{64}$/.test(value)) {
    throw new RangeError(`${name} must be a 64-character SHA-256 hexadecimal string`);
  }
  const bytes = new Uint8Array(32);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function normalizedSha256(value: string, name: string): string {
  sha256Bytes(value, name);
  return value.toLowerCase();
}

function representationCode(value: OepRepresentation): number {
  if (value === OepRepresentation.positionChebyshev) return OepRepresentationCode.positionChebyshev;
  if (value === OepRepresentation.stateChebyshev) return OepRepresentationCode.stateChebyshev;
  throw new RangeError(`Unsupported OEP representation: ${String(value)}`);
}

function representationFromCode(value: number): OepRepresentation {
  if (value === OepRepresentationCode.positionChebyshev) return OepRepresentation.positionChebyshev;
  if (value === OepRepresentationCode.stateChebyshev) return OepRepresentation.stateChebyshev;
  throw new RangeError(`Unsupported OEP representation code: ${value}`);
}

function revisionWords(value: RevisionId | string): { high: number; low: number } {
  const normalized = revisionId(value);
  let high = 0;
  let low = 0;
  for (const character of normalized) {
    const product = low * 10 + character.charCodeAt(0) - 48;
    low = product % 4_294_967_296;
    high = high * 10 + Math.floor(product / 4_294_967_296);
  }
  return { high, low };
}

class BinaryWriter {
  readonly #bytes: Uint8Array;
  readonly #view: DataView;
  #offset = 0;

  constructor(length: number) {
    if (!Number.isSafeInteger(length) || length < 0 || length > MAX_LOAD_BYTES) throw new RangeError("OEP load payload is too large");
    this.#bytes = new Uint8Array(length);
    this.#view = new DataView(this.#bytes.buffer);
  }

  u8(value: number): void { this.#view.setUint8(this.#offset, value); this.#offset += 1; }
  u16(value: number): void { this.#view.setUint16(this.#offset, value, true); this.#offset += 2; }
  u32(value: number): void { this.#view.setUint32(this.#offset, value, true); this.#offset += 4; }
  i32(value: number): void { this.#view.setInt32(this.#offset, value, true); this.#offset += 4; }
  f64(value: number): void { this.#view.setFloat64(this.#offset, value, true); this.#offset += 8; }
  bytes(value: Uint8Array): void { this.#bytes.set(value, this.#offset); this.#offset += value.byteLength; }
  time(value: TimeWire): void { this.i32(value.secondsHigh); this.u32(value.secondsLow); this.u32(value.nanoseconds); }
  revision(value: RevisionId | string): void {
    const words = revisionWords(value);
    this.u32(words.low);
    this.u32(words.high);
  }
  finish(): Uint8Array {
    if (this.#offset !== this.#bytes.byteLength) throw new RangeError("Internal OEP load payload size mismatch");
    return this.#bytes;
  }
}

interface NormalizedSource {
  readonly id: EphemerisSourceNodeId;
  readonly center: EphemerisSourceNodeId | 0;
  readonly representation: OepRepresentation;
  readonly validity: PropagationTimeInterval;
  readonly sourceRevision: RevisionId;
  readonly error: OepNormalizationErrorBudget;
}

interface NormalizedManifest {
  readonly manifest: OepManifestV1;
  readonly manifestSha256: string;
  readonly datasetIdBytes: Uint8Array;
  readonly datasetVersionBytes: Uint8Array;
  readonly normalizationPolicyBytes: Uint8Array;
  readonly sources: readonly NormalizedSource[];
  readonly shards: readonly { readonly id: string; readonly idBytes: Uint8Array; readonly sha256: Uint8Array; readonly bytes: Uint8Array }[];
}

function normalizeInput(input: OepLoadInput): NormalizedManifest {
  if (typeof input !== "object" || input === null || typeof input.manifest !== "object" || input.manifest === null) {
    throw new TypeError("OEP load input must contain a manifest and shard bytes");
  }
  const manifest = input.manifest;
  if (manifest.schemaVersion !== 1) throw new RangeError("Only OEP schemaVersion 1 is supported");
  if (manifest.canonicalTimeScale !== "TDB") throw new RangeError("OEP v1 canonicalTimeScale must be TDB");
  if (manifest.canonicalEpoch !== "J2000 TDB") throw new RangeError("OEP v1 canonicalEpoch must be J2000 TDB");
  if (manifest.canonicalSpatialFrame !== "SSB + ICRS/ICRF-aligned") {
    throw new RangeError("OEP v1 canonicalSpatialFrame must be SSB + ICRS/ICRF-aligned");
  }
  const datasetId = nonEmpty(manifest.datasetId, "datasetId");
  const datasetVersion = nonEmpty(manifest.datasetVersion, "datasetVersion");
  const normalizationPolicyVersion = nonEmpty(manifest.normalizationPolicyVersion, "normalizationPolicyVersion");
  const manifestSha256 = normalizedSha256(input.manifestSha256, "manifestSha256");
  if (!Array.isArray(manifest.sourceNodes) || manifest.sourceNodes.length === 0) throw new RangeError("OEP manifest requires sourceNodes");
  if (!Array.isArray(manifest.shards) || manifest.shards.length === 0) throw new RangeError("OEP manifest requires shards");
  if (!Array.isArray(input.shards)) throw new TypeError("OEP shard bytes must be an array");

  const sources: NormalizedSource[] = [];
  const sourceIds = new Set<number>();
  for (const source of manifest.sourceNodes) {
    if (typeof source !== "object" || source === null) throw new TypeError("OEP source node must be an object");
    const id = ephemerisSourceNodeId(source.id);
    if (sourceIds.has(id)) throw new RangeError(`Duplicate OEP source node: ${id}`);
    sourceIds.add(id);
    const center = source.center === undefined ? 0 : ephemerisSourceNodeId(source.center);
    if (center === id) throw new RangeError(`OEP source ${id} cannot center on itself`);
    if (source.normalizedAxes !== "ICRS/ICRF-aligned") throw new RangeError("OEP v1 only supports normalized ICRS/ICRF-aligned axes");
    const validity = propagationTimeInterval(source.validity.start, source.validity.end);
    if (validity.end === undefined) throw new RangeError("OEP source validity must be bounded");
    sources.push(Object.freeze({
      id,
      center,
      representation: source.representation,
      validity,
      sourceRevision: revisionId(source.sourceRevision),
      error: Object.freeze({
        positionMeters: nonNegativeFinite(source.normalizationErrorBudget.positionMeters, "position normalization error"),
        velocityMetersPerSecond: nonNegativeFinite(source.normalizationErrorBudget.velocityMetersPerSecond, "velocity normalization error"),
      }),
    }));
    representationCode(source.representation);
  }

  const bytesById = new Map<string, Uint8Array>();
  for (const shard of input.shards) {
    if (typeof shard !== "object" || shard === null) throw new TypeError("OEP shard input must be an object");
    const id = nonEmpty(shard.id, "shard id");
    if (!(shard.bytes instanceof Uint8Array)) throw new TypeError(`OEP shard ${id} bytes must be Uint8Array`);
    if (bytesById.has(id)) throw new RangeError(`Duplicate OEP shard bytes: ${id}`);
    bytesById.set(id, shard.bytes);
  }
  const shardIds = new Set<string>();
  const shards = manifest.shards.map((shard) => {
    const id = nonEmpty(shard.id, "manifest shard id");
    if (shardIds.has(id)) throw new RangeError(`Duplicate manifest shard: ${id}`);
    shardIds.add(id);
    const bytes = bytesById.get(id);
    if (bytes === undefined) throw new OepError(OepErrorCode.missingShard, `OEP shard bytes are missing: ${id}`, OepResultCode.missingShard);
    return Object.freeze({
      id,
      idBytes: textEncoder.encode(id),
      sha256: sha256Bytes(shard.sha256, `shard ${id} sha256`),
      bytes,
    });
  });
  if (bytesById.size !== shards.length) throw new RangeError("OEP load input contains shard bytes not declared by the manifest");

  return Object.freeze({
    manifest,
    manifestSha256,
    datasetIdBytes: textEncoder.encode(datasetId),
    datasetVersionBytes: textEncoder.encode(datasetVersion),
    normalizationPolicyBytes: textEncoder.encode(normalizationPolicyVersion),
    sources: Object.freeze(sources),
    shards: Object.freeze(shards),
  });
}

function encodeLoadPayload(value: NormalizedManifest): Uint8Array {
  const fixedHeaderBytes = 60;
  const sourceBytes = value.sources.length * 60;
  let length = fixedHeaderBytes + value.datasetIdBytes.byteLength + value.datasetVersionBytes.byteLength
    + value.normalizationPolicyBytes.byteLength + sourceBytes;
  for (const shard of value.shards) length += 40 + shard.idBytes.byteLength + shard.bytes.byteLength;
  const writer = new BinaryWriter(length);
  for (const byte of [0x4f, 0x45, 0x50, 0x4c]) writer.u8(byte);
  writer.u16(1);
  writer.u16(0);
  writer.u32(value.datasetIdBytes.byteLength);
  writer.u32(value.datasetVersionBytes.byteLength);
  writer.u32(value.normalizationPolicyBytes.byteLength);
  writer.u32(value.sources.length);
  writer.u32(value.shards.length);
  writer.bytes(sha256Bytes(value.manifestSha256, "manifestSha256"));
  writer.bytes(value.datasetIdBytes);
  writer.bytes(value.datasetVersionBytes);
  writer.bytes(value.normalizationPolicyBytes);
  for (const source of value.sources) {
    writer.u32(source.id);
    writer.u32(source.center);
    writer.u16(representationCode(source.representation));
    writer.u16(1);
    writer.time(encodeSimulationInstant(source.validity.start));
    writer.time(encodeSimulationInstant(source.validity.end!));
    writer.revision(source.sourceRevision);
    writer.f64(source.error.positionMeters);
    writer.f64(source.error.velocityMetersPerSecond);
  }
  for (const shard of value.shards) {
    writer.u32(shard.idBytes.byteLength);
    writer.u32(shard.bytes.byteLength);
    writer.bytes(shard.sha256);
    writer.bytes(shard.idBytes);
    writer.bytes(shard.bytes);
  }
  return writer.finish();
}

function intervalFromWire(start: TimeWire, end: TimeWire): PropagationTimeInterval {
  return propagationTimeInterval(decodeSimulationInstant(start), decodeSimulationInstant(end));
}

function sourceIdentity(dataset: OepDatasetIdentity, wire: OepSourceInfoWire): OepSourceIdentity {
  const sourceNodeId = ephemerisSourceNodeId(wire.sourceNodeId);
  return Object.freeze({
    dataset,
    sourceNodeId,
    centerSourceNodeId: wire.centerSourceNodeId === 0 ? undefined : ephemerisSourceNodeId(wire.centerSourceNodeId),
    sourceRevision: revisionId(oepWordsToDecimal(wire.sourceRevisionHigh, wire.sourceRevisionLow)),
    representation: representationFromCode(wire.representationCode),
    validity: intervalFromWire(wire.validityStart, wire.validityEnd),
    effectiveValidity: intervalFromWire(wire.effectiveValidityStart, wire.effectiveValidityEnd),
    normalizationErrorBudget: Object.freeze({
      positionMeters: wire.positionErrorMeters,
      velocityMetersPerSecond: wire.velocityErrorMetersPerSecond,
    }),
  });
}

function evaluatedState(wire: OepEvaluationWire, referenceFrame: ReferenceFrameId) {
  return propagationState({
    position: {
      x: meters(wire.positionX),
      y: meters(wire.positionY),
      z: meters(wire.positionZ),
    },
    velocity: {
      x: metersPerSecond(wire.velocityX),
      y: metersPerSecond(wire.velocityY),
      z: metersPerSecond(wire.velocityZ),
    },
    epoch: decodeSimulationInstant(wire.epoch),
    referenceFrame,
  });
}

export interface OepReferenceModelHandle {
  readonly objectId?: ObjectId;
  readonly identity: OepSourceIdentity;
  readonly source: ReferenceEphemerisSource;
  readonly model: PropagationModel;
  release(): void;
}

export interface OepFrameProviderHandle {
  readonly identity: OepSourceIdentity;
  readonly provider: EphemerisSourceCenteredFrameProvider;
  release(): void;
}

export class OepDataset {
  readonly identity: OepDatasetIdentity;
  readonly #backend: EphemerisBackend;
  readonly #handleHigh: number;
  readonly #handleLow: number;
  #unloaded = false;

  constructor(backend: EphemerisBackend, normalized: NormalizedManifest, wire: OepDatasetInfoWire) {
    this.#backend = backend;
    this.#handleHigh = wire.handleHigh;
    this.#handleLow = wire.handleLow;
    this.identity = Object.freeze({
      schemaVersion: 1 as const,
      datasetId: normalized.manifest.datasetId,
      datasetVersion: normalized.manifest.datasetVersion,
      manifestSha256: normalized.manifestSha256,
      normalizationPolicyVersion: normalized.manifest.normalizationPolicyVersion,
      datasetRevision: revisionId(oepWordsToDecimal(wire.datasetRevisionHigh, wire.datasetRevisionLow)),
      sourceCount: wire.sourceCount,
    });
  }

  #assertLoaded(): void {
    if (this.#unloaded) throw new OepError(OepErrorCode.missingDataset, "OEP dataset has been unloaded", OepResultCode.missingDataset);
  }

  #retain(): void {
    this.#assertLoaded();
    successful(this.#backend.retain(this.#handleHigh, this.#handleLow), "retain");
  }

  #releaseReference(): void {
    successful(this.#backend.releaseReference(this.#handleHigh, this.#handleLow), "release reference");
  }

  sourceInfo(id: EphemerisSourceNodeId | number): OepSourceIdentity {
    this.#assertLoaded();
    const sourceId = ephemerisSourceNodeId(id);
    const wire = successful(this.#backend.sourceInfo(this.#handleHigh, this.#handleLow, sourceId), "source info");
    return sourceIdentity(this.identity, wire);
  }

  referenceModel(
    sourceNodeId: EphemerisSourceNodeId | number,
    propagationFrame: ReferenceFrameId,
    objectId?: ObjectId,
  ): OepReferenceModelHandle {
    const identity = this.sourceInfo(sourceNodeId);
    const frame = referenceFrameId(propagationFrame);
    this.#retain();
    let released = false;
    const source: ReferenceEphemerisSource = Object.freeze({
      validity: identity.effectiveValidity,
      direction: "bounded" as const,
      propagationFrame: frame,
      sourceRevision: identity.sourceRevision,
      dependencies: Object.freeze([Object.freeze({
        kind: "source" as const,
        id: `${this.identity.datasetId}@${this.identity.datasetVersion}:${this.identity.manifestSha256}:${identity.sourceNodeId}`,
        revision: identity.sourceRevision,
      })]),
      errorContract: Object.freeze({
        positionAbsoluteMeters: identity.normalizationErrorBudget.positionMeters,
        velocityAbsoluteMetersPerSecond: identity.normalizationErrorBudget.velocityMetersPerSecond,
        notes: `OEP ${this.identity.datasetId}@${this.identity.datasetVersion} source ${identity.sourceNodeId}`,
      }),
      evaluate: (target: SimulationInstant) => {
        if (released) throw new PropagationError(PropagationErrorCode.sourceUnavailable, "OEP reference source has been released");
        const exactTarget = simulationInstant(target.seconds, target.nanoseconds);
        const wire = this.#backend.evaluate(
          this.#handleHigh,
          this.#handleLow,
          identity.sourceNodeId,
          OepEvaluationModeCode.relativeToCenter,
          encodeSimulationInstant(exactTarget),
        );
        if (wire.resultCode === OepResultCode.sourceOutOfRange) {
          throw new PropagationError(PropagationErrorCode.targetOutsideValidity, "OEP target is outside effective source validity", {
            dataset: this.identity,
            sourceNodeId: identity.sourceNodeId,
            target: exactTarget,
          });
        }
        if (wire.resultCode !== OepResultCode.success) {
          throw new PropagationError(PropagationErrorCode.sourceUnavailable, "OEP reference source evaluation failed", {
            dataset: this.identity,
            sourceNodeId: identity.sourceNodeId,
            oepError: RESULT_ERROR[wire.resultCode] ?? OepErrorCode.invalidInput,
            resultCode: wire.resultCode,
          });
        }
        return evaluatedState(wire, frame);
      },
    });
    const model = createReferenceEphemerisModel(source);
    return Object.freeze({
      ...(objectId === undefined ? {} : { objectId }),
      identity,
      source,
      model,
      release: () => {
        if (released) return;
        this.#releaseReference();
        released = true;
      },
    });
  }

  sourceCenterProvider(sourceNodeId: EphemerisSourceNodeId | number): OepFrameProviderHandle {
    const identity = this.sourceInfo(sourceNodeId);
    this.#retain();
    let released = false;
    const sourceIdentityText = `${this.identity.datasetId}@${this.identity.datasetVersion}:${this.identity.manifestSha256}:${identity.sourceNodeId}`;
    const provider: EphemerisSourceCenteredFrameProvider = Object.freeze({
      kind: FrameProviderKind.ephemerisSourceCentered,
      revision: identity.sourceRevision,
      source: Object.freeze({
        sourceIdentity: sourceIdentityText,
        revision: identity.sourceRevision,
        stateAt: (target: SimulationInstant) => {
          if (released) throw new OepError(OepErrorCode.missingDataset, "OEP frame provider has been released", OepResultCode.missingDataset);
          const exactTarget = simulationInstant(target.seconds, target.nanoseconds);
          const wire = successful(this.#backend.evaluate(
            this.#handleHigh,
            this.#handleLow,
            identity.sourceNodeId,
            OepEvaluationModeCode.rootSsb,
            encodeSimulationInstant(exactTarget),
          ), "source-center frame evaluation");
          return evaluatedState(wire, ROOT_REFERENCE_FRAME_ID);
        },
      }),
    });
    return Object.freeze({
      identity,
      provider,
      release: () => {
        if (released) return;
        this.#releaseReference();
        released = true;
      },
    });
  }

  unload(): void {
    this.#assertLoaded();
    successful(this.#backend.unload(this.#handleHigh, this.#handleLow), "unload");
    this.#unloaded = true;
  }
}

export async function loadOepDataset(kind: BackendKind, input: OepLoadInput): Promise<OepDataset> {
  const normalized = normalizeInput(input);
  const backend = await loadEphemerisBackend(kind);
  const wire = successful(backend.load(encodeLoadPayload(normalized)), "load");
  return new OepDataset(backend, normalized, wire);
}
