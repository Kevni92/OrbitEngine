import { expect, test, type Page } from "@playwright/test";

interface RenderBodyDiagnostics {
  readonly objectId: string;
  readonly representation: string;
  readonly submitted: boolean;
  readonly inViewport: boolean;
  readonly markerSizePixels?: number;
}

interface RenderDiagnostics {
  readonly focusId: string;
  readonly selectedId: string;
  readonly bodies: readonly RenderBodyDiagnostics[];
}

async function readDiagnostics(page: Page): Promise<RenderDiagnostics | undefined> {
  return page.evaluate(() => {
    const hook = (window as Window & {
      __orbitDemoRenderDiagnostics?: () => RenderDiagnostics;
    }).__orbitDemoRenderDiagnostics;
    return hook?.();
  });
}

async function bodyDiagnostics(page: Page, objectId: string): Promise<RenderBodyDiagnostics | undefined> {
  return (await readDiagnostics(page))?.bodies.find((body) => body.objectId === objectId);
}

test("true physical scale applies to distant planet markers while Uranus is focused", async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  await page.goto("/");
  await expect(page.locator("#engine-status")).toHaveAttribute("data-state", "ready");
  await expect(page.locator("#rendering-status")).toHaveAttribute("data-state", "ready");

  await page.selectOption("#selected-select", "1008");
  await page.selectOption("#focus-select", "1008");
  await expect.poll(async () => (await readDiagnostics(page))?.focusId).toBe("1008");
  await expect.poll(async () => (await bodyDiagnostics(page, "1008"))?.inViewport).toBe(true);
  await expect.poll(async () => (await bodyDiagnostics(page, "1008"))?.representation).toBe("sphere");

  await expect(page.locator("#radius-mode")).toHaveValue("adaptive");
  await expect.poll(async () => {
    const earth = await bodyDiagnostics(page, "1003");
    return earth?.representation === "marker" && earth.submitted ? earth.markerSizePixels : undefined;
  }).toBe(7);

  await page.selectOption("#radius-mode", "physical");
  await expect(page.locator("#radius-mode")).toHaveValue("physical");
  await expect.poll(async () => {
    const earth = await bodyDiagnostics(page, "1003");
    const size = earth?.markerSizePixels;
    return earth?.representation === "marker"
      && earth.submitted
      && typeof size === "number"
      && size > 0
      && size < 7;
  }).toBe(true);

  const physicalEarth = await bodyDiagnostics(page, "1003");
  expect(physicalEarth?.markerSizePixels).toBeLessThan(7);
  expect((await bodyDiagnostics(page, "1008"))?.representation).toBe("sphere");

  await page.selectOption("#radius-mode", "adaptive");
  await expect.poll(async () => (await bodyDiagnostics(page, "1003"))?.markerSizePixels).toBe(7);
  expect(pageErrors).toHaveLength(0);
});