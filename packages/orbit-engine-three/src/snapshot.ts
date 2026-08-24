import type { ObjectId, ObjectType, SimulationInstant } from "orbit-engine";
import type { CelestialAppearance } from "./presentation/appearance.js";
import type { RenderVector3 } from "./render-space.js";

export type BodyRepresentation = "hidden" | "marker" | "sphere";

export interface RenderSnapshotOrigin {
  readonly kind: "frame" | "object" | "custom";
  readonly frameId: string;
  readonly objectId?: ObjectId;
  readonly label?: string;
}

export interface CelestialBodyRenderState {
  readonly objectId: ObjectId;
  readonly objectType?: ObjectType;
  readonly parentId?: ObjectId;
  readonly positionRelativeToOriginMeters: RenderVector3;
  readonly velocityRelativeToOriginMetersPerSecond?: RenderVector3;
  readonly physicalRadiusMeters?: number;
  readonly stateRevision?: string;
  readonly propertyRevision?: string;
  readonly appearance?: CelestialAppearance;
  readonly accentColor?: number;
  readonly representation?: BodyRepresentation;
}

export interface CelestialRenderSnapshotInput {
  readonly instant: SimulationInstant;
  readonly origin: RenderSnapshotOrigin;
  readonly bodies: readonly CelestialBodyRenderState[];
  readonly revision?: string;
}

export interface CelestialRenderSnapshot extends CelestialRenderSnapshotInput {
  readonly fingerprint: string;
  readonly bodies: readonly CelestialBodyRenderState[];
}

function fail(message: string): never {
  throw new RangeError(`Render snapshot: ${message}`);
}

function nonEmpty(name: string, value: string): void {
  if (typeof value !== "string" || value.trim().length === 0) fail(`${name} must be a non-empty string`);
}

function finite(name: string, value: number): void {
  if (!Number.isFinite(value)) fail(`${name} must be finite`);
}

function validateVector(name: string, value: RenderVector3): void {
  finite(`${name}.x`, value.x);
  finite(`${name}.y`, value.y);
  finite(`${name}.z`, value.z);
}

function validateInstant(instant: SimulationInstant): void {
  finite("instant.seconds", instant.seconds);
  finite("instant.nanoseconds", instant.nanoseconds);
  if (!Number.isInteger(instant.seconds) || !Number.isInteger(instant.nanoseconds) || instant.nanoseconds < 0 || instant.nanoseconds >= 1_000_000_000) {
    fail("instant must contain normalized integer seconds and nanoseconds");
  }
}

function validateOrigin(origin: RenderSnapshotOrigin): void {
  if (origin.kind !== "frame" && origin.kind !== "object" && origin.kind !== "custom") fail(`origin kind ${String(origin.kind)} is unsupported`);
  nonEmpty("origin.frameId", origin.frameId);
  if (origin.kind === "object" && origin.objectId === undefined) fail("object origins require objectId");
  if (origin.label !== undefined) nonEmpty("origin.label", origin.label);
}

function validateBody(body: CelestialBodyRenderState, index: number): void {
  const prefix = `bodies[${index}]`;
  nonEmpty(`${prefix}.objectId`, body.objectId);
  validateVector(`${prefix}.positionRelativeToOriginMeters`, body.positionRelativeToOriginMeters);
  if (body.velocityRelativeToOriginMetersPerSecond !== undefined) validateVector(`${prefix}.velocityRelativeToOriginMetersPerSecond`, body.velocityRelativeToOriginMetersPerSecond);
  if (body.physicalRadiusMeters !== undefined) {
    finite(`${prefix}.physicalRadiusMeters`, body.physicalRadiusMeters);
    if (body.physicalRadiusMeters < 0) fail(`${prefix}.physicalRadiusMeters must be non-negative`);
    if ((body.representation ?? "sphere") === "sphere" && body.physicalRadiusMeters === 0) fail(`${prefix}.sphere representation requires a positive physical radius`);
  }
  if (body.representation !== undefined && body.representation !== "hidden" && body.representation !== "marker" && body.representation !== "sphere") fail(`${prefix}.representation ${String(body.representation)} is unsupported`);
  if (body.accentColor !== undefined && (!Number.isSafeInteger(body.accentColor) || body.accentColor < 0 || body.accentColor > 0xffffff)) fail(`${prefix}.accentColor must be a 24-bit integer`);
  if (body.stateRevision !== undefined) nonEmpty(`${prefix}.stateRevision`, body.stateRevision);
  if (body.propertyRevision !== undefined) nonEmpty(`${prefix}.propertyRevision`, body.propertyRevision);
}

function freezeVector(value: RenderVector3): RenderVector3 {
  return Object.freeze({ x: value.x, y: value.y, z: value.z });
}

function stableFingerprint(value: unknown): string {
  const serialized = JSON.stringify(value);
  let hash = 2_166_136_261;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `snapshot-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function createCelestialRenderSnapshot(input: CelestialRenderSnapshotInput): CelestialRenderSnapshot {
  validateInstant(input.instant);
  validateOrigin(input.origin);
  const ids = new Set<ObjectId>();
  input.bodies.forEach((body, index) => {
    validateBody(body, index);
    if (ids.has(body.objectId)) fail(`duplicate objectId ${body.objectId}`);
    ids.add(body.objectId);
  });
  if (input.revision !== undefined) nonEmpty("revision", input.revision);
  const bodies = Object.freeze(input.bodies.map((body) => Object.freeze({
    ...body,
    positionRelativeToOriginMeters: freezeVector(body.positionRelativeToOriginMeters),
    ...(body.velocityRelativeToOriginMetersPerSecond === undefined ? {} : {
      velocityRelativeToOriginMetersPerSecond: freezeVector(body.velocityRelativeToOriginMetersPerSecond),
    }),
  })));
  const origin = Object.freeze({ ...input.origin });
  const instant = Object.freeze({ seconds: input.instant.seconds, nanoseconds: input.instant.nanoseconds }) as SimulationInstant;
  const revision = input.revision;
  const fingerprint = stableFingerprint({ instant, origin, bodies, revision });
  return Object.freeze({ instant, origin, bodies, ...(revision === undefined ? {} : { revision }), fingerprint });
}
