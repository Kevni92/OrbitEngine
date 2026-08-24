import { expect, test, type Page } from "@playwright/test";

interface OrbitDiagnostics {
  readonly objectId: string;
  readonly kind: string;
  readonly role: string;
  readonly opacity: number;
  readonly visible: boolean;
  readonly anchorPosition: { readonly x: number; readonly y: number; readonly z: number };
}

interface BodyDiagnostics {
  readonly objectId: string;
  readonly renderWorldPosition: { readonly x: number; readonly y: number; readonly z: number };
}

interface RenderDiagnostics {
  readonly focusId: string;
  readonly selectedId: string;
  readonly orbits: readonly OrbitDiagnostics[];
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

async function focus(page: Page, objectId: string): Promise<RenderDiagnostics> {
  await page.selectOption("#selected-select", objectId);
  await page.selectOption("#focus-select", objectId);
  await expect.poll(async () => (await readDiagnostics(page))?.focusId).toBe(objectId);
  return (await readDiagnostics(page))!;
}

function orbit(diagnostics: RenderDiagnostics, objectId: string): OrbitDiagnostics {
  const result = diagnostics.orbits.find((candidate) => candidate.objectId === objectId);
  expect(result, `orbit ${objectId}`).toBeDefined();
  return result!;
}

function body(diagnostics: RenderDiagnostics, objectId: string): BodyDiagnostics {
  const result = diagnostics.bodies.find((candidate) => candidate.objectId === objectId);
  expect(result, `body ${objectId}`).toBeDefined();
  return result!;
}

test("resolved planetary child orbits are local, selectable, and parent-anchored", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#engine-status")).toHaveAttribute("data-state", "ready");
  await expect(page.locator("#rendering-status")).toHaveAttribute("data-state", "ready");
  await expect(page.locator("#orbit-status")).toContainText("reference orbits ready");

  let diagnostics = await focus(page, "1006");
  for (const objectId of ["1201", "1202", "1203", "1204", "1205"]) {
    const childOrbit = orbit(diagnostics, objectId);
    expect(childOrbit.kind).toBe("child");
    expect(childOrbit.role).toBe("local-system");
    expect(childOrbit.visible).toBe(true);
    expect(childOrbit.opacity).toBeCloseTo(0.3, 8);
  }

  await page.selectOption("#selected-select", "1202");
  await expect.poll(async () => (await readDiagnostics(page))?.selectedId).toBe("1202");
  diagnostics = (await readDiagnostics(page))!;
  expect(orbit(diagnostics, "1202").role).toBe("selected");
  expect(orbit(diagnostics, "1202").opacity).toBe(1);
  for (const objectId of ["1201", "1203", "1204"]) {
    expect(orbit(diagnostics, objectId).opacity).toBeCloseTo(0.3, 8);
  }

  await page.selectOption("#selected-select", "1203");
  await expect.poll(async () => (await readDiagnostics(page))?.selectedId).toBe("1203");
  diagnostics = (await readDiagnostics(page))!;
  expect(orbit(diagnostics, "1202").opacity).toBeCloseTo(0.3, 8);
  expect(orbit(diagnostics, "1203").role).toBe("selected");
  expect(orbit(diagnostics, "1203").opacity).toBe(1);

  const beforeAdvance = diagnostics;
  await page.locator("#advanced-details summary").click();
  await page.fill("#jump-seconds", "86400");
  await page.fill("#jump-nanoseconds", "0");
  await page.click("#jump-time");
  await expect(page.locator("#simulation-instant")).toHaveAttribute("data-seconds", "86400");
  await expect.poll(async () => {
    const current = await readDiagnostics(page);
    if (current === undefined) return false;
    const jupiter = body(current, "1006");
    const childOrbit = orbit(current, "1203");
    return Math.hypot(
      childOrbit.anchorPosition.x - jupiter.renderWorldPosition.x,
      childOrbit.anchorPosition.y - jupiter.renderWorldPosition.y,
      childOrbit.anchorPosition.z - jupiter.renderWorldPosition.z,
    ) < 1e-9;
  }).toBe(true);
  diagnostics = (await readDiagnostics(page))!;
  expect(body(diagnostics, "1203").renderWorldPosition).not.toEqual(body(beforeAdvance, "1203").renderWorldPosition);
  expect(orbit(diagnostics, "1203").opacity).toBe(1);

  diagnostics = await focus(page, "1008");
  for (const objectId of ["1201", "1202", "1203", "1204", "1205"]) {
    expect(orbit(diagnostics, objectId).visible, `Jupiter child orbit ${objectId}`).toBe(false);
  }

  diagnostics = await focus(page, "1005");
  for (const objectId of ["1101", "1102"]) {
    expect(orbit(diagnostics, objectId).kind).toBe("child");
    expect(orbit(diagnostics, objectId).visible, `Mars child orbit ${objectId}`).toBe(true);
  }

  diagnostics = await focus(page, "1007");
  for (const objectId of ["1301", "1302", "1303", "1304", "1305", "1306", "1307", "1308", "1309"]) {
    expect(orbit(diagnostics, objectId).kind).toBe("child");
    expect(orbit(diagnostics, objectId).visible, `Saturn child orbit ${objectId}`).toBe(true);
  }

  await page.selectOption("#selected-select", "3001");
  await expect.poll(async () => (await readDiagnostics(page))?.selectedId).toBe("3001");
  diagnostics = (await readDiagnostics(page))!;
  expect(orbit(diagnostics, "3001").visible).toBe(true);
  expect(orbit(diagnostics, "3001").role).toBe("selected");

  await page.selectOption("#selected-select", "1000");
  await expect.poll(async () => (await readDiagnostics(page))?.selectedId).toBe("1000");
  diagnostics = (await readDiagnostics(page))!;
  expect(diagnostics.orbits.some((candidate) => candidate.objectId === "3001")).toBe(false);
});
