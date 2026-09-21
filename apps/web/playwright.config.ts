import { defineConfig, devices } from "@playwright/test";

const baseURL = "http://[::1]:4173";

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "../../output/playwright-tests",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { outputFolder: "../../output/playwright-report", open: "never" }]],
  use: { baseURL, trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: {
    command: "pnpm dev --host ::1 --port 4173",
    url: baseURL,
    env: { ...process.env, PROVIDER_WEBHOOK_SECRET: "e2e-local-only-secret" },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } }
  ]
});
