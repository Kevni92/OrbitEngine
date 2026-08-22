import { test, expect } from "@playwright/test";

test("demo exposes polished guide, orbit, time, and advanced controls", async ({ page }) => {
  const pageErrors: Error[] = [];
  const requestUrls: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  page.on("request", (request) => requestUrls.push(request.url()));
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
  await expect(page.locator("#celestial-browser")).toBeVisible();
  await expect(page.locator("#celestial-browser-summary")).toContainText("48 registered bodies");
  await expect(page.locator("#hierarchy-diagnostics")).toHaveText("Europa representation: hidden");

  await page.locator("#celestial-browser-search").fill("Jupiter");
  const jupiterResult = page.locator('#celestial-browser-results button[data-object-id="1006"]');
  await jupiterResult.focus();
  await jupiterResult.press("Enter");
  await expect(page.locator("#focus-select")).toHaveValue("1006");
  await expect(page.locator("#hierarchy-diagnostics")).toHaveText(/Europa representation: (marker|sphere)/);

  for (const [query, id, name] of [["Phobos", "1101", "Phobos"], ["Deimos", "1102", "Deimos"], ["Hygiea", "3003", "Hygiea"]] as const) {
    await page.locator("#celestial-browser-search").fill(query);
    const result = page.locator(`#celestial-browser-results button[data-object-id="${id}"]`);
    await result.focus();
    await result.press("Enter");
    await expect(page.locator("#selected-name")).toHaveText(name);
    await expect(page.locator("#selected-body-section")).toHaveAttribute("data-object-id", id);
    await expect(page.locator("#selected-body-section")).toHaveAttribute("data-representation", /^(marker|sphere)$/);
    await expect(page.locator("#selected-body-section")).toHaveAttribute("data-parent-representation", /^(marker|sphere|unknown)$/);
  }

  await page.locator("#celestial-browser-search").fill("Europa");
  await expect(page.locator("#celestial-browser-results")).toContainText("Jupiter › Europa");
  const europaResult = page.locator('#celestial-browser-results button[data-object-id="1202"]');
  await europaResult.focus();
  await europaResult.press("Enter");
  await expect(page.locator("#selected-name")).toHaveText("Europa");
  await expect(page.locator("#focus-select")).toHaveValue("1202");
  await page.locator("#celestial-browser-clear").click();
  await expect(page.locator("#celestial-browser-tree")).toBeVisible();
  await expect(page.locator('#celestial-browser-tree li[data-object-id="1202"]')).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('#celestial-browser-tree li[data-object-id="1202"]')).toBeVisible();
  const jupiterBranch = page.locator('#celestial-browser-tree li[data-object-id="1006"] > .celestial-tree-row .celestial-branch-toggle');
  await jupiterBranch.click();
  await expect(page.locator('#celestial-browser-tree li[data-object-id="1202"]')).not.toBeVisible();
  await jupiterBranch.click();
  await expect(page.locator('#celestial-browser-tree li[data-object-id="1202"]')).toBeVisible();

  await page.click("#celestial-browser-toggle");
  await expect(page.locator("#celestial-browser")).toHaveClass(/is-collapsed/);
  await page.click("#celestial-browser-toggle");
  await expect(page.locator("#celestial-browser")).not.toHaveClass(/is-collapsed/);

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
  await expect(page.locator('#celestial-browser-tree li[data-object-id="1003"]')).toHaveAttribute("aria-selected", "true");
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

  await expect(page.locator("#radius-mode")).toHaveValue("adaptive");
  await page.selectOption("#radius-mode", "physical");
  await page.selectOption("#radius-mode", "adaptive");
  await page.locator("#population-count").fill("300");
  await page.locator("#population-seed").fill("smoke-62");
  await page.click("#add-asteroids");
  await expect(page.locator("#population-status")).toContainText("300 generated asteroids");
  await expect(page.locator("#population-diagnostics")).toContainText("Generated asteroids: 300");
  await expect(page.locator("#population-diagnostics")).toContainText("Registered objects: 348");
  await expect(page.locator("#population-diagnostics")).toContainText("Queried objects: 348");
  await expect(page.locator("#population-diagnostics")).toContainText("Promoted runtime spheres:");
  const lodText = await page.locator("#population-diagnostics").textContent();
  const promotedRuntimeSpheres = Number(lodText?.match(/Promoted runtime spheres: (\d+)/)?.[1] ?? "-1");
  expect(promotedRuntimeSpheres).toBeGreaterThanOrEqual(0);
  expect(promotedRuntimeSpheres).toBeLessThanOrEqual(128);
  await page.selectOption("#selected-select", "9000000000000000000");
  await expect(page.locator("#selected-name")).toHaveText("Synthetic Asteroid 1");
  await expect(page.locator("#selected-body-section")).toHaveAttribute("data-representation", /^(marker|sphere)$/);
  await page.selectOption("#warp-select", "86400");
  await page.click("#play-pause");
  await page.waitForTimeout(120);
  await page.click("#play-pause");
  await page.click("#remove-asteroids");
  await expect(page.locator("#population-status")).toContainText("Removed 300 generated asteroids");
  await expect(page.locator("#population-diagnostics")).toContainText("Generated asteroids: 0");
  await expect(page.locator("#population-diagnostics")).toContainText("Registered objects: 48");
  await expect(page.locator("#population-diagnostics")).toContainText("Queried objects: 48");
  await expect(page.locator("#selected-name")).toHaveText("Sun");
  await page.selectOption("#selected-select", "1003");
  await expect(page.locator("#selected-name")).toHaveText("Earth");

  await page.locator("#scene").hover();
  await page.mouse.wheel(0, 16_000);
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
  expect(requestUrls.filter((url) => /(nasa|jpl|mpc|horizons)/i.test(url))).toHaveLength(0);
  expect(pageErrors).toHaveLength(0);
});
