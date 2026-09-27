import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/distribution",
  timeout: 30000,
  workers: 1,
  use: { baseURL: "http://127.0.0.1:3108", headless: true },
  webServer: {
    command: 'node "release/Party Trivia/launcher.mjs"',
    env: {
      TRIVIA_NO_OPEN: "1",
      PORT: "3108",
      PUBLIC_URL: "http://127.0.0.1:3108",
    },
    url: "http://127.0.0.1:3108/health",
    reuseExistingServer: false,
  },
});
