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

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function canonicalManifestSha256(bytes: Uint8Array): Promise<string> {
  const text = new TextDecoder().decode(bytes).replace(/\r\n?/g, "\n");
  return sha256Hex(new TextEncoder().encode(text));
}

async function readAsset(file: string): Promise<Uint8Array> {
  const response = await fetch(`${DATASET_ROOT}/${file}`, { cache: "no-store" });
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

export async function loadSolarSystemReferenceDataset(engine: OrbitEngine): Promise<SolarSystemReferenceDataset> {
  try {
    const manifestBytes = await readAsset(MANIFEST_FILE);
    const manifestAssetSha256 = await canonicalManifestSha256(manifestBytes);
    if (manifestAssetSha256 !== OEP_MANIFEST_IDENTITY_SHA256) {
      throw new Error(`Manifest checksum mismatch: expected ${OEP_MANIFEST_IDENTITY_SHA256}, received ${manifestAssetSha256}`);
    }
    const manifest = parseJson<OepManifestV1>(manifestBytes, MANIFEST_FILE);
    assertManifest(manifest);
    const shards = await Promise.all(manifest.shards.map(async (shard) => {
      const file = `solar-system-reference-${shard.id}.oepb`;
      const bytes = await readAsset(file);
      const actualSha256 = await sha256Hex(bytes);
      if (actualSha256 !== shard.sha256) throw new Error(`Shard checksum mismatch for ${shard.id}`);
      return { id: shard.id, bytes };
    }));
    const oracle = parseJson<EclipseOracleAsset>(await readAsset(ECLIPSE_ORACLE_FILE), ECLIPSE_ORACLE_FILE);
    const input: OepLoadInput = { manifest, manifestSha256: OEP_MANIFEST_IDENTITY_SHA256, shards };
    const dataset = await engine.loadEphemerisPack(input);
    return Object.freeze({ dataset, eclipseOracle: oracle });
  } catch (error) {
    throw new Error(
      `Solar-System reference dataset failed to initialize: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}
