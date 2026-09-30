import { afterEach, describe, expect, it, vi } from "vitest";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";

afterEach(() => vi.unstubAllEnvs());

describe("search engines", () => {
  it("are asked to stay out of anything but production", () => {
    vi.stubEnv("PRODUCT_ENVIRONMENT", "development");
    vi.stubEnv("APP_ORIGIN", "https://aura-dev.aurel-events.workers.dev");
    expect(robots()).toEqual({ rules: { userAgent: "*", disallow: "/" } });
    expect(sitemap()).toEqual([]);
  });

  it("see only the landing page in production", () => {
    vi.stubEnv("PRODUCT_ENVIRONMENT", "production");
    vi.stubEnv("APP_ORIGIN", "https://aura.example");
    const rules = robots();
    expect(rules.rules).toEqual({ userAgent: "*", allow: "/", disallow: ["/app", "/api/", "/pay/", "/unavailable"] });
    expect(rules.sitemap).toBe("https://aura.example/sitemap.xml");
    expect(sitemap().map((entry) => entry.url)).toEqual(["https://aura.example/"]);
  });

  it("get no sitemap until production has its origin", () => {
    vi.stubEnv("PRODUCT_ENVIRONMENT", "production");
    vi.stubEnv("APP_ORIGIN", "");
    expect(robots().sitemap).toBeUndefined();
    expect(sitemap()).toEqual([]);
  });
});
