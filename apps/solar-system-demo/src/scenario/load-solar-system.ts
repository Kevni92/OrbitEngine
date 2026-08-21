import {
  createReferenceEphemerisModel,
  PropagationModelKind,
  ReferenceStatus,
  revisionId,
  type ObjectRecord,
  type ObjectId,
  type OrbitEngine,
  type PropagationModel,
  type ReferenceFrameId,
} from "orbit-engine";
import {
  createCelestialCatalog,
  type CelestialCatalog,
  type CelestialBodyDefinition,
  type CelestialCenteredFrameDefinition,
} from "./celestial-catalog.js";
import {
  EARTH_ID,
  SCENARIO_BODIES,
  SCENARIO_CENTERED_FRAMES,
  SCENARIO_EPOCH,
  SCENARIO_PROVENANCE,
  SCENARIO_ROOT_FRAME,
  SCENARIO_VALIDITY,
  SUN_ID,
  type ScenarioBodyDefinition,
} from "./scenario-data.js";

export interface RegisteredScenarioBody {
  readonly definition: ScenarioBodyDefinition;
  readonly record: ObjectRecord;
}

export interface SolarSystemScenario {
  readonly epoch: typeof SCENARIO_EPOCH;
  readonly validity: typeof SCENARIO_VALIDITY;
  readonly provenance: typeof SCENARIO_PROVENANCE;
  readonly catalog: CelestialCatalog;
  readonly centeredFrames: readonly CelestialCenteredFrameDefinition[];
  readonly rootFrame: ReferenceFrameId;
  /** Compatibility shortcuts for the demo's existing camera/state code. */
  readonly sunCenteredFrame: ReferenceFrameId;
  readonly earthCenteredFrame: ReferenceFrameId;
  readonly bodies: readonly RegisteredScenarioBody[];
  readonly bodyById: ReadonlyMap<ObjectId, RegisteredScenarioBody>;
  readonly objectIds: readonly ObjectId[];
}

function motionMetadata(definition: CelestialBodyDefinition) {
  return {
    modelKind: definition.propagation.modelKind,
    direction: definition.propagation.direction,
    propagationFrame: definition.propagation.propagationFrame,
    segmentStart: SCENARIO_EPOCH,
    segmentEnd: SCENARIO_VALIDITY.end,
    configurationRevision: revisionId(definition.propagation.configurationRevision),
    motionRevision: revisionId("1"),
  } as const;
}

function registerRoot(engine: OrbitEngine, definition: CelestialBodyDefinition): RegisteredScenarioBody {
  if (definition.propagation.modelKind !== PropagationModelKind.referenceEphemeris) {
    throw new RangeError(`Catalog root ${definition.id} must use a reference ephemeris model`);
  }
  const record = engine.registry().register({
    id: definition.id,
    type: definition.type,
    properties: definition.properties,
    state: definition.anchor,
    motion: motionMetadata(definition),
    referenceStatus: ReferenceStatus.followingReference,
  });
  const direction = definition.propagation.direction;
  if (direction !== "bidirectional" && direction !== "bounded") {
    throw new RangeError(`Catalog root ${definition.id} uses unsupported reference direction ${direction}`);
  }
  const model = createReferenceEphemerisModel({
    validity: SCENARIO_VALIDITY,
    direction,
    propagationFrame: definition.propagation.propagationFrame,
    sourceRevision: revisionId(definition.propagation.configurationRevision),
    dependencies: [],
    errorContract: {},
    evaluate: (target) => ({ ...definition.anchor, epoch: target }),
  });
  engine.bindMotionModel(definition.id, model);
  return Object.freeze({ definition, record });
}

function twoBodyModel(
  engine: OrbitEngine,
  definition: CelestialBodyDefinition,
  centralBody: RegisteredScenarioBody,
): PropagationModel {
  if (definition.propagation.modelKind !== PropagationModelKind.twoBodyAnalytical) {
    throw new RangeError(`Catalog body ${definition.id} uses unsupported model ${definition.propagation.modelKind}`);
  }
  if (definition.propagation.direction !== "bidirectional") {
    throw new RangeError(`Catalog two-body body ${definition.id} must use bidirectional propagation`);
  }
  const mu = centralBody.record.properties.mu;
  if (mu === undefined) throw new RangeError(`Catalog central body ${centralBody.definition.id} has no gravitational parameter`);
  return engine.twoBodyModel({
    anchor: definition.anchor,
    centralBody: centralBody.definition.id,
    centralBodyRevision: centralBody.record.motion.motionRevision,
    mu,
    muRevision: centralBody.record.propertyRevision,
    propagationFrame: definition.propagation.propagationFrame,
    frameRevision: revisionId("1"),
    validity: SCENARIO_VALIDITY,
    configurationRevision: revisionId(definition.propagation.configurationRevision),
  });
}

function registerChild(
  engine: OrbitEngine,
  definition: CelestialBodyDefinition,
  centralBody: RegisteredScenarioBody,
): RegisteredScenarioBody {
  const record = engine.registry().register({
    id: definition.id,
    type: definition.type,
    properties: definition.properties,
    state: definition.anchor,
    motion: motionMetadata(definition),
  });
  engine.bindMotionModel(definition.id, twoBodyModel(engine, definition, centralBody));
  return Object.freeze({ definition, record });
}

function registerCenteredFrame(engine: OrbitEngine, frame: CelestialCenteredFrameDefinition): void {
  engine.frames().register({
    id: frame.id,
    parent: frame.parent,
    provider: {
      kind: "objectCentered",
      source: engine.objectStateSource(frame.centerBody, frame.parent),
      revision: revisionId("1"),
    },
  });
}

export function loadSolarSystemScenario(engine: OrbitEngine): SolarSystemScenario {
  const catalog = createCelestialCatalog(SCENARIO_BODIES, SCENARIO_CENTERED_FRAMES);
  const definitions = catalog.bodyById;
  const registered = new Map<ObjectId, RegisteredScenarioBody>();
  const centeredFrames = new Map(catalog.frameByCenterBody);

  for (const id of catalog.registrationOrder) {
    const definition = definitions.get(id)!;
    const value = definition.centralBody === undefined
      ? registerRoot(engine, definition)
      : registerChild(engine, definition, registered.get(definition.centralBody)!);
    registered.set(id, value);

    const centeredFrame = centeredFrames.get(id);
    if (centeredFrame !== undefined) registerCenteredFrame(engine, centeredFrame);
  }

  const bodies = Object.freeze(catalog.registrationOrder.map((id) => registered.get(id)!));
  const bodyById = new Map(bodies.map((body) => [body.definition.id, body]));
  const sunCenteredFrame = catalog.frameForCenter(SUN_ID)?.id;
  const earthCenteredFrame = catalog.frameForCenter(EARTH_ID)?.id;
  if (sunCenteredFrame === undefined || earthCenteredFrame === undefined) {
    throw new RangeError("Catalog must define centered frames for the Sun and Earth");
  }
  return Object.freeze({
    epoch: SCENARIO_EPOCH,
    validity: SCENARIO_VALIDITY,
    provenance: SCENARIO_PROVENANCE,
    catalog,
    centeredFrames: SCENARIO_CENTERED_FRAMES,
    rootFrame: SCENARIO_ROOT_FRAME,
    sunCenteredFrame,
    earthCenteredFrame,
    bodies,
    bodyById,
    objectIds: catalog.registrationOrder,
  });
}
