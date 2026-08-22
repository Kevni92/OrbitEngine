import { expect, test, type Page } from "@playwright/test";

interface BodyDiagnostics {
  readonly objectId: string;
  readonly representation: string;
  readonly physicalIrradianceWattsPerSquareMeter?: number;
  readonly lightingMode: "physical" | "enhanced";
  readonly inspectionFillApplied: boolean;
  readonly inspectionFillContribution: number;
  readonly rendererInspectionFillIntensity: number;
  readonly surfaceTextureKind?: string;
  readonly surfaceTextureLuminanceRange?: number;
}

interface RenderDiagnostics {
  readonly selectedId: string;
  readonly lighting: {
    readonly mode: "physical" | "enhanced";
    readonly physicalIncidentFill: number;
    readonly inspectionFillContribution: number;
    readonly inspectionFillMaximum: number;
    readonly inspectionFillSource: string;
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

test("Physical and Enhanced preserve stellar diagnostics while toggling Lambert-normalized inspection fill", async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  await page.goto("/");
  await expect(page.locator("#engine-status")).toHaveAttribute("data-state", "ready");
  await expect(page.locator("#lighting-mode")).toHaveValue("physical");

  await page.selectOption("#selected-select", "1003");
  await page.selectOption("#focus-select", "1003");
  await expect.poll(async () => (await readDiagnostics(page))?.selectedId).toBe("1003");
  await expect.poll(async () => (await readDiagnostics(page))?.bodies.find((body) => body.objectId === "1003")?.representation).toBe("sphere");

  const physical = await readDiagnostics(page);
  const physicalBody = physical!.bodies.find((body) => body.objectId === "1003")!;
  expect(physical!.lighting.mode).toBe("physical");
  expect(physical!.lighting.physicalIncidentFill).toBe(0);
  expect(physical!.lighting.inspectionFillContribution).toBe(0);
  expect(physicalBody.inspectionFillApplied).toBe(false);
  expect(physicalBody.rendererInspectionFillIntensity).toBe(0);

  await page.selectOption("#lighting-mode", "enhanced");
  await expect(page.locator("#lighting-mode-note")).toContainText("artificial inspection lighting");
  await expect.poll(async () => (await readDiagnostics(page))?.lighting.mode).toBe("enhanced");
  const enhanced = await readDiagnostics(page);
  const enhancedBody = enhanced!.bodies.find((body) => body.objectId === "1003")!;
  expect(enhanced!.lighting.inspectionFillContribution).toBe(0.18);
  expect(enhanced!.lighting.inspectionFillContribution).toBeLessThanOrEqual(enhanced!.lighting.inspectionFillMaximum);
  expect(enhanced!.lighting.inspectionFillSource).toContain("artificial inspection lighting");
  expect(enhancedBody.lightingMode).toBe("enhanced");
  expect(enhancedBody.inspectionFillApplied).toBe(true);
  expect(enhancedBody.inspectionFillContribution).toBe(0.18);
  expect(enhancedBody.rendererInspectionFillIntensity).toBeCloseTo(0.18 * Math.PI, 12);
  expect(enhancedBody.physicalIrradianceWattsPerSquareMeter).toBe(physicalBody.physicalIrradianceWattsPerSquareMeter);

  await page.selectOption("#selected-select", "1009");
  await page.selectOption("#focus-select", "1009");
  await expect.poll(async () => (await readDiagnostics(page))?.bodies.find((body) => body.objectId === "1009")?.representation).toBe("sphere");
  await page.selectOption("#lighting-mode", "physical");
  const neptunePhysical = (await readDiagnostics(page))!.bodies.find((body) => body.objectId === "1009")!;
  await page.selectOption("#lighting-mode", "enhanced");
  await expect.poll(async () => (await readDiagnostics(page))?.bodies.find((body) => body.objectId === "1009")?.inspectionFillApplied).toBe(true);
  const neptuneEnhanced = (await readDiagnostics(page))!.bodies.find((body) => body.objectId === "1009")!;
  expect(neptuneEnhanced.physicalIrradianceWattsPerSquareMeter).toBe(neptunePhysical.physicalIrradianceWattsPerSquareMeter);
  expect(neptuneEnhanced.rendererInspectionFillIntensity).toBeCloseTo(0.18 * Math.PI, 12);
  expect(neptuneEnhanced.surfaceTextureKind).toBe("cloudDeck");
  expect(neptuneEnhanced.surfaceTextureLuminanceRange).toBeGreaterThan(0.04);

  await page.selectOption("#selected-select", "2001");
  await expect(page.locator("#selected-name")).toHaveText("Ceres");
  await expect(page.locator("#lighting-mode")).toHaveValue("enhanced");
  await page.selectOption("#lighting-mode", "physical");
  await expect(page.locator("#lighting-mode-note")).toContainText("stellar illumination only");
  await expect.poll(async () => (await readDiagnostics(page))?.lighting.inspectionFillContribution).toBe(0);
  expect(pageErrors).toHaveLength(0);
});
