import { test, expect } from "@playwright/test";

test("demo initializes the public WASM engine and reports rendering capability", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#engine-status")).toHaveAttribute("data-state", "ready");
  await expect(page.locator("#engine-status")).toContainText("WASM ready");
  await expect(page.locator("#rendering-status")).toHaveAttribute("data-state", /^(ready|unsupported)$/);
});
