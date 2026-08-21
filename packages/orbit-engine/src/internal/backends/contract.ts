export const BINDING_PROTOCOL_VERSION = 1;

export type BackendKind = "native" | "wasm";

export interface BackendHealth {
  readonly protocolVersion: number;
  readonly coreVersion: number;
  readonly healthCode: number;
}

export interface Backend {
  readonly kind: BackendKind;
  health(): BackendHealth;
}

export interface RawBackendBinding {
  readonly protocolVersion: unknown;
  initialize(): unknown;
}

export interface RawInitializationResult {
  readonly coreVersion: unknown;
  readonly healthCode: unknown;
}
