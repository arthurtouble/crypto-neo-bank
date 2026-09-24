import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ bankEnabled: 0 }));
vi.mock("cloudflare:workers", () => ({ env: { PROJECTION_DB: { prepare(sql: string) { return { bind() { return { async first() {
  return sql.includes("FROM aura_tags")
    ? { tag: "alice", subject_reference: "owner", receiving_address: "0x000000000000000000000000000000000000dEaD", display_name: "Alice", public_bank_enabled: state.bankEnabled }
    : { external_customer_id: "customer-1" };
} }; } }; } } } }));
vi.mock("@/lib/auth/wallet", () => ({ requireLinkedEvmWallet: async () => "0x000000000000000000000000000000000000dEaD" }));

import { GET } from "@/app/api/aura-tags/[tag]/route";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); state.bankEnabled = 0; });

describe("public Aura tag bank method", () => {
  it("does not fetch or reveal Bridge data without separate consent", async () => {
    vi.stubEnv("BRIDGE_MODE", "live"); vi.stubEnv("BRIDGE_API_KEY", "test-key");
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const response = await GET(new Request("https://aura.test/pay/alice"), { params: Promise.resolve({ tag: "alice" }) });
    expect((await response.json() as { bank: unknown }).bank).toEqual({ available: false });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("shows complete activated instructions when owner consent and Bridge agree", async () => {
    state.bankEnabled = 1; vi.stubEnv("BRIDGE_MODE", "live"); vi.stubEnv("BRIDGE_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ data: [{ id: "account-1", customer_id: "customer-1", status: "activated", source_deposit_instructions: { currency: "usd", payment_rails: ["ach_push"], bank_name: "Lead Bank", bank_beneficiary_name: "Alice", bank_account_number: "123456789", bank_routing_number: "876543210" } }] })));
    const response = await GET(new Request("https://aura.test/pay/alice"), { params: Promise.resolve({ tag: "alice" }) });
    expect((await response.json() as { bank: unknown }).bank).toMatchObject({ available: true, instructions: { beneficiaryName: "Alice", accountNumber: "123456789" } });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
