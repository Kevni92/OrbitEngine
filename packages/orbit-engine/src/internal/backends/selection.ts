import type { Backend, BackendKind } from "./contract.js";
import { BackendInitializationError, BackendUnavailableError, isBackendUnavailableError } from "./errors.js";

export type BackendPreference = "auto" | BackendKind;

export interface BackendLoaders {
  native: () => Promise<Backend>;
  wasm: () => Promise<Backend>;
}

const defaultLoaders: BackendLoaders = {
  async native() {
    try {
      const module = await import("./native.js");
      return await module.loadNativeBackend();
    } catch (error) {
      if (error instanceof BackendUnavailableError || error instanceof BackendInitializationError) {
        throw error;
      }

      throw new BackendUnavailableError("Native backend is unavailable", {
        backend: "native",
        cause: error,
      });
    }
  },
  async wasm() {
    try {
      const module = await import("./wasm.js");
      return await module.loadWasmBackend();
    } catch (error) {
      if (error instanceof BackendInitializationError) {
        throw error;
      }

      throw new BackendInitializationError("wasm", "WASM backend initialization failed", error);
    }
  },
};

export async function initializeBackend(
  preference: BackendPreference,
  loaders: BackendLoaders = defaultLoaders,
): Promise<Backend> {
  if (preference === "native") {
    return loaders.native();
  }

  if (preference === "wasm") {
    return loaders.wasm();
  }

  try {
    return await loaders.native();
  } catch (error) {
    if (!isBackendUnavailableError(error)) {
      throw error;
    }
  }

  return loaders.wasm();
}
