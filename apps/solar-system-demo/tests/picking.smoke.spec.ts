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

test("clicking centered Mars does not get stolen by a nearby moon marker", async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  await page.goto("/");
  await expect(page.locator("#engine-status")).toHaveAttribute("data-state", "ready");
  await expect(page.locator("#rendering-status")).toHaveAttribute("data-state", "ready");

  // Keep Mars as the camera focus so its visible sphere is centered, then
  // select Deimos to reproduce the reported local-system state.
  await page.selectOption("#focus-select", "1005"); // Mars
  await expect.poll(async () => (await readDiagnostics(page))?.focusId).toBe("1005");
  await page.selectOption("#selected-select", "1102"); // Deimos
  await expect.poll(async () => (await readDiagnostics(page))?.selectedId).toBe("1102");

  await expect.poll(async () => {
    const mars = (await readDiagnostics(page))?.bodies.find((body) => body.objectId === "1005");
    return mars === undefined ? undefined : {
      representation: mars.representation,
      submitted: mars.submitted,
      inViewport: mars.inViewport,
    };
  }).toEqual({ representation: "sphere", submitted: true, inViewport: true });

  const canvas = page.locator("#scene");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await canvas.click({
    position: {
      x: box!.width / 2,
      y: box!.height / 2,
    },
  });

  await expect.poll(async () => (await readDiagnostics(page))?.selectedId).toBe("1005");
  expect(pageErrors).toHaveLength(0);
});
