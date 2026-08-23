import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../../..");
const sourceDirectory = path.join(repositoryRoot, "data", "solar-system-oep");
const targetDirectory = path.join(scriptDirectory, "..", "public", "data", "solar-system-oep");

const files = [
  "solar-system-reference-1.0.0-de441-major.oep.json",
  "eclipse-oracle.json",
  "solar-system-reference-de441-mercury-venus.oepb",
  "solar-system-reference-de441-earth-emb.oepb",
  "solar-system-reference-de441-moon-sun.oepb",
  "solar-system-reference-de441-outer-planets.oepb",
];

await mkdir(targetDirectory, { recursive: true });
await Promise.all(files.map((file) => copyFile(path.join(sourceDirectory, file), path.join(targetDirectory, file))));
