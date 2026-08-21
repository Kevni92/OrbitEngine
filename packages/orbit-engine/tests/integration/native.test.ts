import assert from "node:assert/strict";
import test from "node:test";

import { OrbitEngine } from "../../src/index.js";

test("real native backend initializes and reports the shared core health", async () => {
  const engine = await OrbitEngine.create({ backend: "native" });
  const health = engine.health();

  assert.equal(engine.backend, "native");
  assert.deepEqual(health, {
    backend: "native",
    protocolVersion: 1,
    coreVersion: 1,
    healthCode: 42,
  });
});
