import { ORBIT_ENGINE_THREE_PACKAGE_NAME } from "orbit-engine-three";
import { presentationPackageInfo } from "orbit-engine-three/presentation";
import { Vector3 } from "three";

const status = document.querySelector<HTMLParagraphElement>("#status");

try {
  const vector = new Vector3(1, 2, 3);
  if (vector.length() !== Math.sqrt(14)) throw new Error("Three.js peer import failed");
  if (status !== null) {
    status.dataset.orbitEngineThreeSmoke = "ready";
    status.textContent = `ready:${ORBIT_ENGINE_THREE_PACKAGE_NAME}:${presentationPackageInfo.entryPoint}:three:${vector.length()}`;
  }
} catch (error) {
  if (status !== null) {
    status.dataset.orbitEngineThreeSmoke = "error";
    status.textContent = `error:${error instanceof Error ? error.message : String(error)}`;
  }
}
