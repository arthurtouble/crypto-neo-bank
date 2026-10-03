import { decodeFunctionData, encodeFunctionResult, erc20Abi, parseAbi } from "viem";
import { describe, expect, it, vi } from "vitest";
import { VenueError } from "@/lib/markets/types";
import { POLYMARKET_CONTRACTS, ZERO_BYTES32 } from "@/lib/markets/polymarket/http";
import { activity, positions, pusdBalance, redeemablePositions, redeemCalls } from "@/lib/markets/polymarket/positions";

const wallet = "0x4Fe2CC4925607a473264FA89e7138075695A5F8e";
const CONDITION = `0x${"ab".repeat(32)}`;
const YES = "17010377994663817312158123655937348199252960045746746128731746451645055725586";
const NO = "61725366781282351729996972759460154434089275036953062948669003249092837754960";

/** A Data API v2 position (fields trimmed to what Aura reads). */
const position = (overrides: Record<string, unknown> = {}) => ({
  token_id: YES, opposite_token_id: NO, condition_id: CONDITION, title: "Fed Decision in October?", slug: "fed", event_slug: "fed-decision", icon: "",
  outcome: "Yes", outcome_index: 0, current_size: 40, avg_price: 0.25, current_price: 0.3, current_value: 12, entry_cost_usdc: 10,
  total_pnl: 2, percent_pnl: 20, realized_pnl: 0, redeemable: false, negative_risk: true, end_date: "2026-10-29", ...overrides
});

/** A JSON-RPC answer for each `eth_call`, in order. */
const rpc = (...results: string[]) => vi.fn(async () => Response.json({ jsonrpc: "2.0", id: 1, result: results.shift() })) as unknown as typeof fetch;

describe("Positions", () => {
  it("reads positions with current value and P&L, and pages by cursor", async () => {
    const fetcher = vi.fn(async () => Response.json({ data: [position()], pagination: { has_more: true, next_cursor: "c2" } })) as unknown as typeof fetch;
    const result = await positions(wallet.toLowerCase(), { limit: 500 }, { fetcher });
    expect(result.nextCursor).toBe("c2");
    expect(result.positions[0]).toEqual({
      tokenId: YES, oppositeTokenId: NO, conditionId: CONDITION, title: "Fed Decision in October?", slug: "fed", eventSlug: "fed-decision", icon: null,
      outcome: "Yes", outcomeIndex: 0, size: 40, avgPrice: 0.25, currentPrice: 0.3, value: 12, cost: 10, pnl: 2, percentPnl: 20, realizedPnl: 0,
      redeemable: false, negRisk: true, endDate: "2026-10-29"
    });
    expect(vi.mocked(fetcher).mock.calls[0]?.[0]).toBe(`https://data-api.polymarket.com/v2/positions?user=${wallet}&status=OPEN&limit=100`);
  });

  it("refuses a bad wallet or cursor and an unexpected position", async () => {
    const fetcher = vi.fn(async () => Response.json({ data: [position({ condition_id: "nope" })] })) as unknown as typeof fetch;
    await expect(positions("0x12", {}, { fetcher })).rejects.toMatchObject({ code: "invalid_request" });
    await expect(positions(wallet, { cursor: "a b" }, { fetcher })).rejects.toMatchObject({ code: "invalid_request" });
    await expect(positions(wallet, {}, { fetcher })).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("collects redeemable positions across pages", async () => {
    const pages = [
      { data: [position(), position({ token_id: "1", redeemable: true, current_value: 40, current_price: 1 })], pagination: { has_more: true, next_cursor: "p2" } },
      { data: [position({ token_id: "2", redeemable: true, current_size: 0 }), position({ token_id: "3", redeemable: true, current_value: 0, current_price: 0 })], pagination: { has_more: false, next_cursor: null } }
    ];
    const fetcher = vi.fn(async () => Response.json(pages.shift())) as unknown as typeof fetch;
    const found = await redeemablePositions(wallet, { fetcher });
    expect(found.map((item) => item.tokenId)).toEqual(["1", "3"]);
    expect(new URL(vi.mocked(fetcher).mock.calls[1]?.[0] as string).searchParams.get("cursor")).toBe("p2");
  });
});

describe("Activity", () => {
  it("reads trades and transfers, newest first", async () => {
    const fetcher = vi.fn(async () => Response.json({ data: [
      { type: "TRADE", timestamp: 1791000000, transaction_hash: `0x${"1".repeat(64)}`, condition_id: CONDITION, token_id: YES, side: "BUY", title: "Fed", outcome: "Yes", size: 10, usdc_size: 2.5, price: 0.25 },
      { type: "DEPOSIT", timestamp: 1790000000, transaction_hash: "", side: "", usdc_size: 50 }
    ], pagination: { has_more: false } })) as unknown as typeof fetch;
    const result = await activity(wallet, {}, { fetcher });
    expect(result.nextCursor).toBeNull();
    expect(result.activity[0]).toMatchObject({ type: "TRADE", side: "BUY", tokenId: YES, usdcSize: 2.5, price: 0.25 });
    expect(result.activity[1]).toMatchObject({ type: "DEPOSIT", transactionHash: null, side: null, tokenId: null, usdcSize: 50 });
    expect(new URL(vi.mocked(fetcher).mock.calls[0]?.[0] as string).searchParams.get("exclude_deposits_withdrawals")).toBe("false");
  });
});

describe("pUSD balance", () => {
  it("reads the wallet's pUSD from Polygon", async () => {
    const fetcher = rpc(encodeFunctionResult({ abi: erc20Abi, functionName: "balanceOf", result: 12_345_678n }));
    await expect(pusdBalance(wallet, { fetcher })).resolves.toEqual({ raw: "12345678", amount: "12.345678" });
    const request = JSON.parse((vi.mocked(fetcher).mock.calls[0] as unknown as [string, RequestInit])[1].body as string) as { params: [{ to: string; data: `0x${string}` }] };
    expect(request.params[0].to).toBe(POLYMARKET_CONTRACTS.pusd);
    expect(decodeFunctionData({ abi: erc20Abi, data: request.params[0].data }).args).toEqual([wallet]);
  });

  it("is unavailable when Polygon cannot be read", async () => {
    const fetcher = vi.fn(async () => { throw new TypeError("down"); }) as unknown as typeof fetch;
    await expect(pusdBalance(wallet, { fetcher })).rejects.toMatchObject({ code: "chain_unavailable" });
  });
});

describe("Redeeming", () => {
  const redeemAbi = parseAbi(["function redeemPositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] indexSets)"]);
  const routerAbi = parseAbi(["function redeem(bytes31 conditionId, uint256 outcomeIndex, uint256 amount)"]);

  it("redeems a CTF market through the pUSD collateral adapter for its kind", async () => {
    for (const [negRisk, adapter] of [[false, POLYMARKET_CONTRACTS.collateralAdapter], [true, POLYMARKET_CONTRACTS.negRiskCollateralAdapter]] as const) {
      const [call] = await redeemCalls({ wallet, conditionId: CONDITION, negRisk, tokenIds: [YES, NO] });
      expect(call?.target).toBe(adapter);
      expect(decodeFunctionData({ abi: redeemAbi, data: call!.data }).args).toEqual([POLYMARKET_CONTRACTS.pusd, ZERO_BYTES32, CONDITION, [1n, 2n]]);
    }
  });

  it("redeems each held outcome of a protocol v2 market through the router", async () => {
    const prefix = "11".repeat(19);
    const v2Yes = BigInt(`0x${prefix}${"0".repeat(16)}2222222200`).toString();
    const v2No = BigInt(`0x${prefix}${"0".repeat(16)}2222222201`).toString();
    const balances = parseAbi(["function balanceOfBatch(address[] accounts, uint256[] ids) view returns (uint256[])"]);
    const fetcher = rpc(encodeFunctionResult({ abi: balances, functionName: "balanceOfBatch", result: [0n, 7_000_000n] }));
    const calls = await redeemCalls({ wallet, conditionId: CONDITION, negRisk: false, tokenIds: [v2Yes, v2No] }, { fetcher });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.target).toBe(POLYMARKET_CONTRACTS.protocolV2Router);
    expect(decodeFunctionData({ abi: routerAbi, data: calls[0]!.data }).args).toEqual([`0x${prefix}${"0".repeat(16)}22222222`, 1n, 7_000_000n]);
    const empty = rpc(encodeFunctionResult({ abi: balances, functionName: "balanceOfBatch", result: [0n, 0n] }));
    await expect(redeemCalls({ wallet, conditionId: CONDITION, negRisk: false, tokenIds: [v2Yes, v2No] }, { fetcher: empty })).rejects.toMatchObject({ code: "nothing_to_redeem" });
  });

  it("refuses unknown markets", async () => {
    await expect(redeemCalls({ wallet, conditionId: "0x12", negRisk: false, tokenIds: [YES, NO] })).rejects.toBeInstanceOf(VenueError);
  });
});
