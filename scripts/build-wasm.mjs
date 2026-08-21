import fs from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const buildDirectory = path.join(root, "build", "wasm");
const outputDirectory = path.join(root, "packages", "orbit-engine", "wasm");

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    env,
    shell: process.platform === "win32" && command === "emcmake",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const emcmakeCommand = process.platform === "win32"
  ? (process.env.EMSDK_PYTHON ?? "python")
  : "emcmake";
const emsdkDirectory = process.env.EMSDK ?? path.join(root, "emsdk");
const emcmakeArgs = process.platform === "win32"
  ? [path.join(emsdkDirectory, "upstream", "emscripten", "emcmake.py")]
  : [];

function findExecutableOnPath(name) {
  const lookupCommand = process.platform === "win32" ? "where.exe" : "which";
  const result = spawnSync(lookupCommand, [name], { encoding: "utf8" });
  if (result.status !== 0 || !result.stdout) {
    return undefined;
  }
  return result.stdout.split(/\r?\n/).find(Boolean)?.trim();
}

function findNinja() {
  const candidates = [process.env.CMAKE_MAKE_PROGRAM, process.env.NINJA];
  const pathNinja = findExecutableOnPath("ninja");
  if (pathNinja) {
    candidates.push(pathNinja);
  }

  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    const wingetPackages = path.join(
      process.env.LOCALAPPDATA,
      "Microsoft",
      "WinGet",
      "Packages",
    );
    if (fs.existsSync(wingetPackages)) {
      for (const entry of fs.readdirSync(wingetPackages, { withFileTypes: true })) {
        if (entry.isDirectory() && entry.name.toLowerCase().startsWith("ninja-build.ninja_")) {
          candidates.push(path.join(wingetPackages, entry.name, "ninja.exe"));
        }
      }
    }
  }

  return candidates
    .filter(Boolean)
    .map((candidate) => path.resolve(candidate))
    .find((candidate) => fs.existsSync(candidate));
}

const ninjaPath = process.platform === "win32" ? findNinja() : undefined;
const generatorArgs = ninjaPath
  ? ["-G", "Ninja", `-DCMAKE_MAKE_PROGRAM=${ninjaPath}`]
  : [];
const wasmEnvironment = { ...process.env };
if (ninjaPath) {
  wasmEnvironment.PATH = [path.dirname(ninjaPath), process.env.PATH]
    .filter(Boolean)
    .join(path.delimiter);
}

run(emcmakeCommand, [
  ...emcmakeArgs,
  "cmake", "-S", root,
  "-B", buildDirectory,
  "-DORBIT_ENGINE_BUILD_TESTS=OFF",
  "-DORBIT_ENGINE_BUILD_NODE=OFF",
  "-DORBIT_ENGINE_BUILD_WASM=ON",
  `-DORBIT_ENGINE_WASM_OUTPUT_DIR=${outputDirectory}`,
  ...generatorArgs,
], wasmEnvironment);
run("cmake", ["--build", buildDirectory, "--config", "Release"], wasmEnvironment);
