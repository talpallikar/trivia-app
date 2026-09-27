import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/browser",
  timeout: 60000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:3107",
    headless: true,
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node --import tsx scripts/browser-server.ts",
    url: "http://127.0.0.1:3107/health",
    reuseExistingServer: false,
  },
});
