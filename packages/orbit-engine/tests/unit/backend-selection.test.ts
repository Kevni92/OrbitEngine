import assert from "node:assert/strict";
import test from "node:test";

import type { Backend } from "../../src/internal/backends/contract.js";
import { backendFromRawBinding } from "../../src/internal/backends/binding.js";
import { BackendInitializationError, BackendUnavailableError } from "../../src/internal/backends/errors.js";
import { initializeBackend } from "../../src/internal/backends/selection.js";

function fakeBackend(kind: "native" | "wasm"): Backend {
  return {
    kind,
    health: () => ({ protocolVersion: 4, coreVersion: 1, healthCode: 42 }),
    roundTripTime: (value) => value,
    roundTripDouble: (value) => value,
    roundTripObject: (value) => value,
    roundTripFrame: (value) => value,
    roundTripPropagation: (value) => value,
    roundTripRegistry: (value) => value,
    roundTripFrameRegistry: (value) => value,
  };
}

test("auto prefers native when native is available", async () => {
  const calls: string[] = [];
  const backend = await initializeBackend("auto", {
    native: async () => {
      calls.push("native");
      return fakeBackend("native");
    },
    wasm: async () => {
      calls.push("wasm");
      return fakeBackend("wasm");
    },
  });

  assert.equal(backend.kind, "native");
  assert.deepEqual(calls, ["native"]);
});

test("auto falls back only for native unavailability", async () => {
  const calls: string[] = [];
  const backend = await initializeBackend("auto", {
    native: async () => {
      calls.push("native");
      throw new BackendUnavailableError("missing native artifact", { backend: "native" });
    },
    wasm: async () => {
      calls.push("wasm");
      return fakeBackend("wasm");
    },
  });

  assert.equal(backend.kind, "wasm");
  assert.deepEqual(calls, ["native", "wasm"]);
});

test("auto does not hide native protocol or initialization failures", async () => {
  let wasmCalled = false;
  const expected = new BackendInitializationError("native", "protocol mismatch");

  await assert.rejects(
    initializeBackend("auto", {
      native: async () => {
        throw expected;
      },
      wasm: async () => {
        wasmCalled = true;
        return fakeBackend("wasm");
      },
    }),
    (error: unknown) => error === expected,
  );

  assert.equal(wasmCalled, false);
});

test("explicit native never falls back", async () => {
  let wasmCalled = false;

  await assert.rejects(
    initializeBackend("native", {
      native: async () => {
        throw new BackendUnavailableError("unsupported tuple", { backend: "native" });
      },
      wasm: async () => {
        wasmCalled = true;
        return fakeBackend("wasm");
      },
    }),
    BackendUnavailableError,
  );

  assert.equal(wasmCalled, false);
});

test("explicit wasm does not probe native", async () => {
  let nativeCalled = false;

  const backend = await initializeBackend("wasm", {
    native: async () => {
      nativeCalled = true;
      return fakeBackend("native");
    },
    wasm: async () => fakeBackend("wasm"),
  });

  assert.equal(backend.kind, "wasm");
  assert.equal(nativeCalled, false);
});

test("binding handshake rejects a mismatched protocol", async () => {
  await assert.rejects(
    backendFromRawBinding("native", {
      protocolVersion: 999,
      initialize: () => ({ coreVersion: 1, healthCode: 42 }),
      roundTripTime: (value: unknown) => value,
      roundTripDouble: (value: unknown) => value,
      roundTripObject: (value: unknown) => value,
      roundTripFrame: (value: unknown) => value,
      roundTripPropagation: (value: unknown) => value,
      roundTripRegistry: (value: unknown) => value,
      roundTripFrameRegistry: (value: unknown) => value,
    }),
    (error: unknown) => error instanceof BackendInitializationError
      && error.message.includes("protocol mismatch"),
  );
});
