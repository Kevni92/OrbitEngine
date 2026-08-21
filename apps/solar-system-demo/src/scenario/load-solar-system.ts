import {
  createReferenceEphemerisModel,
  PropagationDirection,
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
  EARTH_CENTERED_FRAME,
  EARTH_ID,
  SCENARIO_BODIES,
  SCENARIO_EPOCH,
  SCENARIO_MOTION,
  SCENARIO_OBJECT_IDS,
  SCENARIO_PROVENANCE,
  SCENARIO_ROOT_FRAME,
  SCENARIO_VALIDITY,
  SUN_CENTERED_FRAME,
  SUN_ID,
  MARS_ID,
  JUPITER_ID,
  SATURN_ID,
  URANUS_ID,
  NEPTUNE_ID,
  MERCURY_ID,
  VENUS_ID,
  MOON_ID,
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
  readonly rootFrame: ReferenceFrameId;
  readonly sunCenteredFrame: ReferenceFrameId;
  readonly earthCenteredFrame: ReferenceFrameId;
  readonly bodies: readonly RegisteredScenarioBody[];
  readonly bodyById: ReadonlyMap<ObjectId, RegisteredScenarioBody>;
  readonly objectIds: readonly ObjectId[];
}

function registerMotion(definition: ScenarioBodyDefinition): {
  readonly modelKind: typeof PropagationModelKind[keyof typeof PropagationModelKind];
  readonly direction: typeof PropagationDirection[keyof typeof PropagationDirection];
  readonly propagationFrame: ReferenceFrameId;
  readonly segmentStart: typeof SCENARIO_EPOCH;
  readonly segmentEnd: typeof SCENARIO_VALIDITY.end;
  readonly configurationRevision: ReturnType<typeof revisionId>;
  readonly motionRevision: ReturnType<typeof revisionId>;
} {
  return {
    modelKind: definition.id === SUN_ID ? PropagationModelKind.referenceEphemeris : SCENARIO_MOTION.modelKind,
    direction: definition.id === SUN_ID ? PropagationDirection.bidirectional : SCENARIO_MOTION.direction,
    propagationFrame: definition.propagationFrame,
    segmentStart: SCENARIO_EPOCH,
    segmentEnd: SCENARIO_VALIDITY.end,
    configurationRevision: revisionId(definition.configurationRevision),
    motionRevision: SCENARIO_MOTION.motionRevision,
  };
}

function registerSun(engine: OrbitEngine, definition: ScenarioBodyDefinition): RegisteredScenarioBody {
  const record = engine.registry().register({
    id: definition.id,
    type: definition.type,
    properties: definition.properties,
    state: definition.anchor,
    motion: registerMotion(definition),
    referenceStatus: ReferenceStatus.followingReference,
  });
  const model = createReferenceEphemerisModel({
    validity: SCENARIO_VALIDITY,
    direction: "bidirectional",
    propagationFrame: SCENARIO_ROOT_FRAME,
    sourceRevision: revisionId(definition.configurationRevision),
    dependencies: [],
    errorContract: {},
    evaluate: (target) => ({ ...definition.anchor, epoch: target }),
  });
  engine.bindMotionModel(definition.id, model);
  return Object.freeze({ definition, record });
}

function twoBodyModel(engine: OrbitEngine, definition: ScenarioBodyDefinition, centralBody: RegisteredScenarioBody): PropagationModel {
  return engine.twoBodyModel({
    anchor: definition.anchor,
    centralBody: centralBody.definition.id,
    centralBodyRevision: centralBody.record.motion.motionRevision,
    mu: centralBody.record.properties.mu!,
    muRevision: centralBody.record.propertyRevision,
    propagationFrame: definition.propagationFrame,
    frameRevision: revisionId("1"),
    validity: SCENARIO_VALIDITY,
    configurationRevision: revisionId(definition.configurationRevision),
  });
}

function registerTwoBody(
  engine: OrbitEngine,
  definition: ScenarioBodyDefinition,
  centralBody: RegisteredScenarioBody,
): RegisteredScenarioBody {
  const record = engine.registry().register({
    id: definition.id,
    type: definition.type,
    properties: definition.properties,
    state: definition.anchor,
    motion: registerMotion(definition),
  });
  engine.bindMotionModel(definition.id, twoBodyModel(engine, definition, centralBody));
  return Object.freeze({ definition, record });
}

function registerCenteredFrame(engine: OrbitEngine, id: ReferenceFrameId, parent: ReferenceFrameId, source: ObjectId): void {
  engine.frames().register({
    id,
    parent,
    provider: {
      kind: "objectCentered",
      source: engine.objectStateSource(source, parent),
      revision: revisionId("1"),
    },
  });
}

export function loadSolarSystemScenario(engine: OrbitEngine): SolarSystemScenario {
  const definitions = new Map(SCENARIO_BODIES.map((definition) => [definition.id, definition]));
  const registered = new Map<ObjectId, RegisteredScenarioBody>();

  const sunDefinition = definitions.get(SUN_ID)!;
  const sun = registerSun(engine, sunDefinition);
  registered.set(SUN_ID, sun);

  registerCenteredFrame(engine, SUN_CENTERED_FRAME, SCENARIO_ROOT_FRAME, SUN_ID);

  for (const id of [MERCURY_ID, VENUS_ID, EARTH_ID] as const) {
    const definition = definitions.get(id)!;
    const value = registerTwoBody(engine, definition, sun);
    registered.set(definition.id, value);
  }

  const earth = registered.get(EARTH_ID)!;
  registerCenteredFrame(engine, EARTH_CENTERED_FRAME, SUN_CENTERED_FRAME, EARTH_ID);

  for (const id of [MARS_ID, JUPITER_ID, SATURN_ID, URANUS_ID, NEPTUNE_ID] as const) {
    const definition = definitions.get(id)!;
    const value = registerTwoBody(engine, definition, sun);
    registered.set(definition.id, value);
  }

  const moonDefinition = definitions.get(MOON_ID)!;
  const moon = registerTwoBody(engine, moonDefinition, earth);
  registered.set(moonDefinition.id, moon);

  const bodies = Object.freeze(SCENARIO_OBJECT_IDS.map((id) => registered.get(id)!));
  return Object.freeze({
    epoch: SCENARIO_EPOCH,
    validity: SCENARIO_VALIDITY,
    provenance: SCENARIO_PROVENANCE,
    rootFrame: SCENARIO_ROOT_FRAME,
    sunCenteredFrame: SUN_CENTERED_FRAME,
    earthCenteredFrame: EARTH_CENTERED_FRAME,
    bodies,
    bodyById: new Map(bodies.map((body) => [body.definition.id, body])),
    objectIds: SCENARIO_OBJECT_IDS,
  });
}
