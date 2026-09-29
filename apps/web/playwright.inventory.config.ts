import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// Phase 1 of docs/overview/redesign.md: screenshots of every screen and state,
// against the same fake as the end-to-end tests. See tests/inventory.
export default defineConfig({
  ...base,
  testDir: "./tests/inventory",
  outputDir: "../../output/inventory-results",
  retries: 0,
  reporter: [["list"]],
  use: { ...base.use, screenshot: "off", trace: "off", actionTimeout: 15_000 }
});
