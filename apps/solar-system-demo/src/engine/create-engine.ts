import { OrbitEngine } from "orbit-engine";

export async function createDemoEngine(): Promise<OrbitEngine> {
  return OrbitEngine.create({ backend: "wasm" });
}
