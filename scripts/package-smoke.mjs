import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageDirectory = path.join(root, "packages", "orbit-engine");
const tempDirectory = os.tmpdir();
const smokeDirectory = path.join(tempDirectory, `orbit-engine-smoke-${Date.now()}`);
const consumerDirectory = path.join(smokeDirectory, "consumer");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const requireAllArtifacts = process.env.ORBIT_ENGINE_SMOKE_REQUIRE_ALL === "true";

mkdirSync(consumerDirectory, { recursive: true });

function runPnpm(args, cwd) {
  return execFileSync(pnpm, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
}

function runNode(args) {
  execFileSync(process.execPath, args, { cwd: consumerDirectory, stdio: "inherit" });
}

runPnpm(["--filter", "orbit-engine", "pack", "--pack-destination", smokeDirectory], root);

const tarball = readdirSync(smokeDirectory)
  .filter((entry) => entry.endsWith(".tgz"))
  .map((entry) => path.join(smokeDirectory, entry))[0];

if (!tarball) {
  throw new Error("pnpm pack did not produce an npm tarball");
}

writeFileSync(
  path.join(consumerDirectory, "package.json"),
  JSON.stringify({
    name: "orbit-engine-smoke-consumer",
    private: true,
    type: "module",
    dependencies: { "orbit-engine": `file:${tarball.replaceAll("\\", "/")}` },
  }, null, 2),
);
runPnpm(["install", "--ignore-scripts", "--no-lockfile"], consumerDirectory);

const installedPackage = path.join(consumerDirectory, "node_modules", "orbit-engine");
const hasWindowsNative = existsSync(path.join(installedPackage, "prebuilds", "win32-x64", "orbit_engine.node"));
const hasLinuxNative = existsSync(path.join(installedPackage, "prebuilds", "linux-x64", "orbit_engine.node"));
const hasNative = hasWindowsNative || hasLinuxNative;
const hasWasm = existsSync(path.join(installedPackage, "wasm", "orbit_engine_wasm.js"))
  && existsSync(path.join(installedPackage, "wasm", "orbit_engine_wasm.wasm"));

if (requireAllArtifacts && (!hasWindowsNative || !hasLinuxNative || !hasWasm)) {
  throw new Error(
    `packed package is missing required artifacts (win32=${hasWindowsNative}, linux=${hasLinuxNative}, wasm=${hasWasm})`,
  );
}

runNode(["--input-type=module", "-e", [
  "import { OrbitEngine } from 'orbit-engine';",
  "const engine = await OrbitEngine.create({ backend: 'native' });",
  "if (engine.backend !== 'native' || engine.health().healthCode !== 42) process.exit(1);",
].join("\n")]);

if (hasWasm) {
  runNode(["--input-type=module", "-e", [
    "import { OrbitEngine } from 'orbit-engine';",
    "const engine = await OrbitEngine.create({ backend: 'wasm' });",
    "if (engine.backend !== 'wasm' || engine.health().healthCode !== 42) process.exit(1);",
  ].join("\n")]);
}

console.log(`package smoke test passed in ${smokeDirectory}`);
