import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { EphemerisBackend } from "./ephemeris-backend.js";
import {
  validateOepDatasetInfoWire,
  validateOepEvaluationWire,
  validateOepSourceInfoWire,
} from "./oep-wire.js";
import type { TimeWire } from "./time-wire.js";
import { BackendUnavailableError } from "./backends/errors.js";

const require = createRequire(import.meta.url);
const SUPPORTED_NATIVE_TUPLES = new Set(["win32-x64", "linux-x64"]);

interface RawNativeEphemerisBinding {
  loadOep(value: Uint8Array): unknown;
  retainOep(handleHigh: number, handleLow: number): unknown;
  releaseOepReference(handleHigh: number, handleLow: number): unknown;
  unloadOep(handleHigh: number, handleLow: number): unknown;
  oepSourceInfo(handleHigh: number, handleLow: number, sourceNodeId: number): unknown;
  evaluateOep(handleHigh: number, handleLow: number, sourceNodeId: number, mode: number, target: TimeWire): unknown;
}

function artifactPath(): string {
  if (typeof process === "undefined" || !process.versions?.node) {
    throw new BackendUnavailableError("Native ephemeris backend requires Node.js", { backend: "native" });
  }
  const tuple = `${process.platform}-${process.arch}`;
  if (!SUPPORTED_NATIVE_TUPLES.has(tuple)) {
    throw new BackendUnavailableError(`Native ephemeris backend is not available for ${tuple}`, { backend: "native" });
  }
  const url = new URL(`../../../prebuilds/${tuple}/orbit_engine_oep.node`, import.meta.url);
  const path = fileURLToPath(url);
  if (!existsSync(path)) {
    throw new BackendUnavailableError(`Native ephemeris artifact is missing for ${tuple}`, { backend: "native" });
  }
  return path;
}

function rawBinding(value: unknown): RawNativeEphemerisBinding {
  if (typeof value !== "object" || value === null) throw new TypeError("Native ephemeris addon returned an invalid module");
  const candidate = value as Record<string, unknown>;
  for (const name of ["loadOep", "retainOep", "releaseOepReference", "unloadOep", "oepSourceInfo", "evaluateOep"]) {
    if (typeof candidate[name] !== "function") throw new TypeError(`Native ephemeris addon is missing ${name}`);
  }
  return value as RawNativeEphemerisBinding;
}

export async function loadNativeEphemerisBackend(): Promise<EphemerisBackend> {
  let loaded: unknown;
  try {
    loaded = require(artifactPath());
  } catch (cause) {
    throw new BackendUnavailableError("Native ephemeris backend binary could not be loaded", {
      backend: "native",
      cause,
    });
  }
  const raw = rawBinding(loaded);
  return Object.freeze({
    kind: "native" as const,
    load: (payload: Uint8Array) => validateOepDatasetInfoWire(raw.loadOep(payload)),
    retain: (high: number, low: number) => validateOepDatasetInfoWire(raw.retainOep(high, low)),
    releaseReference: (high: number, low: number) => validateOepDatasetInfoWire(raw.releaseOepReference(high, low)),
    unload: (high: number, low: number) => validateOepDatasetInfoWire(raw.unloadOep(high, low)),
    sourceInfo: (high: number, low: number, sourceNodeId: number) =>
      validateOepSourceInfoWire(raw.oepSourceInfo(high, low, sourceNodeId)),
    evaluate: (high: number, low: number, sourceNodeId: number, mode: number, target: TimeWire) =>
      validateOepEvaluationWire(raw.evaluateOep(high, low, sourceNodeId, mode, target)),
  });
}
