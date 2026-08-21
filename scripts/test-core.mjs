import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const buildDirectory = path.join(root, "build", "core");
const result = spawnSync("ctest", ["--test-dir", buildDirectory, "-C", "Release", "--output-on-failure"], {
  cwd: root,
  stdio: "inherit",
});

process.exit(result.status ?? 1);
