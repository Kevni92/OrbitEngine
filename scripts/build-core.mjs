import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const buildDirectory = path.join(root, "build", "core");

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run("cmake", [
  "-S", root,
  "-B", buildDirectory,
  "-DORBIT_ENGINE_BUILD_TESTS=ON",
  "-DORBIT_ENGINE_BUILD_NODE=OFF",
  "-DORBIT_ENGINE_BUILD_WASM=OFF",
]);
run("cmake", ["--build", buildDirectory, "--config", "Release"]);
