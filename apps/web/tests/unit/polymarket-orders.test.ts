import { hashTypedData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it, vi } from "vitest";
import { VenueError, type TypedData } from "@/lib/markets/types";
import { hmacSignature, POLYMARKET_CONTRACTS } from "@/lib/markets/polymarket/http";
import type { OrderBook, TickSize } from "@/lib/markets/polymarket/markets";
import {
  buildDollarBuy, buildOrder, cancelOrder, limitOrderAmounts, marketOrderAmounts, openOrders, orderExchange, orderRejectionCode, orderTypedData, postOrder,
  priceOnTick, quoteMarketOrder, wrapOrderSignature, type UnsignedOrder
} from "@/lib/markets/polymarket/orders";

// Hardhat's public test key #1; never a real account. Its Deposit Wallet:
const owner = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const wallet = "0x4Fe2CC4925607a473264FA89e7138075695A5F8e";
const YES = "17010377994663817312158123655937348199252960045746746128731746451645055725586";
const NO = "61725366781282351729996972759460154434089275036953062948669003249092837754960";
const ZERO = `0x${"0".repeat(64)}` as const;
const ORDER_TYPE_HEX = "4f726465722875696e743235362073616c742c61646472657373206d616b65722c61646472657373207369676e65722c75696e7432353620746f6b656e49642c75696e74323536206d616b6572416d6f756e742c75696e743235362074616b6572416d6f756e742c75696e743820736964652c75696e7438207369676e6174757265547970652c75696e743235362074696d657374616d702c62797465733332206d657461646174612c62797465733332206275696c6465722900ba";

const signable = (typedData: TypedData) => {
  const types = Object.fromEntries(Object.entries(typedData.types).filter(([name]) => name !== "EIP712Domain"));
  return { ...typedData, types } as unknown as Parameters<typeof owner.signTypedData>[0];
};

// Each row's expected amounts come from the SDK's computeLimitOrderAmounts and
// computeMarketOrderAmounts (protected price) for the same inputs.
const AMOUNT_VECTORS: Array<{ side: "BUY" | "SELL"; price: number; size: number; tick: TickSize; limit: [string, string]; market: [string, string] }> = [
  { side: "BUY", price: 0.55, size: 10, tick: 0.01, limit: ["5500000", "10000000"], market: ["10000000", "18181900"] },
  { side: "SELL", price: 0.55, size: 10.129, tick: 0.01, limit: ["10120000", "5566000"], market: ["10120000", "5566000"] },
  { side: "BUY", price: 0.123, size: 7.777, tick: 0.001, limit: ["955710", "7770000"], market: ["7770000", "63170740"] },
  { side: "SELL", price: 0.0025, size: 1234.5678, tick: 0.0025, limit: ["1234560000", "3086400"], market: ["1234560000", "3086400"] },
  { side: "BUY", price: 0.3, size: 3.33, tick: 0.1, limit: ["999000", "3330000"], market: ["3330000", "11100000"] },
  { side: "BUY", price: 0.0001, size: 100, tick: 0.0001, limit: ["10000", "100000000"], market: ["100000000", "1000000000000"] }
];

describe("Order amounts", () => {
  it.each(AMOUNT_VECTORS)("match the SDK for $side $size at $price (tick $tick)", ({ side, price, size, tick, limit, market }) => {
    const scaled = priceOnTick(price, tick);
    const l = limitOrderAmounts(side, scaled, size, tick);
    expect([String(l.makerAmount), String(l.takerAmount)]).toEqual(limit);
    const m = marketOrderAmounts(side, scaled, size, tick);
    expect([String(m.makerAmount), String(m.takerAmount)]).toEqual(market);
    // Decimal strings give the same result as numbers.
    expect(String(limitOrderAmounts(side, priceOnTick(String(price), tick), String(size), tick).makerAmount)).toBe(limit[0]);
  });

  it("rejects prices off the tick grid or outside it", () => {
    expect(() => priceOnTick(0.555, 0.01)).toThrow(VenueError);
    expect(() => priceOnTick(0.001, 0.01)).toThrow(VenueError);
    expect(() => priceOnTick(1, 0.01)).toThrow(VenueError);
    expect(() => priceOnTick("0.1234567", 0.0001)).toThrow(VenueError);
    expect(priceOnTick("0.995", 0.005)).toBe(995_000n);
  });
});

describe("Order building and signing", () => {
  const now = new Date(1_791_000_000_000);

  it("produces the SDK's TypedDataSign and wrapped signature for a standard market", async () => {
    const built = buildOrder({ wallet, tokenId: YES, side: "BUY", price: 0.55, size: 10, negRisk: false, tickSize: 0.01, now, salt: 123456789012345n });
    expect(built.orderType).toBe("GTC");
    expect(built.exchange).toBe(POLYMARKET_CONTRACTS.standardExchange);
    expect(built.order).toMatchObject({ maker: wallet, signer: wallet, makerAmount: "5500000", takerAmount: "10000000", signatureType: 3, timestamp: "1791000000000", expiration: "0" });
    // Hash, signature, and wrapped signature from the SDK's createExchangeOrderTypedDataPayload / createExchangeOrderSignature.
    expect(hashTypedData(signable(built.typedData))).toBe("0x8d40fb12e17e8447ae116ddee762a5bf569794b8d4d1327e3040de9caed55b14");
    const signature = await owner.signTypedData(signable(built.typedData));
    expect(signature).toBe("0x6a88d0d986fc59af3f07bffaa291c62dcf7a84d71affb185a8ee35128bff76d87e10a0be010d40da14bcc4f3397855e726126ab2fd26c46217aa345f894b7be81b");
    expect(wrapOrderSignature(built.typedData, signature)).toBe(`${signature}3264e159346253e26a64e00b69032db0e7d32f94628de3e6eecb50304d7af3d24ee062b77aab3b1cfad07b4d33a4124a9732572b4f7476f53a91f4259d8f9ea5${ORDER_TYPE_HEX}`);
  });

  it("uses the neg-risk exchange domain for neg-risk markets", async () => {
    const order: UnsignedOrder = {
      salt: "123456789012345", maker: wallet, signer: wallet, tokenId: NO, makerAmount: "5500000", takerAmount: "10000000", side: "SELL",
      signatureType: 3, timestamp: "1791000000000", metadata: ZERO, builder: ZERO, expiration: "0"
    };
    const { exchange, version } = orderExchange(NO, true);
    expect(exchange).toBe(POLYMARKET_CONTRACTS.negRiskExchange);
    const typedData = orderTypedData(order, exchange, version);
    expect(hashTypedData(signable(typedData))).toBe("0xdf75d428266a4f463e472e0d9a28378f8c764835362e3aba6313dc86616c444f");
    const signature = await owner.signTypedData(signable(typedData));
    expect(wrapOrderSignature(typedData, signature)).toBe(`${signature}9b858f53327b0bd13af8ec14cfb35234fb9eb7b0504d1a4e61f433840d30e81a69fd48d6cb1bc36799caafe57547ac1359cb2140b24b8dd85ba829d2814838c7${ORDER_TYPE_HEX}`);
  });

  it("builds market buys by amount and market sells by shares", () => {
    const buy = buildOrder({ wallet, tokenId: YES, side: "BUY", price: 0.55, amount: 10, negRisk: false, tickSize: 0.01, now });
    expect(buy).toMatchObject({ orderType: "FAK", order: { makerAmount: "10000000", takerAmount: "18181900" } });
    const sell = buildOrder({ wallet, tokenId: YES, side: "SELL", price: 0.55, size: 10.129, orderType: "FOK", negRisk: false, tickSize: 0.01, now });
    expect(sell).toMatchObject({ orderType: "FOK", order: { makerAmount: "10120000", takerAmount: "5566000" } });
    expect(Number(buy.order.salt)).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER);
  });

  it("enforces minimums, GTD expiry, and order shapes", () => {
    const base = { wallet, tokenId: YES, price: 0.5, negRisk: false, tickSize: 0.01 as const, now };
    expect(() => buildOrder({ ...base, side: "BUY", amount: 0.5 })).toThrow(expect.objectContaining({ code: "below_minimum" }));
    expect(() => buildOrder({ ...base, side: "BUY", size: 4, minOrderSize: 5 })).toThrow(expect.objectContaining({ code: "below_minimum" }));
    expect(() => buildOrder({ ...base, side: "SELL", amount: 5 })).toThrow(expect.objectContaining({ code: "invalid_request" }));
    expect(() => buildOrder({ ...base, side: "BUY", size: 5, orderType: "FAK" })).toThrow(expect.objectContaining({ code: "invalid_request" }));
    expect(() => buildOrder({ ...base, side: "BUY", size: 5, expiration: 1_791_000_100 })).toThrow(VenueError);
    expect(buildOrder({ ...base, side: "BUY", size: 5, expiration: 1_791_000_180 })).toMatchObject({ orderType: "GTD", order: { expiration: "1791000180" } });
  });

  it("refuses to wrap anything but an order", () => {
    expect(() => wrapOrderSignature({ domain: {}, types: {}, primaryType: "Batch", message: {} }, `0x${"1".repeat(130)}`)).toThrow(VenueError);
  });
});

function book(asks: Array<[number, number]>, bids: Array<[number, number]>, tickSize: TickSize = 0.01): OrderBook {
  const levels = (entries: Array<[number, number]>) => entries.map(([price, size]) => ({ price, size }));
  return { tokenId: YES, conditionId: `0x${"a".repeat(64)}`, asks: levels(asks), bids: levels(bids), bestBid: bids[0]?.[0] ?? null, bestAsk: asks[0]?.[0] ?? null, mid: null, tickSize, minOrderSize: 5, negRisk: false, lastTradePrice: null, observedAt: new Date(0).toISOString() };
}

describe("Market order pricing", () => {
  const sample = book([[0.52, 10], [0.55, 50], [0.6, 100]], [[0.48, 10], [0.45, 50], [0.4, 100]]);

  // Worst prices match the SDK's resolveMarketPriceFromOrderBook for the same book.
  it.each([[3, 0.52], [5.2, 0.52], [20, 0.55], [40, 0.6]])("walks the asks for a %s pUSD buy to %s", (amount, worst) => {
    expect(quoteMarketOrder({ book: sample, side: "BUY", amount, slippageBps: 0 }).worstPrice).toBe(worst);
  });
  it.each([[5, 0.48], [10, 0.48], [30, 0.45], [100, 0.4]])("walks the bids for a %s share sell to %s", (amount, worst) => {
    expect(quoteMarketOrder({ book: sample, side: "SELL", amount, slippageBps: 0 }).worstPrice).toBe(worst);
  });

  it("averages the fill, estimates fees, and caps the signed price with slippage on the tick grid", () => {
    const quote = quoteMarketOrder({ book: sample, side: "BUY", amount: 20, slippageBps: 200, fee: { rate: 0.05, exponent: 1 } });
    expect(quote.limitPrice).toBe(0.57); // 0.55 * 1.02 = 0.561, rounded up to the tick
    expect(quote.shares).toBeCloseTo(10 + 14.8 / 0.55, 9);
    expect(quote.averagePrice).toBeCloseTo(20 / quote.shares, 9);
    expect(quote.fee).toBeCloseTo(10 * 0.05 * 0.52 * 0.48 + (14.8 / 0.55) * 0.05 * 0.55 * 0.45, 9);
    expect(quoteMarketOrder({ book: sample, side: "SELL", amount: 30, slippageBps: 200 }).limitPrice).toBe(0.44);
    expect(quoteMarketOrder({ book: book([[0.99, 100]], []), side: "BUY", amount: 10, slippageBps: 500 }).limitPrice).toBe(0.99);
  });

  it("refuses when the book cannot fill the order", () => {
    expect(() => quoteMarketOrder({ book: sample, side: "BUY", amount: 1_000 })).toThrow(expect.objectContaining({ code: "insufficient_liquidity" }));
    expect(() => quoteMarketOrder({ book: book([], []), side: "SELL", amount: 1 })).toThrow(expect.objectContaining({ code: "insufficient_liquidity" }));
  });
});

describe("Buying by dollars", () => {
  const sample = book([[0.52, 10], [0.55, 50], [0.6, 100]], [[0.48, 10]]);

  it("builds a marketable FAK buy for the amount and reports shares and the payout if it wins", () => {
    const now = new Date(1_791_000_000_000);
    const result = buildDollarBuy({ wallet, book: sample, amountUsd: 20.009, fee: { rate: 0.05, exponent: 1 }, now, salt: 7n });
    expect(result.built.orderType).toBe("FAK");
    expect(result.built.order).toMatchObject({ tokenId: YES, side: "BUY", maker: wallet, signer: wallet, makerAmount: "20000000", signatureType: 3 });
    expect(result.built.exchange).toBe(POLYMARKET_CONTRACTS.standardExchange);
    const signed = marketOrderAmounts("BUY", priceOnTick(0.57, 0.01), "20.00", 0.01);
    expect(result.built.order.takerAmount).toBe(String(signed.takerAmount));
    expect(result).toMatchObject({ amount: 20, limitPrice: 0.57, estimatedShares: 36.9, payoutIfWins: 36.9, minimumShares: Number(signed.takerAmount) / 1e6 });
    expect(result.minimumPayoutIfWins).toBe(result.minimumShares);
    expect(result.minimumShares).toBeLessThanOrEqual(result.estimatedShares);
    expect(result.averagePrice).toBeCloseTo(20 / (10 + 14.8 / 0.55), 9);
    expect(result.fee).toBeGreaterThan(0);
    expect(buildDollarBuy({ wallet, book: sample, amountUsd: 5, orderType: "FOK", negRisk: true }).built).toMatchObject({ orderType: "FOK", exchange: POLYMARKET_CONTRACTS.negRiskExchange });
  });

  it("refuses amounts under the minimum or beyond the book", () => {
    expect(() => buildDollarBuy({ wallet, book: sample, amountUsd: 0.5 })).toThrow(expect.objectContaining({ code: "below_minimum" }));
    expect(() => buildDollarBuy({ wallet, book: sample, amountUsd: Number.NaN })).toThrow(expect.objectContaining({ code: "below_minimum" }));
    expect(() => buildDollarBuy({ wallet, book: sample, amountUsd: 1_000 })).toThrow(expect.objectContaining({ code: "insufficient_liquidity" }));
  });
});

describe("CLOB order calls", () => {
  const session = { ownerAddress: owner.address, credentials: { key: "clob-key", secret: "AAEC_-8=", passphrase: "clob-pass" } };
  const built = buildOrder({ wallet, tokenId: YES, side: "BUY", price: 0.55, size: 10, negRisk: false, tickSize: 0.01, now: new Date(1_791_000_000_000), salt: 123456789012345n });

  it("posts the wrapped order with L2 headers and reads the result", async () => {
    const signature = await owner.signTypedData(signable(built.typedData));
    const fetcher = vi.fn(async () => Response.json({ success: true, errorMsg: "", orderID: `0x${"d".repeat(64)}`, status: "live", makingAmount: "", takingAmount: "", tradeIDs: [] })) as unknown as typeof fetch;
    await expect(postOrder({ session, built, signature }, { fetcher })).resolves.toEqual({ orderId: `0x${"d".repeat(64)}`, status: "live", makingAmount: "0", takingAmount: "0", tradeIds: [] });
    const [url, init] = vi.mocked(fetcher).mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe("https://clob.polymarket.com/order");
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      deferExec: false, orderType: "GTC", owner: "clob-key",
      order: { builder: ZERO, expiration: "0", maker: wallet, makerAmount: "5500000", metadata: ZERO, salt: 123456789012345, side: "BUY", signature: wrapOrderSignature(built.typedData, signature), signatureType: 3, signer: wallet, takerAmount: "10000000", timestamp: "1791000000000", tokenId: YES }
    });
    expect(init.headers.POLY_ADDRESS).toBe(owner.address);
    expect(init.headers.POLY_SIGNATURE).toBe(await hmacSignature("AAEC_-8=", Number(init.headers.POLY_TIMESTAMP), "POST", "/order", init.body as string));
  });

  it("maps rejections to codes and never posts a stranger's signature", async () => {
    const signature = await owner.signTypedData(signable(built.typedData));
    const broke = vi.fn(async () => Response.json({ error: "not enough balance / allowance" }, { status: 400 })) as unknown as typeof fetch;
    await expect(postOrder({ session, built, signature }, { fetcher: broke })).rejects.toMatchObject({ code: "insufficient_balance" });
    const killed = vi.fn(async () => Response.json({ success: false, errorMsg: "order couldn't be fully filled. FOK orders are fully filled or killed.", orderID: "", status: "" })) as unknown as typeof fetch;
    await expect(postOrder({ session, built, signature }, { fetcher: killed })).rejects.toMatchObject({ code: "fok_not_filled" });
    const stranger = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");
    const unused = vi.fn() as unknown as typeof fetch;
    await expect(postOrder({ session, built, signature: await stranger.signTypedData(signable(built.typedData)) }, { fetcher: unused })).rejects.toMatchObject({ code: "invalid_signature" });
    expect(unused).not.toHaveBeenCalled();
    expect(orderRejectionCode("whatever", "unmatched")).toBe("unmatched");
  });

  it("cancels an order and lists open orders across pages", async () => {
    const id = `0x${"e".repeat(64)}`;
    const cancel = vi.fn(async () => Response.json({ canceled: [id], not_canceled: {} })) as unknown as typeof fetch;
    await expect(cancelOrder({ session, orderId: id }, { fetcher: cancel })).resolves.toEqual({ canceled: true, reason: null });
    const [, init] = vi.mocked(cancel).mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("DELETE");
    expect(JSON.parse(init.body as string)).toEqual({ orderID: id });

    const row = { id, status: "LIVE", market: `0x${"a".repeat(64)}`, asset_id: YES, outcome: "Yes", side: "BUY", price: "0.5", original_size: "10", size_matched: "2", order_type: "GTC", created_at: 1791000000, expiration: "0" };
    const pages = [{ data: [row], next_cursor: "MTA=" }, { data: [{ ...row, id: `0x${"f".repeat(64)}` }], next_cursor: "LTE=" }];
    const list = vi.fn(async () => Response.json(pages.shift())) as unknown as typeof fetch;
    const orders = await openOrders({ session }, { fetcher: list });
    expect(orders).toHaveLength(2);
    expect(orders[0]).toMatchObject({ id, tokenId: YES, side: "BUY", price: 0.5, originalSize: 10, sizeMatched: 2, expiration: null });
    expect(vi.mocked(list).mock.calls[1]?.[0]).toBe("https://clob.polymarket.com/data/orders?next_cursor=MTA%3D");
  });
});
