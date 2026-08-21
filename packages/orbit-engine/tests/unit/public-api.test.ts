import assert from "node:assert/strict";
import test from "node:test";

import { OrbitEngine } from "../../src/index.js";

test("public API validates backend options before loading a backend", async () => {
  await assert.rejects(
    OrbitEngine.create({ backend: "invalid" as never }),
    (error: unknown) => error instanceof TypeError && error.message.includes("Unsupported"),
  );
});

test("public API exposes only the backend-neutral engine surface", () => {
  assert.equal(typeof OrbitEngine.create, "function");
  assert.equal("nativeLoader" in OrbitEngine, false);
  assert.equal("wasmLoader" in OrbitEngine, false);
});
