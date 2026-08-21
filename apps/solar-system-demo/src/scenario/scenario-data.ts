import {
  ObjectType,
  PropagationDirection,
  PropagationModelKind,
  meters,
  metersPerSecond,
  objectId,
  propagationState,
  propagationTimeInterval,
  referenceFrameId,
  revisionId,
  simulationInstant,
  type ObjectId,
  type ObjectType as ObjectTypeValue,
  type PhysicalPropertiesInput,
  type PropagationState,
  type ReferenceFrameId,
} from "orbit-engine";

export const SCENARIO_EPOCH = simulationInstant(0);
export const SCENARIO_END = simulationInstant(31_557_600_000);
export const SCENARIO_VALIDITY = propagationTimeInterval(SCENARIO_EPOCH, SCENARIO_END);

export const SCENARIO_ROOT_FRAME = referenceFrameId("1");
export const SUN_CENTERED_FRAME = referenceFrameId("100");
export const EARTH_CENTERED_FRAME = referenceFrameId("101");

export const SUN_ID = objectId("1000");
export const MERCURY_ID = objectId("1001");
export const VENUS_ID = objectId("1002");
export const EARTH_ID = objectId("1003");
export const MOON_ID = objectId("1004");
export const MARS_ID = objectId("1005");
export const JUPITER_ID = objectId("1006");
export const SATURN_ID = objectId("1007");
export const URANUS_ID = objectId("1008");
export const NEPTUNE_ID = objectId("1009");

export interface OrbitVisualizationDefinition {
  readonly sampleSpanSeconds: number;
  readonly sampleCount: number;
  readonly closedReferenceOrbit: boolean;
}

function orbitVisualization(sampleSpanSeconds: number): OrbitVisualizationDefinition {
  return Object.freeze({ sampleSpanSeconds, sampleCount: 128, closedReferenceOrbit: true });
}

export interface ScenarioBodyDefinition {
  readonly id: ObjectId;
  readonly name: string;
  readonly type: ObjectTypeValue;
  readonly color: number;
  readonly propagationFrame: ReferenceFrameId;
  readonly centralBody?: ObjectId;
  readonly configurationRevision: string;
  readonly properties: PhysicalPropertiesInput;
  readonly anchor: PropagationState;
  readonly orbitVisualization?: OrbitVisualizationDefinition;
}

export const SCENARIO_PROVENANCE = Object.freeze({
  source: "NASA/JPL Solar System Dynamics reference data families",
  sourceUrls: Object.freeze([
    "https://ssd.jpl.nasa.gov/horizons/manual.html",
    "https://ssd.jpl.nasa.gov/planets/orbits.html",
  ]),
  retrievalDate: "2026-08-21",
  sourceEpoch: "J2000 TDB",
  sourceFrame: "ICRS/ICRF-aligned right-handed celestial axes",
  normalization: "SI metres, metres per second, kilograms, TDB seconds from J2000, and canonical decimal IDs",
  limitations: "The committed anchors are deterministic circularized educational fixture values, not a precision DE ephemeris extraction.",
} as const);

function anchor(
  x: number,
  y: number,
  z: number,
  velocityX: number,
  velocityY: number,
  velocityZ: number,
  frame: ReferenceFrameId,
): PropagationState {
  return propagationState({
    position: { x: meters(x), y: meters(y), z: meters(z) },
    velocity: { x: metersPerSecond(velocityX), y: metersPerSecond(velocityY), z: metersPerSecond(velocityZ) },
    epoch: SCENARIO_EPOCH,
    referenceFrame: frame,
  });
}

function body(
  id: ObjectId,
  name: string,
  type: ObjectTypeValue,
  color: number,
  propagationFrame: ReferenceFrameId,
  configurationRevision: string,
  properties: PhysicalPropertiesInput,
  state: PropagationState,
  centralBody?: ObjectId,
  orbitVisualizationDefinition?: OrbitVisualizationDefinition,
): ScenarioBodyDefinition {
  return Object.freeze({
    id,
    name,
    type,
    color,
    propagationFrame,
    configurationRevision,
    properties: Object.freeze({ ...properties }),
    anchor: state,
    ...(centralBody === undefined ? {} : { centralBody }),
    ...(orbitVisualizationDefinition === undefined ? {} : { orbitVisualization: orbitVisualizationDefinition }),
  });
}

export const SCENARIO_BODIES: readonly ScenarioBodyDefinition[] = Object.freeze([
  body(
    SUN_ID,
    "Sun",
    ObjectType.star,
    0xffd166,
    SCENARIO_ROOT_FRAME,
    "1",
    { mass: 1.98847e30, mu: 1.32712440018e20, physicalRadius: 695_700_000 },
    anchor(0, 0, 0, 0, 0, 0, SCENARIO_ROOT_FRAME),
  ),
  body(
    MERCURY_ID,
    "Mercury",
    ObjectType.planet,
    0xb8a99a,
    SUN_CENTERED_FRAME,
    "2",
    { mass: 3.3011e23, mu: 2.2032e13, physicalRadius: 2_439_700 },
    anchor(56_754_897_931.32163, 11_504_787_374.949291, 0, -9_510.706115768091, 46_917.78624527545, 0, SUN_CENTERED_FRAME),
    SUN_ID,
    orbitVisualization(7_600_000),
  ),
  body(
    VENUS_ID,
    "Venus",
    ObjectType.planet,
    0xd6b27a,
    SUN_CENTERED_FRAME,
    "3",
    { mass: 4.8675e24, mu: 3.24859e14, physicalRadius: 6_051_800 },
    anchor(58_465_828_859.28082, 91_055_133_493.79546, 0, -29_468.79092110239, 18_921.69305095249, 0, SUN_CENTERED_FRAME),
    SUN_ID,
    orbitVisualization(19_400_000),
  ),
  body(
    EARTH_ID,
    "Earth",
    ObjectType.planet,
    0x4f83cc,
    SUN_CENTERED_FRAME,
    "4",
    { mass: 5.97219e24, mu: 3.986004418e14, physicalRadius: 6_371_000 },
    anchor(-62_254_680_645.99345, 136_028_958_886.11104, 0, -27_083.143641357805, -12_394.805283292137, 0, SUN_CENTERED_FRAME),
    SUN_ID,
    orbitVisualization(31_557_600),
  ),
  body(
    MARS_ID,
    "Mars",
    ObjectType.planet,
    0xc85b3c,
    SUN_CENTERED_FRAME,
    "5",
    { mass: 6.4171e23, mu: 4.282837e13, physicalRadius: 3_389_500 },
    anchor(-214_769_406_554.1414, 76_356_930_956.01689, 0, -8_083.059055501473, -22_735.248454290246, 0, SUN_CENTERED_FRAME),
    SUN_ID,
    orbitVisualization(59_400_000),
  ),
  body(
    JUPITER_ID,
    "Jupiter",
    ObjectType.planet,
    0xd5a06e,
    SUN_CENTERED_FRAME,
    "6",
    { mass: 1.89813e27, mu: 1.26686534e17, physicalRadius: 69_911_000 },
    anchor(-508_757_512_504.3964, -589_050_275_532.8215, 0, 9_882.196114454531, -8_535.165370600633, 0, SUN_CENTERED_FRAME),
    SUN_ID,
    orbitVisualization(374_000_000),
  ),
  body(
    SATURN_ID,
    "Saturn",
    ObjectType.planet,
    0xd8bd83,
    SUN_CENTERED_FRAME,
    "7",
    { mass: 5.6834e26, mu: 3.7931187e16, physicalRadius: 58_232_000 },
    anchor(124_831_861_632.19225, -1_421_194_598_210.8584, 0, 9_607.838746010182, 843.912859249703, 0, SUN_CENTERED_FRAME),
    SUN_ID,
    orbitVisualization(929_000_000),
  ),
  body(
    URANUS_ID,
    "Uranus",
    ObjectType.planet,
    0x8ac6d1,
    SUN_CENTERED_FRAME,
    "8",
    { mass: 8.6810e25, mu: 5.793939e15, physicalRadius: 25_362_000 },
    anchor(1_591_419_226_261.024, -2_389_155_345_961.324, 0, 5_658.8473782743295, 3_769.364989801019, 0, SUN_CENTERED_FRAME),
    SUN_ID,
    orbitVisualization(2_650_000_000),
  ),
  body(
    NEPTUNE_ID,
    "Neptune",
    ObjectType.planet,
    0x4666c8,
    SUN_CENTERED_FRAME,
    "9",
    { mass: 1.02413e26, mu: 6.836529e15, physicalRadius: 24_622_000 },
    anchor(3_983_417_843_444.868, -2_089_964_790_355.6897, 0, 2_523.5283977712284, 4_809.778659673478, 0, SUN_CENTERED_FRAME),
    SUN_ID,
    orbitVisualization(5_200_000_000),
  ),
  body(
    MOON_ID,
    "Moon",
    ObjectType.moon,
    0xbfc4cf,
    EARTH_CENTERED_FRAME,
    "10",
    { mass: 7.342e22, mu: 4.9048695e12, physicalRadius: 1_737_400 },
    anchor(294_005_336.79215735, 247_637_278.97416842, 0, -656.0090681046934, 778.8414079083318, 0, EARTH_CENTERED_FRAME),
    EARTH_ID,
    orbitVisualization(2_360_000),
  ),
]);

export const SCENARIO_OBJECT_IDS = Object.freeze(SCENARIO_BODIES.map((value) => value.id));

export const SCENARIO_MOTION = Object.freeze({
  modelKind: PropagationModelKind.twoBodyAnalytical,
  direction: PropagationDirection.bidirectional,
  motionRevision: revisionId("1"),
});
