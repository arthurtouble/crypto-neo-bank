import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { customerSections } from "@/lib/product-map";

// Each section has its own route that imports only its own screen, so opening one section doesn't load every other
// section's code. The app layout must not import a screen for every section either.
const app = fileURLToPath(new URL("../../src/app/app/", import.meta.url));

describe("section routes", () => {
  it("gives every section its own page that imports one component", () => {
    for (const section of customerSections) {
      const file = `${app}${section}/page.tsx`;
      expect(existsSync(file), section).toBe(true);
      const source = readFileSync(file, "utf8");
      // A section folded into another (Insights, into Transactions) only redirects there, and imports no screen.
      if (/^import \{ redirect \} from "next\/navigation";$/m.test(source)) {
        expect(source, section).not.toMatch(/@\/components\//);
        continue;
      }
      expect(source.match(/from "@\/components\//g), section).toHaveLength(1);
    }
  });

  it("keeps the app layout free of section screens", () => {
    const layout = readFileSync(`${app}layout.tsx`, "utf8");
    expect(layout).not.toMatch(/section-page|product-access-gate|-workspace|-page"/);
  });
});
