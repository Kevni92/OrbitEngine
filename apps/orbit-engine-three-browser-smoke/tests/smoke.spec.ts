import { expect, test } from "@playwright/test";

test("imports both public companion entry points in a browser consumer", async ({ page }) => {
  await page.goto("/");
  const status = page.locator("#status");
  await expect(status).toHaveAttribute("data-orbit-engine-three-smoke", "ready");
  await expect(status).toHaveText(/^ready:orbit-engine-three:orbit-engine-three\/presentation:three:3\.7416573867739413$/);
});
