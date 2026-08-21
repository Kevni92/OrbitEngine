import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const buildDirectory = path.join(root, "build", "native");
const packageDirectory = path.join(root, "packages", "orbit-engine");
const tuple = `${process.platform}-${process.arch}`;
const outputDirectory = path.join(packageDirectory, "prebuilds", tuple);
const nodeHeadersDirectory = path.dirname(require.resolve("node-api-headers/package.json"));
const addonApiDirectory = path.dirname(require.resolve("node-addon-api"));

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (!new Set(["win32-x64", "linux-x64"]).has(tuple)) {
  console.error(`Native prebuilds are only supported for win32-x64 and linux-x64; got ${tuple}`);
  process.exit(1);
}

run("cmake", [
  "-S", root,
  "-B", buildDirectory,
  "-DORBIT_ENGINE_BUILD_TESTS=OFF",
  "-DORBIT_ENGINE_BUILD_NODE=ON",
  "-DORBIT_ENGINE_BUILD_WASM=OFF",
  `-DORBIT_ENGINE_NODE_INCLUDE_DIR=${path.join(nodeHeadersDirectory, "include")}`,
  `-DORBIT_ENGINE_NODE_ADDON_API_DIR=${addonApiDirectory}`,
  `-DORBIT_ENGINE_NODE_OUTPUT_DIR=${outputDirectory}`,
]);
run("cmake", ["--build", buildDirectory, "--config", "Release"]);
