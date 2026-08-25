import { expect, test, type Page } from "@playwright/test";

interface Vector3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

interface DirectionDiagnostics {
  readonly emitterId: string;
  readonly physicalDirectionToEmitter: Vector3;
  readonly renderDirectionToEmitter: Vector3;
  readonly shaderDirectionToEmitter: Vector3;
}

interface BodyDiagnostics {
  readonly objectId: string;
  readonly ndcX: number;
  readonly ndcY: number;
  readonly renderWorldPosition: Vector3;
  readonly representation: string;
  readonly submitted: boolean;
  readonly surfaceReflectanceSource?: string;
  readonly physicalIrradianceWattsPerSquareMeter?: number;
  readonly preExposureMappedIrradiance?: number;
  readonly displayExposure: number;
  readonly toneMappingMode: string;
  readonly stellarDirections: readonly DirectionDiagnostics[];
  readonly atmosphere: {
    readonly resourcesAllocated: boolean;
    readonly visible: boolean;
    readonly projectedDiameterPixels: number;
    readonly viewSampleCount: number;
    readonly opticalSource?: "explicit" | "gas-library" | "zero-fallback";
    readonly resolvedOptics?: {
      readonly rayleighScattering: { readonly r: number; readonly g: number; readonly b: number };
      readonly mieScattering: { readonly r: number; readonly g: number; readonly b: number };
      readonly absorption: { readonly r: number; readonly g: number; readonly b: number };
    };
  };
}

interface RenderDiagnostics {
  readonly focusId: string;
  readonly selectedId: string;
  readonly displayExposure: {
    readonly physicalIrradianceWattsPerSquareMeter?: number;
    readonly preExposureMappedIrradiance: number;
    readonly displayExposure: number;
    readonly toneMappingMode: string;
  };
  readonly atmosphereResourceCount: number;
  readonly performance: {
    readonly frameCount: number;
    readonly lastFrameDurationMs: number;
    readonly averageFrameDurationMs: number;
  };
  readonly bodies: readonly BodyDiagnostics[];
}

async function readDiagnostics(page: Page): Promise<RenderDiagnostics | undefined> {
  return page.evaluate(() => {
    const hook = (window as Window & {
      __orbitDemoRenderDiagnostics?: () => RenderDiagnostics;
    }).__orbitDemoRenderDiagnostics;
    return hook?.();
  });
}

async function focusBody(page: Page, objectId: string): Promise<BodyDiagnostics> {
  await page.evaluate((nextObjectId) => {
    for (const id of ["selected-select", "focus-select"]) {
      const select = document.getElementById(id) as HTMLSelectElement | null;
      if (select === null) throw new Error(`Missing ${id}`);
      select.value = nextObjectId;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }, objectId);
  await expect.poll(async () => (await readDiagnostics(page))?.focusId).toBe(objectId);
  await expect.poll(async () => (await readDiagnostics(page))?.bodies.find((body) => body.objectId === objectId)?.representation).toBe("sphere");
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
}

async function faceFocusedBodyTowardSun(page: Page, body: BodyDiagnostics): Promise<BodyDiagnostics> {
  const direction = (await readDiagnostics(page))!.bodies
    .find((candidate) => candidate.objectId === body.objectId)!
    .stellarDirections.find((candidate) => candidate.emitterId === "1000")!;
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
        center.x + direction.renderDirectionToEmitter.x * distance,
        center.y + direction.renderDirectionToEmitter.y * distance,
        center.z + direction.renderDirectionToEmitter.z * distance,
      ],
      target: [center.x, center.y, center.z],
      up: [0, 0, 1],
    });
  }, { center: body.renderWorldPosition, direction });
  await page.waitForTimeout(80);
  return (await readDiagnostics(page))!.bodies.find((candidate) => candidate.objectId === body.objectId)!;
}

interface RegionMetrics {
  readonly meanLuminance: number;
  readonly meanRed: number;
  readonly meanGreen: number;
  readonly meanBlue: number;
  readonly luminanceRange: number;
  readonly count: number;
}

async function regionMetrics(page: Page, body: BodyDiagnostics, annulus: boolean): Promise<RegionMetrics> {
  const screenshot = await page.locator("#scene").screenshot();
  return page.evaluate(async ({ source, input }) => {
    const image = new Image();
    image.src = source;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (context === null) throw new Error("2D canvas analysis context unavailable");
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const centerX = (input.body.ndcX + 1) * canvas.width / 2;
    const centerY = (1 - input.body.ndcY) * canvas.height / 2;
    const bodyRadius = Math.max(input.body.atmosphere.projectedDiameterPixels / 2, 18);
    const inner = input.annulus ? bodyRadius + 0.75 : 0;
    const outer = input.annulus ? bodyRadius + 7 : bodyRadius * 0.62;
    let redTotal = 0;
    let greenTotal = 0;
    let blueTotal = 0;
    let luminanceMin = Number.POSITIVE_INFINITY;
    let luminanceMax = Number.NEGATIVE_INFINITY;
    let count = 0;
    const minX = Math.max(0, Math.floor(centerX - outer - 2));
    const maxX = Math.min(canvas.width - 1, Math.ceil(centerX + outer + 2));
    const minY = Math.max(0, Math.floor(centerY - outer - 2));
    const maxY = Math.min(canvas.height - 1, Math.ceil(centerY + outer + 2));
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const radius = Math.hypot(x - centerX, y - centerY);
        if (radius < inner || radius > outer) continue;
        const offset = (y * canvas.width + x) * 4;
        const red = pixels[offset] ?? 0;
        const green = pixels[offset + 1] ?? 0;
        const blue = pixels[offset + 2] ?? 0;
        const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
        redTotal += red;
        greenTotal += green;
        blueTotal += blue;
        luminanceMin = Math.min(luminanceMin, luminance);
        luminanceMax = Math.max(luminanceMax, luminance);
        count += 1;
      }
    }
    if (count === 0) throw new Error("No body-region pixels found");
    return {
      meanLuminance: (redTotal * 0.2126 + greenTotal * 0.7152 + blueTotal * 0.0722) / count,
      meanRed: redTotal / count,
      meanGreen: greenTotal / count,
      meanBlue: blueTotal / count,
      luminanceRange: luminanceMax - luminanceMin,
      count,
    };
  }, { source: `data:image/png;base64,${screenshot.toString("base64")}`, input: { body, annulus } });
}

test("representative appearance bodies keep deterministic atmosphere, fallback, LOD, and performance diagnostics", async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  await page.goto("/");
  await expect(page.locator("#engine-status")).toHaveAttribute("data-state", "ready");
  await expect(page.locator("#rendering-status")).toHaveAttribute("data-state", "ready");

  const overview = await readDiagnostics(page);
  expect(overview!.performance.frameCount).toBeGreaterThan(0);
  expect(Number.isFinite(overview!.performance.averageFrameDurationMs)).toBe(true);
  console.log("[atmosphere-performance] overview", overview!.performance, { atmosphereResourceCount: overview!.atmosphereResourceCount });

  for (const [objectId, opticalSource] of [
    ["1003", "explicit"], // Earth-like Rayleigh atmosphere
    ["1002", "explicit"], // Venus dense haze/cloud atmosphere
    ["1005", "explicit"], // Mars thin atmosphere
    ["1306", "explicit"], // Titan dense haze atmosphere
    ["1006", "explicit"], // Jupiter cloud deck
  ] as const) {
    const body = await focusBody(page, objectId);
    expect(body.submitted).toBe(true);
    expect(body.atmosphere.resourcesAllocated).toBe(true);
    expect(body.atmosphere.visible).toBe(true);
    expect(body.atmosphere.viewSampleCount).toBe(8);
    expect(body.atmosphere.opticalSource).toBe(opticalSource);
    expect(body.surfaceReflectanceSource).toBeDefined();
  }

  const airless = await focusBody(page, "3001"); // Vesta
  expect(airless.atmosphere.resourcesAllocated).toBe(false);
  expect(airless.atmosphere.visible).toBe(false);
  expect(airless.atmosphere.viewSampleCount).toBe(8);
  console.log("[atmosphere-performance] without focused atmosphere", (await readDiagnostics(page))!.performance);

  const fallback = await focusBody(page, "2001"); // Ceres, no detailed appearance metadata
  expect(fallback.surfaceReflectanceSource).toBe("fallbackAccent");
  expect(fallback.atmosphere.resourcesAllocated).toBe(false);

  const earth = await focusBody(page, "1003");
  const beforeRadiusChange = (await readDiagnostics(page))!;
  console.log("[atmosphere-performance] focused Earth", beforeRadiusChange.performance, { atmosphereResourceCount: beforeRadiusChange.atmosphereResourceCount });
  const earthIrradiance = earth.physicalIrradianceWattsPerSquareMeter;
  await page.selectOption("#radius-mode", "physical");
  await expect.poll(async () => (await readDiagnostics(page))?.bodies.find((body) => body.objectId === "1003")?.physicalIrradianceWattsPerSquareMeter).toBe(earthIrradiance);
  await page.selectOption("#radius-mode", "adaptive");
  await expect.poll(async () => (await readDiagnostics(page))?.bodies.find((body) => body.objectId === "1003")?.physicalIrradianceWattsPerSquareMeter).toBe(earthIrradiance);

  await page.selectOption("#lighting-mode", "enhanced");
  await expect(page.locator("#lighting-mode-note")).toContainText("artificial inspection lighting");
  await expect.poll(async () => (await readDiagnostics(page))?.bodies.find((body) => body.objectId === "1003")?.atmosphere.resourcesAllocated).toBe(true);
  await page.selectOption("#lighting-mode", "physical");
  await expect(page.locator("#lighting-mode-note")).toContainText("stellar illumination only");

  const resourcesBeforePopulation = (await readDiagnostics(page))!.atmosphereResourceCount;
  await page.locator("#population-count").fill("300");
  await page.click("#add-asteroids");
  await expect(page.locator("#population-live-status")).toHaveText("Live total: 300 generated asteroids");
  await expect.poll(async () => (await readDiagnostics(page))?.atmosphereResourceCount).toBe(resourcesBeforePopulation);
  const generated = (await readDiagnostics(page))!.bodies.filter((body) => body.objectId.startsWith("900000000000000"));
  expect(generated.length).toBeGreaterThan(0);
  expect(generated.every((body) => body.atmosphere.resourcesAllocated === false)).toBe(true);

  const focused = await readDiagnostics(page);
  expect(focused!.performance.frameCount).toBeGreaterThan(beforeRadiusChange!.performance.frameCount);
  expect(Number.isFinite(focused!.performance.lastFrameDurationMs)).toBe(true);
  expect(Number.isFinite(focused!.performance.averageFrameDurationMs)).toBe(true);
  expect(pageErrors).toHaveLength(0);
});

test("Physical focus exposure keeps inner and outer planets readable without changing irradiance", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await expect(page.locator("#engine-status")).toHaveAttribute("data-state", "ready");
  await expect(page.locator("#rendering-status")).toHaveAttribute("data-state", "ready");
  await page.selectOption("#lighting-mode", "physical");
  await hideOverlays(page);

  const earth = await focusBody(page, "1003");
  const earthFacingSun = await faceFocusedBodyTowardSun(page, earth);
  const earthRing = await regionMetrics(page, earthFacingSun, true);
  const earthIrradiance = earth.physicalIrradianceWattsPerSquareMeter!;
  expect(earth.toneMappingMode).toBe("ACESFilmic");
  expect(earth.displayExposure).toBeGreaterThan(0);
  expect(earth.preExposureMappedIrradiance).toBeGreaterThan(0);

  const mars = await focusBody(page, "1005");
  const marsFacingSun = await faceFocusedBodyTowardSun(page, mars);
  const marsRing = await regionMetrics(page, marsFacingSun, true);
  expect(mars.atmosphere.resolvedOptics!.mieScattering.r).toBeGreaterThan(mars.atmosphere.resolvedOptics!.mieScattering.b);
  expect(marsRing.meanRed / Math.max(marsRing.meanBlue, 1))
    .toBeGreaterThan(earthRing.meanRed / Math.max(earthRing.meanBlue, 1) + 0.02);

  const mercury = await focusBody(page, "1001");
  const mercuryFacingSun = await faceFocusedBodyTowardSun(page, mercury);
  const mercurySurface = await regionMetrics(page, mercuryFacingSun, false);
  expect(mercury.physicalIrradianceWattsPerSquareMeter!).toBeGreaterThan(earthIrradiance);
  expect(mercury.displayExposure).toBeLessThan(earth.displayExposure);
  expect(mercurySurface.meanLuminance).toBeGreaterThan(8);
  expect(mercurySurface.luminanceRange).toBeGreaterThan(2);

  const uranus = await focusBody(page, "1008");
  const uranusFacingSun = await faceFocusedBodyTowardSun(page, uranus);
  const uranusSurface = await regionMetrics(page, uranusFacingSun, false);
  expect(uranus.physicalIrradianceWattsPerSquareMeter!).toBeLessThan(earthIrradiance / 100);
  expect(uranus.displayExposure).toBeGreaterThan(earth.displayExposure);
  expect(uranusSurface.meanLuminance).toBeGreaterThan(8);
  expect(uranusSurface.meanBlue).toBeGreaterThan(uranusSurface.meanRed);

  const neptune = await focusBody(page, "1009");
  const neptuneFacingSun = await faceFocusedBodyTowardSun(page, neptune);
  const neptuneSurface = await regionMetrics(page, neptuneFacingSun, false);
  expect(neptune.physicalIrradianceWattsPerSquareMeter!).toBeLessThan(earthIrradiance / 300);
  expect(neptune.displayExposure).toBeGreaterThan(uranus.displayExposure);
  expect(neptuneSurface.meanLuminance).toBeGreaterThan(8);
  expect(neptuneSurface.meanBlue).toBeGreaterThan(neptuneSurface.meanRed);
});

test("overview retains global star and major-planet context while focused atmosphere remains inspectable", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#engine-status")).toHaveAttribute("data-state", "ready");
  await expect.poll(async () => (await readDiagnostics(page))?.bodies.length ?? 0).toBeGreaterThan(0);
  const initial = await readDiagnostics(page);
  expect(initial!.bodies.find((body) => body.objectId === "1000")).toBeDefined();
  expect(initial!.bodies.find((body) => body.objectId === "1006")).toBeDefined();

  await focusBody(page, "1003");
  const focused = await readDiagnostics(page);
  expect(focused!.bodies.find((body) => body.objectId === "1003")?.atmosphere.resourcesAllocated).toBe(true);
  expect(focused!.bodies.find((body) => body.objectId === "1000")?.representation).not.toBe("hidden");
  expect(focused!.bodies.find((body) => body.objectId === "1006")?.representation).not.toBe("hidden");
});
