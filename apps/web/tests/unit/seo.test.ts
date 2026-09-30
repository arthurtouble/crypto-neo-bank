import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as llms } from "@/app/llms.txt/route";
import manifest from "@/app/manifest";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { jsonLd, landingStructuredData, themeColors } from "@/lib/site/seo";

afterEach(() => vi.unstubAllEnvs());

const web = fileURLToPath(new URL("../../", import.meta.url));

describe("search engines", () => {
  it("are asked to stay out of anything but production", () => {
    vi.stubEnv("PRODUCT_ENVIRONMENT", "development");
    vi.stubEnv("APP_ORIGIN", "https://aura-dev.aurel-events.workers.dev");
    expect(robots()).toEqual({ rules: { userAgent: "*", disallow: "/" } });
    expect(sitemap()).toEqual([]);
  });

  it("see only the landing page in production, and may crawl the app to read its noindex", () => {
    vi.stubEnv("PRODUCT_ENVIRONMENT", "production");
    vi.stubEnv("APP_ORIGIN", "https://aura.example");
    const rules = robots();
    expect(rules.rules).toEqual({ userAgent: "*", allow: "/", disallow: ["/api/", "/pay/", "/unavailable"] });
    expect(rules.sitemap).toBe("https://aura.example/sitemap.xml");
    expect(sitemap().map((entry) => entry.url)).toEqual(["https://aura.example/"]);
    const appLayout = readFileSync(`${web}src/app/app/layout.tsx`, "utf8");
    expect(appLayout).toMatch(/robots: \{ index: false, follow: false \}/);
  });

  it("get no sitemap until production has its origin", () => {
    vi.stubEnv("PRODUCT_ENVIRONMENT", "production");
    vi.stubEnv("APP_ORIGIN", "");
    expect(robots().sitemap).toBeUndefined();
    expect(sitemap()).toEqual([]);
  });
});

describe("structured data", () => {
  it("describes the organisation, site, app, and the landing page's own questions, as valid JSON", async () => {
    vi.stubEnv("APP_ORIGIN", "https://aura.example");
    const { default: Landing } = await import("@/app/page");
    const html = renderToStaticMarkup(Landing());
    const script = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    expect(script).not.toBeNull();
    const data = JSON.parse(script![1]);
    const types = data["@graph"].map((node: { "@type": string }) => node["@type"]);
    expect(types).toEqual(["Organization", "WebSite", "WebApplication", "FAQPage"]);
    const app = data["@graph"][2];
    expect(app).toMatchObject({ applicationCategory: "FinanceApplication", url: "https://aura.example/app" });
    expect(app).not.toHaveProperty("aggregateRating");
    expect(app).not.toHaveProperty("offers");
    // Every question on the page, and only those.
    const questions = data["@graph"][3].mainEntity.map((item: { name: string }) => item.name);
    const onPage = [...html.slice(html.indexOf('id="faq"')).matchAll(/<summary>([^<]+)/g)].map((match) => match[1].replace(/&#x27;|&#39;/g, "'"));
    expect(questions).toEqual(onPage);
    expect(questions.length).toBeGreaterThan(0);
  });

  it("can't close its script element", () => {
    const text = jsonLd(landingStructuredData([{ question: "</script><script>alert(1)</script>", answer: "a" }], "https://aura.example"));
    expect(text).not.toContain("<");
    expect(JSON.parse(text)["@graph"][3].mainEntity[0].name).toBe("</script><script>alert(1)</script>");
  });
});

describe("installing and theme colour", () => {
  it("uses the design tokens' canvas colours", () => {
    const tokens = readFileSync(`${web}public/design-tokens.css`, "utf8");
    expect(tokens.match(/:root \{[^}]*--color-canvas: (#[0-9a-f]+);/)?.[1]).toBe(themeColors.light);
    expect(tokens.match(/:root\[data-theme="dark"\] \{[^}]*--color-canvas: (#[0-9a-f]+);/)?.[1]).toBe(themeColors.dark);
  });

  it("has a manifest that opens the app on its own, with PNG and maskable icons that exist", () => {
    const app = manifest();
    expect(app).toMatchObject({ name: "Aura", start_url: "/app", display: "standalone", theme_color: themeColors.light });
    for (const icon of app.icons ?? []) {
      const file = icon.src === "/icon.svg" ? "src/app/icon.svg" : `public${icon.src}`;
      expect(() => readFileSync(`${web}${file}`), icon.src).not.toThrow();
    }
    expect(app.icons?.some((icon) => icon.purpose === "maskable")).toBe(true);
    expect(readFileSync(`${web}src/app/apple-icon.png`).readUInt32BE(16)).toBe(180);
  });
});

describe("llms.txt", () => {
  it("summarises Aura and links to the docs site's key pages", async () => {
    vi.stubEnv("NEXT_PUBLIC_DOCS_URL", "https://docs.aura.example");
    vi.stubEnv("APP_ORIGIN", "https://aura.example");
    const response = llms(new Request("https://aura.example/llms.txt"));
    expect(response.headers.get("content-type")).toContain("text/plain");
    const text = await response.text();
    expect(text.startsWith("# Aura\n\n> ")).toBe(true);
    for (const path of ["/getting-started/status/", "/getting-started/setup/", "/safety/security-model/", "/company/fees-and-alignment/", "/product/networks-and-assets/", "/legal/", "/llms-full.txt"]) {
      expect(text).toContain(`(https://docs.aura.example${path})`);
    }
    expect(text).toContain("(https://aura.example/app)");
  });
});
