import {
  OepRepresentation,
  OrbitEngine,
  ROOT_REFERENCE_FRAME_ID,
  evaluatePropagationModel,
  propagationTimeInterval,
  revisionId,
  simulationInstant,
  duration,
  kilograms,
  meters,
  metersPerSecond,
  metersPerSecondSquared,
  objectId,
  propagationState,
  referenceFrameId,
  vec3,
  type OepLoadInput,
} from "orbit-engine";

const status = document.querySelector<HTMLParagraphElement>("#status");
const TWO_TO_32 = 4_294_967_296;

function setStatus(value: "ready" | "error", message: string): void {
  if (status === null) return;
  status.dataset.orbitEngineSmoke = value;
  status.textContent = message;
}

function browserFixture(): OepLoadInput {
  const bytes = new Uint8Array(136);
  const view = new DataView(bytes.buffer);
  let offset = 0;
  const raw = (value: string) => {
    for (let index = 0; index < value.length; index += 1) bytes[offset++] = value.charCodeAt(index);
  };
  const u16 = (value: number) => { view.setUint16(offset, value, true); offset += 2; };
  const u32 = (value: number) => { view.setUint32(offset, value, true); offset += 4; };
  const f64 = (value: number) => { view.setFloat64(offset, value, true); offset += 8; };
  const time = (seconds: number) => {
    const high = Math.floor(seconds / TWO_TO_32);
    const low = seconds - high * TWO_TO_32;
    view.setInt32(offset, high, true);
    offset += 4;
    u32(low);
    u32(0);
  };

  raw("OEPB");
  u16(1);
  u16(0);
  u32(136);
  u32(1);
  u32(0);
  u32(0);
  u32(1);
  u16(1);
  u16(3);
  time(-10);
  time(10);
  f64(0);
  f64(10);
  u32(2);
  u32(88);
  u32(48);
  u32(0);
  for (const coefficient of [100, 20, 0, 0, 0, 0]) f64(coefficient);
  if (offset !== bytes.byteLength) throw new Error("Browser OEP fixture size mismatch");

  return Object.freeze({
    manifestSha256: "1111111111111111111111111111111111111111111111111111111111111111",
    manifest: Object.freeze({
      schemaVersion: 1 as const,
      datasetId: "browser-smoke",
      datasetVersion: "1",
      normalizationPolicyVersion: "test-v1",
      canonicalTimeScale: "TDB" as const,
      canonicalEpoch: "J2000 TDB" as const,
      canonicalSpatialFrame: "SSB + ICRS/ICRF-aligned" as const,
      sourceNodes: Object.freeze([Object.freeze({
        id: 1,
        representation: OepRepresentation.positionChebyshev,
        validity: propagationTimeInterval(simulationInstant(-10), simulationInstant(10)),
        sourceRevision: revisionId("1"),
        normalizedAxes: "ICRS/ICRF-aligned" as const,
        normalizationErrorBudget: Object.freeze({ positionMeters: 0, velocityMetersPerSecond: 0 }),
      })]),
      shards: Object.freeze([Object.freeze({
        id: "smoke",
        sha256: "c44f2c6c52ff08d4ede4071dae5639c5f19ef57a3505289bc45ef5f185abc16d",
      })]),
    }),
    shards: Object.freeze([Object.freeze({ id: "smoke", bytes })]),
  });
}

try {
  const engine = await OrbitEngine.create({ backend: "wasm" });
  const health = engine.health();
  if (health.backend !== "wasm" || health.healthCode !== 42) {
    throw new Error("Unexpected WASM engine health");
  }

  const dataset = await engine.loadEphemerisPack(browserFixture());
  const handle = dataset.referenceModel(1, ROOT_REFERENCE_FRAME_ID);
  const state = evaluatePropagationModel(handle.model, simulationInstant(0), { currentTime: simulationInstant(0) });
  if (state.position.x !== 100 || state.velocity.x !== 2 || state.referenceFrame !== ROOT_REFERENCE_FRAME_ID) {
    throw new Error("Unexpected browser OEP reference state");
  }
  handle.release();
  dataset.unload();

  const numerical = engine.numericalMotion({
    objectId: objectId("42"),
    anchor: propagationState({
      position: vec3(meters(1), meters(0), meters(0)),
      velocity: vec3(metersPerSecond(3), metersPerSecond(0), metersPerSecond(0)),
      epoch: simulationInstant(0),
      referenceFrame: referenceFrameId("1"),
    }),
    configurationRevision: revisionId("1"),
    motionRevision: revisionId("2"),
    relativeTolerance: 1e-12,
    positionAbsoluteToleranceMeters: 1e-10,
    velocityAbsoluteToleranceMetersPerSecond: 1e-12,
    minStep: duration(0, 1),
    maxStep: duration(1),
    mass: kilograms(4),
    constantAcceleration: vec3(
      metersPerSecondSquared(2),
      metersPerSecondSquared(0),
      metersPerSecondSquared(0),
    ),
  });
  const numericalState = numerical.stateAt(simulationInstant(2));
  if (Math.abs(numericalState.position.x - 11) > 1e-8
      || Math.abs(numericalState.velocity.x - 7) > 1e-9) {
    throw new Error("Unexpected browser numerical state");
  }

  setStatus(
    "ready",
    `ready:${health.protocolVersion}:${health.coreVersion}:${health.healthCode}:oep:${state.position.x}:${state.velocity.x}:numerical:${Math.round(numericalState.position.x)}`,
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  setStatus("error", `error:${message}`);
}
