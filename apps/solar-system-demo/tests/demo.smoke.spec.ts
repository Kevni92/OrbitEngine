import { test, expect } from "@playwright/test";

test("demo initializes the public WASM engine and reports rendering capability", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#engine-status")).toHaveAttribute("data-state", "ready");
  await expect(page.locator("#engine-status")).toContainText("WASM ready");
  await expect(page.locator("#scenario-note")).toHaveAttribute("data-state", "ready");
  await expect(page.locator("#scenario-note")).toContainText("10 bodies");
  await expect(page.locator("#focus-select")).toBeEnabled();
  await expect(page.locator("#selected-panel")).toContainText("epoch 0s");
  await expect(page.locator("#rendering-status")).toHaveAttribute("data-state", /^(ready|unsupported)$/);
});
