import { expect, test } from "@playwright/test";

interface StartupDiagnostics {
  readonly milestones: Readonly<Record<string, number | undefined>>;
}

async function readStartupDiagnostics(page: import("@playwright/test").Page): Promise<StartupDiagnostics | undefined> {
  return page.evaluate(() => (window as Window & {
    __orbitDemoStartupDiagnostics?: () => StartupDiagnostics;
  }).__orbitDemoStartupDiagnostics?.());
}

test("first rendered frame precedes deferred orbit population and state queries follow dataset readiness", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#startup-loader")).toHaveAttribute("data-state", "loading");
  await expect(page.locator("#startup-loader")).toBeVisible();
  await expect.poll(async () => (await readStartupDiagnostics(page))?.milestones["first-rendered-frame"]).toBeDefined();
  await expect.poll(async () => (await readStartupDiagnostics(page))?.milestones["deferred-orbit-population-complete"]).toBeDefined();

  const milestones = (await readStartupDiagnostics(page))!.milestones;
  expect(milestones["webgl-ready"]).toBeDefined();
  expect(milestones["first-rendered-frame"]).toBeGreaterThanOrEqual(milestones["webgl-ready"]!);
  expect(milestones["first-rendered-frame"]).toBeLessThan(milestones["deferred-orbit-population-complete"]!);
  expect(milestones["dataset-ready"]).toBeDefined();
  expect(milestones["first-state-frame-ready"]).toBeGreaterThanOrEqual(milestones["dataset-ready"]!);
  await expect(page.locator("#startup-loader")).toHaveAttribute("data-state", "ready");
  await expect(page.locator("#scenario-note")).toHaveAttribute("data-state", "ready");
});
