import {
  BINDING_PROTOCOL_VERSION,
  type Backend,
  type BackendHealth,
  type BackendKind,
  type RawBackendBinding,
  type RawInitializationResult,
} from "./contract.js";
import { BackendInitializationError } from "./errors.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asInteger(value: unknown, field: string, backend: BackendKind): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new BackendInitializationError(backend, `${backend} binding returned an invalid ${field}`);
  }

  return value;
}

export async function backendFromRawBinding(
  kind: BackendKind,
  raw: unknown,
): Promise<Backend> {
  if (!isRecord(raw) || typeof raw.initialize !== "function") {
    throw new BackendInitializationError(kind, `${kind} binding is missing its initialization surface`);
  }

  const protocolVersion = asInteger(raw.protocolVersion, "protocol version", kind);
  if (protocolVersion !== BINDING_PROTOCOL_VERSION) {
    throw new BackendInitializationError(
      kind,
      `${kind} binding protocol mismatch: expected ${BINDING_PROTOCOL_VERSION}, received ${protocolVersion}`,
    );
  }

  let initialized: unknown;
  try {
    initialized = await raw.initialize();
  } catch (cause) {
    throw new BackendInitializationError(kind, `${kind} backend initialization failed`, cause);
  }

  if (!isRecord(initialized)) {
    throw new BackendInitializationError(kind, `${kind} binding returned an invalid initialization result`);
  }

  const result = initialized as unknown as RawInitializationResult;
  const health: BackendHealth = {
    protocolVersion,
    coreVersion: asInteger(result.coreVersion, "core version", kind),
    healthCode: asInteger(result.healthCode, "health code", kind),
  };

  return {
    kind,
    health: () => health,
  };
}
