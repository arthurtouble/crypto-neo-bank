import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeFunctionData, erc20Abi } from "viem";
import { LIFI_DIAMOND, quoteRoute, validateRoute, type RouteQuoteRequest } from "@/lib/actions/lifi";
import { prepareAction } from "@/lib/actions/prepare";
import { buildRoute, markQuoteUsed, saveRouteQuote } from "@/lib/actions/route";
import { ensureSubjectProfile } from "@/lib/profile/ensure";
import type { CatalogAsset } from "@/lib/swap/assets";
import { d1 } from "../support/d1";
import { schemaDatabase } from "../support/schema";

const wallet = "0x1111111111111111111111111111111111111111";
const external = "0x2222222222222222222222222222222222222222";
const now = Date.parse("2026-09-25T12:00:00.000Z");
const asset = (chainId: number, address: string | null, symbol: string, decimals: number): CatalogAsset => ({
  id: `${chainId}:${address ?? "native"}`, chainId, address, symbol, name: symbol, decimals, logoUrl: null, eligibility: "eligible" });
const baseUsdc = asset(8453, "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", "USDC", 6);
const baseEth = asset(8453, null, "ETH", 18);
const arbUsdc = asset(42161, "0xaf88d065e77c8cc2239327c5edb3a432268e5831", "USDC", 6);
const request: RouteQuoteRequest = { from: baseUsdc, to: arbUsdc, amount: "10", wallet, recipient: wallet, slippageBps: 50 };

function lifiQuote(overrides: { to?: CatalogAsset; toAddress?: string; txTo?: string; approval?: string | null; value?: string; fromAmount?: string; toUsd?: string } = {}) {
  const to = overrides.to ?? arbUsdc;
  const token = (item: CatalogAsset) => ({ address: item.address ?? "0x0000000000000000000000000000000000000000", chainId: item.chainId, decimals: item.decimals, symbol: item.symbol });
  return {
    id: "quote-1", tool: "across",
    action: { fromChainId: 8453, toChainId: to.chainId, fromToken: token(baseUsdc), toToken: token(to), fromAmount: overrides.fromAmount ?? "10000000",
      fromAddress: wallet, toAddress: overrides.toAddress ?? wallet, slippage: 0.005 },
    estimate: { fromAmount: overrides.fromAmount ?? "10000000", toAmount: "9990000", toAmountMin: "9940000",
      approvalAddress: overrides.approval === null ? undefined : overrides.approval ?? LIFI_DIAMOND, fromAmountUSD: "10.00", toAmountUSD: overrides.toUsd ?? "9.99",
      gasCosts: [{ amountUSD: "0.01" }], feeCosts: [{ amountUSD: "0.02" }] },
    transactionRequest: { to: overrides.txTo ?? LIFI_DIAMOND, data: "0xabcdef01", value: overrides.value ?? "0x0", chainId: 8453, from: wallet }
  };
}

describe("validating a LI.FI quote", () => {
  it("builds an exact approval and the LI.FI call, with debit and delivery effects", () => {
    const route = validateRoute(lifiQuote(), request, now)!;
    expect(route.calls).toHaveLength(2);
    const approval = decodeFunctionData({ abi: erc20Abi, data: route.calls[0].data });
    expect([route.calls[0].to, approval.functionName, approval.args]).toEqual([baseUsdc.address, "approve", [expect.stringMatching(/^0x1231/i), 10_000_000n]]);
    expect(route.calls[1]).toEqual({ to: LIFI_DIAMOND, value: "0", data: "0xabcdef01" });
    expect(route.effects).toEqual([
      { type: "erc20_debit", token: baseUsdc.address, amountRaw: "10000000" },
      { type: "delivery", tool: "across", destinationChainId: 42161, token: arbUsdc.address, to: wallet, minimumRaw: "9940000" }
    ]);
    expect(route.expiresAt).toBe(new Date(now + 45_000).toISOString());
  });

  it("checks a same-chain output credit instead of delivery", () => {
    const route = validateRoute(lifiQuote({ to: asset(8453, "0x4200000000000000000000000000000000000006", "WETH", 18) }),
      { ...request, to: asset(8453, "0x4200000000000000000000000000000000000006", "WETH", 18) }, now)!;
    expect(route.effects[1]).toEqual({ type: "erc20_credit_min", token: "0x4200000000000000000000000000000000000006", to: wallet, minimumRaw: "9940000" });
  });

  it("sends native value without an approval", () => {
    const quote = lifiQuote({ value: "10000000000000000", approval: null, fromAmount: "10000000000000000" });
    quote.action.fromToken = { address: "0x0000000000000000000000000000000000000000", chainId: 8453, decimals: 18, symbol: "ETH" };
    const route = validateRoute(quote, { ...request, from: baseEth, amount: "0.01" }, now)!;
    expect(route.calls).toEqual([{ to: LIFI_DIAMOND, value: "10000000000000000", data: "0xabcdef01" }]);
    expect(route.effects.map((effect) => effect.type)).toEqual(["delivery"]);
  });

  it.each([
    ["another call target", lifiQuote({ txTo: external })],
    ["another approval spender", lifiQuote({ approval: external })],
    ["another recipient", lifiQuote({ toAddress: external })],
    ["another amount", lifiQuote({ fromAmount: "9000000" })],
    ["native value on a token route", lifiQuote({ value: "1" })],
    ["high price impact", lifiQuote({ toUsd: "9.00" })],
    ["another destination asset", lifiQuote({ to: asset(42161, "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9", "USDT", 6) })]
  ])("rejects %s", (_name, quote) => {
    expect(validateRoute(quote, request, now)).toBeNull();
  });

  it("says when price impact is the reason, so a smaller amount can work", async () => {
    const fetcher = (async () => Response.json(lifiQuote({ toUsd: "9.00" }))) as unknown as typeof fetch;
    await expect(quoteRoute(request, { now: () => now, fetcher })).rejects.toMatchObject({ code: "price_impact", message: expect.stringContaining("10.0%") });
    const other = (async () => Response.json(lifiQuote({ txTo: external }))) as unknown as typeof fetch;
    await expect(quoteRoute(request, { now: () => now, fetcher: other })).rejects.toMatchObject({ code: "no_route" });
  });

  it("pays out to an external recipient only when asked", () => {
    expect(validateRoute(lifiQuote({ toAddress: external }), { ...request, recipient: external }, now)?.effects[1]).toMatchObject({ to: external });
  });

  it("asks LI.FI for the smart wallet as sender and passes the integrator fee", async () => {
    vi.stubEnv("LIFI_INTEGRATOR_FEE", "0.0025");
    let url = "";
    await quoteRoute(request, { now: () => now, fetcher: (async (input: string) => { url = input; return Response.json(lifiQuote()); }) as unknown as typeof fetch });
    vi.unstubAllEnvs();
    const query = new URL(url).searchParams;
    expect([query.get("fromAddress"), query.get("toAddress"), query.get("fromAmount"), query.get("fee")]).toEqual([wallet, wallet, "10000000", "0.0025"]);
  });
});

describe("server-held route quotes", () => {
  let sqlite: DatabaseSync;
  let db: D1Database;
  beforeEach(() => { sqlite = schemaDatabase(); db = d1(sqlite); });
  afterEach(() => sqlite.close());

  async function saved(recipient = wallet) {
    const route = validateRoute(lifiQuote({ toAddress: recipient }), { ...request, recipient }, now)!;
    return saveRouteQuote(db, { subject: "alice", wallet, from: baseUsdc, to: arbUsdc, recipient, route }, new Date(now));
  }

  it("turns a quote into a route action that moves the customer's own money", async () => {
    const built = await buildRoute(db, { kind: "route", quoteId: await saved() }, "alice", wallet, new Date(now));
    expect(built).toMatchObject({ kind: "route", chainId: 8453, countsTowardLimit: false, destinationChainId: 42161, recipient: undefined,
      valuation: { assetId: baseUsdc.id, amountRaw: "10000000", decimals: 6, quotedUsd: "10.00" } });
    expect(built.calls).toHaveLength(2);
  });

  it("counts a payout to someone else toward limits and recipient rules", async () => {
    const built = await buildRoute(db, { kind: "route", quoteId: await saved(external) }, "alice", wallet, new Date(now));
    expect(built).toMatchObject({ countsTowardLimit: true, recipient: external });
  });

  it("needs the send switch as well as the cross-network switch to pay someone else on another network", async () => {
    await ensureSubjectProfile(db, "alice", new Date(now));
    sqlite.exec("UPDATE feature_flags SET enabled = CASE flag_key WHEN 'cross_chain' THEN 1 ELSE 0 END");
    const own = await prepareAction(db, "alice", wallet, { kind: "route", quoteId: await saved() }, new Date(now));
    expect(own.ok).toBe(true);
    await expect(prepareAction(db, "alice", wallet, { kind: "route", quoteId: await saved(external) }, new Date(now)))
      .rejects.toMatchObject({ status: 503 });
    sqlite.exec("UPDATE feature_flags SET enabled = 1 WHERE flag_key = 'direct_transfers'");
    const payout = await prepareAction(db, "alice", wallet, { kind: "route", quoteId: await saved(external) }, new Date(now));
    expect(payout).toMatchObject({ ok: true, action: { kind: "route", destinationChainId: 42161, summary: { recipient: external } } });
  });

  it("refuses another customer's, an expired, or a used quote", async () => {
    const quoteId = await saved();
    await expect(buildRoute(db, { kind: "route", quoteId }, "bob", wallet, new Date(now))).rejects.toMatchObject({ code: "quote_not_found" });
    await expect(buildRoute(db, { kind: "route", quoteId }, "alice", wallet, new Date(now + 60_000))).rejects.toMatchObject({ code: "quote_expired" });
    await markQuoteUsed(db, quoteId, "00000000-0000-4000-8000-000000000000");
    await expect(buildRoute(db, { kind: "route", quoteId }, "alice", wallet, new Date(now))).rejects.toMatchObject({ code: "quote_used" });
  });
});
