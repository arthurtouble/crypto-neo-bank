import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { environment: "node", include: [process.env.AUREL_LIVE_READONLY === "1"
    ? "tests/live/**/*.test.ts" : "tests/unit/**/*.test.ts"], coverage: { reporter: ["text", "json-summary"] } }
});
