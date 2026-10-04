import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ buckets: [] as string[], ip: "203.0.113.9" as string | null, limited: false }));
vi.mock("cloudflare:workers", () => ({ env: { PROJECTION_DB: { prepare(sql: string) { return { bind() { return { async first() {
  if (sql.includes("feature_flags")) return { enabled: 1 };
  return sql.includes("FROM aura_tags")
    ? { tag: "alice", subject_reference: "owner", receiving_address: "0x000000000000000000000000000000000000dEaD", display_name: "Alice", public_bank_enabled: 0 }
    : null;
} }; } }; } } } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(state.ip ? { "cf-connecting-ip": state.ip } : {}) }));
vi.mock("@/lib/security/rate-limit", async () => {
  const { RateLimitError } = await import("@/lib/http/errors");
  return { enforceRateLimit: async (_db: unknown, input: { subject: string }) => { state.buckets.push(input.subject); if (state.limited) throw new RateLimitError(30); } };
});
vi.mock("@/lib/auth/wallet", () => ({ requireLinkedEvmWallet: async () => "0x000000000000000000000000000000000000dEaD" }));

const { default: AuraTagPage } = await import("@/app/pay/[tag]/page");
const { GET } = await import("@/app/api/aura-tags/[tag]/route");
const { renderToStaticMarkup } = await import("react-dom/server");

afterEach(() => { state.buckets = []; state.ip = "203.0.113.9"; state.limited = false; });

describe("public payment page rate limit (security review B4)", () => {
  it("counts each visitor of the page on their own, like the API", async () => {
    await AuraTagPage({ params: Promise.resolve({ tag: "alice" }) });
    await GET(new Request("https://aura.test/api/aura-tags/alice", { headers: { "cf-connecting-ip": "198.51.100.7" } }), { params: Promise.resolve({ tag: "alice" }) });
    expect(state.buckets).toEqual(["203.0.113.9", "198.51.100.7"]);
  });

  it("tells a visitor over the limit to try again, rather than calling the tag unavailable", async () => {
    state.limited = true;
    const html = renderToStaticMarkup(await AuraTagPage({ params: Promise.resolve({ tag: "alice" }) }));
    expect(html).toContain("Too many requests");
    expect(html).toContain("Try again in a minute.");
    expect(html).not.toContain("Payment page unavailable");
    // Nothing about the tag itself shows.
    expect(html).not.toContain("Alice");
    expect(html).not.toContain("0x000000000000000000000000000000000000dEaD");
  });
});

describe("public payment page copy", () => {
  it("names what shows in Aura on Base, with a stock by its symbol, and says payments can't be undone", async () => {
    const html = renderToStaticMarkup(await AuraTagPage({ params: Promise.resolve({ tag: "alice" }) }));
    expect(html).toContain("Pay @alice");
    expect(html).toMatch(/Send ETH, USDC, .*, or a stock like AAPLc, on Base\. Anything else, or anything sent on another network, won(&#x27;|')t show/);
    expect(html).not.toContain("tokenized");
    expect(html).toMatch(/Crypto payments can(&#x27;|')t be undone/);
  });
});
