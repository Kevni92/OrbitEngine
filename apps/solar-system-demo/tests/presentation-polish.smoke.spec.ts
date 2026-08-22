import { expect, test, type Page } from "@playwright/test";

interface RenderBodyDiagnostics {
  readonly objectId: string;
  readonly representation: string;
  readonly submitted: boolean;
  readonly inViewport: boolean;
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

async function navigateAndExpectInspectionScale(page: Page, objectId: string): Promise<void> {
  await page.selectOption("#selected-select", objectId);
  await page.selectOption("#focus-select", objectId);
  await expect.poll(async () => (await readDiagnostics(page))?.focusId).toBe(objectId);
  await expect.poll(async () => {
    const diagnostics = await readDiagnostics(page);
    const body = diagnostics?.bodies.find((candidate) => candidate.objectId === objectId);
    return body === undefined ? undefined : {
      selectedId: diagnostics!.selectedId,
      representation: body.representation,
      submitted: body.submitted,
      inViewport: body.inViewport,
    };
  }).toEqual({
    selectedId: objectId,
    representation: "sphere",
    submitted: true,
    inViewport: true,
  });
}

test("focus navigation lands Mars and Bennu at immediate inspection scale", async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  await page.goto("/");
  await expect(page.locator("#engine-status")).toHaveAttribute("data-state", "ready");
  await expect(page.locator("#rendering-status")).toHaveAttribute("data-state", "ready");

  await navigateAndExpectInspectionScale(page, "1005"); // Mars
  await navigateAndExpectInspectionScale(page, "3005"); // Bennu

  expect(pageErrors).toHaveLength(0);
});
