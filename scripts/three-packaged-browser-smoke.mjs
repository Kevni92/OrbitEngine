import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const smokeDirectory = path.join(os.tmpdir(), `orbit-engine-three-browser-package-${Date.now()}`);
const consumerDirectory = path.join(smokeDirectory, "consumer");
const sourceDirectory = path.join(root, "apps", "orbit-engine-three-browser-smoke");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

mkdirSync(path.join(consumerDirectory, "src"), { recursive: true });
mkdirSync(path.join(consumerDirectory, "tests"), { recursive: true });

function runPnpm(args, cwd) {
  return execFileSync(pnpm, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
}

function tarball(packageName) {
  const value = path.join(smokeDirectory, `${packageName}-0.1.0.tgz`);
  return value;
}

runPnpm(["--filter", "orbit-engine", "pack", "--pack-destination", smokeDirectory], root);
runPnpm(["--filter", "orbit-engine-three", "pack", "--pack-destination", smokeDirectory], root);

for (const file of ["index.html", "vite.config.ts", "playwright.config.ts"]) {
  copyFileSync(path.join(sourceDirectory, file), path.join(consumerDirectory, file));
}
for (const file of ["main.ts"]) copyFileSync(path.join(sourceDirectory, "src", file), path.join(consumerDirectory, "src", file));
for (const file of ["smoke.spec.ts"]) copyFileSync(path.join(sourceDirectory, "tests", file), path.join(consumerDirectory, "tests", file));
copyFileSync(path.join(root, "tsconfig.base.json"), path.join(consumerDirectory, "tsconfig.base.json"));

writeFileSync(path.join(consumerDirectory, "tsconfig.json"), JSON.stringify({
  extends: "./tsconfig.base.json",
  compilerOptions: { module: "ESNext", moduleResolution: "Bundler", noEmit: true },
  include: ["src/**/*.ts", "tests/**/*.ts", "vite.config.ts", "playwright.config.ts"],
}, null, 2));

writeFileSync(path.join(consumerDirectory, "package.json"), JSON.stringify({
  name: "orbit-engine-three-packaged-browser-consumer",
  private: true,
  type: "module",
  scripts: {
    typecheck: "tsc -p tsconfig.json",
    build: "vite build",
    smoke: "playwright test --workers=1",
  },
  dependencies: {
    "orbit-engine": `file:${tarball("orbit-engine").replaceAll("\\", "/")}`,
    "orbit-engine-three": `file:${tarball("orbit-engine-three").replaceAll("\\", "/")}`,
    three: "0.185.1",
  },
  devDependencies: {
    "@playwright/test": "1.62.1",
    "@types/node": "22.13.10",
    "@types/three": "0.185.4",
    typescript: "5.8.3",
    vite: "8.2.2",
  },
}, null, 2));

runPnpm(["install", "--ignore-scripts", "--no-lockfile", "--strict-peer-dependencies"], consumerDirectory);
runPnpm(["run", "typecheck"], consumerDirectory);
runPnpm(["run", "build"], consumerDirectory);
runPnpm(["run", "smoke"], consumerDirectory);

console.log(`packaged orbit-engine-three browser smoke passed in ${consumerDirectory}`);
