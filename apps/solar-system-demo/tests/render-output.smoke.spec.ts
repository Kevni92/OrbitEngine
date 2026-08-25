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
  readonly atmosphere: {
    readonly projectedDiameterPixels: number;
  };
}

interface RenderDiagnostics {
  readonly focusId: string;
  readonly lighting: {
    readonly mode: "physical" | "enhanced";
  };
  readonly bodies: readonly BodyDiagnostics[];
}

interface PixelMetrics {
  readonly background: readonly [number, number, number];
  readonly center: readonly [number, number];
  readonly disk: readonly [number, number, number];
  readonly diskLuminance: number;
  readonly annulus: readonly [number, number, number];
  readonly annulusLuminance: number;
  readonly annulusPixelCount: number;
}

async function readDiagnostics(page: Page): Promise<RenderDiagnostics | undefined> {
  return page.evaluate(() => {
    const hook = (window as Window & {
      __orbitDemoRenderDiagnostics?: () => RenderDiagnostics;
    }).__orbitDemoRenderDiagnostics;
    return hook?.();
  });
}

async function setFocus(page: Page, objectId: string): Promise<BodyDiagnostics> {
  const select = page.locator("#focus-select");
  if (await select.isVisible()) {
    await select.selectOption(objectId);
  } else {
    await page.evaluate((nextObjectId) => {
      const hiddenSelect = document.querySelector<HTMLSelectElement>("#focus-select");
      if (hiddenSelect === null) throw new Error("Focus select is missing");
      hiddenSelect.value = nextObjectId;
      hiddenSelect.dispatchEvent(new Event("input", { bubbles: true }));
      hiddenSelect.dispatchEvent(new Event("change", { bubbles: true }));
    }, objectId);
  }
  await expect.poll(async () => (await readDiagnostics(page))?.focusId).toBe(objectId);
  await expect.poll(async () => (await readDiagnostics(page))?.bodies.find((body) => body.objectId === objectId)?.representation).toBe("sphere");
  await page.waitForTimeout(100);
  return (await readDiagnostics(page))!.bodies.find((body) => body.objectId === objectId)!;
}

async function setLightingMode(page: Page, mode: "physical" | "enhanced"): Promise<void> {
  await page.evaluate((nextMode) => {
    const select = document.querySelector<HTMLSelectElement>("#lighting-mode");
    if (select === null) throw new Error("Lighting mode control is missing");
    select.value = nextMode;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }, mode);
  await expect.poll(async () => (await readDiagnostics(page))?.lighting.mode).toBe(mode);
  await page.waitForTimeout(100);
}

async function prepareCleanScene(page: Page): Promise<void> {
  for (const selector of ["#grid-toggle", "#orbits-toggle"] as const) {
    const button = page.locator(selector);
    if (await button.getAttribute("aria-pressed") === "true") await button.click();
  }
  await page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>("#demo-panel");
    const browser = document.querySelector<HTMLElement>("#celestial-browser");
    if (panel !== null) panel.style.display = "none";
    if (browser !== null) browser.style.display = "none";
  });
  await page.waitForTimeout(50);
}

async function screenshotDataUrl(page: Page): Promise<string> {
  const screenshot = await page.locator("#scene").screenshot();
  return `data:image/png;base64,${screenshot.toString("base64")}`;
}

async function analyzeImage(
  page: Page,
  dataUrl: string,
  bodyDiameterPixels: number,
  fixedCenter?: readonly [number, number],
  sector?: "left" | "right",
): Promise<PixelMetrics> {
  return page.evaluate(async ({ source, diameter, requestedCenter, requestedSector }) => {
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

    const cornerSamples = [
      [4, 4],
      [canvas.width - 5, 4],
      [4, canvas.height - 5],
      [canvas.width - 5, canvas.height - 5],
    ] as const;
    const background: [number, number, number] = [0, 0, 0];
    for (const [x, y] of cornerSamples) {
      const offset = (y * canvas.width + x) * 4;
      background[0] += pixels[offset] ?? 0;
      background[1] += pixels[offset + 1] ?? 0;
      background[2] += pixels[offset + 2] ?? 0;
    }
    background[0] /= cornerSamples.length;
    background[1] /= cornerSamples.length;
    background[2] /= cornerSamples.length;

    let centerX = requestedCenter?.[0] ?? 0;
    let centerY = requestedCenter?.[1] ?? 0;
    if (requestedCenter === undefined) {
      let count = 0;
      let sumX = 0;
      let sumY = 0;
      const edgeMarginX = Math.floor(canvas.width * 0.08);
      const edgeMarginY = Math.floor(canvas.height * 0.08);
      for (let y = edgeMarginY; y < canvas.height - edgeMarginY; y += 1) {
        for (let x = edgeMarginX; x < canvas.width - edgeMarginX; x += 1) {
          const offset = (y * canvas.width + x) * 4;
          const r = pixels[offset] ?? 0;
          const g = pixels[offset + 1] ?? 0;
          const b = pixels[offset + 2] ?? 0;
          const distanceFromBackground = Math.max(
            Math.abs(r - background[0]),
            Math.abs(g - background[1]),
            Math.abs(b - background[2]),
          );
          if (distanceFromBackground < 24) continue;
          count += 1;
          sumX += x;
          sumY += y;
        }
      }
      if (count === 0) throw new Error("No resolved body pixels found in screenshot");
      centerX = sumX / count;
      centerY = sumY / count;
    }

    const bodyRadius = diameter / 2;
    const diskRadius = bodyRadius * 0.55;
    const annulusInner = bodyRadius + 0.75;
    const annulusOuter = bodyRadius + 6;
    const disk: [number, number, number] = [0, 0, 0];
    const annulus: [number, number, number] = [0, 0, 0];
    let diskCount = 0;
    let annulusCount = 0;
    const minX = Math.max(0, Math.floor(centerX - annulusOuter - 2));
    const maxX = Math.min(canvas.width - 1, Math.ceil(centerX + annulusOuter + 2));
    const minY = Math.max(0, Math.floor(centerY - annulusOuter - 2));
    const maxY = Math.min(canvas.height - 1, Math.ceil(centerY + annulusOuter + 2));
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const distance = Math.hypot(x - centerX, y - centerY);
        const offset = (y * canvas.width + x) * 4;
        if (requestedSector === "left" && x >= centerX) continue;
        if (requestedSector === "right" && x < centerX) continue;
        if (distance <= diskRadius) {
          disk[0] += pixels[offset] ?? 0;
          disk[1] += pixels[offset + 1] ?? 0;
          disk[2] += pixels[offset + 2] ?? 0;
          diskCount += 1;
        } else if (distance >= annulusInner && distance <= annulusOuter) {
          annulus[0] += pixels[offset] ?? 0;
          annulus[1] += pixels[offset + 1] ?? 0;
          annulus[2] += pixels[offset + 2] ?? 0;
          annulusCount += 1;
        }
      }
    }
    if (diskCount === 0 || annulusCount === 0) throw new Error("Insufficient screenshot samples");
    const diskMean: [number, number, number] = [disk[0] / diskCount, disk[1] / diskCount, disk[2] / diskCount];
    const annulusMean: [number, number, number] = [annulus[0] / annulusCount, annulus[1] / annulusCount, annulus[2] / annulusCount];
    const luminance = (rgb: readonly [number, number, number]): number => rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
    return {
      background,
      center: [centerX, centerY] as [number, number],
      disk: diskMean,
      diskLuminance: luminance(diskMean),
      annulus: annulusMean,
      annulusLuminance: luminance(annulusMean),
      annulusPixelCount: annulusCount,
    };
  }, { source: dataUrl, diameter: bodyDiameterPixels, requestedCenter: fixedCenter, requestedSector: sector });
}

async function canvasCenterForBody(page: Page, body: BodyDiagnostics): Promise<readonly [number, number]> {
  return page.locator("#scene").evaluate((element, ndc) => {
    if (!(element instanceof HTMLCanvasElement)) throw new Error("Scene canvas is missing");
    return [
      (ndc.x + 1) * element.width / 2,
      (1 - ndc.y) * element.height / 2,
    ] as const;
  }, { x: body.ndcX, y: body.ndcY });
}

async function orientFocusedBody(page: Page, body: BodyDiagnostics, geometry: "dayside" | "terminator"): Promise<BodyDiagnostics> {
  const sunDirection = body.stellarDirections.find((direction) => direction.emitterId === "1000")?.renderDirectionToEmitter;
  if (sunDirection === undefined) throw new Error(`Sun direction is missing for ${body.objectId}`);
  const cameraDirection = geometry === "dayside"
    ? sunDirection
    : (() => {
      const reference = Math.abs(sunDirection.z) < 0.9 ? { x: 0, y: 0, z: 1 } : { x: 1, y: 0, z: 0 };
      const tangent = {
        x: sunDirection.y * reference.z - sunDirection.z * reference.y,
        y: sunDirection.z * reference.x - sunDirection.x * reference.z,
        z: sunDirection.x * reference.y - sunDirection.y * reference.x,
      };
      const length = Math.hypot(tangent.x, tangent.y, tangent.z);
      return { x: tangent.x / length, y: tangent.y / length, z: tangent.z / length };
    })();
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
      position: [center.x + direction.x * distance, center.y + direction.y * distance, center.z + direction.z * distance],
      target: [center.x, center.y, center.z],
      up: [0, 0, 1],
    });
  }, { center: body.renderWorldPosition, direction: cameraDirection });
  await page.waitForTimeout(80);
  return (await readDiagnostics(page))!.bodies.find((candidate) => candidate.objectId === body.objectId)!;
}

test("Earth focus produces a visible blue atmospheric limb in actual canvas pixels", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#engine-status")).toHaveAttribute("data-state", "ready");
  const earth = await setFocus(page, "1003");
  await setLightingMode(page, "physical");
  await prepareCleanScene(page);
  const metrics = await analyzeImage(page, await screenshotDataUrl(page), earth.atmosphere.projectedDiameterPixels);
  const limbBlueBias = metrics.annulus[2] - metrics.annulus[0];
  expect(metrics.diskLuminance).toBeGreaterThan(25);
  expect(metrics.annulusPixelCount).toBeGreaterThan(100);
  expect(metrics.annulus[2] - metrics.background[2]).toBeGreaterThan(5);
  expect(limbBlueBias).toBeGreaterThan(5);
});

test("Neptune Enhanced mode stays readable while its body-driven atmosphere remains blue", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#engine-status")).toHaveAttribute("data-state", "ready");
  const neptune = await setFocus(page, "1009");
  const neptuneCenter = await canvasCenterForBody(page, neptune);
  await setLightingMode(page, "physical");
  await prepareCleanScene(page);
  const physicalImage = await screenshotDataUrl(page);
  await setLightingMode(page, "enhanced");
  const enhancedImage = await screenshotDataUrl(page);
  const enhanced = await analyzeImage(page, enhancedImage, neptune.atmosphere.projectedDiameterPixels, neptuneCenter);
  const physical = await analyzeImage(page, physicalImage, neptune.atmosphere.projectedDiameterPixels, neptuneCenter);
  expect(enhanced.diskLuminance).toBeGreaterThan(20);
  expect(enhanced.diskLuminance - physical.diskLuminance).toBeGreaterThan(15);
  expect(enhanced.annulus[2] - enhanced.annulus[0]).toBeGreaterThan(5);
});

test("bounded atmosphere radiance remains measurable across body-specific optics and terminator geometry", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await expect(page.locator("#engine-status")).toHaveAttribute("data-state", "ready");
  await setLightingMode(page, "physical");
  await prepareCleanScene(page);

  const earth = await setFocus(page, "1003");
  const earthDayside = await orientFocusedBody(page, earth, "dayside");
  const earthDaysideMetrics = await analyzeImage(page, await screenshotDataUrl(page), earthDayside.atmosphere.projectedDiameterPixels);
  const earthTerminator = await orientFocusedBody(page, earth, "terminator");
  const earthTerminatorImage = await screenshotDataUrl(page);
  const earthTerminatorMetrics = await analyzeImage(page, earthTerminatorImage, earthTerminator.atmosphere.projectedDiameterPixels);
  const earthTerminatorLeft = await analyzeImage(page, earthTerminatorImage, earthTerminator.atmosphere.projectedDiameterPixels, undefined, "left");
  const earthTerminatorRight = await analyzeImage(page, earthTerminatorImage, earthTerminator.atmosphere.projectedDiameterPixels, undefined, "right");
  console.log("[atmosphere-radiance] Earth", { earthDaysideMetrics, earthTerminatorMetrics, earthTerminatorLeft, earthTerminatorRight });
  expect(earthDaysideMetrics.annulusLuminance).toBeGreaterThan(1);
  expect(earthDaysideMetrics.annulus[2] - earthDaysideMetrics.annulus[0]).toBeGreaterThan(1);
  expect(earthTerminatorMetrics.annulusLuminance).toBeGreaterThan(0.5);
  const daysideRedBlueRatio = earthDaysideMetrics.annulus[0] / Math.max(earthDaysideMetrics.annulus[2], 1);
  const tangentRedBlueRatio = earthTerminatorLeft.annulus[0] / Math.max(earthTerminatorLeft.annulus[2], 1);
  const oppositeTerminatorRedBlueRatio = earthTerminatorRight.annulus[0] / Math.max(earthTerminatorRight.annulus[2], 1);
  expect(tangentRedBlueRatio).toBeGreaterThan(daysideRedBlueRatio);
  expect(tangentRedBlueRatio).toBeGreaterThan(oppositeTerminatorRedBlueRatio + 0.1);

  const mars = await setFocus(page, "1005");
  const marsDayside = await orientFocusedBody(page, mars, "dayside");
  const marsMetrics = await analyzeImage(page, await screenshotDataUrl(page), marsDayside.atmosphere.projectedDiameterPixels);
  console.log("[atmosphere-radiance] Mars", { marsMetrics });
  expect(marsMetrics.annulusLuminance).toBeGreaterThan(0.5);
  expect(marsMetrics.annulus[0] / Math.max(marsMetrics.annulus[2], 1))
    .toBeGreaterThan(earthDaysideMetrics.annulus[0] / Math.max(earthDaysideMetrics.annulus[2], 1));

  const venus = await setFocus(page, "1002");
  const venusDayside = await orientFocusedBody(page, venus, "dayside");
  const venusMetrics = await analyzeImage(page, await screenshotDataUrl(page), venusDayside.atmosphere.projectedDiameterPixels);
  console.log("[atmosphere-radiance] Venus", { venusMetrics });
  expect(venusMetrics.annulusLuminance).toBeGreaterThan(0.5);

  const neptune = await setFocus(page, "1009");
  const neptuneDayside = await orientFocusedBody(page, neptune, "dayside");
  const neptuneMetrics = await analyzeImage(page, await screenshotDataUrl(page), neptuneDayside.atmosphere.projectedDiameterPixels);
  console.log("[atmosphere-radiance] Neptune", { neptuneMetrics });
  expect(neptuneMetrics.annulusLuminance).toBeGreaterThan(0.5);
  expect(neptuneMetrics.annulus[2]).toBeGreaterThan(neptuneMetrics.annulus[0]);
});
