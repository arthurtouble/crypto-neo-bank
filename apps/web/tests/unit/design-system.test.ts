import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The design system's contract (DESIGN.md, docs/product/design-system.md): tokens in public/design-tokens.css, screens
// built from them in the area stylesheets, and the two docs agreeing with the tokens.
const web = fileURLToPath(new URL("../../", import.meta.url));
const read = (path: string) => readFileSync(`${web}${path}`, "utf8");
const layout = read("src/app/layout.tsx");
const tokens = read("public/design-tokens.css");
const design = readFileSync(`${web}../../DESIGN.md`, "utf8");
const legacy = ["globals.css", "identity.css", "product-system.css"];
const areas = ["shell.css", "overview.css", "money.css", "cards.css", "records.css", "settings.css", "public.css"];
const position = (file: string) => layout.indexOf(`/${file}"`);

describe("design system", () => {
  it("loads the tokens after the pre-redesign layers, and every area stylesheet after the tokens", () => {
    const tokensAt = position("design-tokens.css");
    expect(tokensAt).toBeGreaterThan(0);
    for (const file of legacy) expect(position(file), file).toBeLessThan(tokensAt);
    for (const file of areas) expect(position(file), file).toBeGreaterThan(tokensAt);
  });

  it("keeps literal colours out of the area stylesheets: they use tokens only", () => {
    for (const file of areas) {
      const css = read(`src/app/${file}`).replace(/\/\*[\s\S]*?\*\//g, "");
      expect(css.match(/#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\(/gi), file).toBeNull();
    }
  });

  it("documents the same type scale in DESIGN.md as the tokens define", () => {
    for (const role of ["headline", "display", "amount-hero", "amount", "title-1", "title-2", "title-3", "body", "small", "caption"]) {
      const documented = design.match(new RegExp(`\\n  ${role}:\\n(?:    .*\\n)*?    fontSize: (\\d+px)\\n(?:    .*\\n)*?    lineHeight: (\\d+px)`));
      const size = tokens.match(new RegExp(`--text-${role}-size: (\\d+px);`));
      const line = tokens.match(new RegExp(`--text-${role}-line: (\\d+px);`));
      expect(documented, `DESIGN.md ${role}`).not.toBeNull();
      expect([documented?.[1], documented?.[2]], role).toEqual([size?.[1], line?.[1]]);
    }
  });
});
