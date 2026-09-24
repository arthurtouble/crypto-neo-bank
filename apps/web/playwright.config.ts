import { defineConfig, devices } from "@playwright/test";

// Keep the test server isolated from other local preview processes. Reusing an
// unrelated server can make the browser pass or fail against the wrong build.
const e2ePort = process.env.AUREL_E2E_PORT ?? "43173";
const serverURL = `http://localhost:${e2ePort}`;

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "../../output/playwright-tests",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { outputFolder: "../../output/playwright-report", open: "never" }]],
  use: { baseURL: serverURL, trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: {
    command: `pnpm dev --host 127.0.0.1 --port ${e2ePort}`,
    url: serverURL,
    env: { ...process.env, PROVIDER_WEBHOOK_SECRET: "e2e-local-only-secret" },
    reuseExistingServer: process.env.AUREL_E2E_USE_EXISTING === "1",
    timeout: 120_000
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } }
  ]
});
