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
  // GitHub's runners take longer than 5 s to hydrate a dev-mode page in a fresh browser context, so a guest page can
  // still be on its server-rendered "Loading" when the first check runs.
  expect: { timeout: process.env.CI ? 15_000 : 5_000 },
  reporter: [["list"], ["html", { outputFolder: "../../output/playwright-report", open: "never" }]],
  // Cloudflare's local runtime places requests where the machine is (GitHub's runners are in the US), and some
  // features follow a provider's list of places (lib/legal/places.ts). Tests run from a place every provider serves (Switzerland; Aura refuses new Predictions buys from the UAE);
  // a test that checks a refusal sends its own CF-IPCountry.
  use: { baseURL: serverURL, trace: "retain-on-failure", screenshot: "only-on-failure", extraHTTPHeaders: { "CF-IPCountry": "CH" } },
  webServer: {
    // The app, a fresh local database, and a fake of Privy, the chains, and prices (tests/e2e/support).
    command: "node tests/e2e/support/serve.mjs",
    url: serverURL,
    env: { ...process.env, AUREL_E2E_PORT: e2ePort },
    reuseExistingServer: process.env.AUREL_E2E_USE_EXISTING === "1",
    timeout: 120_000
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } }
  ]
});
