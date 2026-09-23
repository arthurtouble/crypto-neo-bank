import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ writes: [] as Array<{ sql: string; values: unknown[] }>, spent: { spent_cents: 0, missing: 0 }, stepUpThresholdUsd: 10_000 }));
vi.mock("cloudflare:workers", () => ({ env: { PROJECTION_DB: {
  prepare(sql: string) {
    const statement = { values: [] as unknown[], bind(...values: unknown[]) { this.values.push(...values); return this; },
      async first() { return null; } };
    state.writes.push({ sql, values: statement.values });
    return statement;
  },
  async batch(statements: Array<{ values: unknown[] }>) {
    if (statements.length === 3) return [
      { results: [{ account_locked: 0, enforce_address_book: 0, daily_limit_usd: 25000, new_address_threshold_usd: 100000, step_up_threshold_usd: state.stepUpThresholdUsd, new_address_delay_seconds: 86400 }] },
      { results: [{ address: "0x3333333333333333333333333333333333333333", available_at: "2020-01-01T00:00:00Z" }] },
      { results: [state.spent] }
    ];
    return [];
  }
} } }));
vi.mock("@/lib/auth/server", () => ({ AuthenticationError: class extends Error {}, requireVerifiedSubject: async () => ({ subjectReference: "subject-a", sessionReference: "session-a" }) }));
vi.mock("@/lib/auth/wallet", () => ({ WalletOwnershipError: class extends Error {}, requireLinkedEvmWallet: async () => "0x2222222222222222222222222222222222222222" }));
vi.mock("@/lib/beta/access", () => ({ BetaAccessError: class extends Error {}, requireBetaAccess: async () => ({ transactionLimitUsd: 25000 }) }));
vi.mock("@/lib/security/rate-limit", () => ({ RateLimitError: class extends Error {}, enforceRateLimit: async () => undefined }));
vi.mock("@/lib/profile/ensure", () => ({ ensureSubjectProfile: async () => undefined }));
vi.mock("@/lib/features/flags", () => ({ FeatureUnavailableError: class extends Error {}, requireFeature: async () => undefined }));

import { POST } from "@/app/api/intents/evaluate/route";

function request(type = "transfer", asset = "USDC", amount = "30000") {
  return new Request("https://aurel.test/api/intents/evaluate", { method: "POST", body: JSON.stringify({
    type, walletAddress: "0x2222222222222222222222222222222222222222", chainId: 8453,
    asset, amount, destination: "0x3333333333333333333333333333333333333333", estimatedUsd: 0, availableUsd: 999999
  }) });
}

beforeEach(() => {
  state.writes.length = 0;
  state.spent = { spent_cents: 0, missing: 0 };
  state.stepUpThresholdUsd = 10_000;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const pair = new URL(url).searchParams.get("pair")!;
    const minute = Math.floor(Date.now() / 60_000) * 60;
    return Response.json({ error: [], result: { [pair]: [[minute, "1", "1", "1", "1", "1", "2", 4]], last: minute } });
  }));
});

describe("server-authoritative intent evaluation", () => {
  it("requires step-up at 10k when a legacy profile stores a higher threshold", async () => {
    state.stepUpThresholdUsd = 20_000;
    const response = await POST(request("transfer", "USDC", "10000"));
    expect(response.status).toBe(201);
    expect((await response.json() as { decision: { requiresStepUp: boolean } }).decision.requiresStepUp).toBe(true);
  });
  it("requires step-up when a stored threshold is malformed", async () => {
    state.stepUpThresholdUsd = Number.NaN;
    const response = await POST(request("transfer", "USDC", "100"));
    expect(response.status).toBe(201);
    expect((await response.json() as { decision: { requiresStepUp: boolean } }).decision.requiresStepUp).toBe(true);
  });
  it("blocks a 30k USDC transfer despite a zero client estimate and persists trusted evidence", async () => {
    const response = await POST(request());
    expect(response.status).toBe(422);
    const body = await response.json() as { decision: { findings: Array<{code: string}> } };
    expect(body.decision.findings.map((item) => item.code)).toContain("daily_limit_exceeded");
    const insert = state.writes.find((item) => item.sql.includes("INSERT INTO intent_valuations"));
    expect(insert).toBeDefined();
    const intentWrite = state.writes.find((item) => item.sql.includes("INSERT INTO transaction_intents"));
    expect(intentWrite).toBeDefined();
    expect(JSON.stringify(intentWrite?.values)).not.toContain("estimatedUsd");
  });

  it("does not create a reviewed intent for actions without governed preparation", async () => {
    for (const type of ["swap", "bridge", "earn_supply", "earn_withdraw", "earn_claim", "borrow", "repay"]) {
      const response = await POST(request(type));
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: "action_not_ready" });
    }
    expect(state.writes.some((item) => item.sql.includes("INSERT INTO transaction_intents"))).toBe(false);
  });

  it("fails closed for unsupported assets and unvalued legacy spend", async () => {
    expect((await POST(request("transfer", "DAI"))).status).toBe(422);
    state.spent = { spent_cents: 0, missing: 1 };
    const response = await POST(request("transfer", "USDC", "100"));
    expect(response.status).toBe(422);
    expect(JSON.stringify(await response.json())).toContain("spent_value_unavailable");
  });

  it("blocks ETH/WETH transfers reported as zero by the browser using source prices", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const pair = new URL(url).searchParams.get("pair")!;
      const minute = Math.floor(Date.now() / 60_000) * 60;
      return Response.json({ error: [], result: { [pair]: [[minute, "3000", "3000", "3000", "3000", "3000", "2", 4]], last: minute } });
    }));
    for (const asset of ["ETH", "WETH"]) {
      const response = await POST(request("transfer", asset, "10"));
      expect(response.status).toBe(422);
      expect(JSON.stringify(await response.json())).toContain("daily_limit_exceeded");
    }
  });

  it("returns unavailable when the independent price source fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw Error("offline"); }));
    const response = await POST(request("transfer", "USDC", "100"));
    expect(response.status).toBe(503);
    expect((await response.json() as { error: string }).error).toBe("valuation_unavailable");
  });
});
