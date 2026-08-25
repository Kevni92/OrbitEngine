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

async function readDiagnostics(page: Page): Promise<RenderDiagnostics | undefined> {
  return page.evaluate(() => {
    const hook = (window as Window & { __orbitDemoRenderDiagnostics?: () => RenderDiagnostics }).__orbitDemoRenderDiagnostics;
    return hook?.();
  });
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
  return (await readDiagnostics(page))!.bodies.find((body) => body.objectId === objectId)!;
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

async function orientOppositeSun(page: Page, body: BodyDiagnostics): Promise<BodyDiagnostics> {
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
    const distance = 0.06;
    hook({
      position: [
        center.x - direction.x * distance,
        center.y - direction.y * distance,
        center.z - direction.z * distance,
      ],
      target: [center.x, center.y, center.z],
      up: [0, 0, 1],
    });
  }, { center: body.renderWorldPosition, direction: sunDirection });
  await page.waitForTimeout(120);
  return (await readDiagnostics(page))!.bodies.find((candidate) => candidate.objectId === body.objectId)!;
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

    // Measure most of the visible disk rather than only the central core.
    // This catches clipped limbs and overly dark presentation while leaving a
    // small edge margin for atmosphere compositing.
    const diskRadius = bodyRadius * 0.72;

    // The detached selection arcs now start 14 px outside the body. The halo
    // probe can therefore stay close to the physical limb and measure the
    // atmosphere/bloom where it is actually visible, without UI contamination.
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

for (const planet of PLANETS) {
  test(`${planet.name} obeys the shared planetary photometry contract`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");
    await expect(page.locator("#engine-status")).toHaveAttribute("data-state", "ready");
    await setPhysicalLighting(page);
    const daysideBody = await focusBody(page, planet.objectId);
    await hideOverlays(page);
    const dayside = await measure(page, daysideBody);

    // One shared contract for all current and future textured planets: readable
    // but not clipped. No object-id-specific thresholds are allowed here.
    expect(dayside.diskLuminance).toBeGreaterThan(35);
    expect(dayside.diskLuminance).toBeLessThan(220);
    expect(dayside.clippedDiskFraction).toBeLessThan(0.12);

    if (daysideBody.atmosphere.resourcesAllocated) {
      expect(dayside.annulusLuminance - dayside.backgroundLuminance).toBeGreaterThan(3);
      expect(dayside.annulusLuminance).toBeLessThan(235);
      expect(dayside.clippedAnnulusFraction).toBeLessThan(0.25);
    } else {
      expect(dayside.annulusLuminance - dayside.backgroundLuminance).toBeLessThan(10);
    }

    const nightsideBody = await orientOppositeSun(page, daysideBody);
    const nightside = await measure(page, nightsideBody);
    expect(nightside.diskLuminance).toBeLessThan(80);
    expect(nightside.diskLuminance).toBeLessThan(dayside.diskLuminance * 0.45);

    console.log("[planet-photometry]", planet.name, { dayside, nightside, atmosphere: daysideBody.atmosphere.resourcesAllocated });
  });
}
