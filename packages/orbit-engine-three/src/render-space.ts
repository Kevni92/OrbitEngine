export interface RenderVector3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Row-major 3x3 transform from authoritative snapshot axes to render axes. */
export type PresentationAxisTransform = readonly [
  number, number, number,
  number, number, number,
  number, number, number,
];

export const IDENTITY_PRESENTATION_AXIS_TRANSFORM: PresentationAxisTransform = Object.freeze([
  1, 0, 0,
  0, 1, 0,
  0, 0, 1,
]);

export interface RenderSpaceConfig {
  readonly metersPerSceneUnit: number;
  readonly presentationAxisTransform: PresentationAxisTransform;
}

function finite(name: string, value: number): void {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
}

function validateVector(name: string, value: RenderVector3): void {
  finite(`${name}.x`, value.x);
  finite(`${name}.y`, value.y);
  finite(`${name}.z`, value.z);
}

function validateTransform(transform: PresentationAxisTransform): void {
  if (transform.length !== 9) throw new RangeError("presentation axis transform must contain nine values");
  transform.forEach((value, index) => finite(`presentationAxisTransform[${index}]`, value));
}

export function createRenderSpaceConfig(input: Partial<RenderSpaceConfig> = {}): RenderSpaceConfig {
  const metersPerSceneUnit = input.metersPerSceneUnit ?? 1;
  finite("metersPerSceneUnit", metersPerSceneUnit);
  if (metersPerSceneUnit <= 0) throw new RangeError("metersPerSceneUnit must be positive");
  const presentationAxisTransform = input.presentationAxisTransform ?? IDENTITY_PRESENTATION_AXIS_TRANSFORM;
  validateTransform(presentationAxisTransform);
  return Object.freeze({
    metersPerSceneUnit,
    presentationAxisTransform: Object.freeze([...presentationAxisTransform]) as PresentationAxisTransform,
  });
}

export function transformSnapshotPositionToSceneUnits(position: RenderVector3, config: RenderSpaceConfig): RenderVector3 {
  validateVector("positionRelativeToOriginMeters", position);
  const transform = config.presentationAxisTransform;
  const x = transform[0] * position.x + transform[1] * position.y + transform[2] * position.z;
  const y = transform[3] * position.x + transform[4] * position.y + transform[5] * position.z;
  const z = transform[6] * position.x + transform[7] * position.y + transform[8] * position.z;
  return Object.freeze({
    x: x / config.metersPerSceneUnit,
    y: y / config.metersPerSceneUnit,
    z: z / config.metersPerSceneUnit,
  });
}

export function transformSnapshotDirectionToRenderSpace(direction: RenderVector3, config: RenderSpaceConfig): RenderVector3 {
  validateVector("direction", direction);
  const transform = config.presentationAxisTransform;
  const x = transform[0] * direction.x + transform[1] * direction.y + transform[2] * direction.z;
  const y = transform[3] * direction.x + transform[4] * direction.y + transform[5] * direction.z;
  const z = transform[6] * direction.x + transform[7] * direction.y + transform[8] * direction.z;
  const length = Math.hypot(x, y, z);
  if (!Number.isFinite(length) || length <= 0) throw new RangeError("direction must be non-zero after axis transform");
  return Object.freeze({ x: x / length, y: y / length, z: z / length });
}

export function transformSceneUnitsToSnapshotPosition(position: RenderVector3, config: RenderSpaceConfig): RenderVector3 {
  validateVector("scenePosition", position);
  const transform = config.presentationAxisTransform;
  const x = position.x * config.metersPerSceneUnit;
  const y = position.y * config.metersPerSceneUnit;
  const z = position.z * config.metersPerSceneUnit;
  return Object.freeze({
    x: transform[0] * x + transform[3] * y + transform[6] * z,
    y: transform[1] * x + transform[4] * y + transform[7] * z,
    z: transform[2] * x + transform[5] * y + transform[8] * z,
  });
}
