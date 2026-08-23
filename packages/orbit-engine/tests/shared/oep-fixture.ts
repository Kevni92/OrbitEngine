import {
  OepRepresentation,
  propagationTimeInterval,
  revisionId,
  simulationInstant,
  type OepLoadInput,
} from "../../src/index.js";

const SHARD_SHA256 = "df9b3ecfa78334c3b0c625174623d69880390f8d050e89d151377e9ce8c6adbf";
const MANIFEST_SHA256 = "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20";
const TWO_TO_32 = 4_294_967_296;

class Writer {
  readonly bytes: Uint8Array;
  readonly view: DataView;
  offset = 0;

  constructor(length: number) {
    this.bytes = new Uint8Array(length);
    this.view = new DataView(this.bytes.buffer);
  }

  raw(value: string): void {
    for (let index = 0; index < value.length; index += 1) this.bytes[this.offset++] = value.charCodeAt(index);
  }

  u16(value: number): void { this.view.setUint16(this.offset, value, true); this.offset += 2; }
  u32(value: number): void { this.view.setUint32(this.offset, value, true); this.offset += 4; }
  f64(value: number): void { this.view.setFloat64(this.offset, value, true); this.offset += 8; }

  time(seconds: number): void {
    const high = Math.floor(seconds / TWO_TO_32);
    const low = seconds - high * TWO_TO_32;
    this.view.setInt32(this.offset, high, true);
    this.offset += 4;
    this.u32(low);
    this.u32(0);
  }

  coefficients(values: readonly number[]): void {
    for (const value of values) this.f64(value);
  }
}

export function syntheticOepShard(): Uint8Array {
  const writer = new Writer(296);
  writer.raw("OEPB");
  writer.u16(1);
  writer.u16(0);
  writer.u32(296);
  writer.u32(2);
  writer.u32(0);
  writer.u32(0);

  writer.u32(1);
  writer.u16(1);
  writer.u16(3);
  writer.time(-10);
  writer.time(10);
  writer.f64(0);
  writer.f64(10);
  writer.u32(2);
  writer.u32(152);
  writer.u32(48);
  writer.u32(0);

  writer.u32(2);
  writer.u16(2);
  writer.u16(6);
  writer.time(-5);
  writer.time(5);
  writer.f64(0);
  writer.f64(5);
  writer.u32(2);
  writer.u32(200);
  writer.u32(96);
  writer.u32(0);

  writer.coefficients([100, 20]);
  writer.coefficients([0, 0]);
  writer.coefficients([0, 0]);
  writer.coefficients([10, 5]);
  writer.coefficients([20, 0]);
  writer.coefficients([30, 0]);
  writer.coefficients([1, 0.5]);
  writer.coefficients([2, 0]);
  writer.coefficients([3, 0]);

  if (writer.offset !== writer.bytes.byteLength) throw new Error("Synthetic OEP fixture size mismatch");
  return writer.bytes;
}

export function syntheticOepInput(): OepLoadInput {
  return Object.freeze({
    manifestSha256: MANIFEST_SHA256,
    manifest: Object.freeze({
      schemaVersion: 1 as const,
      datasetId: "synthetic-runtime-test",
      datasetVersion: "1",
      normalizationPolicyVersion: "test-v1",
      canonicalTimeScale: "TDB" as const,
      canonicalEpoch: "J2000 TDB" as const,
      canonicalSpatialFrame: "SSB + ICRS/ICRF-aligned" as const,
      sourceNodes: Object.freeze([
        Object.freeze({
          id: 1,
          representation: OepRepresentation.positionChebyshev,
          validity: propagationTimeInterval(simulationInstant(-10), simulationInstant(10)),
          sourceRevision: revisionId("7"),
          normalizedAxes: "ICRS/ICRF-aligned" as const,
          normalizationErrorBudget: Object.freeze({ positionMeters: 0.01, velocityMetersPerSecond: 0.001 }),
        }),
        Object.freeze({
          id: 2,
          center: 1,
          representation: OepRepresentation.stateChebyshev,
          validity: propagationTimeInterval(simulationInstant(-5), simulationInstant(5)),
          sourceRevision: revisionId("11"),
          normalizedAxes: "ICRS/ICRF-aligned" as const,
          normalizationErrorBudget: Object.freeze({ positionMeters: 0.02, velocityMetersPerSecond: 0.002 }),
        }),
      ]),
      shards: Object.freeze([Object.freeze({ id: "system", sha256: SHARD_SHA256 })]),
    }),
    shards: Object.freeze([Object.freeze({ id: "system", bytes: syntheticOepShard() })]),
  });
}

export function corruptedSyntheticOepInput(): OepLoadInput {
  const base = syntheticOepInput();
  const bytes = new Uint8Array(base.shards[0]!.bytes);
  bytes[bytes.length - 1] ^= 0xff;
  return Object.freeze({ ...base, shards: Object.freeze([Object.freeze({ id: "system", bytes })]) });
}
