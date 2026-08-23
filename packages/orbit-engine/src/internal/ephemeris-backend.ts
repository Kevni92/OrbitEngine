import type { BackendKind } from "./backends/contract.js";
import type { TimeWire } from "./time-wire.js";
import type {
  OepDatasetInfoWire,
  OepEvaluationWire,
  OepSourceInfoWire,
} from "./oep-wire.js";

export interface EphemerisBackend {
  readonly kind: BackendKind;
  load(payload: Uint8Array): OepDatasetInfoWire;
  retain(handleHigh: number, handleLow: number): OepDatasetInfoWire;
  releaseReference(handleHigh: number, handleLow: number): OepDatasetInfoWire;
  unload(handleHigh: number, handleLow: number): OepDatasetInfoWire;
  sourceInfo(handleHigh: number, handleLow: number, sourceNodeId: number): OepSourceInfoWire;
  evaluate(
    handleHigh: number,
    handleLow: number,
    sourceNodeId: number,
    evaluationModeCode: number,
    target: TimeWire,
  ): OepEvaluationWire;
}

export async function loadEphemerisBackend(kind: BackendKind): Promise<EphemerisBackend> {
  if (kind === "native") {
    const module = await import("./ephemeris-native.js");
    return module.loadNativeEphemerisBackend();
  }
  const module = await import("./ephemeris-wasm.js");
  return module.loadWasmEphemerisBackend();
}
