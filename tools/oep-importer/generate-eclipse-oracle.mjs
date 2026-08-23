#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const stateScript = fileURLToPath(new URL('./spice_state.py', import.meta.url));
const [, , planPath, spiceKernel, leapSeconds, outputPath, pythonExecutable = 'python'] = process.argv;
if ([planPath, spiceKernel, leapSeconds, outputPath].some((value) => value === undefined)) {
  console.error('usage: generate-eclipse-oracle.mjs <import-plan.json> <de441-kernel.bsp> <naif0012.tls> <output.json> [python]');
  process.exit(2);
}

const plan = JSON.parse(await readFile(planPath, 'utf8'));
const instant = Object.freeze({ seconds: 839_828_822, nanoseconds: 982_997_894 });

async function state(target, center) {
  const { stdout } = await execFileAsync(pythonExecutable, [
    stateScript,
    JSON.stringify([leapSeconds, spiceKernel]),
    String(target),
    String(center),
    'J2000',
    String(instant.seconds),
    String(instant.nanoseconds),
  ], { maxBuffer: 1024 * 1024, windowsHide: true });
  const km = JSON.parse(stdout.trim());
  if (!Array.isArray(km) || km.length !== 6) throw new Error(`invalid state for ${target}/${center}`);
  return km.map((value) => value * 1000);
}

function add(...states) {
  return states[0].map((_, index) => states.reduce((sum, value) => sum + value[index], 0));
}

function subtract(left, right) {
  return left.map((value, index) => value - right[index]);
}

function norm(vector) {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

function unit(vector) {
  const length = norm(vector);
  return vector.slice(0, 3).map((value) => value / length);
}

function geometry(sunEarthState, moonEarthState) {
  const sun = sunEarthState.slice(0, 3);
  const moon = moonEarthState.slice(0, 3);
  const sunDistance = norm(sun);
  const moonDistance = norm(moon);
  const cosine = Math.max(-1, Math.min(1, sun.reduce((sum, value, index) => sum + value * moon[index], 0) / (sunDistance * moonDistance)));
  return Object.freeze({
    sunDistanceMeters: sunDistance,
    moonDistanceMeters: moonDistance,
    separationMeters: norm(subtract(sun, moon)),
    angularSeparationRadians: Math.acos(cosine),
    sunDirectionEarthCentered: unit(sun),
    moonDirectionEarthCentered: unit(moon),
  });
}

const [sunSsb, embSsb, earthEmb, moonEmb] = await Promise.all([
  state(10, 0),
  state(3, 0),
  state(399, 3),
  state(301, 3),
]);
const earthSsb = add(embSsb, earthEmb);
const moonSsb = add(embSsb, moonEmb);
const sunEarth = subtract(sunSsb, earthSsb);
const moonEarth = subtract(moonSsb, earthSsb);
const statePositionTolerance = 4 * 1e-3;
const stateVelocityTolerance = 4 * 1e-6;
const output = {
  schemaVersion: 1,
  datasetId: plan.datasetId,
  datasetVersion: plan.datasetVersion,
  event: {
    name: '2026-08-12 total solar eclipse',
    selectedUtc: '2026-08-12T17:45:53.800Z',
    source: 'NASA GSFC Besselian-elements greatest-eclipse instant',
    sourceUrl: 'https://eclipse.gsfc.nasa.gov/SEbeselm/SEbeselm2001/SE2026Aug12Tbeselm.html',
    normalizedTimeScale: 'TDB',
    normalizedInstant: instant,
    conversion: 'NAIF SPICE str2et UTC -> ET/TDB, rounded to the OrbitEngine nanosecond grid',
    leapSecondsKernel: {
      name: 'naif0012.tls',
      url: 'https://naif.jpl.nasa.gov/pub/naif/generic_kernels/lsk/naif0012.tls',
      sha256: '678e32bdb5a744117a467cd9601cd6b373f0e9bc9bbde1371d5eee39600a039b',
    },
  },
  frame: 'SSB + ICRS/ICRF-aligned, geometric states, J2000',
  sourceStates: {
    sunSsb,
    earthBarycenterSsb: embSsb,
    earthEmb,
    moonEmb,
    earthSsb,
    moonSsb,
    sunEarth,
    moonEarth,
  },
  earthCenteredGeometry: geometry(sunEarth, moonEarth),
  tolerance: {
    statePositionMeters: statePositionTolerance,
    stateVelocityMetersPerSecond: stateVelocityTolerance,
    geometryPositionMeters: statePositionTolerance * 2,
    geometryDirectionRadians: (statePositionTolerance * 2) / Math.min(norm(sunEarth.slice(0, 3)), norm(moonEarth.slice(0, 3))),
    note: 'Four-state propagation allowance from the 1e-3 m / 1e-6 m/s direct-representation ceilings; source uncertainty is separate.',
  },
};
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ outputPath, instant, geometry: output.earthCenteredGeometry }));
