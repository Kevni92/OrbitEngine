import type { ObjectId } from "orbit-engine";
import {
  EARTH_ID,
  JUPITER_ID,
  MARS_ID,
  MERCURY_ID,
  NEPTUNE_ID,
  SATURN_ID,
  URANUS_ID,
  VENUS_ID,
} from "./scenario-data.js";

export const SOLAR_SYSTEM_SCOPE_TEXTURE_SOURCE = "Solar System Scope" as const;
export const SOLAR_SYSTEM_SCOPE_TEXTURE_SOURCE_URL = "https://www.solarsystemscope.com/textures/" as const;
export const SOLAR_SYSTEM_SCOPE_TEXTURE_LICENSE = "CC BY 4.0" as const;

export type PlanetTexturePurpose = "surface" | "cloudDeck" | "cloudOverlay" | "nightLights";

export interface PlanetTextureAsset {
  readonly key: string;
  readonly fileName: string;
  readonly purpose: PlanetTexturePurpose;
  readonly sourceUrl: string;
  readonly license: typeof SOLAR_SYSTEM_SCOPE_TEXTURE_LICENSE;
  readonly sourceResolution: "2048x1024";
  readonly packagedResolution: "2048x1024";
  readonly processing: "downloaded unchanged";
}

export interface PlanetTextureSet {
  readonly objectId: ObjectId;
  /** The only visible map for the body. Venus deliberately has no solid map. */
  readonly primary: PlanetTextureAsset;
  readonly primaryLayer: "solidSurface" | "cloudDeck";
  readonly clouds?: PlanetTextureAsset;
  readonly nightLights?: PlanetTextureAsset;
}

function asset(
  key: string,
  fileName: string,
  purpose: PlanetTexturePurpose,
): PlanetTextureAsset {
  return Object.freeze({
    key,
    fileName,
    purpose,
    sourceUrl: `${SOLAR_SYSTEM_SCOPE_TEXTURE_SOURCE_URL}download/2k_${fileName}`,
    license: SOLAR_SYSTEM_SCOPE_TEXTURE_LICENSE,
    sourceResolution: "2048x1024",
    packagedResolution: "2048x1024",
    processing: "downloaded unchanged",
  });
}

function textureSet(
  objectId: ObjectId,
  primary: PlanetTextureAsset,
  primaryLayer: PlanetTextureSet["primaryLayer"],
  extras: Pick<PlanetTextureSet, "clouds" | "nightLights"> = {},
): PlanetTextureSet {
  return Object.freeze({ objectId, primary, primaryLayer, ...extras });
}

export const PLANET_TEXTURE_REGISTRY: ReadonlyMap<ObjectId, PlanetTextureSet> = new Map([
  [MERCURY_ID, textureSet(
    MERCURY_ID,
    asset("mercury-primary", "mercury.jpg", "surface"),
    "solidSurface",
  )],
  [VENUS_ID, textureSet(
    VENUS_ID,
    asset("venus-cloud-deck", "venus-atmosphere.jpg", "cloudDeck"),
    "cloudDeck",
  )],
  [EARTH_ID, textureSet(
    EARTH_ID,
    asset("earth-day", "earth-daymap.jpg", "surface"),
    "solidSurface",
    {
      clouds: asset("earth-clouds", "earth-clouds.jpg", "cloudOverlay"),
      nightLights: asset("earth-night-lights", "earth-nightmap.jpg", "nightLights"),
    },
  )],
  [MARS_ID, textureSet(
    MARS_ID,
    asset("mars-primary", "mars.jpg", "surface"),
    "solidSurface",
  )],
  [JUPITER_ID, textureSet(
    JUPITER_ID,
    asset("jupiter-cloud-deck", "jupiter.jpg", "cloudDeck"),
    "cloudDeck",
  )],
  [SATURN_ID, textureSet(
    SATURN_ID,
    asset("saturn-cloud-deck", "saturn.jpg", "cloudDeck"),
    "cloudDeck",
  )],
  [URANUS_ID, textureSet(
    URANUS_ID,
    asset("uranus-cloud-deck", "uranus.jpg", "cloudDeck"),
    "cloudDeck",
  )],
  [NEPTUNE_ID, textureSet(
    NEPTUNE_ID,
    asset("neptune-cloud-deck", "neptune.jpg", "cloudDeck"),
    "cloudDeck",
  )],
]);

export function planetTextureSetFor(objectId: ObjectId): PlanetTextureSet | undefined {
  return PLANET_TEXTURE_REGISTRY.get(objectId);
}

export function planetTextureAssets(set: PlanetTextureSet): readonly PlanetTextureAsset[] {
  return Object.freeze([
    set.primary,
    ...(set.clouds === undefined ? [] : [set.clouds]),
    ...(set.nightLights === undefined ? [] : [set.nightLights]),
  ]);
}
