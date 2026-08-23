import { test, expect } from "@playwright/test";

test("production OEP is active at the exact eclipse instant", async ({ page }) => {
  const requestUrls: string[] = [];
  const pageErrors: Error[] = [];
  page.on("request", (request) => requestUrls.push(request.url()));
  page.on("pageerror", (error) => pageErrors.push(error));

  await page.goto("/");
  await expect(page.locator("#scenario-note")).toHaveAttribute("data-state", "ready");
  await expect(page.locator("#reference-dataset-diagnostics")).toContainText("solar-system-reference@1.0.0-de441-major");
  await expect(page.locator("#eclipse-diagnostics")).toContainText("pass");

  const reference = await page.evaluate(() => window.__orbitDemoReferenceDiagnostics?.());
  expect(reference?.datasetId).toBe("solar-system-reference");
  expect(reference?.datasetVersion).toBe("1.0.0-de441-major");
  expect(reference?.eclipse.instant).toEqual({ seconds: 839828822, nanoseconds: 982997894 });
  expect(reference?.eclipse.angularSeparationRadians).toBeGreaterThan(0.01);
  expect(reference?.eclipse.angularErrorRadians).toBeLessThan(3e-11);

  await page.locator("#advanced-details summary").click();
  await page.locator("#jump-seconds").fill("839828822");
  await page.locator("#jump-nanoseconds").fill("982997894");
  await page.locator("#jump-time").click();
  await expect(page.locator("#simulation-instant")).toHaveAttribute("data-seconds", "839828822");
  await expect(page.locator("#simulation-instant")).toHaveAttribute("data-nanoseconds", "982997894");

  await page.selectOption("#selected-select", "1003");
  await expect(page.locator("#technical-details")).toContainText("Motion model: referenceEphemeris");
  await expect(page.locator("#technical-details")).toContainText("Reference source: OEP source node 6");
  await expect(page.locator("#technical-details")).toContainText("Source validity (TDB s): 0–31557600000");
  await expect(page.locator("#scenario-note")).toHaveAttribute("data-state", "ready");
  expect(requestUrls.filter((url) => /(nasa|jpl|mpc|horizons)/i.test(url))).toHaveLength(0);
  expect(pageErrors).toHaveLength(0);
});
