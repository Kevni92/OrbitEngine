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
  readonly projectedDirection?: { readonly x: number; readonly y: number };
}

interface BodyDiagnostics {
  readonly objectId: string;
  readonly ndcX: number;
  readonly ndcY: number;
  readonly renderWorldPosition: Vector3;
  readonly stellarDirections: readonly DirectionDiagnostics[];
  readonly atmosphere: {
    readonly resourcesAllocated: boolean;
    readonly visible: boolean;
    readonly projectedDiameterPixels: number;
  };
}

interface RenderDiagnostics {
  readonly focusId: string;
  readonly bodies: readonly BodyDiagnostics[];
}

interface CameraFixture {
  readonly position: readonly [number, number, number];
  readonly target: readonly [number, number, number];
  readonly up: readonly [number, number, number];
}

interface SideMetrics {
  readonly blueBias: number;
  readonly luminance: number;
  readonly count: number;
}

async function readDiagnostics(page: Page): Promise<RenderDiagnostics | undefined> {
  return page.evaluate(() => {
    const hook = (window as Window & {
      __orbitDemoRenderDiagnostics?: () => RenderDiagnostics;
    }).__orbitDemoRenderDiagnostics;
    return hook?.();
  });
}

async function setCameraFixture(page: Page, fixture: CameraFixture): Promise<void> {
  await page.evaluate((value) => {
    const hook = (window as Window & {
      __orbitDemoSetCameraFixture?: (next: CameraFixture) => void;
    }).__orbitDemoSetCameraFixture;
    if (hook === undefined) throw new Error("Camera fixture hook is missing");
    hook(value);
  }, fixture);
  await page.waitForTimeout(80);
}

async function focusEarth(page: Page): Promise<BodyDiagnostics> {
  await page.locator('#celestial-browser-tree button[data-object-id="1003"]').click();
  await expect.poll(async () => (await readDiagnostics(page))?.focusId).toBe("1003");
  await expect.poll(async () => (await readDiagnostics(page))?.bodies.find((body) => body.objectId === "1003")?.stellarDirections.length).toBeGreaterThan(0);
  return (await readDiagnostics(page))!.bodies.find((body) => body.objectId === "1003")!;
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

function length(value: Vector3): number {
  return Math.hypot(value.x, value.y, value.z);
}

function scale(value: Vector3, factor: number): Vector3 {
  return { x: value.x * factor, y: value.y * factor, z: value.z * factor };
}

function cross(left: Vector3, right: Vector3): Vector3 {
  return {
    x: left.y * right.z - left.z * right.y,
    y: left.z * right.x - left.x * right.z,
    z: left.x * right.y - left.y * right.x,
  };
}

function normalize(value: Vector3): Vector3 {
  const magnitude = length(value);
  return scale(value, 1 / magnitude);
}

function perpendicularTo(direction: Vector3): Vector3 {
  const basis = Math.abs(direction.z) < 0.9 ? { x: 0, y: 0, z: 1 } : { x: 0, y: 1, z: 0 };
  return normalize(cross(direction, basis));
}

function cameraForDirection(
  center: Vector3,
  direction: Vector3,
  caseName: "behind" | "above" | "below" | "left" | "right",
): CameraFixture {
  // Earth is roughly 0.004 scene units in this presentation scale. Keep the
  // fixture outside the body so the shell samples a visible limb rather than
  // integrating from inside the solid sphere.
  const distance = 0.06;
  if (caseName === "behind") {
    const up = Math.abs(direction.z) < 0.9 ? { x: 0, y: 0, z: 1 } : { x: 0, y: 1, z: 0 };
    return {
      position: [center.x - direction.x * distance, center.y - direction.y * distance, center.z - direction.z * distance],
      target: [center.x, center.y, center.z],
      up: [up.x, up.y, up.z],
    };
  }

  const forward = perpendicularTo(direction);
  if (caseName === "above" || caseName === "below") {
    const sign = caseName === "above" ? 1 : -1;
    const up = scale(direction, sign);
    return {
      position: [center.x - forward.x * distance, center.y - forward.y * distance, center.z - forward.z * distance],
      target: [center.x, center.y, center.z],
      up: [up.x, up.y, up.z],
    };
  }

  const right = scale(direction, caseName === "right" ? 1 : -1);
  const up = normalize(cross(right, forward));
  return {
    position: [center.x - forward.x * distance, center.y - forward.y * distance, center.z - forward.z * distance],
    target: [center.x, center.y, center.z],
    up: [up.x, up.y, up.z],
  };
}

async function atmosphereSideMetrics(
  page: Page,
  body: BodyDiagnostics,
  side: readonly [number, number],
): Promise<SideMetrics> {
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
    const bodyRadius = input.body.atmosphere.projectedDiameterPixels / 2;
    const inner = bodyRadius + 0.75;
    const outer = bodyRadius + 7;
    let blueBias = 0;
    let luminance = 0;
    let count = 0;
    const minX = Math.max(0, Math.floor(centerX - outer - 2));
    const maxX = Math.min(canvas.width - 1, Math.ceil(centerX + outer + 2));
    const minY = Math.max(0, Math.floor(centerY - outer - 2));
    const maxY = Math.min(canvas.height - 1, Math.ceil(centerY + outer + 2));
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const dx = x - centerX;
        const dy = y - centerY;
        const radius = Math.hypot(dx, dy);
        const sideDistance = dx * input.side[0] + dy * input.side[1];
        if (radius < inner || radius > outer || sideDistance < radius * 0.3) continue;
        const offset = (y * canvas.width + x) * 4;
        const red = pixels[offset] ?? 0;
        const green = pixels[offset + 1] ?? 0;
        const blue = pixels[offset + 2] ?? 0;
        blueBias += blue - red;
        luminance += red * 0.2126 + green * 0.7152 + blue * 0.0722;
        count += 1;
      }
    }
    if (count === 0) throw new Error("No atmospheric side pixels found");
    return { blueBias: blueBias / count, luminance: luminance / count, count };
  }, { source: `data:image/png;base64,${screenshot.toString("base64")}`, input: { body, side } });
}

test("atmosphere stellar direction remains aligned in actual canvas output across camera directions", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await expect(page.locator("#engine-status")).toHaveAttribute("data-state", "ready");
  await expect(page.locator("#rendering-status")).toHaveAttribute("data-state", "ready");
  await page.selectOption("#lighting-mode", "physical");
  const initialEarth = await focusEarth(page);
  // Keep the focused body resolved while moving its selection halo away so
  // the annulus oracle measures atmospheric pixels rather than UI chrome.
  await page.selectOption("#selected-select", "1000");
  await hideOverlays(page);

  const sunDirection = initialEarth.stellarDirections.find((direction) => direction.emitterId === "1000")!;
  expect(sunDirection.shaderDirectionToEmitter).toEqual(sunDirection.renderDirectionToEmitter);
  const center = initialEarth.renderWorldPosition;
  const direction = sunDirection.renderDirectionToEmitter;

  const behindFixture = cameraForDirection(center, direction, "behind");
  await setCameraFixture(page, behindFixture);
  const behindBody = (await readDiagnostics(page))!.bodies.find((body) => body.objectId === "1003")!;
  const behindTop = await atmosphereSideMetrics(page, behindBody, [0, -1]);
  const behindBottom = await atmosphereSideMetrics(page, behindBody, [0, 1]);
  const behindLeft = await atmosphereSideMetrics(page, behindBody, [-1, 0]);
  const behindRight = await atmosphereSideMetrics(page, behindBody, [1, 0]);
  const verticalMean = (behindTop.luminance + behindBottom.luminance) / 2;
  const horizontalMean = (behindLeft.luminance + behindRight.luminance) / 2;
  expect(Math.abs(behindTop.luminance - behindBottom.luminance) / Math.max(verticalMean, 1)).toBeLessThan(0.25);
  expect(Math.abs(behindLeft.luminance - behindRight.luminance) / Math.max(horizontalMean, 1)).toBeLessThan(0.25);

  const expectedSides = [
    ["above", [0, -1]],
    ["below", [0, 1]],
    ["left", [-1, 0]],
    ["right", [1, 0]],
  ] as const;
  for (const [caseName, side] of expectedSides) {
    await setCameraFixture(page, cameraForDirection(center, direction, caseName));
    const body = (await readDiagnostics(page))!.bodies.find((candidate) => candidate.objectId === "1003")!;
    const expected = await atmosphereSideMetrics(page, body, side);
    const opposite = await atmosphereSideMetrics(page, body, [-side[0], -side[1]]);
    expect(expected.count).toBeGreaterThan(10);
    expect(expected.luminance).toBeGreaterThan(opposite.luminance + 0.5);
    expect(expected.blueBias).toBeGreaterThan(opposite.blueBias - 0.5);
  }
});

test("atmosphere direction stays invariant across adaptive radius and camera-relative presentation changes", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await expect(page.locator("#engine-status")).toHaveAttribute("data-state", "ready");
  const initialEarth = await focusEarth(page);
  const initialDirection = initialEarth.stellarDirections.find((direction) => direction.emitterId === "1000")!;
  const center = initialEarth.renderWorldPosition;
  await page.selectOption("#radius-mode", "physical");
  await setCameraFixture(page, cameraForDirection(center, initialDirection.renderDirectionToEmitter, "behind"));
  const physical = (await readDiagnostics(page))!.bodies.find((body) => body.objectId === "1003")!;
  await page.selectOption("#radius-mode", "adaptive");
  const adaptive = (await readDiagnostics(page))!.bodies.find((body) => body.objectId === "1003")!;
  const physicalDirection = physical.stellarDirections.find((direction) => direction.emitterId === "1000")!;
  const adaptiveDirection = adaptive.stellarDirections.find((direction) => direction.emitterId === "1000")!;
  expect(adaptiveDirection.physicalDirectionToEmitter).toEqual(physicalDirection.physicalDirectionToEmitter);
  expect(adaptiveDirection.renderDirectionToEmitter).toEqual(physicalDirection.renderDirectionToEmitter);
  expect(adaptiveDirection.shaderDirectionToEmitter).toEqual(physicalDirection.shaderDirectionToEmitter);
});
