import { test, expect } from "@playwright/test";

test("demo initializes the public WASM engine and reports rendering capability", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#engine-status")).toHaveAttribute("data-state", "ready");
  await expect(page.locator("#engine-status")).toContainText("WASM ready");
  await expect(page.locator("#scenario-note")).toHaveAttribute("data-state", "ready");
  await expect(page.locator("#scenario-note")).toContainText("10 bodies");
  await expect(page.locator("#focus-select")).toBeEnabled();
  await expect(page.locator("#selected-panel")).toContainText("epoch 0s");
  await page.selectOption("#focus-select", "1003");
  await expect(page.locator("#focus-context")).toContainText("1003");
  await page.selectOption("#selected-select", "1001");
  await page.click("#sample-path");
  await expect(page.locator("#path-status")).toHaveAttribute("data-state", "ready");
  await expect(page.locator("#path-status")).toContainText("Sampled 96 public states");
  await page.selectOption("#warp-select", "86400");
  await page.click("#play-pause");
  await page.waitForTimeout(120);
  await page.click("#play-pause");
  await expect(page.locator("#simulation-instant")).not.toHaveText("0s + 0ns");
  await expect(page.locator("#rendering-status")).toHaveAttribute("data-state", /^(ready|unsupported)$/);
});
