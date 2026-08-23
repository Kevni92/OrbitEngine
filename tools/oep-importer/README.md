# OrbitEngine OEP direct importer

This directory contains the offline developer/build tooling for Architecture #113 / document 20. It intentionally lives outside the `orbit-engine` runtime package. CSPICE may be installed for validation here; it is not linked into the portable C++ core, native addon, or WebAssembly runtime.

## Supported direct source records

The importer reads binary DAF/SPK files directly and supports the forms that map without sampled refitting to OEP v1:

- SPK Type 2 -> OEP `positionChebyshev` (position coefficients km -> m; runtime derives velocity analytically);
- SPK Type 3 -> OEP `stateChebyshev` (position km -> m and velocity km/s -> m/s).

Both `LTL-IEEE` and `BIG-IEEE` DAF encodings are decoded explicitly. Unsupported SPK types fail with `unsupportedSpkType`; they are never silently sampled or fitted. Non-direct fitting policy belongs to Spike #125.

Source-family labels such as `de441`, planetary/satellite SPK, and Pluto-system SPK are provenance only. Target, center, frame, type, coverage and DAF addresses always come from the actual segment descriptor. Large SPKs are inspected and streamed from disk; they are never loaded into one JavaScript `Buffer`.

## Reproducible acquisition records

Every source is pinned by a machine-readable record:

```json
{
  "sourceKind": "de441",
  "sourceProductId": "de441-part-1",
  "sourceTargetIds": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 199, 299, 301, 399],
  "sourceUrl": "https://.../de441_part-1.bsp",
  "retrievalTimestamp": "2026-08-23T00:00:00Z",
  "sourceDeclaredVersion": "DE441",
  "requestedCoverage": { "note": "source product coverage" },
  "sha256": "<64 lowercase hex chars>",
  "redistribution": {
    "class": "review-required",
    "notes": "Record source licensing/attribution review here."
  }
}
```

A normalized request object may be used instead of `sourceUrl` for request-generated products. Exactly one URL/request is required. Downloaded and cached bytes are SHA-256 checked before import; checksum drift is an error until the pin is deliberately updated. Cache filenames include the full pinned hash, and host-specific paths are never serialized into OEP output.

## Import plan and source hierarchy

An import plan pins dataset identity (`datasetId`, `datasetVersion`, `createdAt`, importer version/commit, normalization-policy version), embeds acquisition records, and assigns dataset-local `sourceNodeId` values to explicit SPK segment selectors. Segment selection can constrain target, center, segment ID, and SPK type; ambiguous selection fails.

`targetNaifId` is selection/provenance metadata. It is never converted into an OrbitEngine `ObjectId` or `ReferenceFrameId`. The actual SPK center maps to another explicitly declared OEP source node, or to SSB for center `0`. Missing mappings and source-center cycles fail.

SPK frame 1 (`J2000`) is treated as the documented JPL/SPICE ICRF-aligned convention. Any other frame requires an explicit fixed proper right-handed 3x3 rotation in `frameRotations`; the rotation is applied coefficient-wise exactly once. Time-dependent/body-fixed frames are not silently accepted by this translational importer.

## Exact time normalization

SPK ET is binary64 TDB seconds past J2000. OEP boundaries use exact OrbitEngine `(seconds,nanoseconds)` instants. Conversion is deterministic and conservative:

- source start rounds inward/up to the nanosecond grid;
- source end rounds inward/down and remains half-open;
- shared record boundaries use one exact instant valid for both adjacent Chebyshev domains;
- every boundary is rechecked using the same midpoint/radius arithmetic required by the #123 evaluator.

If no exact nanosecond boundary satisfies both records, import fails with `unrepresentableTimeBoundary`; the importer never clamps the normalized Chebyshev coordinate or expands validity.

## Deterministic output and provenance

Source nodes and records have deterministic ordering. OEP shards use the fixed little-endian #123 binary contract. The manifest is canonical sorted-key JSON and contains no generated host path or implicit wall-clock timestamp. `createdAt`, importer version, importer commit, normalization policy and source hashes are explicit inputs. Source revisions are deterministically derived from the pinned source/segment/frame-normalization identity.

Manifest `sourceRecords` retain source target/center/frame/type/coverage, source hashes and URLs/requests, retrieval/version metadata, conversion method, normalization units/time/frame, source limitations/uncertainty notes, and representation-validation results.

## CSPICE validation

`requirements-spice.txt` pins the optional tooling dependency. With `--spice-python`, import queries geometric states through SpiceyPy/CSPICE and compares them with emitted OEP series at deterministic epochs: source-near start/end, J2000 when covered, fixed and deterministic seeded interior points, representable points after record boundaries, and plan-supplied named epochs such as modern-scenario and decades-away checks. Exact OrbitEngine nanosecond instants are preserved when the absolute TDB value is passed to the oracle; the adapter applies the sub-ULP correction that binary64 CSPICE cannot represent at long horizons.

The default direct-normalization ceiling is `1e-3 m` position and `1e-6 m/s` velocity. Import aborts if either ceiling is exceeded. Astronomical source uncertainty is recorded separately and does not relax representation correctness implicitly.

## Commands

```bash
node tools/oep-importer/cli.mjs inspect path/to/kernel.bsp
node tools/oep-importer/cli.mjs acquire path/to/acquisition.json .cache/orbit-engine-ephemeris
node tools/oep-importer/cli.mjs acquire-plan path/to/import-plan.json .cache/orbit-engine-ephemeris
node tools/oep-importer/cli.mjs import path/to/import-plan.json .cache/orbit-engine-ephemeris out/oep

python3 -m pip install -r tools/oep-importer/requirements-spice.txt
node tools/oep-importer/cli.mjs import path/to/import-plan.json .cache/orbit-engine-ephemeris out/oep --spice-python python3
node tools/oep-importer/cli.mjs import path/to/import-plan.json .cache/orbit-engine-ephemeris out/oep --spice-python python3 --spice-kernel path/to/independent-validation-kernel.bsp
node tools/oep-importer/generate-eclipse-oracle.mjs path/to/import-plan.json path/to/kernel.bsp path/to/naif0012.tls out/eclipse-oracle.json python3
```

The `import` command never performs network access; acquisition is a separate explicit step.

## Tests

- `importer.test.mjs`: deterministic DAF parser, checksum, Type 2/3, SI/frame/time normalization, graph, error-budget and output-determinism tests.
- `spice-integration.test.mjs`: creates real Type 2/3 SPKs with CSPICE and validates direct OEP output against geometric `spkgeo` states for DE441-style, satellite-system and Pluto-system fixtures.
- `runtime-compat.mjs`: passes importer output through the public #123 native/WASM OEP APIs.
- `production-pack.test.mjs`: loads the committed #126 production manifest/shards through the public WASM API and checks the offline eclipse oracle and effective validity.

Network-dependent production downloads are intentionally not routine CI inputs. Production source pins and released OEP assets are owned by dataset issue #126; this importer remains a tooling-only dependency and is not used by runtime consumers.
