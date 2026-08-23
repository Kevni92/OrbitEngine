import type { TimeWire } from "../time-wire.js";
import type { ObjectWire } from "../object-wire.js";
import type { FrameWire } from "../frame-wire.js";
import type { PropagationWire } from "../propagation-wire.js";
import type { RegistryWire } from "../registry-wire.js";
import type { FrameRegistryWire } from "../frame-registry-wire.js";
import type { TwoBodyWire } from "../two-body-wire.js";

export const BINDING_PROTOCOL_VERSION = 9;

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
  roundTripRegistry(value: RegistryWire): RegistryWire;
  roundTripFrameRegistry(value: FrameRegistryWire): FrameRegistryWire;
  roundTripTwoBody(value: TwoBodyWire): TwoBodyWire;
}

export interface RawBackendBinding {
  readonly protocolVersion: unknown;
  initialize(): unknown;
  roundTripTime(value: unknown): unknown;
  roundTripDouble(value: unknown): unknown;
  roundTripObject(value: unknown): unknown;
  roundTripFrame(value: unknown): unknown;
  roundTripPropagation(value: unknown): unknown;
  roundTripRegistry(value: unknown): unknown;
  roundTripFrameRegistry(value: unknown): unknown;
  roundTripTwoBody(value: unknown): unknown;
}

export interface RawInitializationResult {
  readonly coreVersion: unknown;
  readonly healthCode: unknown;
}
