import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { join } from 'node:path';

import { acquisitionCacheFilename, OepImporterError } from './lib.mjs';

const execFileAsync = promisify(execFile);
const stateScript = fileURLToPath(new URL('./spice_state.py', import.meta.url));

function contains(record, instant) {
  const compare = (a, b) => a.seconds - b.seconds || a.nanoseconds - b.nanoseconds;
  return compare(instant, record.start) >= 0 && compare(instant, record.end) < 0;
}

export function createSpiceyPyOracle(plan, cacheDir, options = {}) {
  const pythonExecutable = options.pythonExecutable ?? process.env.ORBIT_ENGINE_SPICE_PYTHON ?? 'python3';
  const records = plan.acquisitions;
  if (!Array.isArray(records) || records.length === 0) throw new OepImporterError('invalidInput', 'SpiceyPy oracle requires plan acquisitions');
  const kernelPathByProduct = new Map(records.map((record) => [record.sourceProductId, join(cacheDir, acquisitionCacheFilename(record))]));
  return async (source, instant) => {
    const record = source.records.find((candidate) => contains(candidate, instant));
    if (!record) throw new OepImporterError('sourceOutOfRange', `no imported record covers oracle instant for source ${source.sourceNodeId}`);
    const frame = source.oracleFrameName ?? (source.frameCode === 1 ? 'J2000' : undefined);
    if (frame === undefined) throw new OepImporterError('unsupportedFrame', `CSPICE oracle requires an explicit SPICE frame name for frame ${source.frameCode}`);
    const et = instant.seconds + instant.nanoseconds / 1e9;
    const kernelPath = kernelPathByProduct.get(record.sourceProductId);
    if (kernelPath === undefined) throw new OepImporterError('oracleFailure', `missing CSPICE kernel path for ${record.sourceProductId}`);
    const { stdout } = await execFileAsync(pythonExecutable, [stateScript, JSON.stringify([kernelPath]), String(source.targetNaifId), String(source.centerNaifId), frame, String(et)], {
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    });
    const stateKm = JSON.parse(stdout.trim());
    if (!Array.isArray(stateKm) || stateKm.length !== 6) throw new OepImporterError('oracleFailure', 'SpiceyPy oracle returned malformed state');
    const rotation = source.oracleRotationMatrix ?? [1,0,0,0,1,0,0,0,1];
    const rotate = (offset) => [
      (rotation[0] * stateKm[offset] + rotation[1] * stateKm[offset + 1] + rotation[2] * stateKm[offset + 2]) * 1000,
      (rotation[3] * stateKm[offset] + rotation[4] * stateKm[offset + 1] + rotation[5] * stateKm[offset + 2]) * 1000,
      (rotation[6] * stateKm[offset] + rotation[7] * stateKm[offset + 1] + rotation[8] * stateKm[offset + 2]) * 1000,
    ];
    return [...rotate(0), ...rotate(3)];
  };
}
