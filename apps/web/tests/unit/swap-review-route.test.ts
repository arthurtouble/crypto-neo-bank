import { beforeEach, describe, expect, it, vi } from "vitest";
const httpErrors = await vi.hoisted(() => import("@/lib/http/errors"));

const wallet = "0x1111111111111111111111111111111111111111";
const source = "8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const target = "8453:native";
const crossTarget = "42161:0xaf88d065e77c8cc2239327c5edb3a432268e5831";
const fixture = vi.hoisted(() => ({
  swapsEnabled: true, walletOwned: true, planAvailable: true, unverified: false, stepUp: false, locked: false, bindSucceeds: true,
  crossChain: false, integrityReject: false, integrityCalls: 0,
  recipient: "0x1111111111111111111111111111111111111111",
  callTo: "0x3333333333333333333333333333333333333333",
  valuationCalls: 0, balanceCalls: 0, bindCalls: 0, intentStatus: null as null | string, statements: [] as string[]
}));

vi.mock("cloudflare:workers", () => ({ env: { PROJECTION_DB: {
  prepare(sql: string) { fixture.statements.push(sql); return { bind() { return {
    async first() {
      if (sql.includes("security_profiles")) return { account_locked: fixture.locked ? 1 : 0, enforce_address_book: 0, daily_limit_usd: 25_000, new_address_threshold_usd: 1_000, step_up_threshold_usd: 10_000, new_address_delay_seconds: 86_400 };
      if (sql.includes("spent_cents")) return { spent_cents: 0, missing: 0 };
      return null;
    }, async run() {
      if (sql.includes("INSERT INTO transaction_intents")) fixture.intentStatus = "reviewed";
      if (sql.includes("UPDATE transaction_intents SET status = 'blocked'")) fixture.intentStatus = "blocked";
      return { meta: { changes: 1 } };
    }, async all() { return { results: [] }; }
  }; } }; },
  async batch(statements: Array<{ run(): Promise<unknown> }>) {
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }
} } }));
vi.mock("@/lib/auth/server", () => ({
  AuthenticationError: httpErrors.AuthenticationError,
  requireVerifiedSubject: async () => ({ subjectReference: "did:privy:owner", sessionReference: "s1" })
}));
vi.mock("@/lib/auth/wallet", () => ({
  WalletOwnershipError: httpErrors.WalletOwnershipError,
  requireLinkedEvmWallet: async (_subject: string, address: string) => {
    if (!fixture.walletOwned) throw new Error("unlinked");
    return address.toLowerCase();
  }
}));
vi.mock("@/lib/features/flags", () => {
  const FeatureUnavailableError = httpErrors.FeatureUnavailableError;
  return { FeatureUnavailableError, requireFeature: async (_db: unknown, feature: string) => {
    if (feature === "swaps" && !fixture.swapsEnabled) throw new FeatureUnavailableError("swaps disabled");
  } };
});
vi.mock("@/lib/security/rate-limit", () => ({
  RateLimitError: httpErrors.RateLimitError, enforceRateLimit: async () => undefined
}));
vi.mock("@/lib/profile/ensure", () => ({ ensureSubjectProfile: async () => undefined }));
vi.mock("@/lib/swap/plans", () => ({
  getActiveSwapQuotePlan: async () => fixture.planAvailable ? {
    plan_id: "00000000-0000-4000-8000-000000000001", source_asset_id: source,
    destination_asset_id: fixture.crossChain ? crossTarget : target,
    source_chain_id: 8453, destination_chain_id: fixture.crossChain ? 42161 : 8453,
    from_amount_raw: "1000000", recipient: fixture.recipient,
    wallet_address: wallet, to_amount_min_raw: "100000000000000", expires_at: new Date(Date.now() + 40_000).toISOString(),
    source_call_json: JSON.stringify({ chainId: 8453, from: wallet, to: fixture.callTo, value: "0", data: "0x1234" }),
    route_steps_json: "[]", economics_json: "{}", fingerprint: `0x${"a".repeat(64)}`, intent_id: null
  } : null,
  bindSwapQuotePlan: async () => { fixture.bindCalls++; return fixture.bindSucceeds; }
}));
vi.mock("@/lib/swap/catalog", () => ({
  resolveCatalogAsset: async (id: string) => ({ id, chainId: id === crossTarget ? 42161 : 8453,
    address: id === target ? null : id.split(":")[1],
    decimals: id === target ? 18 : 6,
    verification: fixture.unverified ? "unverified" : "verified", eligibility: "eligible" })
}));
vi.mock("@/lib/swap/prepare-integrity", () => ({ assertSwapPrepareIntegrity: async () => {
  fixture.integrityCalls++;
  if (fixture.integrityReject) throw new Error("route not reviewed");
  return { reviewedSpender: fixture.callTo };
} }));
vi.mock("@/lib/transactions/valuation", () => ({
  ValuationError: class ValuationError extends Error {},
  valueSwapSource: async () => { fixture.valuationCalls++; return { assetId: source, rawUnits: "1000000", decimals: 6,
    priceUsd: "1", marketPriceUsd: "1", priceSource: "kraken", priceObservedAt: new Date().toISOString(),
    valuedAt: new Date().toISOString(), usdCents: "100", policyVersion: 1, depegUncertainty: false }; }
}));
vi.mock("@/lib/swap/source-balance", () => ({ observeSwapSourceBalance: async () => { fixture.balanceCalls++; return { balanceRaw: "2000000" }; } }));
vi.mock("@/lib/transactions/policy", () => ({
  evaluateTransactionPolicy: () => ({ permitted: true, requiresStepUp: fixture.stepUp, requiresWalletConfirmation: true, findings: [] })
}));

import { POST } from "@/app/api/swap/review/route";


function post(body: Record<string, unknown>) {
  return POST(new Request("https://aurel.test/api/swap/review", { method: "POST", body: JSON.stringify(body) }));
}

describe("Swap review boundary", () => {
  beforeEach(() => { Object.assign(fixture, { swapsEnabled: true, walletOwned: true, planAvailable: true, unverified: false,
    stepUp: false, locked: false, bindSucceeds: true, recipient: wallet,
    crossChain: false, integrityReject: false, integrityCalls: 0,
    callTo: "0x3333333333333333333333333333333333333333",
    valuationCalls: 0, balanceCalls: 0, bindCalls: 0, intentStatus: null, statements: [] });
    vi.stubEnv("AUREL_SWAP_ALLOWED_TARGETS", "0x3333333333333333333333333333333333333333");
  });

  it("accepts only an opaque plan and owned wallet, never a browser-authored transaction", async () => {
    const response = await post({ planId: "00000000-0000-4000-8000-000000000001", walletAddress: wallet,
      call: { to: "0x9999999999999999999999999999999999999999" } });
    expect(response.status).toBe(400);
    expect(fixture.bindCalls).toBe(0);
  });

  it("rejects an unavailable plan before valuation, balance, or persistence", async () => {
    fixture.planAvailable = false;
    const response = await post({ planId: "00000000-0000-4000-8000-000000000001", walletAddress: wallet });
    expect(response.status).toBe(409);
    expect(fixture.valuationCalls).toBe(0);
    expect(fixture.bindCalls).toBe(0);
  });

  it("does not create an intent from a preview quote when swaps are disabled", async () => {
    fixture.swapsEnabled = false;
    const response = await post({ planId: "00000000-0000-4000-8000-000000000001", walletAddress: wallet });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "feature_unavailable" });
    expect(fixture.intentStatus).toBeNull();
    expect(fixture.bindCalls).toBe(0);
  });

  it("blocks unverified assets whose acknowledgement is absent from immutable plan evidence", async () => {
    fixture.unverified = true;
    const response = await post({ planId: "00000000-0000-4000-8000-000000000001", walletAddress: wallet });
    expect(response.status).toBe(422);
    expect(fixture.bindCalls).toBe(0);
  });

  it("rejects a stored recipient that differs from the owned destination wallet", async () => {
    fixture.recipient = "0x9999999999999999999999999999999999999999";
    const response = await post({ planId: "00000000-0000-4000-8000-000000000001", walletAddress: wallet });
    expect(response.status).toBe(409);
    expect(fixture.valuationCalls).toBe(0);
  });

  it("rejects a stored source call aimed at a target no longer allowed", async () => {
    fixture.callTo = "0x9999999999999999999999999999999999999999";
    const response = await post({ planId: "00000000-0000-4000-8000-000000000001", walletAddress: wallet });
    expect(response.status).toBe(409);
    expect(fixture.intentStatus).toBeNull();
  });

  it("refuses to review a bridge whose retained route fails the governed audit", async () => {
    fixture.crossChain = true;
    fixture.integrityReject = true;
    const response = await post({ planId: "00000000-0000-4000-8000-000000000001", walletAddress: wallet });
    expect(response.status).toBe(409);
    expect(fixture.integrityCalls).toBe(1);
    expect(fixture.bindCalls).toBe(0);
  });

  it("refuses to review an unaudited same-network LI.FI route", async () => {
    fixture.integrityReject = true;
    const response = await post({ planId: "00000000-0000-4000-8000-000000000001", walletAddress: wallet });
    expect(response.status).toBe(409);
    expect(fixture.integrityCalls).toBe(1);
    expect(fixture.bindCalls).toBe(0);
    expect(fixture.intentStatus).toBeNull();
  });

  it("rejects an account lock before persisting a review", async () => {
    fixture.locked = true;
    const response = await post({ planId: "00000000-0000-4000-8000-000000000001", walletAddress: wallet });
    expect(response.status).toBe(403);
    expect(fixture.bindCalls).toBe(0);
  });

  it("does not persist a review when a missing server step-up attestation is required", async () => {
    fixture.stepUp = true;
    const response = await post({ planId: "00000000-0000-4000-8000-000000000001", walletAddress: wallet });
    expect(response.status).toBe(403);
    expect(fixture.bindCalls).toBe(0);
  });

  it("persists a reviewed intent and valuation without exposing calldata or signing authority", async () => {
    const response = await post({ planId: "00000000-0000-4000-8000-000000000001", walletAddress: wallet });
    expect(response.status).toBe(201);
    const body = await response.json() as Record<string, unknown>;
    expect(body.intentId).toEqual(expect.any(String));
    expect(JSON.stringify(body)).not.toContain("0x1234");
    expect(fixture.bindCalls).toBe(1);
    expect(fixture.intentStatus).toBe("reviewed");
  });

  it("blocks an orphan review if the one-time quote bind loses a race", async () => {
    fixture.bindSucceeds = false;
    const response = await post({ planId: "00000000-0000-4000-8000-000000000001", walletAddress: wallet });
    expect(response.status).toBe(409);
    expect(fixture.intentStatus).toBe("blocked");
  });
});
