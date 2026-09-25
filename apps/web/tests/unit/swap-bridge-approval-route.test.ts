import { beforeEach, describe, expect, it, vi } from "vitest";
const httpErrors = await vi.hoisted(() => import("@/lib/http/errors"));
import { getAddress } from "viem";
import { normalizePreparedCall } from "@/lib/transactions/evidence";

const wallet = "0x1111111111111111111111111111111111111111";
const diamond = "0x2222222222222222222222222222222222222222";
const source = "8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const destination = "42161:0xaf88d065e77c8cc2239327c5edb3a432268e5831";
const intentId = "00000000-0000-4000-8000-000000000002";
const planId = "00000000-0000-4000-8000-000000000001";
const state = vi.hoisted(() => ({ routeValid: true, featureFailure: "", prior: false, recheckAllowed: true, finalReads: 0,
  approval: null as null | Record<string, unknown>,
  dailyLimitUsd: 1000, spentCents: 0,
  planIntent: "00000000-0000-4000-8000-000000000002", intentType: "bridge", planTool: "across", destinationChain: 42161,
  amount: "1000000", approvalKind: "approve", writes: [] as Array<{ sql: string; values: unknown[] }> }));

vi.mock("cloudflare:workers", () => ({ env: { PROJECTION_DB: { prepare(sql: string) {
  return { bind(...values: unknown[]) { return {
    async first() {
      if (sql.includes("FROM swap_approval_requests a") && sql.includes("JOIN security_profiles")) {
        state.finalReads++;
        return state.recheckAllowed ? { approval_id: state.approval?.approval_id } : null;
      }
      if (/FROM swap_approval_requests\s+WHERE approval_id/.test(sql)) return state.approval;
      if (sql.includes("FROM security_profiles WHERE subject_reference")) return {
        account_locked: 0, enforce_address_book: 0, daily_limit_usd: state.dailyLimitUsd,
        new_address_threshold_usd: 100000, step_up_threshold_usd: 100000,
        new_address_delay_seconds: 0, policy_version: 1 };
      if (sql.includes("FROM intent_valuations WHERE intent_id")) return {
        usd_cents: 100, asset_id: source, raw_units: state.amount, policy_version: 1 };
      if (sql.includes("AS spent_cents")) return { spent_cents: state.spentCents, missing: 0 };
      if (sql.includes("FROM transaction_intents WHERE intent_id")) return {
        intent_id: intentId, intent_type: state.intentType, wallet_reference: `wallet:${wallet}`,
        status: "reviewed", expires_at: new Date(Date.now() + 45_000).toISOString(),
        route_reference: `swap-plan:${planId}`, policy_result_json: '{"permitted":true}',
        request_json: JSON.stringify({ type: "bridge", walletAddress: wallet, chainId: 8453,
          asset: source, amount: "1", amountRaw: state.amount, destination: wallet,
          destinationChainId: 42161, destinationAssetId: destination,
          toAmountMinRaw: "1", planId })
      };
      if (sql.includes("FROM swap_approval_requests WHERE plan_id")) return state.prior ? { approval_id: "prior" } : null;
      return null;
    }, async run() { state.writes.push({ sql, values }); return { meta: { changes: 1 } }; }
  }; } }; }
} } }));
vi.mock("@/lib/auth/server", () => ({ AuthenticationError: httpErrors.AuthenticationError,
  requireVerifiedSubject: async () => ({ subjectReference: "subject-a" }) }));
vi.mock("@/lib/auth/wallet", () => ({ WalletOwnershipError: httpErrors.WalletOwnershipError,
  requireLinkedEvmWallet: async () => wallet }));
vi.mock("@/lib/features/flags", () => ({ FeatureUnavailableError: httpErrors.FeatureUnavailableError,
  requireFeature: async (_db: unknown, key: string) => { if (state.featureFailure === key) throw new Error("disabled"); } }));
vi.mock("@/lib/security/rate-limit", () => ({ RateLimitError: httpErrors.RateLimitError, enforceRateLimit: async () => undefined }));
vi.mock("@/lib/swap/plans", () => ({ getActiveSwapQuotePlan: async () => ({
  plan_id: planId, intent_id: state.planIntent, wallet_address: wallet, source_asset_id: source,
  destination_asset_id: destination, source_chain_id: 8453, destination_chain_id: state.destinationChain,
  from_amount_raw: state.amount, to_amount_min_raw: "1", recipient: wallet, approval_spender: diamond,
  tool_id: state.planTool, expires_at: new Date(Date.now() + 45_000).toISOString()
}) }));
vi.mock("@/lib/swap/catalog", () => ({ resolveCatalogAsset: async (id: string) => ({ id,
  address: id.split(":")[1], chainId: Number(id.split(":")[0]), decimals: 6,
  verification: "verified", eligibility: "eligible" }) }));
vi.mock("@/lib/transactions/valuation", () => ({ valueSwapSource: async () => ({
  usdCents: 100n, decimals: 6, rawUnits: state.amount }) }));
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
const recheck = () => POST(new Request("https://aurel.test/api/swap/approval", { method: "POST",
  body: JSON.stringify({ approvalId: "00000000-0000-4000-8000-000000000003", walletAddress: wallet, recheck: true }) }));

describe("reviewed Across bridge approval prerequisite", () => {
  beforeEach(() => Object.assign(state, { routeValid: true, featureFailure: "", prior: false, recheckAllowed: true, finalReads: 0, approval: null,
    dailyLimitUsd: 1000, spentCents: 0,
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

  it("rechecks the same prepared approval without writing or renewing it", async () => {
    const first = await post();
    const body = await first.json() as { call: { chainId: number; from: string; to: string; value: string; data: string }; fingerprint: string; expiresAt: string };
    state.writes = [];
    state.approval = { approval_id: "00000000-0000-4000-8000-000000000003", plan_id: planId,
      intent_id: intentId, subject_reference: "subject-a", wallet_address: wallet,
      token_address: body.call.to.toLowerCase(), spender_address: diamond,
      amount_raw: "1000000", call_json: JSON.stringify(body.call), call_fingerprint: body.fingerprint,
      status: "prepared", transaction_hash: null, expires_at: body.expiresAt };
    const checked = await recheck();
    const checkedBody = await checked.json() as Record<string, unknown>;
    expect(checked.status, JSON.stringify({ ...checkedBody, finalReads: state.finalReads })).toBe(200);
    expect(checkedBody).toMatchObject({ approvalId: state.approval.approval_id,
      fingerprint: body.fingerprint, expiresAt: body.expiresAt, call: body.call });
    expect(state.writes).toHaveLength(0);
    state.recheckAllowed = false;
    expect((await recheck()).status).toBe(409);
    state.recheckAllowed = true;
    state.approval.status = "submitted";
    expect((await recheck()).status).toBe(409);
    state.approval.status = "prepared";
    state.approval.call_fingerprint = (await normalizePreparedCall({ ...body.call, data: "0x1234" })).fingerprint;
    expect((await recheck()).status).toBe(409);
  });

  it("denies approval signing if the current spending policy tightens", async () => {
    const first = await post();
    const body = await first.json() as { call: { to: string }; fingerprint: string; expiresAt: string };
    state.approval = { approval_id: "00000000-0000-4000-8000-000000000003", plan_id: planId,
      intent_id: intentId, subject_reference: "subject-a", wallet_address: wallet,
      token_address: body.call.to.toLowerCase(), spender_address: diamond,
      amount_raw: "1000000", call_json: JSON.stringify(body.call), call_fingerprint: body.fingerprint,
      status: "prepared", transaction_hash: null, expires_at: body.expiresAt };
    state.dailyLimitUsd = 0;
    expect((await recheck()).status).toBe(403);
  });
});
