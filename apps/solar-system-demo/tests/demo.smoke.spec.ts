import { test, expect } from "@playwright/test";

test("demo exposes polished guide, orbit, time, and advanced controls", async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  await page.addInitScript(() => {
    const nativeRequestAnimationFrame = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) => nativeRequestAnimationFrame((timestamp) => {
      callback(timestamp - 1000);
    });
  });
  await page.goto("/");

  await expect(page.locator("#engine-status")).toHaveAttribute("data-state", "ready");
  await expect(page.locator("#engine-status")).toContainText("Engine ready");
  await expect(page.locator("#scenario-note")).toHaveAttribute("data-state", "ready");
  await expect(page.locator("#focus-select")).toBeEnabled();
  await expect(page.locator("#grid-toggle")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#orbits-toggle")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#axes-toggle")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#orbit-status")).toContainText("reference orbits ready");

  await page.click("#panel-toggle");
  await expect(page.locator("#demo-panel")).toHaveClass(/is-collapsed/);
  await expect(page.locator("#panel-toggle")).toHaveAttribute("aria-expanded", "false");
  await page.click("#panel-toggle");
  await expect(page.locator("#demo-panel")).not.toHaveClass(/is-collapsed/);

  await page.click("#axes-toggle");
  await expect(page.locator("#axes-toggle")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#grid-toggle")).toHaveAttribute("aria-pressed", "true");
  await page.click("#grid-toggle");
  await expect(page.locator("#grid-toggle")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#axes-toggle")).toHaveAttribute("aria-pressed", "true");
  await page.click("#grid-toggle");
  await page.click("#orbits-toggle");
  await expect(page.locator("#orbits-toggle")).toHaveAttribute("aria-pressed", "false");
  await page.click("#orbits-toggle");

  await page.selectOption("#selected-select", "1003");
  await expect(page.locator("#selected-name")).toHaveText("Earth");
  await expect(page.locator("#selected-type")).toContainText("Planet");
  await expect(page.locator("#orbit-status")).toContainText("direction highlighted");
  await page.selectOption("#focus-select", "1003");
  await expect(page.locator("#focus-select")).toHaveValue("1003");

  await page.selectOption("#selected-select", "1202");
  await expect(page.locator("#selected-name")).toHaveText("Europa");
  await expect(page.locator("#selected-type")).toContainText("Moon");
  await page.selectOption("#selected-select", "2001");
  await expect(page.locator("#selected-name")).toHaveText("Ceres");
  await page.selectOption("#selected-select", "3007");
  await expect(page.locator("#selected-name")).toHaveText("Apophis");
  await page.selectOption("#selected-select", "1003");
  await expect(page.locator("#selected-name")).toHaveText("Earth");

  await page.locator("#scene").hover();
  for (let index = 0; index < 160; index += 1) await page.mouse.wheel(0, 100);
  await page.waitForTimeout(250);

  await page.locator("#advanced-details").locator("summary").click();
  await expect(page.locator("#technical-details")).toContainText("ObjectId: 1003");
  await expect(page.locator("#jump-seconds")).toBeVisible();
  await page.locator("#jump-local-datetime").fill("2026-08-22T00:16:32");
  await page.waitForTimeout(120);
  await page.click("#jump-local-time");
  await expect(page.locator("#simulation-instant")).toContainText("22.08.2026 00:16:32 Uhr");

  await page.selectOption("#warp-select", "2592000");
  await page.click("#play-pause");
  await page.waitForTimeout(120);
  await page.click("#play-pause");
  await expect(page.locator("#simulation-instant")).toContainText("Uhr");
  await expect(page.locator("#rendering-status")).toHaveAttribute("data-state", /^(ready|unsupported)$/);
  expect(pageErrors).toHaveLength(0);
});
