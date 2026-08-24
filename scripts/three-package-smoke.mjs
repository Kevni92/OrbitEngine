import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const smokeDirectory = path.join(os.tmpdir(), `orbit-engine-three-smoke-${Date.now()}`);
const compatibleConsumer = path.join(smokeDirectory, "compatible-consumer");
const incompatibleConsumer = path.join(smokeDirectory, "incompatible-consumer");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

mkdirSync(compatibleConsumer, { recursive: true });
mkdirSync(incompatibleConsumer, { recursive: true });

function runPnpm(args, cwd, options = {}) {
  return execFileSync(pnpm, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
    ...options,
  });
}

function runNode(code, cwd) {
  return execFileSync(process.execPath, ["--input-type=module", "-e", code], {
    cwd,
    stdio: "inherit",
  });
}

function packageTarball(packageName) {
  const tarball = readdirSync(smokeDirectory)
    .filter((entry) => entry === `${packageName}-0.1.0.tgz`)
    .map((entry) => path.join(smokeDirectory, entry))[0];
  if (!tarball) throw new Error(`missing tarball for ${packageName}`);
  return tarball;
}

runPnpm(["--filter", "orbit-engine", "pack", "--pack-destination", smokeDirectory], root);
runPnpm(["--filter", "orbit-engine-three", "pack", "--pack-destination", smokeDirectory], root);

const orbitEngineTarball = packageTarball("orbit-engine");
const companionTarball = packageTarball("orbit-engine-three");
const fileDependency = (value) => `file:${value.replaceAll("\\", "/")}`;

writeFileSync(
  path.join(compatibleConsumer, "package.json"),
  JSON.stringify({
    name: "orbit-engine-three-compatible-consumer",
    private: true,
    type: "module",
    dependencies: {
      "orbit-engine": fileDependency(orbitEngineTarball),
      "orbit-engine-three": fileDependency(companionTarball),
      three: "0.185.1",
    },
  }, null, 2),
);
runPnpm(["install", "--ignore-scripts", "--no-lockfile", "--strict-peer-dependencies"], compatibleConsumer);
runNode([
  "import { ORBIT_ENGINE_THREE_PACKAGE_NAME } from 'orbit-engine-three';",
  "import { presentationPackageInfo } from 'orbit-engine-three/presentation';",
  "import { OrbitEngine } from 'orbit-engine';",
  "if (ORBIT_ENGINE_THREE_PACKAGE_NAME !== 'orbit-engine-three') process.exit(1);",
  "if (presentationPackageInfo.entryPoint !== 'orbit-engine-three/presentation') process.exit(1);",
  "if (typeof OrbitEngine.create !== 'function') process.exit(1);",
  "if ('window' in globalThis || 'document' in globalThis) process.exit(1);",
].join("\n"), compatibleConsumer);

writeFileSync(
  path.join(incompatibleConsumer, "package.json"),
  JSON.stringify({
    name: "orbit-engine-three-incompatible-consumer",
    private: true,
    type: "module",
    dependencies: {
      "orbit-engine": fileDependency(orbitEngineTarball),
      "orbit-engine-three": fileDependency(companionTarball),
      three: "0.184.0",
    },
  }, null, 2),
);

let peerInstallRejected = false;
try {
  runPnpm(["install", "--ignore-scripts", "--no-lockfile", "--strict-peer-dependencies"], incompatibleConsumer, { stdio: "pipe" });
} catch {
  peerInstallRejected = true;
}
if (!peerInstallRejected) throw new Error("incompatible Three.js peer range was accepted");

console.log(`orbit-engine-three package smoke test passed in ${smokeDirectory}`);
