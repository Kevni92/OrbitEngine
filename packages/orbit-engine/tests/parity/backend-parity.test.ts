import assert from "node:assert/strict";
import test from "node:test";

import { OrbitEngine, type OrbitEngineBackend } from "../../src/index.js";

for (const backend of ["native", "wasm"] as const satisfies readonly OrbitEngineBackend[]) {
  test(`shared health scenario has equivalent semantics on ${backend}`, async () => {
    const engine = await OrbitEngine.create({ backend });
    const health = engine.health();

    assert.equal(health.backend, backend);
    assert.equal(health.protocolVersion, 1);
    assert.equal(health.coreVersion, 1);
    assert.equal(health.healthCode, 42);
  });
}
