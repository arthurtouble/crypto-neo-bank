import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const wallet = "0x1111111111111111111111111111111111111111";
const intentId = "00000000-0000-4000-8000-000000000002";
const planId = "00000000-0000-4000-8000-000000000001";
const source = "8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const destination = "8453:0x4200000000000000000000000000000000000006";
const bridgeDestination = "42161:0xaf88d065e77c8cc2239327c5edb3a432268e5831";
const fixture = vi.hoisted(() => ({
  planIntent: "00000000-0000-4000-8000-000000000002", intentStatus: "reviewed", intentType: "swap", locked: false,
  allowance: "sufficient", routeValid: true, simulationValid: true, changes: 1,
  expiryAt: "", advanceAfterSimulation: false, simulationAdvanceMs: 60_000, priceAgeMs: 0, bridge: false,
  countries: ["US"] as string[], inserted: [] as string[], insertValues: [] as unknown[][], simulationCalls: 0
}));

vi.mock("cloudflare:workers", () => ({ env: { PROJECTION_DB: {
  prepare(sql: string) { return { bind(...values: unknown[]) { return {
    async first() {
      if (sql.includes("FROM transaction_intents") && sql.includes("WHERE intent_id =")) return {
        intent_id: intentId, intent_type: fixture.intentType, chain_id: 8453,
        wallet_reference: `wallet:${wallet}`, route_reference: `swap-plan:${planId}`,
        request_json: JSON.stringify({ type: fixture.bridge ? "bridge" : "swap", walletAddress: wallet, chainId: 8453,
          asset: source, amount: "1", amountRaw: "1000000", destination: wallet,
          destinationChainId: fixture.bridge ? 42161 : 8453,
          destinationAssetId: fixture.bridge ? bridgeDestination : destination, toAmountMinRaw: "900000", planId }),
        policy_result_json: JSON.stringify({ permitted: true }), status: fixture.intentStatus,
        expires_at: fixture.expiryAt
      };
      if (sql.includes("security_profiles")) return { account_locked: fixture.locked ? 1 : 0,
        enforce_address_book: 0, daily_limit_usd: 25_000, new_address_threshold_usd: 1_000,
        step_up_threshold_usd: 10_000, new_address_delay_seconds: 86_400, policy_version: 1 };
      if (sql.includes("spent_cents")) return { spent_cents: 0, missing: 0 };
      return null;
    }, async run() { if (sql.includes("INSERT INTO intent_prepared_calls")) {
      fixture.inserted.push(sql); fixture.insertValues.push(values);
    }
      return { meta: { changes: sql.includes("INSERT INTO intent_prepared_calls") ? fixture.changes : 1 } }; }
  }; } }; },
  async batch(statements: Array<{ run(): Promise<unknown> }>) { return Promise.all(statements.map((statement) => statement.run())); }
} } }));
vi.mock("@/lib/auth/server", () => ({ AuthenticationError: class AuthenticationError extends Error {},
  requireVerifiedSubject: async () => ({ subjectReference: "did:privy:owner" }) }));
vi.mock("@/lib/auth/wallet", () => ({ WalletOwnershipError: class WalletOwnershipError extends Error {},
  requireLinkedEvmWallet: async () => wallet }));
vi.mock("@/lib/beta/access", () => ({ BetaAccessError: class BetaAccessError extends Error {},
  configuredCountries: () => fixture.countries,
  requireBetaAccess: async () => ({ mode: "invite", status: "active", countryCode: "US", transactionLimitUsd: 25_000 }) }));
vi.mock("@/lib/features/flags", () => ({ FeatureUnavailableError: class FeatureUnavailableError extends Error {}, requireFeature: async () => undefined }));
vi.mock("@/lib/security/rate-limit", () => ({ RateLimitError: class RateLimitError extends Error {}, enforceRateLimit: async () => undefined }));
vi.mock("@/lib/swap/plans", () => ({ getActiveSwapQuotePlan: async () => ({
  plan_id: planId, intent_id: fixture.planIntent, subject_reference: "did:privy:owner", wallet_address: wallet,
  source_asset_id: source, destination_asset_id: fixture.bridge ? bridgeDestination : destination,
  source_chain_id: 8453, destination_chain_id: fixture.bridge ? 42161 : 8453,
  from_amount_raw: "1000000", to_amount_min_raw: "900000", recipient: wallet,
  source_call_json: JSON.stringify({ chainId: 8453, from: wallet, to: "0x2222222222222222222222222222222222222222", value: "0", data: "0x1234" }),
  expires_at: fixture.expiryAt, status: "active", approval_spender: "0x2222222222222222222222222222222222222222",
  fingerprint: "plan-fingerprint", route_policy_version: "v1"
}) }));
vi.mock("@/lib/swap/catalog", () => ({ resolveCatalogAsset: async (id: string) => ({ id, chainId: id.startsWith("42161:") ? 42161 : 8453,
  address: id.split(":")[1], symbol: id === source ? "USDC" : "WETH", name: id === source ? "USD Coin" : "Wrapped Ether",
  decimals: id === source ? 6 : 18, logoUrl: null, verification: "verified", eligibility: "eligible" }) }));
vi.mock("@/lib/swap/prepare-integrity", () => ({ assertSwapPrepareIntegrity: async () => { if (!fixture.routeValid) throw new Error("bad route");
  return { sourceCall: { chainId: 8453, from: wallet, to: "0x2222222222222222222222222222222222222222", value: "0", data: "0x1234" },
    ...(fixture.bridge ? { expectedSourceEffect: { wallet, sourceAssetId: source, grossInputRaw: "1000000",
      netInputRaw: "997500", feeRaw: "2500", bridgeAmountRaw: "997500", bridgeOutputRaw: "997000",
      quoteTimestamp: Math.floor(Date.now() / 1000), fillDeadline: Math.floor(Date.now() / 1000) + 3600,
      feeRecipients: ["0x3333333333333333333333333333333333333333"],
      spender: "0x2222222222222222222222222222222222222222" },
      expectedDestinationEffect: { wallet, recipient: wallet, destinationAssetId: bridgeDestination,
        outputAmountRaw: "997000", minimumOutputRaw: "900000" } } : {}),
    expectedEffect: { wallet, sourceAssetId: source, destinationAssetId: destination,
      sourceAmountRaw: "1000000", minimumOutputRaw: "900000", recipient: wallet }, reviewedSpender: "0x2222222222222222222222222222222222222222" }; } }));
vi.mock("@/lib/swap/approval-steps", () => ({ observeNextSwapApproval: async () => ({ kind: fixture.allowance }) }));
vi.mock("@/lib/swap/source-balance", () => ({ observeSwapSourceBalance: async () => ({ chainId: 8453, wallet, assetId: source,
  amountRaw: "1000000", balanceRaw: "2000000", blockNumber: 1n, blockHash: `0x${"a".repeat(64)}`, observedAtMs: Date.now() }) }));
vi.mock("@/lib/swap/simulation", () => ({ observeSwapExecutionBudget: async () => { fixture.simulationCalls++;
  if (fixture.advanceAfterSimulation) vi.setSystemTime(new Date(Date.now() + fixture.simulationAdvanceMs));
  if (!fixture.simulationValid) throw new Error("simulation failed"); return { signingReady: false }; } }));
vi.mock("@/lib/transactions/valuation", () => ({ ValuationError: class ValuationError extends Error {}, valueSwapSource: async () => ({
  assetId: source, rawUnits: "1000000", decimals: 6, priceUsd: "1", marketPriceUsd: "1", priceSource: "kraken",
  priceObservedAt: new Date(Date.now() - fixture.priceAgeMs).toISOString(), valuedAt: new Date().toISOString(), usdCents: "100", policyVersion: 1,
  depegUncertainty: false }) }));
vi.mock("@/lib/transactions/policy", () => ({ evaluateTransactionPolicy: () => ({ permitted: true,
  requiresStepUp: false, requiresWalletConfirmation: true, findings: [] }) }));
vi.mock("viem", async (importOriginal) => { const actual = await importOriginal<typeof import("viem")>();
  return { ...actual, createPublicClient: () => ({}) }; });

import { POST } from "@/app/api/swap/prepare/route";

function post(body: Record<string, unknown> = { intentId, planId, walletAddress: wallet }) {
  return POST(new Request("https://aurel.test/api/swap/prepare", { method: "POST", body: JSON.stringify(body) }));
}

function seededCommitDatabase(policyVersion = 1) {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  const migrations = resolve(process.cwd(), "../../infra/d1/migrations");
  for (const file of readdirSync(migrations).filter((name) => name.endsWith(".sql")).sort())
    db.exec(readFileSync(resolve(migrations, file), "utf8"));
  db.exec("UPDATE feature_flags SET enabled=1 WHERE flag_key='swaps'");
  const current = new Date().toISOString();
  db.prepare(`INSERT INTO subject_profiles (subject_reference,privy_user_reference,created_at,updated_at)
    VALUES ('did:privy:owner','did:privy:owner',?,?)`).run(current, current);
  db.prepare(`INSERT INTO wallet_references (wallet_reference,subject_reference,provider,address,chain_family,control_model,observed_at)
    VALUES (?, 'did:privy:owner','privy',?,'evm','customer',?)`).run(`wallet:${wallet}`, wallet, current);
  db.prepare(`INSERT INTO transaction_intents (intent_id,subject_reference,wallet_reference,intent_type,chain_id,
    request_json,policy_result_json,disclosure_version,status,created_at,updated_at,expires_at,route_reference)
    VALUES (?, 'did:privy:owner',?,'swap',8453,'{}','{"permitted":true}','v1','reviewed',?,?,?,?)`)
    .run(intentId, `wallet:${wallet}`, current, current, fixture.expiryAt, `swap-plan:${planId}`);
  db.prepare(`INSERT INTO swap_quote_plans (plan_id,subject_reference,wallet_address,source_asset_id,destination_asset_id,
    source_chain_id,destination_chain_id,from_amount_raw,recipient,slippage_bps,to_amount_min_raw,quote_id,step_id,
    tool_id,approval_spender,source_call_json,route_policy_version,catalog_version,observed_at,expires_at,fingerprint,intent_id)
    VALUES (?, 'did:privy:owner',?,?,?,8453,8453,'1000000',?,50,'900000','quote-1','quote-1',
      'uniswap_v3_direct',?,'{}','v1','v1',?,?,?,?)`)
    .run(planId, wallet, source, destination, wallet, "0x2222222222222222222222222222222222222222",
      current, fixture.expiryAt, "plan-fingerprint", intentId);
  db.prepare("INSERT INTO security_profiles (subject_reference,policy_version,updated_at) VALUES ('did:privy:owner',?,?)")
    .run(policyVersion, current);
  db.prepare(`INSERT INTO beta_access (subject_reference,cohort,country_code,status,transaction_limit_usd,
    terms_version,terms_accepted_at,activated_at,updated_at)
    VALUES ('did:privy:owner','test','US','active',25000,'test',?,?,?)`).run(current, current, current);
  return db;
}

describe("governed Swap preparation boundary", () => {
  beforeEach(() => { Object.assign(fixture, { planIntent: intentId, intentStatus: "reviewed", intentType: "swap",
    locked: false, allowance: "sufficient", routeValid: true, simulationValid: true, changes: 1,
    countries: ["US"], inserted: [], insertValues: [], simulationCalls: 0, advanceAfterSimulation: false,
    simulationAdvanceMs: 60_000, priceAgeMs: 0, bridge: false,
    expiryAt: new Date(Date.now() + 45_000).toISOString() }); });
  afterEach(() => vi.useRealTimers());

  it("rejects browser-authored calldata", async () => {
    expect((await post({ intentId, planId, walletAddress: wallet, call: { data: "0xdeadbeef" } })).status).toBe(400);
    expect(fixture.inserted).toHaveLength(0);
  });

  it("rejects an orphan or different reviewed intent before preparing", async () => {
    fixture.planIntent = "00000000-0000-4000-8000-000000000099";
    expect((await post()).status).toBe(409);
    expect(fixture.inserted).toHaveLength(0);
  });

  it("refuses unsupported routes and insufficient allowance without writing a call", async () => {
    fixture.routeValid = false;
    expect((await post()).status).toBe(422);
    fixture.routeValid = true; fixture.allowance = "approve";
    expect((await post()).status).toBe(409);
    expect(fixture.inserted).toHaveLength(0);
  });

  it("refuses account lock and a country without explicit allowance", async () => {
    fixture.locked = true;
    expect((await post()).status).toBe(403);
    fixture.locked = false; fixture.countries = [];
    expect((await post()).status).toBe(403);
    expect(fixture.inserted).toHaveLength(0);
  });

  it("stores the exact simulated server-held call once, then returns it for deliberate wallet confirmation", async () => {
    const response = await post();
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(201);
    expect(await response.json()).toMatchObject({ intentId, stepIndex: 0, call: { data: "0x1234", from: wallet } });
    expect(fixture.simulationCalls).toBe(1);
    expect(fixture.inserted).toHaveLength(1);
    expect(fixture.inserted[0]).toContain("submission_phase");
  });

  it("prepares a reviewed LI.FI bridge source without treating it as a completed swap", async () => {
    fixture.bridge = true; fixture.intentType = "bridge";
    const response = await post();
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(201);
    expect(await response.json()).toMatchObject({ intentId, stepIndex: 0, call: { chainId: 8453, from: wallet } });
    expect(fixture.inserted).toHaveLength(1);
    expect(fixture.inserted[0]).toContain("semantic_action");
    expect(fixture.insertValues[0]).toContain("bridge");
    expect(fixture.insertValues[0]).toContain(42161);
    expect(fixture.insertValues[0]).toContainEqual(expect.stringContaining('"sourceChainId":8453'));
    expect(fixture.insertValues[0]).toContainEqual(expect.stringContaining('"minimumOutputRaw":"900000"'));
  });

  it("never returns executable calldata if the conditional insert loses a race", async () => {
    fixture.changes = 0;
    const response = await post();
    expect(response.status).toBe(409);
    expect(JSON.stringify(await response.json())).not.toContain("0x1234");
  });

  it("does not prepare a quote that expires during network simulation", async () => {
    vi.useFakeTimers();
    fixture.expiryAt = new Date(Date.now() + 45_000).toISOString();
    fixture.advanceAfterSimulation = true;
    const response = await post();
    expect(response.status).toBe(409);
    expect(fixture.inserted).toHaveLength(0);
    expect(JSON.stringify(await response.json())).not.toContain("0x1234");
  });

  it("does not prepare when independent price evidence expires during simulation", async () => {
    vi.useFakeTimers();
    fixture.expiryAt = new Date(Date.now() + 45_000).toISOString();
    fixture.priceAgeMs = 179_000;
    fixture.advanceAfterSimulation = true;
    fixture.simulationAdvanceMs = 3_000;
    const response = await post();
    expect(response.status).toBe(503);
    expect(fixture.inserted).toHaveLength(0);
  });

  it("does not commit a signable call after the security policy changes", async () => {
    expect((await post()).status).toBe(201);
    const db = seededCommitDatabase(2);
    try {
      const info = db.prepare(fixture.inserted[0]).run(...fixture.insertValues[0] as Array<string | number | null>);
      expect(info.changes).toBe(0);
      expect(db.prepare("SELECT COUNT(*) AS count FROM intent_prepared_calls").get()).toMatchObject({ count: 0 });
    } finally { db.close(); }
  });

  it("commits the same governed call when policy and price are still current", async () => {
    expect((await post()).status).toBe(201);
    const db = seededCommitDatabase();
    try {
      const info = db.prepare(fixture.inserted[0]).run(...fixture.insertValues[0] as Array<string | number | null>);
      expect(info.changes).toBe(1);
      expect(db.prepare("SELECT submission_phase FROM intent_prepared_calls WHERE intent_id=?").get(intentId))
        .toMatchObject({ submission_phase: "released" });
    } finally { db.close(); }
  });

  it("does not commit when D1 sees stale price evidence after the route check", async () => {
    fixture.priceAgeMs = 90_000;
    expect((await post()).status).toBe(201);
    const db = seededCommitDatabase();
    try {
      const values = [...fixture.insertValues[0]];
      const observedAt = values.findIndex((value) => typeof value === "string"
        && Date.parse(value) > Date.now() - 120_000 && Date.parse(value) < Date.now() - 80_000);
      expect(observedAt).toBeGreaterThan(-1);
      values[observedAt] = new Date(Date.now() - 181_000).toISOString();
      const info = db.prepare(fixture.inserted[0]).run(...values as Array<string | number | null>);
      expect(info.changes).toBe(0);
      expect(db.prepare("SELECT COUNT(*) AS count FROM intent_prepared_calls").get()).toMatchObject({ count: 0 });
    } finally { db.close(); }
  });
});
