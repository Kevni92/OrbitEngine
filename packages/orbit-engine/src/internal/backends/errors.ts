import type { BackendKind } from "./contract.js";

export class BackendUnavailableError extends Error {
  readonly backend: BackendKind;

  constructor(message: string, options: { cause?: unknown; backend?: BackendKind } = {}) {
    super(message, { cause: options.cause });
    this.name = "BackendUnavailableError";
    this.backend = options.backend ?? "native";
  }
}

export class BackendInitializationError extends Error {
  readonly backend: BackendKind;

  constructor(backend: BackendKind, message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "BackendInitializationError";
    this.backend = backend;
  }
}

export function isBackendUnavailableError(error: unknown): error is BackendUnavailableError {
  return error instanceof BackendUnavailableError;
}
