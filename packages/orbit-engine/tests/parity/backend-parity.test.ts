import assert from "node:assert/strict";
import test from "node:test";

import { OrbitEngine, type OrbitEngineBackend } from "../../src/index.js";
import { loadNativeBackend } from "../../src/internal/backends/native.js";
import { loadWasmBackend } from "../../src/internal/backends/wasm.js";
import { assertObjectRoundTrip } from "../shared/object-roundtrip.js";
import { assertFrameRoundTrip } from "../shared/frame-roundtrip.js";
import { assertPropagationRoundTrip } from "../shared/propagation-roundtrip.js";
import { assertRegistryLifecycle } from "../shared/registry-lifecycle.js";

for (const backend of ["native", "wasm"] as const satisfies readonly OrbitEngineBackend[]) {
  test(`shared health scenario has equivalent semantics on ${backend}`, async () => {
    const engine = await OrbitEngine.create({ backend });
    const health = engine.health();

    assert.equal(health.backend, backend);
    assert.equal(health.protocolVersion, 6);
    assert.equal(health.coreVersion, 1);
    assert.equal(health.healthCode, 42);
  });
}

for (const [name, load] of [["native", loadNativeBackend], ["wasm", loadWasmBackend]] as const) {
  test(`object identity and property wire parity has exact semantics on ${name}`, async () => {
    assertObjectRoundTrip(await load());
  });
  test(`reference frame wire parity has exact semantics on ${name}`, async () => {
    assertFrameRoundTrip(await load());
  });
  test(`propagation contract wire parity has exact semantics on ${name}`, async () => {
    assertPropagationRoundTrip(await load());
  });
  test(`object registry lifecycle parity has exact semantics on ${name}`, async () => {
    assertRegistryLifecycle(await load());
  });
}
