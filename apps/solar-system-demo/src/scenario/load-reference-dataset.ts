import type {
  OepDataset,
  OepLoadInput,
  OepManifestV1,
  OrbitEngine,
} from "orbit-engine";

const DATASET_ROOT = "./data/solar-system-oep";
const MANIFEST_FILE = "solar-system-reference-1.0.0-de441-major.oep.json";
const ECLIPSE_ORACLE_FILE = "eclipse-oracle.json";
// The manifest identity is defined over canonical UTF-8 JSON text. Normalizing
// line endings keeps the browser check stable across Git's Windows and Linux
// checkout modes while retaining the production pack identity from #126.
const OEP_MANIFEST_IDENTITY_SHA256 = "302dafc2d4091a6047e1a9026a9308ece1baead7f46891e43040f4de666c8640";

export interface EclipseOracleAsset {
  readonly event: {
    readonly name: string;
    readonly selectedUtc: string;
    readonly normalizedInstant: { readonly seconds: number; readonly nanoseconds: number };
  };
  readonly sourceStates: Readonly<Record<string, readonly number[]>>;
  readonly earthCenteredGeometry: { readonly angularSeparationRadians: number };
  readonly tolerance: {
    readonly statePositionMeters: number;
    readonly stateVelocityMetersPerSecond: number;
    readonly geometryPositionMeters: number;
    readonly geometryDirectionRadians: number;
  };
}

export interface SolarSystemReferenceDataset {
  readonly dataset: OepDataset;
  readonly eclipseOracle: EclipseOracleAsset;
}

export type ReferenceDatasetLoadPhase =
  | "manifest-ready"
  | "shard-validated"
  | "required-oep-data-ready"
  | "dataset-ready";

export interface ReferenceDatasetLoadProgress {
  readonly phase: ReferenceDatasetLoadPhase;
  readonly loadedShards: number;
  readonly totalShards: number;
  readonly shardId?: string;
}

export interface LoadSolarSystemReferenceDatasetOptions {
  readonly onProgress?: (progress: ReferenceDatasetLoadProgress) => void;
}

const datasetLoads = new WeakMap<OrbitEngine, Promise<SolarSystemReferenceDataset>>();

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function canonicalManifestSha256(bytes: Uint8Array): Promise<string> {
  const text = new TextDecoder().decode(bytes).replace(/\r\n?/g, "\n");
  return sha256Hex(new TextEncoder().encode(text));
}

async function yieldToBrowser(): Promise<void> {
  if (typeof globalThis.requestAnimationFrame === "function") {
    await new Promise<void>((resolve) => globalThis.requestAnimationFrame(() => resolve()));
    return;
  }
  await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
}

async function readAsset(file: string): Promise<Uint8Array> {
  // The manifest and shard names identify an immutable committed dataset. Let
  // the browser's normal HTTP cache reuse unchanged versioned assets while
  // retaining the manifest and per-shard integrity checks below.
  const response = await fetch(`${DATASET_ROOT}/${file}`, { cache: "default" });
  if (!response.ok) throw new Error(`Static OEP asset ${file} failed to load (${response.status})`);
  return new Uint8Array(await response.arrayBuffer());
}

function parseJson<T>(bytes: Uint8Array, file: string): T {
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch (error) {
    throw new Error(`Static OEP asset ${file} is not valid JSON`, { cause: error });
  }
}

function assertManifest(manifest: OepManifestV1): void {
  if (manifest.datasetId !== "solar-system-reference" || manifest.datasetVersion !== "1.0.0-de441-major") {
    throw new Error(`Unexpected Solar-System OEP identity: ${manifest.datasetId}@${manifest.datasetVersion}`);
  }
  if (manifest.shards.length !== 4) throw new Error("Solar-System OEP manifest must contain four production shards");
  if (manifest.objectBindings?.length !== 11) throw new Error("Solar-System OEP manifest must bind the eleven demo reference objects");
}

async function loadSolarSystemReferenceDatasetOnce(
  engine: OrbitEngine,
  options: LoadSolarSystemReferenceDatasetOptions,
): Promise<SolarSystemReferenceDataset> {
  try {
    const manifestBytes = await readAsset(MANIFEST_FILE);
    const manifestAssetSha256 = await canonicalManifestSha256(manifestBytes);
    if (manifestAssetSha256 !== OEP_MANIFEST_IDENTITY_SHA256) {
      throw new Error(`Manifest checksum mismatch: expected ${OEP_MANIFEST_IDENTITY_SHA256}, received ${manifestAssetSha256}`);
    }
    const manifest = parseJson<OepManifestV1>(manifestBytes, MANIFEST_FILE);
    assertManifest(manifest);
    options.onProgress?.({
      phase: "manifest-ready",
      loadedShards: 0,
      totalShards: manifest.shards.length,
    });
    let loadedShards = 0;
    const shards = await Promise.all(manifest.shards.map(async (shard) => {
      const file = `solar-system-reference-${shard.id}.oepb`;
      const bytes = await readAsset(file);
      const actualSha256 = await sha256Hex(bytes);
      if (actualSha256 !== shard.sha256) throw new Error(`Shard checksum mismatch for ${shard.id}`);
      loadedShards += 1;
      options.onProgress?.({
        phase: "shard-validated",
        loadedShards,
        totalShards: manifest.shards.length,
        shardId: shard.id,
      });
      return { id: shard.id, bytes };
    }));
    options.onProgress?.({
      phase: "required-oep-data-ready",
      loadedShards,
      totalShards: manifest.shards.length,
    });
    const oracle = parseJson<EclipseOracleAsset>(await readAsset(ECLIPSE_ORACLE_FILE), ECLIPSE_ORACLE_FILE);
    // Give the browser one paint opportunity after the visible loader switches
    // to the indeterminate WASM/indexing phase. The public OEP load itself is
    // intentionally atomic and may perform a long synchronous WASM operation.
    await yieldToBrowser();
    const input: OepLoadInput = { manifest, manifestSha256: OEP_MANIFEST_IDENTITY_SHA256, shards };
    const dataset = await engine.loadEphemerisPack(input);
    options.onProgress?.({
      phase: "dataset-ready",
      loadedShards,
      totalShards: manifest.shards.length,
    });
    return Object.freeze({ dataset, eclipseOracle: oracle });
  } catch (error) {
    throw new Error(
      `Solar-System reference dataset failed to initialize: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

export function loadSolarSystemReferenceDataset(
  engine: OrbitEngine,
  options: LoadSolarSystemReferenceDatasetOptions = {},
): Promise<SolarSystemReferenceDataset> {
  const existing = datasetLoads.get(engine);
  if (existing !== undefined) return existing;

  const loading = loadSolarSystemReferenceDatasetOnce(engine, options);
  datasetLoads.set(engine, loading);
  void loading.catch(() => {
    // A failed session may be retried, but successful loads are retained for
    // the lifetime of this engine so their resources are never redundantly
    // fetched or loaded again.
    if (datasetLoads.get(engine) === loading) datasetLoads.delete(engine);
  });
  return loading;
}
