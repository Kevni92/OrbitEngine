import { test, expect } from "@playwright/test";

test("initializes the real public OrbitEngine WASM backend and evaluates OEP", async ({ page }) => {
  await page.goto("/");
  const status = page.locator("#status");
  await expect(status).toHaveAttribute("data-orbit-engine-smoke", "ready");
  await expect(status).toHaveText(/^ready:\d+:\d+:42:oep:100:2:numerical:11$/);
});
