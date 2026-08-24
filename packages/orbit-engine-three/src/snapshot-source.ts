import type {
  ObjectId,
  ObjectRecord,
  ObjectType,
  PropagationState,
  ReferenceFrameId,
  SimulationInstant,
} from "orbit-engine";
import { createOrbitPathSnapshot, orbitPathCacheKey, OrbitPathCache, sampleOrbitPath, type OrbitPathOrigin, type OrbitPathSnapshot, type OrbitPathInterval } from "./orbit.js";
import { createCelestialRenderSnapshot, type CelestialBodyRenderState, type CelestialRenderSnapshot, type RenderSnapshotOrigin } from "./snapshot.js";
import type { CelestialAppearance } from "./presentation/appearance.js";
import type { RenderVector3 } from "./render-space.js";

export interface OrbitEngineSnapshotOrigin {
  readonly kind: "frame" | "object";
  readonly frameId: ReferenceFrameId;
  readonly objectId?: ObjectId;
}

export interface OrbitEngineSnapshotInclude {
  readonly velocity?: boolean;
  readonly physicalRadius?: boolean;
  readonly hierarchy?: boolean;
  readonly objectType?: boolean;
  readonly appearance?: boolean;
  readonly revisions?: boolean;
}

export interface OrbitEngineSnapshotRequest {
  readonly instant: SimulationInstant;
  readonly objectIds: readonly ObjectId[];
  readonly origin: OrbitEngineSnapshotOrigin;
  readonly include?: OrbitEngineSnapshotInclude;
  readonly revision?: string;
}

export interface OrbitEngineCatalogBodyMetadata {
  readonly parentId?: ObjectId;
  readonly objectType?: ObjectType;
  readonly physicalRadiusMeters?: number;
  readonly appearance?: CelestialAppearance;
  readonly accentColor?: number;
  readonly stateRevision?: string;
  readonly propertyRevision?: string;
}

export interface OrbitEngineCatalogAdapter {
  readonly bodyFor?: (objectId: ObjectId, record: ObjectRecord) => OrbitEngineCatalogBodyMetadata | undefined;
  readonly resolveBody?: (objectId: ObjectId, record: ObjectRecord) => OrbitEngineCatalogBodyMetadata | undefined;
}

export type OrbitEngineCatalogResolver = (
  objectId: ObjectId,
  record: ObjectRecord,
) => OrbitEngineCatalogBodyMetadata | undefined;

export interface OrbitEngineOrbitPathRequest {
  readonly objectId: ObjectId;
  readonly parentId?: ObjectId;
  readonly origin?: OrbitEngineSnapshotOrigin;
  readonly frame?: ReferenceFrameId;
  readonly outputFrame?: ReferenceFrameId;
  readonly interval: OrbitPathInterval;
  readonly sampleCount: number;
  readonly closedReferenceOrbit?: boolean;
}

export interface OrbitEngineSnapshotSource {
  readonly snapshot: (request: OrbitEngineSnapshotRequest) => CelestialRenderSnapshot;
  readonly sampleOrbitPath: (request: OrbitEngineOrbitPathRequest) => OrbitPathSnapshot;
  readonly clearOrbitCache: () => void;
  readonly invalidateObject: (objectId: ObjectId) => void;
}

export interface OrbitEngineSnapshotSourceOptions {
  readonly maxSnapshotBodies?: number;
  readonly maxOrbitCacheEntries?: number;
}

export interface OrbitEngineSnapshotEngine {
  readonly registry: () => { readonly get: (objectId: ObjectId) => ObjectRecord };
  readonly statesAt: (objectIds: readonly ObjectId[], instant: SimulationInstant, outputFrame?: ReferenceFrameId) => readonly PropagationState[];
  readonly stateAt: (objectId: ObjectId, instant: SimulationInstant, outputFrame?: ReferenceFrameId) => PropagationState;
  readonly relativeStateAt: (targetObject: ObjectId, observerObject: ObjectId, instant: SimulationInstant, outputFrame?: ReferenceFrameId) => PropagationState;
}

function nonEmpty(name: string, value: string): void {
  if (typeof value !== "string" || value.trim().length === 0) throw new RangeError(`${name} must be a non-empty string`);
}

function finite(name: string, value: number): void {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
}

function validateOrigin(origin: OrbitEngineSnapshotOrigin): void {
  if (origin.kind !== "frame" && origin.kind !== "object") throw new RangeError(`Unsupported snapshot origin kind: ${String(origin.kind)}`);
  nonEmpty("origin.frameId", origin.frameId);
  if (origin.kind === "object" && origin.objectId === undefined) throw new RangeError("Object snapshot origins require objectId");
}

function compareInstants(left: SimulationInstant, right: SimulationInstant): number {
  if (left.seconds !== right.seconds) return left.seconds < right.seconds ? -1 : 1;
  if (left.nanoseconds !== right.nanoseconds) return left.nanoseconds < right.nanoseconds ? -1 : 1;
  return 0;
}

function vector(position: PropagationState["position"]): RenderVector3 {
  finite("state.position.x", position.x);
  finite("state.position.y", position.y);
  finite("state.position.z", position.z);
  return Object.freeze({ x: position.x, y: position.y, z: position.z });
}

function renderOrigin(origin: OrbitEngineSnapshotOrigin): RenderSnapshotOrigin {
  return Object.freeze({
    kind: origin.kind,
    frameId: origin.frameId,
    ...(origin.objectId === undefined ? {} : { objectId: origin.objectId }),
  });
}

function catalogResolver(adapter: OrbitEngineCatalogAdapter | OrbitEngineCatalogResolver | undefined): OrbitEngineCatalogResolver | undefined {
  if (adapter === undefined) return undefined;
  if (typeof adapter === "function") return adapter;
  return adapter.bodyFor ?? adapter.resolveBody;
}

function sourceRevision(record: ObjectRecord): string {
  return `motion:${record.motion.motionRevision}|configuration:${record.motion.configurationRevision}|property:${record.propertyRevision}`;
}

function assertStateEpoch(state: PropagationState, instant: SimulationInstant, frame: ReferenceFrameId): void {
  if (compareInstants(state.epoch, instant) !== 0) throw new RangeError("OrbitEngine state source returned a state at a different epoch");
  if (state.referenceFrame !== frame) throw new RangeError("OrbitEngine state source returned a state in a different frame");
}

function normalizeInclude(input: OrbitEngineSnapshotInclude | undefined): Required<OrbitEngineSnapshotInclude> {
  return Object.freeze({
    velocity: input?.velocity ?? true,
    physicalRadius: input?.physicalRadius ?? true,
    hierarchy: input?.hierarchy ?? true,
    objectType: input?.objectType ?? true,
    appearance: input?.appearance ?? true,
    revisions: input?.revisions ?? true,
  });
}

function engineAsPublic(value: OrbitEngineSnapshotEngine): OrbitEngineSnapshotEngine {
  return value;
}

export function createOrbitEngineSnapshotSource(
  engine: OrbitEngineSnapshotEngine,
  catalogAdapter?: OrbitEngineCatalogAdapter | OrbitEngineCatalogResolver,
  options: OrbitEngineSnapshotSourceOptions = {},
): OrbitEngineSnapshotSource {
  const publicEngine = engineAsPublic(engine);
  const resolver = catalogResolver(catalogAdapter);
  const maxSnapshotBodies = options.maxSnapshotBodies ?? 4096;
  if (!Number.isSafeInteger(maxSnapshotBodies) || maxSnapshotBodies <= 0) throw new RangeError("maxSnapshotBodies must be positive");
  const orbitCache = new OrbitPathCache(options.maxOrbitCacheEntries ?? 12);

  const snapshot = (request: OrbitEngineSnapshotRequest): CelestialRenderSnapshot => {
    validateOrigin(request.origin);
    if (!Array.isArray(request.objectIds) || request.objectIds.length > maxSnapshotBodies) {
      throw new RangeError(`snapshot objectIds must contain at most ${maxSnapshotBodies} objects`);
    }
    const include = normalizeInclude(request.include);
    const records = request.objectIds.map((objectId) => publicEngine.registry().get(objectId));
    const states = request.origin.kind === "frame"
      ? publicEngine.statesAt(request.objectIds, request.instant, request.origin.frameId)
      : request.objectIds.map((objectId) => publicEngine.relativeStateAt(objectId, request.origin.objectId!, request.instant, request.origin.frameId));
    if (states.length !== request.objectIds.length) throw new RangeError("OrbitEngine state source returned an incomplete snapshot");
    const bodies = request.objectIds.map((objectId, index): CelestialBodyRenderState => {
      const record = records[index]!;
      const state = states[index]!;
      assertStateEpoch(state, request.instant, request.origin.frameId);
      const metadata = resolver?.(objectId, record);
      const body: CelestialBodyRenderState = {
        objectId,
        positionRelativeToOriginMeters: vector(state.position),
        ...(include.velocity ? { velocityRelativeToOriginMetersPerSecond: Object.freeze({ x: state.velocity.x, y: state.velocity.y, z: state.velocity.z }) } : {}),
        ...(include.objectType ? { objectType: metadata?.objectType ?? record.type } : {}),
        ...(include.hierarchy && (metadata?.parentId ?? record.structuralParent) !== undefined ? { parentId: metadata?.parentId ?? record.structuralParent } : {}),
        ...(include.physicalRadius && (metadata?.physicalRadiusMeters ?? record.properties.physicalRadius) !== undefined ? { physicalRadiusMeters: metadata?.physicalRadiusMeters ?? record.properties.physicalRadius } : {}),
        ...(include.appearance && metadata?.appearance !== undefined ? { appearance: metadata.appearance } : {}),
        ...(metadata?.accentColor === undefined ? {} : { accentColor: metadata.accentColor }),
        ...(include.revisions ? {
          stateRevision: metadata?.stateRevision ?? record.motion.motionRevision,
          propertyRevision: metadata?.propertyRevision ?? record.propertyRevision,
        } : {}),
      };
      return body;
    });
    const revision = request.revision ?? (include.revisions
      ? records.map((record) => `${record.id}:${sourceRevision(record)}`).join(",")
      : undefined);
    return createCelestialRenderSnapshot({
      instant: request.instant,
      origin: renderOrigin(request.origin),
      bodies,
      ...(revision === undefined ? {} : { revision }),
    });
  };

  const sample = (request: OrbitEngineOrbitPathRequest): OrbitPathSnapshot => {
    const frame = request.frame ?? request.outputFrame;
    if (frame === undefined) throw new RangeError("Orbit path sampling requires an output frame");
    const record = publicEngine.registry().get(request.objectId);
    const parentId = request.parentId ?? record.structuralParent;
    if (request.origin !== undefined) validateOrigin(request.origin);
    const origin: OrbitPathOrigin = request.origin ?? (parentId === undefined
      ? { kind: "frame", frameId: frame }
      : { kind: "object", objectId: parentId, frameId: frame });
    if (origin.frameId !== frame) throw new RangeError("Orbit path origin frame must match output frame");
    const cacheInput = {
      objectId: request.objectId,
      ...(parentId === undefined ? {} : { parentId }),
      origin,
      frameId: frame,
      interval: request.interval,
      sampleCount: request.sampleCount,
      closedReferenceOrbit: request.closedReferenceOrbit ?? true,
      motionRevision: record.motion.motionRevision,
      sourceRevision: record.motion.configurationRevision,
      sourceRevisionFingerprint: sourceRevision(record),
    };
    const key = orbitPathCacheKey(cacheInput);
    return orbitCache.getOrCreate(key, () => sampleOrbitPath({
      ...cacheInput,
      positionAt: (instant) => {
        const state = origin.kind === "object"
          ? publicEngine.relativeStateAt(request.objectId, origin.objectId!, instant, frame)
          : publicEngine.stateAt(request.objectId, instant, frame);
        assertStateEpoch(state, instant, frame);
        return vector(state.position);
      },
    }));
  };

  return Object.freeze({
    snapshot,
    sampleOrbitPath: sample,
    clearOrbitCache: () => orbitCache.clear(),
    invalidateObject: (objectId: ObjectId) => orbitCache.invalidateObject(objectId),
  });
}

/** Narrower alias matching the architecture document's adapter terminology. */
export const createOrbitEngineSnapshotAdapter = createOrbitEngineSnapshotSource;

/** Build a supplied path without consulting any renderer-local orbital model. */
export function createSuppliedOrbitPathSnapshot(input: Parameters<typeof createOrbitPathSnapshot>[0]): OrbitPathSnapshot {
  return createOrbitPathSnapshot(input);
}
