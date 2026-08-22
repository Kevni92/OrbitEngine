import { expect, test, type Page } from "@playwright/test";

interface OrbitDiagnostics {
  readonly objectId: string;
  readonly role: string;
  readonly visible: boolean;
}

interface RenderDiagnostics {
  readonly focusId: string;
  readonly selectedId: string;
  readonly orbits: readonly OrbitDiagnostics[];
}

async function diagnostics(page: Page): Promise<RenderDiagnostics | undefined> {
  return page.evaluate(() => {
    const hook = (window as Window & {
      __orbitDemoRenderDiagnostics?: () => RenderDiagnostics;
    }).__orbitDemoRenderDiagnostics;
    return hook?.();
  });
}

test("selecting a direct Mars moon keeps Mars heliocentric orbit visible", async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  await page.goto("/");
  await expect(page.locator("#engine-status")).toHaveAttribute("data-state", "ready");
  await expect(page.locator("#rendering-status")).toHaveAttribute("data-state", "ready");

  await page.selectOption("#focus-select", "1005"); // Mars
  await expect.poll(async () => (await diagnostics(page))?.focusId).toBe("1005");

  await page.selectOption("#selected-select", "1102"); // Deimos
  await expect.poll(async () => (await diagnostics(page))?.selectedId).toBe("1102");

  await expect.poll(async () => {
    const current = await diagnostics(page);
    const mars = current?.orbits.find((orbit) => orbit.objectId === "1005");
    return mars?.visible;
  }).toBe(true);

  expect(pageErrors).toHaveLength(0);
});
