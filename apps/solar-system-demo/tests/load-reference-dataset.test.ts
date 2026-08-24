import assert from "node:assert/strict";
import test from "node:test";
import { loadSolarSystemReferenceDataset } from "../src/scenario/load-reference-dataset.js";

const fakeEngine = {} as Parameters<typeof loadSolarSystemReferenceDataset>[0];

test("reference dataset requests use normal browser cache semantics", async () => {
  const originalFetch = globalThis.fetch;
  const requests: RequestInit[] = [];
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(init ?? {});
    throw new Error("test fetch stop");
  }) as typeof fetch;
  try {
    await assert.rejects(loadSolarSystemReferenceDataset(fakeEngine), /test fetch stop/);
    assert.deepEqual(requests, [{ cache: "default" }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("concurrent reference dataset loads share one in-flight request", async () => {
  const originalFetch = globalThis.fetch;
  let requestCount = 0;
  globalThis.fetch = (async () => {
    requestCount += 1;
    throw new Error("test fetch stop");
  }) as typeof fetch;
  try {
    const first = loadSolarSystemReferenceDataset(fakeEngine);
    const second = loadSolarSystemReferenceDataset(fakeEngine);
    assert.strictEqual(first, second);
    await assert.rejects(first, /test fetch stop/);
    assert.equal(requestCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
