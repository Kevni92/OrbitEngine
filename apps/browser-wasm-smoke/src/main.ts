import { OrbitEngine } from "orbit-engine";

const status = document.querySelector<HTMLParagraphElement>("#status");

function setStatus(value: "ready" | "error", message: string): void {
  if (status === null) return;
  status.dataset.orbitEngineSmoke = value;
  status.textContent = message;
}

try {
  const engine = await OrbitEngine.create({ backend: "wasm" });
  const health = engine.health();
  if (health.backend !== "wasm" || health.healthCode !== 42) {
    throw new Error("Unexpected WASM engine health");
  }
  setStatus("ready", `ready:${health.protocolVersion}:${health.coreVersion}:${health.healthCode}`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  setStatus("error", `error:${message}`);
}
