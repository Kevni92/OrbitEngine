import type { TimeWire } from "../time-wire.js";

export const BINDING_PROTOCOL_VERSION = 2;

export type BackendKind = "native" | "wasm";

export interface BackendHealth {
  readonly protocolVersion: number;
  readonly coreVersion: number;
  readonly healthCode: number;
}

export interface Backend {
  readonly kind: BackendKind;
  health(): BackendHealth;
  roundTripTime(value: TimeWire): TimeWire;
  roundTripDouble(value: number): number;
}

export interface RawBackendBinding {
  readonly protocolVersion: unknown;
  initialize(): unknown;
  roundTripTime(value: unknown): unknown;
  roundTripDouble(value: unknown): unknown;
}

export interface RawInitializationResult {
  readonly coreVersion: unknown;
  readonly healthCode: unknown;
}
