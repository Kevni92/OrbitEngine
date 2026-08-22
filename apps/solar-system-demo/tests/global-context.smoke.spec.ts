import { expect, test, type Page } from "@playwright/test";

interface RenderBodyDiagnostics {
  readonly objectId: string;
  readonly name: string;
  readonly type: string;
  readonly representation: string;
  readonly submitted: boolean;
  readonly orbitVisible: boolean;
  readonly inFront: boolean;
  readonly inViewport: boolean;
  readonly positionErrorSceneUnits?: number;
}

interface RenderDiagnostics {
  readonly focusId: string;
  readonly selectedId: string;
  readonly bodies: readonly RenderBodyDiagnostics[];
}

const GLOBAL_CONTEXT = [
  ["1000", "Sun"],
  ["1001", "Mercury"],
  ["1002", "Venus"],
  ["1003", "Earth"],
  ["1005", "Mars"],
  ["1006", "Jupiter"],
  ["1007", "Saturn"],
  ["1008", "Uranus"],
  ["1009", "Neptune"],
] as const;

const MAJOR_PLANET_ORBITS = GLOBAL_CONTEXT.slice(1);

async function readDiagnostics(page: Page): Promise<RenderDiagnostics | undefined> {
  return page.evaluate(() => {
    const hook = (window as Window & {
      __orbitDemoRenderDiagnostics?: () => RenderDiagnostics;
    }).__orbitDemoRenderDiagnostics;
    return hook?.();
  });
}

async function navigateTo(page: Page, objectId: string): Promise<RenderDiagnostics> {
  await page.selectOption("#selected-select", objectId);
  await page.selectOption("#focus-select", objectId);
  await expect(page.locator("#focus-select")).toHaveValue(objectId);
  await expect.poll(async () => (await readDiagnostics(page))?.focusId).toBe(objectId);
  await expect.poll(async () => {
    const diagnostics = await readDiagnostics(page);
    return diagnostics?.bodies.find((body) => body.objectId === objectId)?.inViewport;
  }).toBe(true);
  return (await readDiagnostics(page))!;
}

function expectGlobalContext(diagnostics: RenderDiagnostics): void {
  for (const [objectId, name] of GLOBAL_CONTEXT) {
    const body = diagnostics.bodies.find((candidate) => candidate.objectId === objectId);
    expect(body, `${name} diagnostics`).toBeDefined();
    expect(body!.representation, `${name} representation`).toMatch(/^(marker|sphere)$/);
    expect(body!.submitted, `${name} renderer submission`).toBe(true);
    expect(body!.positionErrorSceneUnits ?? Number.POSITIVE_INFINITY, `${name} current renderer position`).toBeLessThan(0.002);
  }
}

function expectMajorPlanetOrbits(diagnostics: RenderDiagnostics): void {
  for (const [objectId, name] of MAJOR_PLANET_ORBITS) {
    const body = diagnostics.bodies.find((candidate) => candidate.objectId === objectId);
    expect(body, `${name} diagnostics`).toBeDefined();
    expect(body!.orbitVisible, `${name} orbit visibility`).toBe(true);
  }
}

function expectSubmitted(diagnostics: RenderDiagnostics, objectId: string, name: string): void {
  const body = diagnostics.bodies.find((candidate) => candidate.objectId === objectId);
  expect(body, `${name} diagnostics`).toBeDefined();
  expect(body!.representation, `${name} representation`).toMatch(/^(marker|sphere)$/);
  expect(body!.submitted, `${name} renderer submission`).toBe(true);
  expect(body!.positionErrorSceneUnits ?? Number.POSITIVE_INFINITY, `${name} current renderer position`).toBeLessThan(0.002);
}

test("local moon focus preserves global Solar-System renderer context and major planet orbits", async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  await page.goto("/");
  await expect(page.locator("#engine-status")).toHaveAttribute("data-state", "ready");
  await expect(page.locator("#rendering-status")).toHaveAttribute("data-state", "ready");

  await expect.poll(async () => (await readDiagnostics(page))?.focusId).toBe("1000");
  await expect.poll(async () => {
    const diagnostics = await readDiagnostics(page);
    return diagnostics !== undefined && MAJOR_PLANET_ORBITS.every(([objectId]) =>
      diagnostics.bodies.find((body) => body.objectId === objectId)?.orbitVisible === true);
  }).toBe(true);
  let diagnostics = (await readDiagnostics(page))!;
  expectGlobalContext(diagnostics);
  expectMajorPlanetOrbits(diagnostics);
  expect(diagnostics.bodies.find((body) => body.objectId === "1202")?.representation).toBe("hidden");

  diagnostics = await navigateTo(page, "1006");
  expectGlobalContext(diagnostics);
  expectMajorPlanetOrbits(diagnostics);
  expectSubmitted(diagnostics, "1201", "Io");
  expectSubmitted(diagnostics, "1202", "Europa");
  expectSubmitted(diagnostics, "1203", "Ganymede");
  expectSubmitted(diagnostics, "1204", "Callisto");
  expect(diagnostics.bodies.find((body) => body.objectId === "1306")?.representation).toBe("hidden");

  diagnostics = await navigateTo(page, "1202");
  expectGlobalContext(diagnostics);
  expectMajorPlanetOrbits(diagnostics);
  expectSubmitted(diagnostics, "1006", "Jupiter");
  expectSubmitted(diagnostics, "1201", "Io");
  expectSubmitted(diagnostics, "1202", "Europa");
  expectSubmitted(diagnostics, "1203", "Ganymede");
  expectSubmitted(diagnostics, "1204", "Callisto");
  expect(diagnostics.bodies.find((body) => body.objectId === "1306")?.representation).toBe("hidden");

  diagnostics = await navigateTo(page, "1101");
  expectGlobalContext(diagnostics);
  expectMajorPlanetOrbits(diagnostics);
  expectSubmitted(diagnostics, "1005", "Mars");
  expectSubmitted(diagnostics, "1101", "Phobos");
  expect(diagnostics.bodies.find((body) => body.objectId === "1306")?.representation).toBe("hidden");

  diagnostics = await navigateTo(page, "1000");
  expectGlobalContext(diagnostics);
  expectMajorPlanetOrbits(diagnostics);
  expect(diagnostics.bodies.find((body) => body.objectId === "1202")?.representation).toBe("hidden");
  expect(pageErrors).toHaveLength(0);
});
