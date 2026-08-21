import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testsRoot = path.join(root, "packages", "orbit-engine", "dist", "tests");
const requested = process.argv[2];

const locations = {
  unit: ["unit"],
  native: ["integration", "native.test.js"],
  wasm: ["integration", "wasm.test.js"],
  parity: ["parity"],
};

if (!requested || !(requested in locations)) {
  throw new Error(`Unknown test group: ${requested ?? "<missing>"}`);
}

function collectJavaScriptTests(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return collectJavaScriptTests(entryPath);
    }
    return entry.isFile() && entry.name.endsWith(".test.js") ? [entryPath] : [];
  });
}

const location = locations[requested];
const target = path.join(testsRoot, ...location);
const files = target.endsWith(".js") ? [target] : collectJavaScriptTests(target);
if (files.length === 0) {
  throw new Error(`No compiled tests found for ${requested}`);
}

const result = spawnSync(process.execPath, ["--test", ...files], {
  cwd: root,
  stdio: "inherit",
});

process.exit(result.status ?? 1);
