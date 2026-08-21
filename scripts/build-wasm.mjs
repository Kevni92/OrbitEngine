import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const buildDirectory = path.join(root, "build", "wasm");
const outputDirectory = path.join(root, "packages", "orbit-engine", "wasm");

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32" && command === "emcmake",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run("emcmake", [
  "cmake", "-S", root,
  "-B", buildDirectory,
  "-DORBIT_ENGINE_BUILD_TESTS=OFF",
  "-DORBIT_ENGINE_BUILD_NODE=OFF",
  "-DORBIT_ENGINE_BUILD_WASM=ON",
  `-DORBIT_ENGINE_WASM_OUTPUT_DIR=${outputDirectory}`,
]);
run("cmake", ["--build", buildDirectory, "--config", "Release"]);
