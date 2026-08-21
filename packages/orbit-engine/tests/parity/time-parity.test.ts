import test from "node:test";

import { loadNativeBackend } from "../../src/internal/backends/native.js";
import { loadWasmBackend } from "../../src/internal/backends/wasm.js";
import { assertObjectRoundTrip } from "../shared/object-roundtrip.js";
import { assertTimeRoundTrip } from "../shared/time-roundtrip.js";

for (const [name, load] of [["native", loadNativeBackend], ["wasm", loadWasmBackend]] as const) {
  test("exact time and binary64 round-trip parity: " + name, async () => {
    const backend = await load();
    assertTimeRoundTrip(backend);
    assertObjectRoundTrip(backend);
  });
}
