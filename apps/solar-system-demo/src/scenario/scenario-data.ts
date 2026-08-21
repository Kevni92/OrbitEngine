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
import type {
  CelestialBodyDefinition,
  CelestialCatalogCategory,
  CelestialCenteredFrameDefinition,
  CelestialSourceProvenance,
  OrbitVisualizationDefinition,
} from "./celestial-catalog.js";

export const SCENARIO_EPOCH = simulationInstant(0);
export const SCENARIO_END = simulationInstant(31_557_600_000);
export const SCENARIO_VALIDITY = propagationTimeInterval(SCENARIO_EPOCH, SCENARIO_END);

export const SCENARIO_ROOT_FRAME = referenceFrameId("1");
export const SUN_CENTERED_FRAME = referenceFrameId("100");
export const EARTH_CENTERED_FRAME = referenceFrameId("101");
export const MARS_CENTERED_FRAME = referenceFrameId("102");
export const JUPITER_CENTERED_FRAME = referenceFrameId("103");
export const SATURN_CENTERED_FRAME = referenceFrameId("104");
export const URANUS_CENTERED_FRAME = referenceFrameId("105");
export const NEPTUNE_CENTERED_FRAME = referenceFrameId("106");
export const PLUTO_CENTERED_FRAME = referenceFrameId("107");

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
export const PHOBOS_ID = objectId("1101");
export const DEIMOS_ID = objectId("1102");
export const IO_ID = objectId("1201");
export const EUROPA_ID = objectId("1202");
export const GANYMEDE_ID = objectId("1203");
export const CALLISTO_ID = objectId("1204");
export const AMALTHEA_ID = objectId("1205");
export const MIMAS_ID = objectId("1301");
export const ENCELADUS_ID = objectId("1302");
export const TETHYS_ID = objectId("1303");
export const DIONE_ID = objectId("1304");
export const RHEA_ID = objectId("1305");
export const TITAN_ID = objectId("1306");
export const HYPERION_ID = objectId("1307");
export const IAPETUS_ID = objectId("1308");
export const PHOEBE_ID = objectId("1309");
export const MIRANDA_ID = objectId("1401");
export const ARIEL_ID = objectId("1402");
export const UMBRIEL_ID = objectId("1403");
export const TITANIA_ID = objectId("1404");
export const OBERON_ID = objectId("1405");
export const TRITON_ID = objectId("1501");
export const NEREID_ID = objectId("1502");
export const PROTEUS_ID = objectId("1503");
export const LARISSA_ID = objectId("1504");
export const CERES_ID = objectId("2001");
export const PLUTO_ID = objectId("2002");
export const HAUMEA_ID = objectId("2003");
export const MAKEMAKE_ID = objectId("2004");
export const ERIS_ID = objectId("2005");
export const CHARON_ID = objectId("2006");
export const VESTA_ID = objectId("3001");
export const PALLAS_ID = objectId("3002");
export const HYGIEA_ID = objectId("3003");
export const EROS_ID = objectId("3004");
export const BENNU_ID = objectId("3005");
export const RYUGU_ID = objectId("3006");
export const APOPHIS_ID = objectId("3007");

function orbitVisualization(sampleSpanSeconds: number): OrbitVisualizationDefinition {
  return Object.freeze({ sampleSpanSeconds, sampleCount: 128, closedReferenceOrbit: true });
}

export type ScenarioBodyDefinition = CelestialBodyDefinition;
export type { CelestialCatalogCategory, CelestialCenteredFrameDefinition, CelestialSourceProvenance, OrbitVisualizationDefinition };

export const SCENARIO_PROVENANCE = Object.freeze({
  source: "NASA/JPL Solar System Dynamics reference data families",
  sourceUrls: Object.freeze([
    "https://ssd-api.jpl.nasa.gov/doc/horizons.html",
    "https://ssd.jpl.nasa.gov/horizons/manual.html",
    "https://ssd.jpl.nasa.gov/planets/orbits.html",
  ]),
  retrievalDate: "2026-08-21",
  sourceEpoch: "J2000 TDB",
  sourceFrame: "ICRS/ICRF-aligned right-handed celestial axes",
  normalization: "SI metres, metres per second, kilograms, TDB seconds from J2000, and canonical decimal IDs",
  limitations: "The committed anchors are deterministic circularized educational fixture values, not a precision DE ephemeris extraction.",
} as const);

export const SCENARIO_CENTERED_FRAMES: readonly CelestialCenteredFrameDefinition[] = Object.freeze([
  Object.freeze({ id: SUN_CENTERED_FRAME, centerBody: SUN_ID, parent: SCENARIO_ROOT_FRAME }),
  Object.freeze({ id: EARTH_CENTERED_FRAME, centerBody: EARTH_ID, parent: SUN_CENTERED_FRAME }),
  Object.freeze({ id: MARS_CENTERED_FRAME, centerBody: MARS_ID, parent: SUN_CENTERED_FRAME }),
  Object.freeze({ id: JUPITER_CENTERED_FRAME, centerBody: JUPITER_ID, parent: SUN_CENTERED_FRAME }),
  Object.freeze({ id: SATURN_CENTERED_FRAME, centerBody: SATURN_ID, parent: SUN_CENTERED_FRAME }),
  Object.freeze({ id: URANUS_CENTERED_FRAME, centerBody: URANUS_ID, parent: SUN_CENTERED_FRAME }),
  Object.freeze({ id: NEPTUNE_CENTERED_FRAME, centerBody: NEPTUNE_ID, parent: SUN_CENTERED_FRAME }),
  Object.freeze({ id: PLUTO_CENTERED_FRAME, centerBody: PLUTO_ID, parent: SUN_CENTERED_FRAME }),
]);

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

function horizonsAnchor(
  xKilometres: number,
  yKilometres: number,
  zKilometres: number,
  velocityXKilometresPerSecond: number,
  velocityYKilometresPerSecond: number,
  velocityZKilometresPerSecond: number,
  frame: ReferenceFrameId,
): PropagationState {
  return anchor(
    xKilometres * 1_000,
    yKilometres * 1_000,
    zKilometres * 1_000,
    velocityXKilometresPerSecond * 1_000,
    velocityYKilometresPerSecond * 1_000,
    velocityZKilometresPerSecond * 1_000,
    frame,
  );
}

function categoryForType(type: ObjectTypeValue): CelestialCatalogCategory {
  if (type === ObjectType.star) return "star";
  if (type === ObjectType.planet) return "planet";
  if (type === ObjectType.moon) return "moon";
  if (type === ObjectType.dwarfPlanet) return "dwarfPlanet";
  if (type === ObjectType.asteroid) return "asteroid";
  throw new RangeError(`Unsupported catalog ObjectType: ${type}`);
}

function provenance(sourceIdentifier: string, limitations: string = SCENARIO_PROVENANCE.limitations): CelestialSourceProvenance {
  return Object.freeze({
    source: "NASA/JPL Horizons Solar System Dynamics",
    sourceUrl: "https://ssd.jpl.nasa.gov/api/horizons.api",
    sourceIdentifier,
    retrievalDate: SCENARIO_PROVENANCE.retrievalDate,
    sourceEpoch: SCENARIO_PROVENANCE.sourceEpoch,
    sourceTimeScale: "TDB",
    sourceFrame: "ICRF geometric state vectors; normalized to the OrbitEngine ICRS/ICRF-aligned frame",
    normalization: "Horizons km and km/s vectors converted offline to SI metres and metres per second; parent-centered vectors retain their local frame",
    limitations,
  });
}

interface BodyMetadata {
  readonly aliases?: readonly string[];
  readonly sourceIdentifier?: string;
  readonly limitations?: string;
}

function horizonsBody(
  id: ObjectId,
  name: string,
  type: ObjectTypeValue,
  color: number,
  propagationFrame: ReferenceFrameId,
  configurationRevision: string,
  mass: number,
  mu: number,
  physicalRadius: number,
  state: PropagationState,
  centralBody: ObjectId,
  sourceIdentifier: string,
  aliases: readonly string[] = [],
): ScenarioBodyDefinition {
  return body(
    id,
    name,
    type,
    color,
    propagationFrame,
    configurationRevision,
    { mass, mu, physicalRadius },
    state,
    centralBody,
    undefined,
    {
      aliases,
      sourceIdentifier,
      limitations: "One authoritative JPL Horizons J2000 TDB state vector is propagated by the demo's educational two-body model; this is not a precision long-term ephemeris.",
    },
  );
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
  metadata: BodyMetadata = {},
): ScenarioBodyDefinition {
  const modelKind = id === SUN_ID ? PropagationModelKind.referenceEphemeris : PropagationModelKind.twoBodyAnalytical;
  return Object.freeze({
    id,
    name,
    type,
    properties: Object.freeze({ ...properties }),
    anchor: state,
    ...(centralBody === undefined ? {} : { centralBody }),
    propagation: Object.freeze({
      modelKind,
      direction: PropagationDirection.bidirectional,
      propagationFrame,
      configurationRevision,
      ...(orbitVisualizationDefinition === undefined ? {} : { orbitVisualization: orbitVisualizationDefinition }),
    }),
    display: Object.freeze({
      color,
      category: categoryForType(type),
      aliases: Object.freeze([...(metadata.aliases ?? [])]),
      defaultVisible: true,
    }),
    provenance: provenance(metadata.sourceIdentifier ?? `fixture:${name}`, metadata.limitations),
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
  horizonsBody(
    PHOBOS_ID, "Phobos", ObjectType.moon, 0x8f817c, MARS_CENTERED_FRAME, "11",
    1.0659e16, 7.111e5, 11_100,
    horizonsAnchor(-1_988.977928515696, -8_743.160225250358, -3_182.26164950267, 1.843182347661394, -0.04299702870743137, -1.018326836546403, MARS_CENTERED_FRAME),
    MARS_ID, "401 Phobos", ["Mars I"],
  ),
  horizonsBody(
    DEIMOS_ID, "Deimos", ObjectType.moon, 0xb39d8b, MARS_CENTERED_FRAME, "12",
    1.4762e15, 9.852e4, 6_200,
    horizonsAnchor(10_366.44028857383, -15_747.6637075316, -13_945.34607717114, 1.040856466875087, 0.8435344161786805, -0.1788876606922262, MARS_CENTERED_FRAME),
    MARS_ID, "402 Deimos", ["Mars II"],
  ),
  horizonsBody(
    IO_ID, "Io", ObjectType.moon, 0xd5a56c, JUPITER_CENTERED_FRAME, "13",
    8.9319e22, 5.9599e12, 1_821_600,
    horizonsAnchor(399_714.236329573, 114_358.2337934756, 61_202.66694087301, -5.397081715786772, 14.96898532269375, 7.040742588937143, JUPITER_CENTERED_FRAME),
    JUPITER_ID, "501 Io", ["Jupiter I"],
  ),
  horizonsBody(
    EUROPA_ID, "Europa", ObjectType.moon, 0xb9c8d7, JUPITER_CENTERED_FRAME, "14",
    4.8000e22, 3.2027e12, 1_560_800,
    horizonsAnchor(-561_244.4737473305, -319_493.8652420691, -158_086.4244536535, 7.462294847234357, -10.63755742098116, -4.848776619880565, JUPITER_CENTERED_FRAME),
    JUPITER_ID, "502 Europa", ["Jupiter II"],
  ),
  horizonsBody(
    GANYMEDE_ID, "Ganymede", ObjectType.moon, 0x9fa6a9, JUPITER_CENTERED_FRAME, "15",
    1.4819e23, 9.8878e12, 2_634_100,
    horizonsAnchor(-821_345.0948603005, -615_085.6733875166, -304_338.121372288, 6.987637098645384, -7.557915765882209, -3.52782080567081, JUPITER_CENTERED_FRAME),
    JUPITER_ID, "503 Ganymede", ["Jupiter III"],
  ),
  horizonsBody(
    CALLISTO_ID, "Callisto", ObjectType.moon, 0x817c73, JUPITER_CENTERED_FRAME, "16",
    1.0759e23, 7.1793e12, 2_410_300,
    horizonsAnchor(325_079.7306331359, 1_673_657.388398113, 796_198.0648559552, -8.07297227372281, 1.381786782005837, 0.5353865241984859, JUPITER_CENTERED_FRAME),
    JUPITER_ID, "504 Callisto", ["Jupiter IV"],
  ),
  horizonsBody(
    AMALTHEA_ID, "Amalthea", ObjectType.moon, 0xb85f45, JUPITER_CENTERED_FRAME, "17",
    2.08e18, 1.39e8, 83_500,
    horizonsAnchor(112_555.8430185548, 126_804.017090286, 63_279.93609238139, -20.80965827796803, 15.0315771948763, 6.704614248088029, JUPITER_CENTERED_FRAME),
    JUPITER_ID, "505 Amalthea",
  ),
  horizonsBody(
    MIMAS_ID, "Mimas", ObjectType.moon, 0xbec5d1, SATURN_CENTERED_FRAME, "18",
    3.75e19, 2.50e9, 198_200,
    horizonsAnchor(140_987.9472012177, -116_421.2247156115, -2_082.948317340901, 9.35437577055785, 11.04359297535853, -1.23368535735953, SATURN_CENTERED_FRAME),
    SATURN_ID, "601 Mimas",
  ),
  horizonsBody(
    ENCELADUS_ID, "Enceladus", ObjectType.moon, 0xe8edf2, SATURN_CENTERED_FRAME, "19",
    1.08e20, 7.21e9, 252_100,
    horizonsAnchor(161_710.097341096, -173_141.6084562344, -1_182.80590898433, 9.219209164219663, 8.606839851145025, -1.42875677811652, SATURN_CENTERED_FRAME),
    SATURN_ID, "602 Enceladus",
  ),
  horizonsBody(
    TETHYS_ID, "Tethys", ObjectType.moon, 0xb9c4cc, SATURN_CENTERED_FRAME, "20",
    6.17e20, 4.12e10, 531_100,
    horizonsAnchor(217_033.7614667597, -199_135.8387922731, -9_396.03083113896, 7.600784783756903, 8.343467080564723, -1.204113666047753, SATURN_CENTERED_FRAME),
    SATURN_ID, "603 Tethys",
  ),
  horizonsBody(
    DIONE_ID, "Dione", ObjectType.moon, 0xc6ced4, SATURN_CENTERED_FRAME, "21",
    1.095e21, 7.31e10, 561_400,
    horizonsAnchor(228_548.6335990705, -299_408.2715142818, 2_227.807713695493, 7.931813887454402, 6.063601423278839, -1.13111320429424, SATURN_CENTERED_FRAME),
    SATURN_ID, "604 Dione",
  ),
  horizonsBody(
    RHEA_ID, "Rhea", ObjectType.moon, 0xc9c7bf, SATURN_CENTERED_FRAME, "22",
    2.307e21, 1.539e11, 763_800,
    horizonsAnchor(-524_762.3777200788, -23_096.96021475061, 49_541.71717346668, 0.4317788944180728, -8.443388772019738, 0.6044742683498031, SATURN_CENTERED_FRAME),
    SATURN_ID, "605 Rhea",
  ),
  horizonsBody(
    TITAN_ID, "Titan", ObjectType.moon, 0xd69d58, SATURN_CENTERED_FRAME, "23",
    1.3452e23, 8.9781e12, 2_574_700,
    horizonsAnchor(-946_802.9384488795, 824_098.2253187533, 27_082.23040694325, -3.561343519356833, -4.04524701612976, 0.5842850270130896, SATURN_CENTERED_FRAME),
    SATURN_ID, "606 Titan",
  ),
  horizonsBody(
    HYPERION_ID, "Hyperion", ObjectType.moon, 0x9b8d7e, SATURN_CENTERED_FRAME, "24",
    5.6e18, 3.74e8, 135_000,
    horizonsAnchor(171_049.2869803892, 1_431_446.001504394, -98_082.89756057342, -5.017569473499778, 1.275825799647089, 0.3946158993325878, SATURN_CENTERED_FRAME),
    SATURN_ID, "607 Hyperion",
  ),
  horizonsBody(
    IAPETUS_ID, "Iapetus", ObjectType.moon, 0x817668, SATURN_CENTERED_FRAME, "25",
    1.805e21, 1.204e11, 734_500,
    horizonsAnchor(-2_853_773.238772294, -2_271_215.095394639, 160_569.2776601267, 1.920777321933175, -2.405392997278293, -0.810761651840383, SATURN_CENTERED_FRAME),
    SATURN_ID, "608 Iapetus",
  ),
  horizonsBody(
    PHOEBE_ID, "Phoebe", ObjectType.moon, 0x776c65, SATURN_CENTERED_FRAME, "26",
    8.29e18, 5.53e8, 106_500,
    horizonsAnchor(-11_732_539.40105806, -3_040_605.216872639, 140_953.1316844522, -0.6712282219749379, 1.51280786643869, 0.7675858461138741, SATURN_CENTERED_FRAME),
    SATURN_ID, "609 Phoebe",
  ),
  horizonsBody(
    MIRANDA_ID, "Miranda", ObjectType.moon, 0xb6c4d0, URANUS_CENTERED_FRAME, "27",
    6.59e19, 4.40e9, 235_800,
    horizonsAnchor(175_677.935523673, -19_272.29151598568, -72_960.03740562897, -1.827792284132425, 1.768006668093332, -4.878103976818797, URANUS_CENTERED_FRAME),
    URANUS_ID, "701 Miranda",
  ),
  horizonsBody(
    ARIEL_ID, "Ariel", ObjectType.moon, 0xb7c9d0, URANUS_CENTERED_FRAME, "28",
    1.353e21, 9.00e10, 578_900,
    horizonsAnchor(100_010.3237187744, 45_083.2643271979, -242_317.517098039, -4.217267273178355, 1.359812678554251, -1.466212773980389, URANUS_CENTERED_FRAME),
    URANUS_ID, "702 Ariel",
  ),
  horizonsBody(
    UMBRIEL_ID, "Umbriel", ObjectType.moon, 0x7b8790, URANUS_CENTERED_FRAME, "29",
    1.172e21, 7.82e10, 584_700,
    horizonsAnchor(-63_107.0017574001, 128_000.3226932252, -411_987.1943028166, -3.525353166026906, 0.597283168501038, 0.7163518146167579, URANUS_CENTERED_FRAME),
    URANUS_ID, "703 Umbriel",
  ),
  horizonsBody(
    TITANIA_ID, "Titania", ObjectType.moon, 0x9aaeb8, URANUS_CENTERED_FRAME, "30",
    3.527e21, 2.353e11, 788_900,
    horizonsAnchor(-560_569.9599050765, 144_960.9888462288, -72_810.13985111365, -0.5752490512536454, -0.7019439726567546, 3.017425267177671, URANUS_CENTERED_FRAME),
    URANUS_ID, "704 Titania",
  ),
  horizonsBody(
    OBERON_ID, "Oberon", ObjectType.moon, 0x84949d, URANUS_CENTERED_FRAME, "31",
    3.014e21, 2.012e11, 761_400,
    horizonsAnchor(-104_329.5322347591, 34_868.03309094398, -68_865.43638864973, -3.876424817847735, -0.990828650312026, 5.354202382794245, URANUS_CENTERED_FRAME),
    URANUS_ID, "705 Oberon",
  ),
  horizonsBody(
    TRITON_ID, "Triton", ObjectType.moon, 0xb6d0d2, NEPTUNE_CENTERED_FRAME, "32",
    2.14e22, 1.428e12, 1_353_400,
    horizonsAnchor(-205_696.4744679369, 10_004.0771266601, 288_812.3684286066, 2.99043788247843, 2.481259537446611, 2.043662591682624, NEPTUNE_CENTERED_FRAME),
    NEPTUNE_ID, "801 Triton",
  ),
  horizonsBody(
    NEREID_ID, "Nereid", ObjectType.moon, 0x9eabb4, NEPTUNE_CENTERED_FRAME, "33",
    3.0e19, 2.0e9, 170_000,
    horizonsAnchor(893_764.5622070211, 8_278_569.611230759, 4_329_907.699022511, -0.4457969648006417, -0.1040052114876342, -0.08240570319425108, NEPTUNE_CENTERED_FRAME),
    NEPTUNE_ID, "802 Nereid",
  ),
  horizonsBody(
    PROTEUS_ID, "Proteus", ObjectType.moon, 0x777c85, NEPTUNE_CENTERED_FRAME, "34",
    5.0e19, 3.3e9, 210_000,
    horizonsAnchor(46_051.79358221572, -64_887.07589296275, -86_677.76874255059, 6.447950771160707, 4.044726665070662, 0.4028789106414561, NEPTUNE_CENTERED_FRAME),
    NEPTUNE_ID, "808 Proteus",
  ),
  horizonsBody(
    LARISSA_ID, "Larissa", ObjectType.moon, 0x858a91, NEPTUNE_CENTERED_FRAME, "35",
    4.2e18, 2.8e8, 97_000,
    horizonsAnchor(63_322.66385100786, 37_526.59733792121, 2_078.650757884547, -3.505472196799602, 5.529341045964185, 7.064321960055895, NEPTUNE_CENTERED_FRAME),
    NEPTUNE_ID, "807 Larissa",
  ),
  horizonsBody(
    CERES_ID, "Ceres", ObjectType.dwarfPlanet, 0xb9a47a, SUN_CENTERED_FRAME, "36",
    9.3835e20, 6.263e10, 469_700,
    horizonsAnchor(-19_461_726.35585372, -59_927_967.77348039, -29_992_772.67983142, 36.99499185727919, -8.529675283382268, -8.393121143467225, SUN_CENTERED_FRAME),
    SUN_ID, "1 Ceres", ["(1) Ceres"],
  ),
  horizonsBody(
    PLUTO_ID, "Pluto", ObjectType.dwarfPlanet, 0x9b8ca8, SUN_CENTERED_FRAME, "37",
    1.303e22, 8.703e11, 1_188_300,
    horizonsAnchor(-1_477_330_922.306794, -4_185_578_139.004337, -860_738_231.2063003, 5.259850276851352, -1.939761452556408, -2.204049388416424, SUN_CENTERED_FRAME),
    SUN_ID, "999 Pluto", ["134340 Pluto"],
  ),
  horizonsBody(
    HAUMEA_ID, "Haumea", ObjectType.dwarfPlanet, 0x9bb8c2, SUN_CENTERED_FRAME, "38",
    4.006e21, 2.674e11, 620_000,
    horizonsAnchor(-6_879_969_296.738866, -2_034_896_327.022444, 2_767_800_048.16589, 0.8258201205825183, -3.529946421606688, -0.8359153417773986, SUN_CENTERED_FRAME),
    SUN_ID, "136108 Haumea", ["(136108) Haumea"],
  ),
  horizonsBody(
    MAKEMAKE_ID, "Makemake", ObjectType.dwarfPlanet, 0xb99983, SUN_CENTERED_FRAME, "39",
    3.1e21, 2.07e11, 715_000,
    horizonsAnchor(-6_519_247_565.997499, 92_642_736.66409396, 4_103_146_341.030223, -1.22723025596869, -3.463541307022104, -1.183336038059583, SUN_CENTERED_FRAME),
    SUN_ID, "136472 Makemake", ["(136472) Makemake"],
  ),
  horizonsBody(
    ERIS_ID, "Eris", ObjectType.dwarfPlanet, 0xd0d5df, SUN_CENTERED_FRAME, "40",
    1.6466e22, 1.099e12, 1_163_000,
    horizonsAnchor(13_223_455_736.44728, 5_775_422_239.690366, -1_750_807_188.475271, -0.3524852889361067, 0.9513341211798834, 2.052306654864509, SUN_CENTERED_FRAME),
    SUN_ID, "136199 Eris", ["(136199) Eris"],
  ),
  horizonsBody(
    CHARON_ID, "Charon", ObjectType.moon, 0xaaa8b8, PLUTO_CENTERED_FRAME, "41",
    1.586e21, 1.059e11, 606_000,
    horizonsAnchor(-6_837.721052183023, -8_791.382868678276, -16_126.27409547914, -0.1443261478725678, -0.1159985637674944, 0.124410856557521, PLUTO_CENTERED_FRAME),
    PLUTO_ID, "901 Charon", ["Pluto I"],
  ),
  horizonsBody(
    VESTA_ID, "Vesta", ObjectType.asteroid, 0xaaa59a, SUN_CENTERED_FRAME, "42",
    2.59e20, 1.728e10, 262_700,
    horizonsAnchor(208_048.1406418324, 209.6191733587667, -5_529.162313239298, 1.162672436605257, 23.91840970029892, 10.93918951951285, SUN_CENTERED_FRAME),
    SUN_ID, "4 Vesta", ["(4) Vesta"],
  ),
  horizonsBody(
    PALLAS_ID, "Pallas", ObjectType.asteroid, 0xb9a98d, SUN_CENTERED_FRAME, "43",
    2.04e20, 1.36e10, 256_000,
    horizonsAnchor(-107_456.4940521906, -6_922.528774882654, 3_686.187045620657, 1.381906029263447, -32.01876843168273, -14.491835473268, SUN_CENTERED_FRAME),
    SUN_ID, "2 Pallas", ["(2) Pallas"],
  ),
  horizonsBody(
    HYGIEA_ID, "Hygiea", ObjectType.asteroid, 0x8e8b82, SUN_CENTERED_FRAME, "44",
    8.6e19, 5.74e9, 217_500,
    horizonsAnchor(-355_154.6928201286, -190_277.799914204, -111_546.3819701232, 10.57872613465942, -14.39356912726625, -5.755797871910326, SUN_CENTERED_FRAME),
    SUN_ID, "10 Hygiea", ["(10) Hygiea"],
  ),
  horizonsBody(
    EROS_ID, "Eros", ObjectType.asteroid, 0xb88665, SUN_CENTERED_FRAME, "45",
    6.687e15, 4.46e5, 8_400,
    horizonsAnchor(-179_070_469.4364793, -62_187_294.8700556, -67_652_831.48829015, 6.224413101908676, -22.99889097816486, -11.94703015176097, SUN_CENTERED_FRAME),
    SUN_ID, "433 Eros", ["(433) Eros"],
  ),
  horizonsBody(
    BENNU_ID, "Bennu", ObjectType.asteroid, 0xb4a185, SUN_CENTERED_FRAME, "46",
    7.329e10, 4.89, 246,
    horizonsAnchor(-72_177_983.28903423, 108_158_106.1076839, 61_425_319.34153345, -30.19784773639692, -10.64956785614106, -5.877152024541815, SUN_CENTERED_FRAME),
    SUN_ID, "101955 Bennu", ["(101955) Bennu"],
  ),
  horizonsBody(
    RYUGU_ID, "Ryugu", ObjectType.asteroid, 0x7f746a, SUN_CENTERED_FRAME, "47",
    4.5e11, 30, 435,
    horizonsAnchor(169_922_913.3010889, 21_255_722.55555519, 26_286_127.20182858, -9.832901826054455, 24.7493103642331, 8.758730423611457, SUN_CENTERED_FRAME),
    SUN_ID, "162173 Ryugu", ["(162173) Ryugu"],
  ),
  horizonsBody(
    APOPHIS_ID, "Apophis", ObjectType.asteroid, 0xc47b63, SUN_CENTERED_FRAME, "48",
    6.1e10, 4.1, 185,
    horizonsAnchor(-155_271_474.0806844, -18_970_395.44792235, -11_076_649.62013783, 7.319516136905468, -24.45002678021927, -8.908936120221066, SUN_CENTERED_FRAME),
    SUN_ID, "99942 Apophis", ["(99942) Apophis"],
  ),
]);

export const SCENARIO_OBJECT_IDS = Object.freeze(SCENARIO_BODIES.map((value) => value.id));

export const SCENARIO_MOTION = Object.freeze({
  modelKind: PropagationModelKind.twoBodyAnalytical,
  direction: PropagationDirection.bidirectional,
  motionRevision: revisionId("1"),
});
