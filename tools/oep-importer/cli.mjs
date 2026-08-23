#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

import {
  acquirePinnedSource,
  importDirectOep,
  inspectSpk,
  readAcquisitionBytes,
  validateAcquisitionRecord,
  writeImportedOep,
} from './lib.mjs';
import { createSpiceyPyOracle } from './spice-oracle.mjs';

function usage() {
  console.error(`OrbitEngine OEP direct importer

Usage:
  node tools/oep-importer/cli.mjs inspect <kernel.bsp>
  node tools/oep-importer/cli.mjs acquire <acquisition.json> <cache-dir>
  node tools/oep-importer/cli.mjs acquire-plan <import-plan.json> <cache-dir>
  node tools/oep-importer/cli.mjs import <import-plan.json> <cache-dir> <out-dir> [--spice-python <python>] [--spice-kernel <path>]

The import command never performs network access. Use acquire/acquire-plan first to populate
an immutable checksum-verified source cache. If --spice-python is supplied, every emitted
source is validated against CSPICE through SpiceyPy before OEP output is written.`);
}

async function jsonFile(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'inspect' && args.length === 1) {
    console.log(JSON.stringify(inspectSpk(new Uint8Array(await readFile(args[0]))), null, 2));
    return;
  }
  if (command === 'acquire' && args.length === 2) {
    const record = validateAcquisitionRecord(await jsonFile(args[0]));
    const result = await acquirePinnedSource(record, { cacheDir: args[1] });
    console.log(JSON.stringify({ sourceProductId: record.sourceProductId, path: result.path, fromCache: result.fromCache, sha256: record.sha256 }, null, 2));
    return;
  }
  if (command === 'acquire-plan' && args.length === 2) {
    const plan = await jsonFile(args[0]);
    if (!Array.isArray(plan.acquisitions)) throw new Error('import plan acquisitions must be an array');
    const results = [];
    for (const input of plan.acquisitions) {
      const record = validateAcquisitionRecord(input);
      const result = await acquirePinnedSource(record, { cacheDir: args[1] });
      results.push({ sourceProductId: record.sourceProductId, path: result.path, fromCache: result.fromCache, sha256: record.sha256 });
    }
    console.log(JSON.stringify(results, null, 2));
    return;
  }
  if (command === 'import' && args.length >= 3) {
    const [planPath, cacheDir, outDir, ...rest] = args;
    let pythonExecutable;
    let spiceKernelPath;
    for (let index = 0; index < rest.length; index += 1) {
      if (rest[index] === '--spice-python' && rest[index + 1] !== undefined) {
        pythonExecutable = rest[index + 1];
        index += 1;
      } else if (rest[index] === '--spice-kernel' && rest[index + 1] !== undefined) {
        spiceKernelPath = rest[index + 1];
        index += 1;
      } else {
        throw new Error(`unknown import option ${rest[index]}`);
      }
    }
    const plan = await jsonFile(planPath);
    const sources = await readAcquisitionBytes(plan, cacheDir);
    const kernelPathByProduct = spiceKernelPath === undefined ? undefined : new Map(plan.acquisitions.map((record) => [record.sourceProductId, spiceKernelPath]));
    const oracle = pythonExecutable === undefined ? undefined : createSpiceyPyOracle(plan, cacheDir, {
      pythonExecutable,
      ...(kernelPathByProduct === undefined ? {} : { kernelPathByProduct }),
    });
    const output = await importDirectOep(plan, sources, { ...(oracle === undefined ? {} : { oracle }) });
    const paths = await writeImportedOep(output, outDir);
    console.log(JSON.stringify({
      manifestSha256: output.manifestSha256,
      manifestPath: paths.manifestPath,
      shards: output.shards.map((shard, index) => ({ id: shard.id, sha256: shard.sha256, path: paths.shardPaths[index], bytes: shard.bytes.byteLength })),
      representationValidation: output.manifest.sourceRecords.map((record) => ({ sourceNodeId: record.sourceNodeId, validation: record.representationValidation })),
    }, null, 2));
    return;
  }
  usage();
  process.exitCode = 2;
}

main().catch((error) => {
  console.error(error?.details && Object.keys(error.details).length > 0
    ? `${error?.stack ?? error}\n${JSON.stringify(error.details, null, 2)}`
    : (error?.stack ?? error));
  process.exitCode = 1;
});
