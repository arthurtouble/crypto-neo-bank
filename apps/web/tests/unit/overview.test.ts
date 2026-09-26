import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicClient } from "viem";
import { readOverview } from "@/lib/overview/read";
import { d1 } from "../support/d1";
import { schemaDatabase } from "../support/schema";

const wallet = "0x1111111111111111111111111111111111111111";
const usdc = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const cbbtc = "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf";
const aUsdc = "0x4e65fe4dba92790696d040ac24aa414708f5c0ab";
const weth = "0x4200000000000000000000000000000000000006";
const now = new Date("2026-09-25T12:00:00.000Z");

type Read = { address: string; functionName: string; args?: readonly unknown[] };
function fakeClient(reads: (call: Read) => unknown, balance?: () => bigint): PublicClient {
  return { readContract: async (call: Read) => reads(call), getBalance: async () => { if (!balance) throw new Error("rpc down"); return balance(); } } as unknown as PublicClient;
}

const baseReads = (call: Read) => {
  const address = call.address.toLowerCase();
  if (call.functionName === "getReserveData") return { aTokenAddress: address === "0xa238dd80c259a72e81d7e4664a9801593f98d1c5" && String(call.args?.[0]).toLowerCase() === usdc ? aUsdc : "0x0000000000000000000000000000000000000001" };
  if (address === usdc) return 125_500_000n;
  if (address === cbbtc) return 1_000_000n;
  if (address === aUsdc) return 50_000_000n;
  if (address === weth) return 10n ** 17n;
  return 0n;
};

describe("reading the overview from the chains", () => {
  it("groups cash, crypto, and earn with values, sources, and observation times, and totals them", async () => {
    const overview = await readOverview(wallet, {
      base: fakeClient(baseReads, () => 2n * 10n ** 18n),
      ethereum: fakeClient((call) => { if (call.functionName === "balanceOf") return 0n; throw new Error("unexpected"); }),
      price: async (asset) => asset === "btc" ? "60000.5" : "2500"
    }, now);
    expect(overview.holdings.map((item) => [item.group, item.symbol, item.amountRaw, item.usdCents])).toEqual([
      // Registry order; the page groups them.
      ["crypto", "ETH", "2000000000000000000", 500000],
      ["cash", "USDC", "125500000", 12550],
      ["crypto", "WETH", "100000000000000000", 25000],
      ["crypto", "cbBTC", "1000000", 60000],
      ["earn", "USDC", "50000000", 5000]
    ]);
    expect(overview.totals).toEqual({ cash: { usdCents: 12550, partial: false }, crypto: { usdCents: 585000, partial: false },
      earn: { usdCents: 5000, partial: false }, all: { usdCents: 602550, partial: false } });
    expect(overview.holdings.every((item) => item.observedAt === now.toISOString() && item.source)).toBe(true);
  });

  it("marks a failed read unavailable instead of showing a number, and flags the group as partial", async () => {
    const overview = await readOverview(wallet, {
      base: fakeClient(baseReads),
      ethereum: fakeClient(() => { throw new Error("rpc down"); }),
      price: async () => null
    }, now);
    expect(overview.holdings.find((item) => item.symbol === "ETH")).toMatchObject({ status: "unavailable", amountRaw: null, usdCents: null });
    expect(overview.holdings.find((item) => item.label === "Sky savings")).toMatchObject({ status: "unavailable" });
    expect(overview.holdings.find((item) => item.symbol === "cbBTC")).toMatchObject({ status: "observed", amountRaw: "1000000", usdCents: null });
    expect(overview.totals.crypto.partial).toBe(true);
    expect(overview.totals.earn.partial).toBe(true);
    expect(overview.totals.cash.partial).toBe(false);
    expect(overview.totals.all).toEqual({ usdCents: 17550, partial: true });
  });
});

const state = vi.hoisted(() => ({ db: null as D1Database | null }));
vi.mock("cloudflare:workers", () => ({ env: { get PROJECTION_DB() { return state.db; } } }));
vi.mock("@/lib/auth/server", () => ({ requireVerifiedSubject: async () => ({ subjectReference: "alice", sessionReference: "s" }) }));
const { GET: statement } = await import("@/app/api/statements/route");

describe("monthly statements", () => {
  let sqlite: DatabaseSync;
  beforeEach(() => {
    sqlite = schemaDatabase();
    state.db = d1(sqlite);
    const action = (id: string, created: string, status: string, to: string) => `INSERT INTO actions (action_id, subject_reference, wallet_address, kind, chain_id,
      summary_json, calls_json, calls_fingerprint, effects_json, counts_toward_limit, usd_cents, status, transaction_hash, created_at, expires_at, updated_at)
      VALUES ('${id}', 'alice', '${wallet}', 'transfer', 8453, json_object('symbol', 'USDC', 'amount', '10', 'to', '${to}'),
      '[{"to":"${usdc}","value":"0","data":"0x"}]', 'fp', '[]', 1, 1000, '${status}', ${status === "expired" ? "NULL" : `'0x${id.repeat(64).slice(0, 64)}'`}, '${created}', '${created}', '${created}');`;
    sqlite.exec(`INSERT INTO subject_profiles (subject_reference, privy_user_reference, created_at, updated_at) VALUES ('alice', 'alice', 't', 't');
      ${action("a", "2026-09-02T10:00:00.000Z", "confirmed", "0x2222222222222222222222222222222222222222")}
      ${action("b", "2026-09-03T10:00:00.000Z", "expired", "0x2222222222222222222222222222222222222222")}
      ${action("c", "2026-10-01T00:00:00.000Z", "confirmed", "0x2222222222222222222222222222222222222222")}
      ${action("d", "2026-09-30T23:00:00.000Z", "confirmed", "=HYPERLINK(1)")}`);
  });
  afterEach(() => sqlite.close());

  it("lists the month's sent and settled actions as CSV, neutralizing spreadsheet formulas", async () => {
    const response = await statement(new Request("https://aura.test/api/statements?month=2026-09"));
    expect(response.headers.get("content-type")).toContain("text/csv");
    const lines = (await response.text()).trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toMatch(/^2026-09-02T10:00:00.000Z,transfer,confirmed,USDC,10,0x2222/);
    expect(lines[2]).toContain("'=HYPERLINK(1)");
  });

  it("rejects a malformed month", async () => {
    expect((await statement(new Request("https://aura.test/api/statements?month=2026-13"))).status).toBe(400);
  });
});
