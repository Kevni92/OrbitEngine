import { expect, test, type Page } from "@playwright/test";

interface TextureLayerDiagnostics {
  readonly purpose: string;
  readonly assetKey: string;
  readonly loaded: boolean;
}

interface BodyDiagnostics {
  readonly objectId: string;
  readonly representation: string;
  readonly ndcX: number;
  readonly ndcY: number;
  readonly renderWorldPosition: { readonly x: number; readonly y: number; readonly z: number };
  readonly planetTextureSetId?: string;
  readonly planetTextureLayers?: readonly TextureLayerDiagnostics[];
  readonly stellarDirections: readonly { readonly emitterId: string; readonly renderDirectionToEmitter: { readonly x: number; readonly y: number; readonly z: number } }[];
}

interface RenderDiagnostics {
  readonly focusId: string;
  readonly planetTextureResources: {
    readonly activeResourceCount: number;
    readonly pendingResourceCount: number;
    readonly activeReferenceCount: number;
    readonly loadRequestCount: number;
  };
  readonly bodies: readonly BodyDiagnostics[];
}

async function diagnostics(page: Page): Promise<RenderDiagnostics> {
  return (await page.evaluate(() => {
    const hook = (window as Window & {
      __orbitDemoRenderDiagnostics?: () => RenderDiagnostics;
    }).__orbitDemoRenderDiagnostics;
    return hook?.();
  }))!;
}

async function focusBody(page: Page, objectId: string): Promise<BodyDiagnostics> {
  await page.evaluate((nextObjectId) => {
    for (const id of ["focus-select", "selected-select"]) {
      const select = document.querySelector<HTMLSelectElement>(`#${id}`);
      if (select === null) throw new Error(`Missing ${id}`);
      select.value = nextObjectId;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }, objectId);
  await expect.poll(async () => (await diagnostics(page)).focusId).toBe(objectId);
  await expect.poll(async () => (await diagnostics(page)).bodies.find((body) => body.objectId === objectId)?.representation).toBe("sphere");
  await expect.poll(async () => {
    const body = (await diagnostics(page)).bodies.find((candidate) => candidate.objectId === objectId);
    return body?.planetTextureLayers?.filter((layer) => layer.purpose === "surface" || layer.purpose === "cloudDeck").every((layer) => layer.loaded) ?? false;
  }).toBe(true);
  return (await diagnostics(page)).bodies.find((body) => body.objectId === objectId)!;
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

async function bodyPixelStats(page: Page, body: BodyDiagnostics): Promise<{ readonly meanLuminance: number; readonly luminanceRange: number }> {
  const screenshot = await page.locator("#scene").screenshot();
  return page.evaluate(async ({ source, body }) => {
    const image = new Image();
    image.src = source;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (context === null) throw new Error("Texture smoke test cannot read the scene");
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const centerX = (body.ndcX + 1) * canvas.width / 2;
    const centerY = (1 - body.ndcY) * canvas.height / 2;
    const radius = Math.min(canvas.width, canvas.height) * 0.12;
    let total = 0;
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    let count = 0;
    for (let y = Math.max(0, Math.floor(centerY - radius)); y < Math.min(canvas.height, Math.ceil(centerY + radius)); y += 1) {
      for (let x = Math.max(0, Math.floor(centerX - radius)); x < Math.min(canvas.width, Math.ceil(centerX + radius)); x += 1) {
        if (Math.hypot(x - centerX, y - centerY) > radius) continue;
        const offset = (y * canvas.width + x) * 4;
        const luminance = (pixels[offset] ?? 0) * 0.2126
          + (pixels[offset + 1] ?? 0) * 0.7152
          + (pixels[offset + 2] ?? 0) * 0.0722;
        total += luminance;
        min = Math.min(min, luminance);
        max = Math.max(max, luminance);
        count += 1;
      }
    }
    return { meanLuminance: total / count, luminanceRange: max - min };
  }, { source: `data:image/png;base64,${screenshot.toString("base64")}`, body });
}

async function setEarthCameraSide(page: Page, body: BodyDiagnostics, sign: 1 | -1): Promise<BodyDiagnostics> {
  const direction = body.stellarDirections.find((candidate) => candidate.emitterId === "1000")!;
  await page.evaluate(({ body, direction, sign }) => {
    const hook = (window as Window & {
      __orbitDemoSetCameraFixture?: (fixture: { position: readonly [number, number, number]; target: readonly [number, number, number]; up: readonly [number, number, number] }) => void;
    }).__orbitDemoSetCameraFixture;
    if (hook === undefined) throw new Error("Camera fixture hook is missing");
    const distance = 0.06;
    hook({
      position: [
        body.renderWorldPosition.x + direction.renderDirectionToEmitter.x * distance * sign,
        body.renderWorldPosition.y + direction.renderDirectionToEmitter.y * distance * sign,
        body.renderWorldPosition.z + direction.renderDirectionToEmitter.z * distance * sign,
      ],
      target: [body.renderWorldPosition.x, body.renderWorldPosition.y, body.renderWorldPosition.z],
      up: [0, 0, 1],
    });
  }, { body, direction, sign });
  await page.waitForTimeout(120);
  return (await diagnostics(page)).bodies.find((candidate) => candidate.objectId === body.objectId)!;
}

test("SSS maps render for all major planets and Earth keeps separate day/cloud/night layers", async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await expect(page.locator("#engine-status")).toHaveAttribute("data-state", "ready");
  await expect(page.locator("#rendering-status")).toHaveAttribute("data-state", "ready");
  await hideOverlays(page);

  for (const objectId of ["1001", "1002", "1003", "1005", "1006", "1007", "1008", "1009"]) {
    const body = await focusBody(page, objectId);
    expect(body.planetTextureSetId).toBe(objectId);
    expect(body.planetTextureLayers?.some((layer) => layer.loaded)).toBe(true);
    expect((await bodyPixelStats(page, body)).luminanceRange).toBeGreaterThan(2);
  }

  const earth = await focusBody(page, "1003");
  expect(earth.planetTextureLayers?.map((layer) => layer.purpose)).toEqual(["surface", "cloudOverlay", "nightLights"]);
  expect(earth.planetTextureLayers?.every((layer) => layer.loaded)).toBe(true);
  expect((await diagnostics(page)).planetTextureResources.activeResourceCount).toBe(3);

  const earthDay = await setEarthCameraSide(page, earth, 1);
  const dayStats = await bodyPixelStats(page, earthDay);
  const earthNight = await setEarthCameraSide(page, earthDay, -1);
  const nightStats = await bodyPixelStats(page, earthNight);
  expect(dayStats.luminanceRange).toBeGreaterThan(5);
  expect(nightStats.luminanceRange).toBeGreaterThan(2);
  expect(Math.abs(dayStats.meanLuminance - nightStats.meanLuminance)).toBeGreaterThan(1);

  await page.evaluate(() => {
    for (const id of ["focus-select", "selected-select"]) {
      const select = document.querySelector<HTMLSelectElement>(`#${id}`);
      if (select === null) throw new Error(`Missing ${id}`);
      select.value = "2001";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
  await expect.poll(async () => (await diagnostics(page)).focusId).toBe("2001");
  await expect.poll(async () => (await diagnostics(page)).planetTextureResources.activeResourceCount).toBeLessThan(3);
  await expect.poll(async () => (await diagnostics(page)).bodies.find((body) => body.objectId === "1003")?.planetTextureLayers?.some((layer) => layer.loaded)).toBe(false);
  expect(pageErrors).toHaveLength(0);
});
