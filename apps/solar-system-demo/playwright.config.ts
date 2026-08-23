import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: /\.smoke\.spec\.ts$/,
  timeout: 180_000,
  expect: {
    timeout: 90_000,
  },
  use: {
    baseURL: "http://127.0.0.1:4174",
    browserName: "chromium",
  },
  webServer: {
    command: "vite preview --host 127.0.0.1 --port 4174",
    url: "http://127.0.0.1:4174",
    reuseExistingServer: !process.env.CI,
  },
});
