import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAddress } from "viem";

const wallet = "0x1111111111111111111111111111111111111111";
const diamond = "0x2222222222222222222222222222222222222222";
const source = "8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const destination = "42161:0xaf88d065e77c8cc2239327c5edb3a432268e5831";
const intentId = "00000000-0000-4000-8000-000000000002";
const planId = "00000000-0000-4000-8000-000000000001";
const state = vi.hoisted(() => ({ routeValid: true, featureFailure: "", prior: false,
  planIntent: "00000000-0000-4000-8000-000000000002", intentType: "bridge", planTool: "across", destinationChain: 42161,
  amount: "1000000", approvalKind: "approve", writes: [] as Array<{ sql: string; values: unknown[] }> }));

vi.mock("cloudflare:workers", () => ({ env: { PROJECTION_DB: { prepare(sql: string) {
  return { bind(...values: unknown[]) { return {
    async first() {
      if (sql.includes("FROM transaction_intents WHERE intent_id")) return {
        intent_id: intentId, intent_type: state.intentType, wallet_reference: `wallet:${wallet}`,
        status: "reviewed", expires_at: new Date(Date.now() + 45_000).toISOString(),
        route_reference: `swap-plan:${planId}`, policy_result_json: '{"permitted":true}'
      };
      if (sql.includes("FROM swap_approval_requests WHERE plan_id")) return state.prior ? { approval_id: "prior" } : null;
      return null;
    }, async run() { state.writes.push({ sql, values }); return { meta: { changes: 1 } }; }
  }; } }; }
} } }));
vi.mock("@/lib/auth/server", () => ({ AuthenticationError: class AuthenticationError extends Error {},
  requireVerifiedSubject: async () => ({ subjectReference: "subject-a" }) }));
vi.mock("@/lib/auth/wallet", () => ({ WalletOwnershipError: class WalletOwnershipError extends Error {},
  requireLinkedEvmWallet: async () => wallet }));
vi.mock("@/lib/beta/access", () => ({ BetaAccessError: class BetaAccessError extends Error {},
  configuredCountries: () => ["PT"], requireBetaAccess: async () => ({ mode: "invite", status: "active", countryCode: "PT" }) }));
vi.mock("@/lib/features/flags", () => ({ FeatureUnavailableError: class FeatureUnavailableError extends Error {},
  requireFeature: async (_db: unknown, key: string) => { if (state.featureFailure === key) throw new Error("disabled"); } }));
vi.mock("@/lib/security/rate-limit", () => ({ RateLimitError: class RateLimitError extends Error {}, enforceRateLimit: async () => undefined }));
vi.mock("@/lib/swap/plans", () => ({ getActiveSwapQuotePlan: async () => ({
  plan_id: planId, intent_id: state.planIntent, wallet_address: wallet, source_asset_id: source,
  destination_asset_id: destination, source_chain_id: 8453, destination_chain_id: state.destinationChain,
  from_amount_raw: state.amount, recipient: wallet, approval_spender: diamond,
  tool_id: state.planTool, expires_at: new Date(Date.now() + 45_000).toISOString()
}) }));
vi.mock("@/lib/swap/catalog", () => ({ resolveCatalogAsset: async (id: string) => ({ id,
  address: id.split(":")[1], chainId: Number(id.split(":")[0]), verification: "verified", eligibility: "eligible" }) }));
vi.mock("@/lib/swap/prepare-integrity", () => ({ assertSwapPrepareIntegrity: async () => {
  if (!state.routeValid) throw new Error("invalid route");
  return { sourceCall: { chainId: 8453, from: wallet, to: diamond, value: "0", data: "0x1234" },
    reviewedSpender: diamond, expectedSourceEffect: { bridgeAmountRaw: "997500" } };
} }));
vi.mock("@/lib/swap/approval-steps", () => ({ observeNextSwapApproval: async () => state.approvalKind === "sufficient"
  ? { kind: "sufficient" }
  : { kind: state.approvalKind, step: { chainId: 8453, from: wallet, to: source.split(":")[1],
    value: "0", data: "0x095ea7b3" + "0".repeat(24) + diamond.slice(2) + BigInt(state.approvalKind === "reset_required" ? 0 : Number(state.amount)).toString(16).padStart(64, "0"),
    spender: diamond, amountRaw: state.approvalKind === "reset_required" ? "0" : state.amount } } }));
vi.mock("viem", async (importOriginal) => { const actual = await importOriginal<typeof import("viem")>();
  return { ...actual, createPublicClient: () => ({}) }; });

import { POST } from "@/app/api/swap/approval/route";

const post = () => POST(new Request("https://aurel.test/api/swap/approval", { method: "POST",
  body: JSON.stringify({ intentId, planId, walletAddress: wallet }) }));

describe("reviewed Across bridge approval prerequisite", () => {
  beforeEach(() => Object.assign(state, { routeValid: true, featureFailure: "", prior: false,
    planIntent: intentId, intentType: "bridge", planTool: "across", destinationChain: 42161,
    amount: "1000000", approvalKind: "approve", writes: [] }));

  it("prepares only the reviewed exact source-token approval", async () => {
    const response = await post();
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ kind: "approve", amountRaw: "1000000", spender: diamond,
      call: { chainId: 8453, from: wallet, to: getAddress(source.split(":")[1]) } });
    expect(state.writes).toHaveLength(1);
    expect(state.writes[0].values).toContain("1000000");
    expect(state.writes[0].sql).toContain("cross_chain");
  });

  it("allows a zero reset but never a standing approval", async () => {
    state.approvalKind = "reset_required";
    const response = await post();
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ kind: "reset_required", amountRaw: "0" });
    expect(state.writes[0].values).toContain("0");
  });

  it.each(["swaps", "cross_chain"])("requires the %s switch", async (key) => {
    state.featureFailure = key;
    expect((await post()).status).not.toBe(201);
    expect(state.writes).toHaveLength(0);
  });

  it("rejects mismatched, unsupported, or stale route authority", async () => {
    state.planIntent = "other";
    expect((await post()).status).toBe(409);
    state.planIntent = intentId; state.planTool = "unknown";
    expect((await post()).status).toBe(409);
    state.planTool = "across"; state.routeValid = false;
    expect((await post()).status).toBe(422);
    expect(state.writes).toHaveLength(0);
  });
});
