#!/usr/bin/env node
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

const [url, outputDirectory, expectedLengthText] = process.argv.slice(2);
if (url === undefined || outputDirectory === undefined) {
  console.error("usage: node range-acquire.mjs <url> <output-directory> [expected-length]");
  process.exit(2);
}

const chunkBytes = 16 * 1024 * 1024;
const concurrency = 8;
const output = resolve(outputDirectory);
const fileName = basename(new URL(url).pathname) || "source.bin";
const assembledPath = join(output, fileName);

async function fetchChunk(index, start, end, expectedLength) {
  const path = join(output, `${fileName}.part.${String(index).padStart(4, "0")}`);
  try {
    const existing = await stat(path);
    if (existing.size === expectedLength) return;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const response = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } });
  if (!response.ok) throw new Error(`range request failed (${response.status}) for ${start}-${end}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength !== expectedLength) {
    throw new Error(`range ${start}-${end} returned ${bytes.byteLength} bytes; expected ${expectedLength}`);
  }
  await writeFile(path, bytes);
}

async function main() {
  await mkdir(output, { recursive: true });
  const expectedLength = expectedLengthText === undefined ? Number((await (await fetch(url, { method: "HEAD" })).headers).get("content-length")) : Number(expectedLengthText);
  if (!Number.isSafeInteger(expectedLength) || expectedLength <= 0) throw new Error("source length must be a positive safe integer");
  const count = Math.ceil(expectedLength / chunkBytes);
  let next = 0;
  async function worker() {
    while (true) {
      const index = next++;
      if (index >= count) return;
      const start = index * chunkBytes;
      const end = Math.min(expectedLength - 1, start + chunkBytes - 1);
      await fetchChunk(index, start, end, end - start + 1);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, count) }, worker));

  const handle = await import("node:fs/promises").then(({ open }) => open(assembledPath, "w"));
  try {
    for (let index = 0; index < count; index += 1) {
      const start = index * chunkBytes;
      const end = Math.min(expectedLength - 1, start + chunkBytes - 1);
      const path = join(output, `${fileName}.part.${String(index).padStart(4, "0")}`);
      const bytes = await readFile(path);
      if (bytes.byteLength !== end - start + 1) throw new Error(`chunk ${index} has an unexpected length`);
      await handle.write(bytes);
    }
  } finally {
    await handle.close();
  }
  const assembled = await stat(assembledPath);
  if (assembled.size !== expectedLength) throw new Error(`assembled source has ${assembled.size} bytes; expected ${expectedLength}`);
  console.log(JSON.stringify({ url, path: assembledPath, bytes: assembled.size, chunks: count }));
}

if (process.exitCode !== 2) main().catch((error) => {
  console.error(error?.stack ?? error);
  process.exitCode = 1;
});
