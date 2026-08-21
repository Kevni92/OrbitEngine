import type { TimeWire } from "../time-wire.js";
import type { ObjectWire } from "../object-wire.js";
import type { FrameWire } from "../frame-wire.js";
import type { PropagationWire } from "../propagation-wire.js";

export const BINDING_PROTOCOL_VERSION = 5;

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
  roundTripObject(value: ObjectWire): ObjectWire;
  roundTripFrame(value: FrameWire): FrameWire;
  roundTripPropagation(value: PropagationWire): PropagationWire;
}

export interface RawBackendBinding {
  readonly protocolVersion: unknown;
  initialize(): unknown;
  roundTripTime(value: unknown): unknown;
  roundTripDouble(value: unknown): unknown;
  roundTripObject(value: unknown): unknown;
  roundTripFrame(value: unknown): unknown;
  roundTripPropagation(value: unknown): unknown;
}

export interface RawInitializationResult {
  readonly coreVersion: unknown;
  readonly healthCode: unknown;
}
