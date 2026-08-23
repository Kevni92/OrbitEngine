# Solar-System reference OEP dataset

This directory contains the immutable, application-owned release artifacts for the first production Solar-System reference pack.

- `import-plan.json` pins the DE441 SPK URL, source hash, importer revision, normalization policy, source-node graph, stable application bindings, and deterministic shard assignment.
- `solar-system-reference-1.0.0-de441-major.oep.json` and the four matching `.oepb` files are generated outputs; source kernels are never committed.
- `eclipse-oracle.json` contains the offline 2026-08-12 source-vector and geometry regression.

The source is the official NAIF DE441 part-2 planetary/lunar SPK (`1,656,830,976` bytes, SHA-256 `3abb17dae2d78dd34880377544aacb54892104a0d4462b322cb9f4454d4887f6`). It contains the DE441 solution for the complete J2000 through +1000-year scenario interval; the pack does not claim validity outside the declared per-series interval. The source is used as a tooling input only. The OEP pack is normalized to SI metres/metres-per-second, TDB seconds from J2000 TDB, and the OrbitEngine SSB + ICRS/ICRF-aligned axes.

Acquire the pinned source into a local cache (the source is about 1.54 GiB and is intentionally not part of the repository):

```text
node tools/oep-importer/range-acquire.mjs https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/de441_part-2.bsp .cache/oep-source 1656830976
```

The range output is `de441_part-2.bsp`; copy it to the checksum-qualified importer cache filename, then run:

```text
Copy-Item .cache/oep-source/de441_part-2.bsp .cache/oep-source/de441-part-2-3abb17dae2d78dd34880377544aacb54892104a0d4462b322cb9f4454d4887f6.bsp
node tools/oep-importer/cli.mjs import data/solar-system-oep/import-plan.json .cache/oep-source data/solar-system-oep/generated --spice-python python
node tools/oep-importer/generate-eclipse-oracle.mjs data/solar-system-oep/import-plan.json .cache/oep-source/de441_part-2.bsp .cache/oep-source/naif0012.tls data/solar-system-oep/eclipse-oracle.json python
```

The import command performs no network access. Regeneration with unchanged source bytes, plan, importer revision, and normalization policy produces manifest hash `302dafc2d4091a6047e1a9026a9308ece1baead7f46891e43040f4de666c8640` and these shard sizes: Mercury/Venus `25,203,064` bytes, Earth/EMB `42,917,416` bytes, Moon/Sun `41,821,624` bytes, and outer planets `16,437,624` bytes (`126,379,728` bytes total). The browser scenario references all four shards through stable application-object bindings; no full source database is included in the npm package. Redistribution of the derived OEP binaries remains subject to the JPL/NAIF attribution and source-rule review recorded in the manifest.
