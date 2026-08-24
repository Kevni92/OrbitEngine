import assert from "node:assert/strict";
import test from "node:test";

test("public root and presentation entry points import without browser side effects", async () => {
  const root = await import("../dist/index.js");
  const presentation = await import("../dist/presentation.js");

  assert.equal(root.ORBIT_ENGINE_THREE_PACKAGE_NAME, "orbit-engine-three");
  assert.equal(root.ORBIT_ENGINE_THREE_PACKAGE_VERSION, "0.1.0");
  assert.equal(presentation.ORBIT_ENGINE_THREE_PRESENTATION_ENTRY, "orbit-engine-three/presentation");
  assert.deepEqual(presentation.presentationPackageInfo, {
    packageName: "orbit-engine-three",
    entryPoint: "orbit-engine-three/presentation",
  });
  assert.equal("window" in globalThis, false);
  assert.equal("document" in globalThis, false);
});
