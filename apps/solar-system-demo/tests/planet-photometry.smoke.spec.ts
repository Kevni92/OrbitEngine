import { expect, test, type Page } from "@playwright/test";

interface BodyDiagnostics {
  readonly objectId: string;
  readonly representation: string;
  readonly ndcX: number;
  readonly ndcY: number;
  readonly renderWorldPosition: { readonly x: number; readonly y: number; readonly z: number };
  readonly stellarDirections: readonly {
    readonly emitterId: string;
    readonly renderDirectionToEmitter: { readonly x: number; readonly y: number; readonly z: number };
  }[];
  readonly planetTextureLayers?: readonly Readonly<{
    readonly purpose: string;
    readonly loaded: boolean;
  }>[];
  readonly atmosphere: {
    readonly resourcesAllocated: boolean;
    readonly visible: boolean;
    readonly projectedDiameterPixels: number;
  };
}

interface RenderDiagnostics {
  readonly focusId: string;
  readonly lighting: { readonly mode: "physical" | "enhanced" };
  readonly bodies: readonly BodyDiagnostics[];
}

interface RegionMetrics {
  readonly diskLuminance: number;
  readonly clippedDiskFraction: number;
  readonly annulusLuminance: number;
  readonly clippedAnnulusFraction: number;
  readonly backgroundLuminance: number;
}

interface PlanetPhotometryResult {
  readonly name: string;
  readonly atmosphere: boolean;
  readonly dayside: RegionMetrics;
  readonly side: RegionMetrics;
}

const PLANETS = Object.freeze([
  { name: "Mercury", objectId: "1001" },
  { name: "Venus", objectId: "1002" },
  { name: "Earth", objectId: "1003" },
  { name: "Mars", objectId: "1005" },
  { name: "Jupiter", objectId: "1006" },
  { name: "Saturn", objectId: "1007" },
  { name: "Uranus", objectId: "1008" },
  { name: "Neptune", objectId: "1009" },
] as const);

// Numerical photometry stays on the normal focus camera. Review PNGs are
// deliberately closer so texture detail, clipping, limb scattering and bloom
// can be judged visually instead of from an ~80 px disk.
const REVIEW_TARGET_DIAMETER_PIXELS = 360;
const REVIEW_MIN_DIAMETER_PIXELS = 330;
const REVIEW_ZOOM_ATTEMPTS = 18;

async function readDiagnostics(page: Page): Promise<RenderDiagnostics | undefined> {
  return page.evaluate(() => {
    const hook = (window as Window & { __orbitDemoRenderDiagnostics?: () => RenderDiagnostics }).__orbitDemoRenderDiagnostics;
    return hook?.();
  });
}

async function bodyDiagnostics(page: Page, objectId: string): Promise<BodyDiagnostics> {
  const body = (await readDiagnostics(page))?.bodies.find((candidate) => candidate.objectId === objectId);
  if (body === undefined) throw new Error(`Render diagnostics are missing for ${objectId}`);
  return body;
}

async function setPhysicalLighting(page: Page): Promise<void> {
  await page.evaluate(() => {
    const select = document.querySelector<HTMLSelectElement>("#lighting-mode");
    if (select === null) throw new Error("Lighting mode control is missing");
    select.value = "physical";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await expect.poll(async () => (await readDiagnostics(page))?.lighting.mode).toBe("physical");
}

async function focusBody(page: Page, objectId: string): Promise<BodyDiagnostics> {
  await page.evaluate((nextObjectId) => {
    for (const id of ["selected-select", "focus-select"]) {
      const select = document.querySelector<HTMLSelectElement>(`#${id}`);
      if (select === null) throw new Error(`Missing ${id}`);
      select.value = nextObjectId;
      select.dispatchEvent(new Event("input", { bubbles: true }));
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }, objectId);
  await expect.poll(async () => (await readDiagnostics(page))?.focusId).toBe(objectId);
  await expect.poll(async () => (await readDiagnostics(page))?.bodies.find((body) => body.objectId === objectId)?.representation).toBe("sphere");
  await expect.poll(async () => (await readDiagnostics(page))?.bodies
    .find((body) => body.objectId === objectId)
    ?.planetTextureLayers?.some((layer) => layer.loaded) ?? false).toBe(true);
  await page.waitForTimeout(180);
  return bodyDiagnostics(page, objectId);
}

async function hideOverlays(page: Page): Promise<void> {
  for (const selector of ["#grid-toggle", "#orbits-toggle"] as const) {
    const button = page.locator(selector);
    if (await button.getAttribute("aria-pressed") === "true") await button.click();
  }
  await page.evaluate(() => {
    document.querySelector<HTMLElement>("#demo-panel")?.style.setProperty("display", "none");
    document.querySelector<HTMLElement>("#celestial-browser")?.style.setProperty("display", "none");
  });
  await page.waitForTimeout(60);
}

async function orientSideOn(page: Page, body: BodyDiagnostics): Promise<BodyDiagnostics> {
  const sunDirection = body.stellarDirections.find((direction) => direction.emitterId === "1000")?.renderDirectionToEmitter;
  if (sunDirection === undefined) throw new Error(`Sun direction is missing for ${body.objectId}`);
  await page.evaluate(({ center, direction }) => {
    const hook = (window as Window & {
      __orbitDemoSetCameraFixture?: (fixture: {
        readonly position: readonly [number, number, number];
        readonly target: readonly [number, number, number];
        readonly up: readonly [number, number, number];
      }) => void;
    }).__orbitDemoSetCameraFixture;
    if (hook === undefined) throw new Error("Camera fixture hook is missing");

    const sunLength = Math.hypot(direction.x, direction.y, direction.z);
    if (sunLength <= Number.EPSILON) throw new Error("Sun direction is degenerate");
    const sun = {
      x: direction.x / sunLength,
      y: direction.y / sunLength,
      z: direction.z / sunLength,
    };

    // Put the camera exactly 90 degrees from the star direction so the star
    // lies in the image plane and the planet shows a stable half-lit terminator.
    const reference = Math.abs(sun.z) < 0.92
      ? { x: 0, y: 0, z: 1 }
      : { x: 0, y: 1, z: 0 };
    const side = {
      x: sun.y * reference.z - sun.z * reference.y,
      y: sun.z * reference.x - sun.x * reference.z,
      z: sun.x * reference.y - sun.y * reference.x,
    };
    const sideLength = Math.hypot(side.x, side.y, side.z);
    if (sideLength <= Number.EPSILON) throw new Error("Side-on camera direction is degenerate");

    const distance = 0.06;
    hook({
      position: [
        center.x + side.x / sideLength * distance,
        center.y + side.y / sideLength * distance,
        center.z + side.z / sideLength * distance,
      ],
      target: [center.x, center.y, center.z],
      up: [0, 0, 1],
    });
  }, { center: body.renderWorldPosition, direction: sunDirection });
  await page.waitForTimeout(120);
  return bodyDiagnostics(page, body.objectId);
}

async function zoomForVisualReview(page: Page, objectId: string): Promise<BodyDiagnostics> {
  await page.locator("#scene").hover();
  let body = await bodyDiagnostics(page, objectId);

  for (let attempt = 0; attempt < REVIEW_ZOOM_ATTEMPTS; attempt += 1) {
    const diameter = body.atmosphere.projectedDiameterPixels;
    if (diameter >= REVIEW_MIN_DIAMETER_PIXELS) break;

    // OrbitControls uses negative wheel delta to dolly in. Use larger steps
    // while far away and progressively smaller ones near the review target to
    // avoid filling the entire viewport with the planet.
    const ratio = REVIEW_TARGET_DIAMETER_PIXELS / Math.max(diameter, 1);
    const deltaY = ratio > 2.5 ? -900 : ratio > 1.5 ? -520 : -240;
    await page.mouse.wheel(0, deltaY);
    await page.waitForTimeout(60);
    body = await bodyDiagnostics(page, objectId);
  }

  if (body.atmosphere.projectedDiameterPixels < REVIEW_MIN_DIAMETER_PIXELS) {
    throw new Error(
      `${objectId} review zoom only reached ${body.atmosphere.projectedDiameterPixels.toFixed(1)} px; expected at least ${REVIEW_MIN_DIAMETER_PIXELS} px`,
    );
  }
  return body;
}

async function measure(page: Page, body: BodyDiagnostics): Promise<RegionMetrics> {
  const screenshot = await page.locator("#scene").screenshot();
  return page.evaluate(async ({ source, input }) => {
    const image = new Image();
    image.src = source;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (context === null) throw new Error("2D screenshot analysis context unavailable");
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const centerX = (input.ndcX + 1) * canvas.width / 2;
    const centerY = (1 - input.ndcY) * canvas.height / 2;
    const bodyRadius = Math.max(input.projectedDiameterPixels / 2, 18);
    const diskRadius = bodyRadius * 0.72;
    const annulusInner = bodyRadius + 1;
    const annulusOuter = bodyRadius + 8;
    const corners = [[4, 4], [canvas.width - 5, 4], [4, canvas.height - 5], [canvas.width - 5, canvas.height - 5]] as const;
    const background = [0, 0, 0];
    for (const [x, y] of corners) {
      const offset = (y * canvas.width + x) * 4;
      background[0] += pixels[offset] ?? 0;
      background[1] += pixels[offset + 1] ?? 0;
      background[2] += pixels[offset + 2] ?? 0;
    }
    background[0] /= corners.length;
    background[1] /= corners.length;
    background[2] /= corners.length;
    const luminance = (r: number, g: number, b: number): number => r * 0.2126 + g * 0.7152 + b * 0.0722;
    const backgroundLuminance = luminance(background[0]!, background[1]!, background[2]!);
    let diskLuminance = 0;
    let diskCount = 0;
    let clippedDisk = 0;
    let annulusLuminance = 0;
    let annulusCount = 0;
    let clippedAnnulus = 0;
    const minX = Math.max(0, Math.floor(centerX - annulusOuter - 2));
    const maxX = Math.min(canvas.width - 1, Math.ceil(centerX + annulusOuter + 2));
    const minY = Math.max(0, Math.floor(centerY - annulusOuter - 2));
    const maxY = Math.min(canvas.height - 1, Math.ceil(centerY + annulusOuter + 2));
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const radius = Math.hypot(x - centerX, y - centerY);
        const offset = (y * canvas.width + x) * 4;
        const r = pixels[offset] ?? 0;
        const g = pixels[offset + 1] ?? 0;
        const b = pixels[offset + 2] ?? 0;
        const value = luminance(r, g, b);
        if (radius <= diskRadius) {
          diskLuminance += value;
          diskCount += 1;
          if (value >= 245) clippedDisk += 1;
        } else if (radius >= annulusInner && radius <= annulusOuter) {
          annulusLuminance += value;
          annulusCount += 1;
          if (value >= 245) clippedAnnulus += 1;
        }
      }
    }
    if (diskCount === 0 || annulusCount === 0) throw new Error("Insufficient planet pixels for photometry");
    return {
      diskLuminance: diskLuminance / diskCount,
      clippedDiskFraction: clippedDisk / diskCount,
      annulusLuminance: annulusLuminance / annulusCount,
      clippedAnnulusFraction: clippedAnnulus / annulusCount,
      backgroundLuminance,
    };
  }, {
    source: `data:image/png;base64,${screenshot.toString("base64")}`,
    input: {
      ndcX: body.ndcX,
      ndcY: body.ndcY,
      projectedDiameterPixels: body.atmosphere.projectedDiameterPixels,
    },
  });
}

test("all primary planets obey the shared planetary photometry contract", async ({ page }, testInfo) => {
  // The OEP-backed demo startup dominates this suite. Keep one page alive and
  // move the same camera through all eight planets instead of paying the full
  // dataset/bootstrap cost once per body.
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await expect(page.locator("#engine-status")).toHaveAttribute("data-state", "ready");
  await setPhysicalLighting(page);
  await hideOverlays(page);

  const results: PlanetPhotometryResult[] = [];

  for (const planet of PLANETS) {
    // Keep objective metrics tied to the product's normal focus distance.
    const daysideBody = await focusBody(page, planet.objectId);
    const dayside = await measure(page, daysideBody);

    // Then dolly in only for the human visual-review PNG.
    const daysideReviewBody = await zoomForVisualReview(page, planet.objectId);
    await page.locator("#scene").screenshot({
      path: testInfo.outputPath(`${planet.name.toLowerCase()}-focus-dayside.png`),
    });

    // Replace the artificial full-dark view with a 90-degree side view. This
    // shows the illuminated hemisphere, terminator, night hemisphere and limb
    // atmosphere together and is much more useful for visual acceptance.
    const sideBody = await orientSideOn(page, daysideReviewBody);
    const side = await measure(page, sideBody);
    const sideReviewBody = await zoomForVisualReview(page, planet.objectId);
    await page.locator("#scene").screenshot({
      path: testInfo.outputPath(`${planet.name.toLowerCase()}-side.png`),
    });

    const result = {
      name: planet.name,
      atmosphere: daysideBody.atmosphere.resourcesAllocated,
      dayside,
      side,
    } satisfies PlanetPhotometryResult;
    results.push(result);
    console.log("[planet-photometry]", planet.name, {
      ...result,
      reviewDiameterPixels: {
        dayside: daysideReviewBody.atmosphere.projectedDiameterPixels,
        side: sideReviewBody.atmosphere.projectedDiameterPixels,
      },
    });
  }

  // Assert only after every screenshot has been captured. Soft assertions keep
  // the complete eight-body visual review set available even when several
  // planets violate the common contract in the same run.
  for (const result of results) {
    expect.soft(result.dayside.diskLuminance, `${result.name} dayside minimum luminance`).toBeGreaterThan(35);
    expect.soft(result.dayside.diskLuminance, `${result.name} dayside maximum luminance`).toBeLessThan(220);
    expect.soft(result.dayside.clippedDiskFraction, `${result.name} clipped disk fraction`).toBeLessThan(0.12);

    if (result.atmosphere) {
      expect.soft(
        result.dayside.annulusLuminance - result.dayside.backgroundLuminance,
        `${result.name} atmosphere visibility`,
      ).toBeGreaterThan(3);
      expect.soft(result.dayside.annulusLuminance, `${result.name} atmosphere maximum luminance`).toBeLessThan(235);
      expect.soft(result.dayside.clippedAnnulusFraction, `${result.name} clipped atmosphere fraction`).toBeLessThan(0.25);
    } else {
      expect.soft(
        result.dayside.annulusLuminance - result.dayside.backgroundLuminance,
        `${result.name} airless halo`,
      ).toBeLessThan(10);
    }

    // Shared half-phase contract: the side-on disk must remain readable, must
    // not clip, and must be clearly dimmer than the fully illuminated focus view.
    expect.soft(result.side.diskLuminance, `${result.name} side-view minimum luminance`).toBeGreaterThan(8);
    expect.soft(result.side.diskLuminance, `${result.name} side-view maximum luminance`).toBeLessThan(210);
    expect.soft(result.side.clippedDiskFraction, `${result.name} side-view clipped disk fraction`).toBeLessThan(0.12);
    expect.soft(
      result.side.diskLuminance,
      `${result.name} side/day minimum ratio`,
    ).toBeGreaterThan(result.dayside.diskLuminance * 0.12);
    expect.soft(
      result.side.diskLuminance,
      `${result.name} side/day maximum ratio`,
    ).toBeLessThan(result.dayside.diskLuminance * 0.85);
  }
});
