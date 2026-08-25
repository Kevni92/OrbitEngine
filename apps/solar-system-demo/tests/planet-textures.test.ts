import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import * as THREE from "three";
import {
  EARTH_ID,
  JUPITER_ID,
  MARS_ID,
  MERCURY_ID,
  NEPTUNE_ID,
  SATURN_ID,
  URANUS_ID,
  VENUS_ID,
} from "../src/scenario/scenario-data.js";
import {
  PLANET_TEXTURE_REGISTRY,
  planetTextureAssets,
  planetTextureSetFor,
} from "../src/scenario/planet-texture-registry.js";
import {
  createPlanetCloudMaterial,
  PlanetTextureResourceManager,
  type PlanetTextureLoader,
} from "../src/rendering/planet-textures.js";

const assetDirectory = path.resolve(process.cwd(), "public/assets/planet-textures");

test("the SSS registry covers the eight major planets with bounded local assets", () => {
  assert.equal(PLANET_TEXTURE_REGISTRY.size, 8);
  for (const objectId of [MERCURY_ID, VENUS_ID, EARTH_ID, MARS_ID, JUPITER_ID, SATURN_ID, URANUS_ID, NEPTUNE_ID]) {
    const set = planetTextureSetFor(objectId)!;
    assert.ok(set);
    assert.equal(set.primary.sourceResolution, "2048x1024");
    assert.equal(set.primary.packagedResolution, "2048x1024");
    assert.equal(set.primary.license, "CC BY 4.0");
    for (const asset of planetTextureAssets(set)) {
      const file = path.join(assetDirectory, asset.fileName);
      assert.equal(statSync(file).isFile(), true);
      assert.ok(statSync(file).size < 2_000_000, `${asset.fileName} exceeds the per-file budget`);
      assert.notEqual(readFileSync(file).subarray(0, 3).toString("hex"), "3c2144", `${asset.fileName} is not an image`);
    }
  }

  const venus = planetTextureSetFor(VENUS_ID)!;
  assert.equal(venus.primary.purpose, "cloudDeck");
  assert.equal(venus.clouds, undefined);
  assert.equal(venus.nightLights, undefined);
  assert.equal(planetTextureSetFor(EARTH_ID)!.clouds?.purpose, "cloudOverlay");
  assert.equal(planetTextureSetFor(EARTH_ID)!.nightLights?.purpose, "nightLights");
  assert.equal(planetTextureAssets(planetTextureSetFor(EARTH_ID)!).length, 3);
});

test("planet cloud presentation preserves texture alpha and uses direct stellar lighting", () => {
  const material = createPlanetCloudMaterial();
  assert.equal(material.uniforms.uRadianceDisplayGain?.value, 2.4);
  assert.match(material.fragmentShader, /uLightDirections/);
  assert.match(material.fragmentShader, /directVisibility/);
  assert.match(material.fragmentShader, /mapSample\.a/);
  assert.match(material.fragmentShader, /uRadianceDisplayGain/);
  assert.match(material.fragmentShader, /#include <tonemapping_fragment>/);
  assert.equal(material.blending, THREE.NormalBlending);
  material.dispose();
});

class DeferredTextureLoader implements PlanetTextureLoader {
  readonly requests: Array<{ readonly url: string; readonly resolve: (texture: THREE.Texture) => void }> = [];

  load(url: string, onLoad: (texture: THREE.Texture) => void): THREE.Texture {
    this.requests.push({ url, resolve: onLoad });
    return new THREE.Texture();
  }
}

test("planet texture resources are lazy, shared, and released after the final LOD lease", () => {
  const loader = new DeferredTextureLoader();
  const manager = new PlanetTextureResourceManager({ loader, canLoad: true, maxAnisotropy: 16 });
  const asset = planetTextureSetFor(EARTH_ID)!.primary;
  let callbackCount = 0;
  const first = manager.acquire(asset, () => { callbackCount += 1; });
  const second = manager.acquire(asset, () => { callbackCount += 1; });

  assert.equal(loader.requests.length, 1);
  assert.deepEqual(manager.diagnostics(), {
    activeResourceCount: 1,
    pendingResourceCount: 1,
    activeReferenceCount: 2,
    loadRequestCount: 1,
  });

  const loadedTexture = new THREE.Texture();
  loader.requests[0]!.resolve(loadedTexture);
  assert.equal(callbackCount, 2);
  assert.equal(loadedTexture.colorSpace, THREE.SRGBColorSpace);
  assert.equal(loadedTexture.anisotropy, 4);
  assert.equal(manager.diagnostics().pendingResourceCount, 0);

  first.release();
  assert.equal(manager.diagnostics().activeReferenceCount, 1);
  second.release();
  assert.deepEqual(manager.diagnostics(), {
    activeResourceCount: 0,
    pendingResourceCount: 0,
    activeReferenceCount: 0,
    loadRequestCount: 1,
  });
  manager.dispose();
});
