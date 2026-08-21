import assert from "node:assert/strict";
import test from "node:test";

import { OrbitEngine } from "../../src/index.js";
import { loadNativeBackend } from "../../src/internal/backends/native.js";
import { assertObjectRoundTrip } from "../shared/object-roundtrip.js";
import { assertFrameRoundTrip } from "../shared/frame-roundtrip.js";
import { assertTimeRoundTrip } from "../shared/time-roundtrip.js";

test("real native backend initializes and reports the shared core health", async () => {
  const engine = await OrbitEngine.create({ backend: "native" });
  const health = engine.health();

  assert.equal(engine.backend, "native");
  assert.deepEqual(health, {
    backend: "native",
    protocolVersion: 4,
    coreVersion: 1,
    healthCode: 42,
  });

  const backend = await loadNativeBackend();
  assertTimeRoundTrip(backend);
  assertObjectRoundTrip(backend);
  assertFrameRoundTrip(backend);
});
