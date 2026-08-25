import { expect, test } from "@playwright/test";

test("renders and validates the public companion behavior matrix in WebGL", async ({ page }) => {
  await page.goto("/");
  const status = page.locator("#status");
  await expect(status).toHaveAttribute("data-orbit-engine-three-smoke", "ready");
  await expect(status).toHaveAttribute("data-webgl", "true");
  await expect(status).toHaveAttribute("data-rendered", "true");
  await expect(status).toHaveAttribute("data-orbits", "2");
  await expect(status).toHaveAttribute("data-markers", "2001");
  await expect(status).toHaveAttribute("data-marker-drawables", "1");
  await expect(status).toHaveAttribute("data-picked-body", "2");
  await expect(status).toHaveAttribute("data-stable-resources", "true");
  await expect(status).toHaveAttribute("data-caller-texture-preserved", "true");
  await expect(status).toHaveText(/^ready:orbit-engine-three:orbit-engine-three\/presentation:resources:2004:1$/);
  await expect(page.locator("#scene")).toHaveAttribute("width", "640");
  await expect(page.locator("#scene")).toHaveAttribute("height", "480");
});
