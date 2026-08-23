import {
  PropagationModelKind,
  ReferenceStatus,
  revisionId,
  referenceFrameId,
  type ObjectRecord,
  type ObjectId,
  type OepDataset,
  type OepDatasetIdentity,
  type OrbitEngine,
  type PropagationModel,
  type ReferenceFrameId,
  type RegisteredEphemerisFrameHandle,
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
  validateScenarioAnchorSanity,
  type ScenarioBodyDefinition,
} from "./scenario-data.js";
import type { EclipseOracleAsset } from "./load-reference-dataset.js";

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
  /** Present for the production-loaded demo; omitted by isolated rendering fixtures. */
  readonly referenceDataset?: OepDatasetIdentity;
  readonly referenceSources?: ReadonlyMap<ObjectId, ReturnType<OepDataset["sourceInfo"]>>;
  readonly sourceFrameHandles?: readonly RegisteredEphemerisFrameHandle[];
  readonly eclipseOracle?: EclipseOracleAsset;
}

function motionMetadata(definition: CelestialBodyDefinition, validity = SCENARIO_VALIDITY, sourceRevision = definition.propagation.configurationRevision) {
  return {
    modelKind: definition.propagation.modelKind,
    direction: definition.propagation.direction,
    propagationFrame: definition.propagation.propagationFrame,
    segmentStart: validity.start,
    segmentEnd: validity.end,
    configurationRevision: revisionId(sourceRevision),
    motionRevision: revisionId("1"),
  } as const;
}

function registerReferenceBody(
  engine: OrbitEngine,
  dataset: OepDataset,
  definition: CelestialBodyDefinition,
): RegisteredScenarioBody {
  const sourceNodeId = definition.propagation.referenceSourceNodeId;
  if (sourceNodeId === undefined || definition.propagation.modelKind !== PropagationModelKind.referenceEphemeris) {
    throw new RangeError(`Catalog body ${definition.id} is not a reference-ephemeris body`);
  }
  const source = dataset.sourceInfo(sourceNodeId);
  const record = engine.registry().register({
    id: definition.id,
    type: definition.type,
    properties: definition.properties,
    state: definition.anchor,
    motion: motionMetadata(definition, source.effectiveValidity, source.sourceRevision),
    referenceStatus: ReferenceStatus.followingReference,
  });
  engine.bindReferenceEphemeris(
    definition.id,
    dataset,
    sourceNodeId,
    definition.propagation.propagationFrame,
  );
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

export function registerScenarioChild(
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

export function loadSolarSystemScenario(engine: OrbitEngine, dataset: OepDataset, eclipseOracle: EclipseOracleAsset): SolarSystemScenario {
  validateScenarioAnchorSanity();
  const catalog = createCelestialCatalog(SCENARIO_BODIES, SCENARIO_CENTERED_FRAMES);
  const definitions = catalog.bodyById;
  const registered = new Map<ObjectId, RegisteredScenarioBody>();
  const centeredFrames = new Map(catalog.frameByCenterBody);
  const sourceFrameHandles = [
    engine.registerEphemerisSourceFrame(dataset, referenceFrameId("201"), 1),
    engine.registerEphemerisSourceFrame(dataset, referenceFrameId("202"), 3),
    engine.registerEphemerisSourceFrame(dataset, referenceFrameId("203"), 5),
  ];
  const referenceSources = new Map<ObjectId, ReturnType<OepDataset["sourceInfo"]>>();

  for (const id of catalog.registrationOrder) {
    const definition = definitions.get(id)!;
    const value = definition.propagation.referenceSourceNodeId === undefined
      ? registerScenarioChild(engine, definition, registered.get(definition.centralBody!)!)
      : registerReferenceBody(engine, dataset, definition);
    if (definition.propagation.referenceSourceNodeId !== undefined) {
      referenceSources.set(id, dataset.sourceInfo(definition.propagation.referenceSourceNodeId));
    }
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
    validity: dataset.sourceInfo(14).effectiveValidity,
    provenance: SCENARIO_PROVENANCE,
    catalog,
    centeredFrames: SCENARIO_CENTERED_FRAMES,
    rootFrame: SCENARIO_ROOT_FRAME,
    sunCenteredFrame,
    earthCenteredFrame,
    bodies,
    bodyById,
    objectIds: catalog.registrationOrder,
    referenceDataset: dataset.identity,
    referenceSources,
    sourceFrameHandles,
    eclipseOracle,
  });
}
