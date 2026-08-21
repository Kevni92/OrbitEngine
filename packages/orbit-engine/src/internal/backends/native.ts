import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { Backend } from "./contract.js";
import { BackendInitializationError, BackendUnavailableError } from "./errors.js";
import { backendFromRawBinding } from "./binding.js";

const require = createRequire(import.meta.url);
const SUPPORTED_NATIVE_TUPLES = new Set(["win32-x64", "linux-x64"]);

function getNativeArtifactPath(): string {
  if (typeof process === "undefined" || !process.versions?.node) {
    throw new BackendUnavailableError("Native backend requires a Node.js runtime", {
      backend: "native",
    });
  }

  const tuple = `${process.platform}-${process.arch}`;
  if (!SUPPORTED_NATIVE_TUPLES.has(tuple)) {
    throw new BackendUnavailableError(`Native backend is not available for ${tuple}`, {
      backend: "native",
    });
  }

  const artifactUrl = new URL(`../../../../prebuilds/${tuple}/orbit_engine.node`, import.meta.url);
  const artifactPath = fileURLToPath(artifactUrl);
  if (!existsSync(artifactPath)) {
    throw new BackendUnavailableError(`Native backend artifact is missing for ${tuple}`, {
      backend: "native",
    });
  }

  return artifactPath;
}

export async function loadNativeBackend(): Promise<Backend> {
  const artifactPath = getNativeArtifactPath();

  let raw: unknown;
  try {
    raw = require(artifactPath);
  } catch (cause) {
    throw new BackendUnavailableError("Native backend binary could not be loaded", {
      backend: "native",
      cause,
    });
  }

  try {
    return await backendFromRawBinding("native", raw);
  } catch (error) {
    if (error instanceof BackendInitializationError) {
      throw error;
    }

    throw new BackendInitializationError("native", "Native backend initialization failed", error);
  }
}
