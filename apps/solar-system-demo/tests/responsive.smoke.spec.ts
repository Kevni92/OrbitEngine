import { test, expect } from "@playwright/test";

test("portrait surfaces switch independently and expose direct control navigation", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await expect(page.locator("#engine-status")).toHaveAttribute("data-state", "ready");
  await expect(page.locator("#scene")).toBeVisible();
  await expect(page.locator("#mobile-surface-bar")).toBeVisible();
  await expect(page.locator("#demo-panel")).toBeVisible();
  await expect(page.locator("#celestial-browser")).toBeHidden();
  await expect(page.locator("#panel-summary")).toContainText("Simulation");

  for (const target of ["simulation-section", "selected-body-section", "view-section", "population-section"]) {
    await page.locator(`#control-nav button[data-target="${target}"]`).click();
    await expect(page.locator(`#${target}`)).toBeInViewport();
  }
  await page.locator('#control-nav button[data-target="advanced-details"]').click();
  await expect(page.locator("#advanced-details")).toHaveAttribute("open", "");
  await expect(page.locator("#advanced-details")).toBeInViewport();
  await page.locator('#control-nav button[data-target="view-section"]').click();
  await expect(page.locator("#orbit-guide-legend")).toBeInViewport();
  const legendBox = await page.locator("#orbit-guide-legend").boundingBox();
  expect(legendBox?.width ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(390);

  await page.selectOption("#selected-select", "1003");
  await expect(page.locator("#compact-selected-body")).toHaveText("Earth");
  await page.locator("#mobile-browser-toggle").click();
  await expect(page.locator("#celestial-browser")).toBeVisible();
  await expect(page.locator("#demo-panel")).toBeHidden();
  await page.locator("#celestial-browser-search").fill("Europa");

  await page.locator("#mobile-controls-toggle").click();
  await expect(page.locator("#demo-panel")).toBeVisible();
  await expect(page.locator("#celestial-browser")).toBeHidden();
  await expect(page.locator("#celestial-browser-search")).toHaveValue("Europa");
  await expect(page.locator("#compact-selected-body")).toHaveText("Earth");

  await page.locator("#panel-toggle").click();
  await expect(page.locator("#demo-panel")).toHaveClass(/is-collapsed/);
  await expect(page.locator("#panel-content")).toBeHidden();
  await page.locator("#panel-toggle").click();
  await expect(page.locator("#demo-panel")).not.toHaveClass(/is-collapsed/);
  await expect(page.locator("#panel-content")).toBeVisible();
  await expect(page.locator("#compact-simulation-time")).toContainText("Uhr");
});

test("responsive surface controls support Tab, Enter, Space, and Escape", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const controlsToggle = page.locator("#mobile-controls-toggle");
  const browserToggle = page.locator("#mobile-browser-toggle");
  await controlsToggle.focus();
  await page.keyboard.press("Tab");
  await expect(browserToggle).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#celestial-browser")).toBeVisible();
  await expect(page.locator("#demo-panel")).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(page.locator("#celestial-browser")).toBeHidden();
  await expect(browserToggle).toBeFocused();

  await controlsToggle.focus();
  await page.keyboard.press("Space");
  await expect(page.locator("#demo-panel")).toBeVisible();
  await controlsToggle.focus();
  await page.keyboard.press("Space");
  await expect(page.locator("#demo-panel")).toBeHidden();
});

test("constrained desktop navigation keeps selection and summary visible", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/");

  await expect(page.locator("#demo-panel")).toBeVisible();
  await expect(page.locator("#celestial-browser")).toBeVisible();
  await page.selectOption("#selected-select", "1003");
  await expect(page.locator("#compact-selected-body")).toHaveText("Earth");
  await page.locator('#control-nav button[data-target="population-section"]').click();
  await expect(page.locator("#population-section")).toBeInViewport();
  await expect(page.locator("#panel-summary")).toContainText("Earth");
  await expect(page.locator("#compact-simulation-time")).toContainText("Uhr");
  await page.locator('#control-nav button[data-target="view-section"]').click();
  await expect(page.locator("#orbit-guide-legend")).toBeInViewport();
  const legendBox = await page.locator("#orbit-guide-legend").boundingBox();
  expect(legendBox?.width ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(1024);
});
