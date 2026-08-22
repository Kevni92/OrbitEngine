import { expect, test, type Page } from "@playwright/test";

interface BodyDiagnostics {
  readonly objectId: string;
  readonly representation: string;
  readonly submitted: boolean;
  readonly surfaceReflectanceSource?: string;
  readonly physicalIrradianceWattsPerSquareMeter?: number;
  readonly atmosphere: {
    readonly resourcesAllocated: boolean;
    readonly visible: boolean;
    readonly projectedDiameterPixels: number;
    readonly viewSampleCount: number;
    readonly opticalSource?: "explicit" | "gas-library" | "zero-fallback";
  };
}

interface RenderDiagnostics {
  readonly focusId: string;
  readonly selectedId: string;
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
  await page.selectOption("#selected-select", objectId);
  await page.selectOption("#focus-select", objectId);
  await expect.poll(async () => (await readDiagnostics(page))?.focusId).toBe(objectId);
  await expect.poll(async () => (await readDiagnostics(page))?.bodies.find((body) => body.objectId === objectId)?.representation).toBe("sphere");
  return (await readDiagnostics(page))!.bodies.find((body) => body.objectId === objectId)!;
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

  const fallback = await focusBody(page, "2001"); // Ceres, no detailed appearance metadata
  expect(fallback.surfaceReflectanceSource).toBe("fallbackAccent");
  expect(fallback.atmosphere.resourcesAllocated).toBe(false);

  const earth = await focusBody(page, "1003");
  const beforeRadiusChange = (await readDiagnostics(page))!;
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

test("overview retains global star and major-planet context while focused atmosphere remains inspectable", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#engine-status")).toHaveAttribute("data-state", "ready");
  const initial = await readDiagnostics(page);
  expect(initial!.bodies.find((body) => body.objectId === "1000")).toBeDefined();
  expect(initial!.bodies.find((body) => body.objectId === "1006")).toBeDefined();

  await focusBody(page, "1003");
  const focused = await readDiagnostics(page);
  expect(focused!.bodies.find((body) => body.objectId === "1003")?.atmosphere.resourcesAllocated).toBe(true);
  expect(focused!.bodies.find((body) => body.objectId === "1000")?.representation).not.toBe("hidden");
  expect(focused!.bodies.find((body) => body.objectId === "1006")?.representation).not.toBe("hidden");
});
