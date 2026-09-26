import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeFunctionData, erc20Abi } from "viem";
import { LIFI_DIAMOND } from "@/lib/actions/lifi";
import { depositSymbols } from "@/lib/deposits/networks";
import { d1 } from "../support/d1";
import { schemaDatabase } from "../support/schema";

const httpErrors = await vi.hoisted(() => import("@/lib/http/errors"));
const account = "0x1111111111111111111111111111111111111111";
const metamask = "0x2222222222222222222222222222222222222222";
const arbUsdc = "0xaf88d065e77c8cc2239327c5edb3a432268e5831";
const baseUsdc = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const state = vi.hoisted(() => ({ db: null as D1Database | null, quotes: [] as URLSearchParams[] }));
vi.mock("cloudflare:workers", () => ({ env: { get PROJECTION_DB() { return state.db; } } }));
vi.mock("@/lib/auth/server", () => ({ requireVerifiedSubject: async () => ({ subjectReference: "alice", sessionReference: "s" }) }));
vi.mock("@/lib/auth/wallet", () => ({
  requireActionWallet: async () => account,
  requireLinkedEvmWallet: async (_subject: string, address: string) => {
    if (address.toLowerCase() !== metamask) throw new httpErrors.WalletOwnershipError();
    return address.toLowerCase();
  },
  WalletOwnershipError: httpErrors.WalletOwnershipError
}));
const { POST } = await import("@/app/api/deposits/quote/route");

function lifi(query: URLSearchParams) {
  const usdc = query.get("fromToken") !== "0x0000000000000000000000000000000000000000";
  const token = (chainId: number, address: string) => ({ address, chainId, decimals: usdc ? 6 : 18, symbol: usdc ? "USDC" : "ETH" });
  const raw = query.get("fromAmount")!;
  return {
    id: "q1", tool: "across",
    action: { fromChainId: Number(query.get("fromChain")), toChainId: Number(query.get("toChain")),
      fromToken: token(Number(query.get("fromChain")), query.get("fromToken")!), toToken: token(8453, query.get("toToken")!),
      fromAmount: raw, fromAddress: query.get("fromAddress"), toAddress: query.get("toAddress"), slippage: 0.005 },
    estimate: { fromAmount: raw, toAmount: String(BigInt(raw) * 99n / 100n), toAmountMin: String(BigInt(raw) * 98n / 100n),
      approvalAddress: usdc ? LIFI_DIAMOND : undefined, fromAmountUSD: "25.00", toAmountUSD: "24.75", gasCosts: [{ amountUSD: "0.05" }], feeCosts: [{ amountUSD: "0.20" }] },
    transactionRequest: { to: LIFI_DIAMOND, data: "0xabcdef01", value: usdc ? "0x0" : `0x${BigInt(raw).toString(16)}`,
      chainId: Number(query.get("fromChain")), from: query.get("fromAddress") }
  };
}

const post = (body: unknown) => POST(new Request("https://aura.test/api/deposits/quote", { method: "POST", body: JSON.stringify(body) }));

describe("quoting a deposit from another network", () => {
  let sqlite: DatabaseSync;
  beforeEach(() => {
    sqlite = schemaDatabase();
    sqlite.exec("UPDATE feature_flags SET enabled = 1 WHERE flag_key = 'cross_chain'");
    state.db = d1(sqlite);
    state.quotes = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const query = new URL(url).searchParams;
      state.quotes.push(query);
      return Response.json(lifi(query));
    }));
  });
  afterEach(() => { sqlite.close(); vi.unstubAllGlobals(); });

  it("bridges USDC from Arbitrum to USDC on Base, from the linked wallet into the Aura account", async () => {
    const response = await post({ chainId: 42161, symbol: "USDC", amount: "25", from: metamask });
    expect(response.status).toBe(200);
    const { quote } = await response.json() as { quote: { calls: Array<{ to: string; data: `0x${string}` }>; toAmountRaw: string; providerFeeUsd: number } };
    expect(Object.fromEntries(state.quotes[0])).toMatchObject({ fromChain: "42161", toChain: "8453", fromToken: arbUsdc, toToken: baseUsdc,
      fromAddress: metamask, toAddress: account, fromAmount: "25000000" });
    expect(quote.calls.map((call) => call.to)).toEqual([arbUsdc, LIFI_DIAMOND]);
    expect(decodeFunctionData({ abi: erc20Abi, data: quote.calls[0].data }).args).toEqual([expect.stringMatching(/^0x1231/i), 25_000_000n]);
    expect(quote).toMatchObject({ toAmountRaw: "24750000", providerFeeUsd: 0.2 });
  });

  it("keeps ETH as ETH", async () => {
    const response = await post({ chainId: 1, symbol: "ETH", amount: "0.01", from: metamask });
    expect(response.status).toBe(200);
    expect(Object.fromEntries(state.quotes[0])).toMatchObject({ fromToken: "0x0000000000000000000000000000000000000000", toToken: "0x0000000000000000000000000000000000000000" });
  });

  it("refuses a wallet the customer didn't link, Base itself, ETH from Polygon, and a switched-off feature", async () => {
    expect((await post({ chainId: 42161, symbol: "USDC", amount: "25", from: "0x3333333333333333333333333333333333333333" })).status).toBe(403);
    expect((await post({ chainId: 8453, symbol: "USDC", amount: "25", from: metamask })).status).toBe(422);
    expect((await post({ chainId: 137, symbol: "ETH", amount: "1", from: metamask })).status).toBe(422);
    expect(depositSymbols(137)).toEqual(["USDC"]);
    sqlite.exec("UPDATE feature_flags SET enabled = 0 WHERE flag_key = 'cross_chain'");
    const off = await post({ chainId: 42161, symbol: "USDC", amount: "25", from: metamask });
    expect(off.status).toBe(503);
    expect(await off.json()).toMatchObject({ error: "feature_unavailable", message: expect.stringContaining("aren't available right now") });
    expect(state.quotes).toHaveLength(0);
  });

  it("rejects malformed input and reports the bridge provider unavailable", async () => {
    expect((await post({ chainId: 42161, symbol: "DOGE", amount: "25", from: metamask })).status).toBe(400);
    expect((await post({ chainId: 42161, symbol: "USDC", amount: "-1", from: metamask })).status).toBe(400);
    expect((await post({ chainId: 42161, symbol: "USDC", amount: "25", from: "not-an-address" })).status).toBe(400);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 503 })));
    const down = await post({ chainId: 42161, symbol: "USDC", amount: "25", from: metamask });
    expect(down.status).toBe(503);
    expect(await down.json()).toMatchObject({ error: "provider_unavailable" });
  });
});

const { GET: status } = await import("@/app/api/deposits/status/route");
const hash = `0x${"a".repeat(64)}`;
const statusOf = (query: string) => status(new Request(`https://aura.test/api/deposits/status?${query}`));

describe("following a bridged deposit", () => {
  let sqlite: DatabaseSync;
  beforeEach(() => { sqlite = schemaDatabase(); state.db = d1(sqlite); });
  afterEach(() => { sqlite.close(); vi.unstubAllGlobals(); });

  const lifiStatus = (body: unknown) => vi.stubGlobal("fetch", vi.fn(async () => Response.json(body)));

  it("reports delivery with the Base transaction", async () => {
    lifiStatus({ status: "DONE", substatus: "COMPLETED", tool: "across", sending: { txHash: hash, chainId: 42161 }, receiving: { txHash: `0x${"b".repeat(64)}`, chainId: 8453 } });
    expect(await (await statusOf(`chainId=42161&hash=${hash}&tool=across`)).json()).toMatchObject({ status: "DONE", destinationHash: `0x${"b".repeat(64)}` });
  });

  it("reports a refund, and a pending bridge", async () => {
    lifiStatus({ status: "DONE", substatus: "REFUNDED", tool: "across", sending: { txHash: hash, chainId: 42161 } });
    expect(await (await statusOf(`chainId=42161&hash=${hash}&tool=across`)).json()).toMatchObject({ status: "REFUNDED", destinationHash: null });
    lifiStatus({ status: "PENDING", tool: "across", sending: { txHash: hash, chainId: 42161 } });
    expect(await (await statusOf(`chainId=42161&hash=${hash}&tool=across`)).json()).toMatchObject({ status: "PENDING" });
  });

  it("says UNKNOWN rather than guessing when LI.FI is down or reports another transfer", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 503 })));
    expect(await (await statusOf(`chainId=42161&hash=${hash}&tool=across`)).json()).toMatchObject({ status: "UNKNOWN" });
    lifiStatus({ status: "DONE", substatus: "COMPLETED", tool: "across", sending: { txHash: `0x${"c".repeat(64)}`, chainId: 42161 } });
    expect(await (await statusOf(`chainId=42161&hash=${hash}&tool=across`)).json()).toMatchObject({ status: "UNKNOWN" });
  });

  it("rejects a malformed hash or tool", async () => {
    expect((await statusOf("chainId=42161&hash=0x12&tool=across")).status).toBe(400);
    expect((await statusOf(`chainId=42161&hash=${hash}&tool=${encodeURIComponent("a b")}`)).status).toBe(400);
  });
});
