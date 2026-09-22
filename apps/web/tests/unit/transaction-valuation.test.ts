import { describe, expect, it, vi } from "vitest";
import { valueTransfer, ValuationError } from "@/lib/transactions/valuation";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const now = new Date("2026-09-22T12:00:30.000Z");
const candle = (price: string, at = 1_790_078_400, count = 4) => ({ error: [], result: { "ETH/USD": [[at, price, price, price, price, price, "2", count]], last: at } });
const fetcher = (body: unknown) => vi.fn(async () => Response.json(body));

describe("server transfer valuation", () => {
  it("values Base ETH and WETH with raw-unit precision and rounded-up cents", async () => {
    const fetchMock = fetcher(candle("3000.123"));
    const eth = await valueTransfer({ type: "transfer", chainId: 8453, asset: "ETH", amount: "0.000000000000000001" }, { now, fetcher: fetchMock });
    expect(eth.rawUnits).toBe("1");
    expect(eth.usdCents).toBe("1");
    const weth = await valueTransfer({ type: "transfer", chainId: 8453, asset: "0x4200000000000000000000000000000000000006", amount: "2" }, { now, fetcher: fetchMock });
    expect(weth.usdCents).toBe("600025");
    expect(weth.assetId).toBe("8453:0x4200000000000000000000000000000000000006");
  });

  it("floors USDC risk price at $1 even when market trades below peg", async () => {
    const value = await valueTransfer({ type: "transfer", chainId: 8453, asset: "USDC", amount: "25000" }, { now, fetcher: fetcher({ error: [], result: { "USDC/USD": [[1_790_078_400, "0.98", "0.99", "0.98", "0.98", "0.98", "1", 3]], last: 1_790_078_400 } }) });
    expect(value.usdCents).toBe("2500000");
    expect(value.depegUncertainty).toBe(true);
    expect(value.marketPriceUsd).toBe("0.99");
  });

  it("blocks unsupported actions, cross-chain symbols, and wrong contracts", async () => {
    const f = fetcher(candle("3000"));
    for (const input of [
      { type: "swap", chainId: 8453, asset: "ETH", amount: "1" },
      { type: "transfer", chainId: 1, asset: "ETH", amount: "1" },
      { type: "transfer", chainId: 8453, asset: "0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", amount: "1" }
    ]) await expect(valueTransfer(input, { now, fetcher: f })).rejects.toBeInstanceOf(ValuationError);
    expect(f).not.toHaveBeenCalled();
  });

  it("blocks stale, empty, unavailable, and over-precision market evidence", async () => {
    const input = { type: "transfer", chainId: 8453, asset: "ETH", amount: "1" };
    await expect(valueTransfer(input, { now, fetcher: fetcher(candle("3000", 1_790_078_100)) })).rejects.toThrow("stale");
    await expect(valueTransfer(input, { now, fetcher: fetcher(candle("3000", 1_790_078_400, 0)) })).rejects.toThrow("stale");
    await expect(valueTransfer(input, { now, fetcher: vi.fn(async () => { throw Error("offline"); }) })).rejects.toBeInstanceOf(ValuationError);
    await expect(valueTransfer({ ...input, amount: "0.0000000000000000001" }, { now, fetcher: fetcher(candle("3000")) })).rejects.toThrow("amount");
  });
});

describe("immutable valuation evidence migration", () => {
  const migration = readFileSync(resolve(process.cwd(), "../../infra/d1/migrations/0016_authoritative_intent_valuations.sql"), "utf8");
  const setup = "PRAGMA foreign_keys = ON; CREATE TABLE transaction_intents (intent_id TEXT PRIMARY KEY); INSERT INTO transaction_intents VALUES ('intent-1');";
  const row = "INSERT INTO intent_valuations VALUES ('v1','intent-1','8453:native','1000000000000000000',18,'3000','3000','kraken:ohlc:1m:ETH/USD:high','2026-09-22T12:00:00Z','2026-09-22T12:00:30Z','300000',1,0);";
  const sqlite = (sql: string) => spawnSync("sqlite3", [":memory:"], { input: `${setup}\n${migration}\n${sql}`, encoding: "utf8" });

  it("stores bound evidence and rejects updates, deletes, and orphan rows", () => {
    expect(sqlite(`${row} SELECT usd_cents FROM intent_valuations;`).stdout.trim()).toBe("300000");
    expect(sqlite(`${row} UPDATE intent_valuations SET usd_cents='0';`).status).not.toBe(0);
    expect(sqlite(`${row} DELETE FROM intent_valuations;`).status).not.toBe(0);
    expect(sqlite(row.replace("'intent-1'", "'missing'")).status).not.toBe(0);
  });
});
