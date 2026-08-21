import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testsRoot = path.join(root, "dist-test", "tests");

function collectTests(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectTests(entryPath);
    return entry.isFile() && entry.name.endsWith(".test.js") ? [entryPath] : [];
  });
}

const tests = collectTests(testsRoot);
if (tests.length === 0) throw new Error("No compiled demo tests found");
const result = spawnSync(process.execPath, ["--test", ...tests], { cwd: root, stdio: "inherit" });
process.exit(result.status ?? 1);
