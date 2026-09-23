import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getActiveSwapQuotePlan, saveSwapQuotePlan } from "@/lib/swap/plans";
import type { ServerHeldLifiPlan } from "@/lib/swap/lifi";

const wallet = "0x1111111111111111111111111111111111111111";
const now = Date.parse("2026-09-23T12:00:00.000Z");
const plan: ServerHeldLifiPlan = {
  fromAssetId: "8453:native", toAssetId: "1:native", fromChainId: 8453, toChainId: 1,
  fromAmountRaw: "100", toAmountMinRaw: "90", recipient: wallet, slippageBps: 50,
  quoteId: "quote-1", stepId: "quote-1", toolId: "across", approvalSpender: null,
  routeSteps: [{ id: "step-1", type: "cross", tool: "across" }],
  economics: { fromAmountUsd: "1", toAmountUsd: "0.99", toAmountRaw: "95", networkFeeUsd: 0.01, providerFeeUsd: 0.02, totalFeeUsd: 0.03, priceImpactPercent: 1, feeCosts: [{ amountUSD: "0.02" }] },
  sourceCall: { chainId: 8453, from: wallet, to: "0x3333333333333333333333333333333333333333", value: "100", data: "0x1234" },
  routePolicyVersion: "route-v1", catalogVersion: "catalog-v1", observedAt: new Date(now).toISOString(),
  expiresAt: new Date(now + 45_000).toISOString(), fingerprint: `0x${"a".repeat(64)}`
};

function d1(db: DatabaseSync): D1Database {
  return {
    prepare(sql: string) {
      return { bind(...args: unknown[]) {
        return {
          async first() { return db.prepare(sql).get(...args as Array<string | number | null>) ?? null; },
          async run() { const info = db.prepare(sql).run(...args as Array<string | number | null>); return { meta: { changes: Number(info.changes) } }; }
        };
      } };
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    }
  } as unknown as D1Database;
}

let sqlite: DatabaseSync;
let database: D1Database;
beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`PRAGMA foreign_keys = ON;
    CREATE TABLE wallet_references (wallet_reference TEXT PRIMARY KEY, subject_reference TEXT NOT NULL, address TEXT NOT NULL);
    INSERT INTO wallet_references VALUES ('wallet-a', 'subject-a', '${wallet}');
    CREATE TABLE transaction_intents (intent_id TEXT PRIMARY KEY, subject_reference TEXT NOT NULL, wallet_reference TEXT NOT NULL);
    INSERT INTO transaction_intents VALUES ('submitted-intent', 'subject-a', 'wallet-a');`);
  sqlite.exec(readFileSync(resolve(process.cwd(), "../../infra/d1/migrations/0021_server_held_swap_plans.sql"), "utf8"));
  sqlite.exec(readFileSync(resolve(process.cwd(), "../../infra/d1/migrations/0023_swap_plan_integrity.sql"), "utf8"));
  database = d1(sqlite);
});
afterEach(() => sqlite.close());

describe("server-held Swap plans", () => {
  it("returns an opaque ID and reads only the current subject and wallet's plan", async () => {
    const id = await saveSwapQuotePlan(database, "subject-a", wallet, plan, now);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(id).not.toContain("quote-1");
    expect(await getActiveSwapQuotePlan(database, id, "subject-a", wallet, now)).toMatchObject({
      plan_id: id, subject_reference: "subject-a", wallet_address: wallet, source_call_json: JSON.stringify(plan.sourceCall),
      to_amount_min_raw: "90", fingerprint: plan.fingerprint,
      route_steps_json: JSON.stringify(plan.routeSteps), economics_json: JSON.stringify(plan.economics)
    });
    expect(await getActiveSwapQuotePlan(database, id, "subject-b", wallet, now)).toBeNull();
    expect(await getActiveSwapQuotePlan(database, id, "subject-a", "0x2222222222222222222222222222222222222222", now)).toBeNull();
  });

  it("supersedes a prior unbound plan for the same subject, wallet, and pair", async () => {
    const first = await saveSwapQuotePlan(database, "subject-a", wallet, plan, now);
    const second = await saveSwapQuotePlan(database, "subject-a", wallet, { ...plan, quoteId: "quote-2" }, now + 1_000);
    expect(await getActiveSwapQuotePlan(database, first, "subject-a", wallet, now + 1_000)).toBeNull();
    expect(await getActiveSwapQuotePlan(database, second, "subject-a", wallet, now + 1_000)).not.toBeNull();
  });

  it("rejects expiry and retains bound intent evidence during cleanup", async () => {
    const id = await saveSwapQuotePlan(database, "subject-a", wallet, plan, now);
    expect(await getActiveSwapQuotePlan(database, id, "subject-a", wallet, now + 45_000)).toBeNull();
    sqlite.prepare("UPDATE swap_quote_plans SET intent_id = 'submitted-intent' WHERE plan_id = ?").run(id);
    await saveSwapQuotePlan(database, "subject-a", wallet, { ...plan, quoteId: "quote-2", observedAt: new Date(now + 8 * 86_400_000).toISOString(), expiresAt: new Date(now + 8 * 86_400_000 + 45_000).toISOString() }, now + 8 * 86_400_000);
    expect(sqlite.prepare("SELECT intent_id FROM swap_quote_plans WHERE plan_id = ?").get(id)).toMatchObject({ intent_id: "submitted-intent" });
  });

  it("refuses to issue a plan ID after the provider quote has expired", async () => {
    await expect(saveSwapQuotePlan(database, "subject-a", wallet, plan, now + 45_000)).rejects.toThrow();
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM swap_quote_plans").get()).toMatchObject({ count: 0 });
  });
});
