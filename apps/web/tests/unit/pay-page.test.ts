import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ buckets: [] as string[], ip: "203.0.113.9" as string | null }));
vi.mock("cloudflare:workers", () => ({ env: { PROJECTION_DB: { prepare(sql: string) { return { bind() { return { async first() {
  if (sql.includes("feature_flags")) return { enabled: 1 };
  return sql.includes("FROM aura_tags")
    ? { tag: "alice", subject_reference: "owner", receiving_address: "0x000000000000000000000000000000000000dEaD", display_name: "Alice", public_bank_enabled: 0 }
    : null;
} }; } }; } } } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(state.ip ? { "cf-connecting-ip": state.ip } : {}) }));
vi.mock("@/lib/security/rate-limit", () => ({ enforceRateLimit: async (_db: unknown, input: { subject: string }) => { state.buckets.push(input.subject); } }));
vi.mock("@/lib/auth/wallet", () => ({ requireLinkedEvmWallet: async () => "0x000000000000000000000000000000000000dEaD" }));

const { default: AuraTagPage } = await import("@/app/pay/[tag]/page");
const { GET } = await import("@/app/api/aura-tags/[tag]/route");

afterEach(() => { state.buckets = []; state.ip = "203.0.113.9"; });

describe("public payment page rate limit (security review B4)", () => {
  it("counts each visitor of the page on their own, like the API", async () => {
    await AuraTagPage({ params: Promise.resolve({ tag: "alice" }) });
    await GET(new Request("https://aura.test/api/aura-tags/alice", { headers: { "cf-connecting-ip": "198.51.100.7" } }), { params: Promise.resolve({ tag: "alice" }) });
    expect(state.buckets).toEqual(["203.0.113.9", "198.51.100.7"]);
  });
});
