import { decodeFunctionResult, encodeFunctionData, erc20Abi, formatUnits, getAddress, isAddress, type Hex } from "viem";
import { z } from "zod";
import { VenueError } from "../types";
import type { WalletCall } from "./account";
import { ethCall, type ChainOptions } from "./chain";
import { POLYMARKET_CONTRACTS, ZERO_BYTES32, numeric, polymarketRequest, type RequestOptions } from "./http";

/**
 * What the customer's Deposit Wallet holds: positions and activity from
 * Polymarket's Data API (an index, shown with where it came from), and the
 * pUSD balance from Polygon itself. Redemption builds wallet calls only; the
 * owner signs them as a batch like any other wallet action.
 */

export const PUSD_DECIMALS = 6;

const walletAddress = (wallet: string) => {
  if (!isAddress(wallet, { strict: false })) throw new VenueError("polymarket", "invalid_request", "Invalid wallet address.", 400);
  return getAddress(wallet);
};

/** pUSD in the wallet, read from Polygon. */
export async function pusdBalance(wallet: string, options: ChainOptions = {}): Promise<{ raw: string; amount: string }> {
  const data = await ethCall(POLYMARKET_CONTRACTS.pusd, encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [walletAddress(wallet)] }), options);
  let raw: bigint;
  try { raw = decodeFunctionResult({ abi: erc20Abi, functionName: "balanceOf", data }); } catch {
    throw new VenueError("polymarket", "chain_unavailable", "Polygon sent an unexpected answer.", 503);
  }
  return { raw: raw.toString(), amount: formatUnits(raw, PUSD_DECIMALS) };
}

export type Position = {
  tokenId: string;
  oppositeTokenId: string | null;
  conditionId: `0x${string}`;
  title: string;
  slug: string | null;
  eventSlug: string | null;
  icon: string | null;
  outcome: string;
  outcomeIndex: number;
  /** Shares held. */
  size: number;
  avgPrice: number;
  currentPrice: number;
  /** pUSD, at the current price. */
  value: number;
  /** pUSD paid, excluding fees. */
  cost: number;
  pnl: number;
  percentPnl: number;
  realizedPnl: number | null;
  redeemable: boolean;
  negRisk: boolean;
  endDate: string | null;
};

const tokenId = z.string().regex(/^\d{1,78}$/);
const conditionId = z.string().regex(/^0x[\da-fA-F]{64}$/).transform((value) => value.toLowerCase() as `0x${string}`);
const optional = z.string().max(2_000).nullish().transform((value) => value || null);
const positionSchema = z.object({
  token_id: tokenId,
  opposite_token_id: tokenId.nullish(),
  condition_id: conditionId,
  title: z.string().max(2_000),
  slug: optional,
  event_slug: optional,
  icon: optional,
  outcome: z.string().max(300),
  outcome_index: z.number().int(),
  current_size: numeric,
  avg_price: numeric,
  current_price: numeric,
  current_value: numeric,
  entry_cost_usdc: numeric,
  total_pnl: numeric,
  percent_pnl: numeric.nullish(),
  realized_pnl: numeric.nullish(),
  redeemable: z.boolean(),
  negative_risk: z.boolean().nullish(),
  end_date: optional
});
const page = z.object({ data: z.array(z.unknown()).max(500), pagination: z.object({ has_more: z.boolean().optional(), next_cursor: z.string().max(2_000).nullish() }).nullish() });
const cursorPattern = /^[\w=-]{1,2000}$/;

/** Open positions (or closed ones) of a wallet, largest first per the Data API, one page at a time. */
export async function positions(wallet: string, input: { status?: "OPEN" | "CLOSED"; limit?: number; cursor?: string } = {}, options: RequestOptions = {}): Promise<{ positions: Position[]; nextCursor: string | null }> {
  if (input.cursor !== undefined && !cursorPattern.test(input.cursor)) throw new VenueError("polymarket", "invalid_request", "Invalid page.", 400);
  const result = await polymarketRequest({
    service: "data", path: "/v2/positions",
    query: { user: walletAddress(wallet), status: input.status ?? "OPEN", limit: Math.min(Math.max(Math.trunc(input.limit ?? 50), 1), 100), cursor: input.cursor },
    schema: page, maxBytes: 2_000_000, fetcher: options.fetcher
  });
  return {
    positions: result.data.map((raw) => {
      const parsed = positionSchema.safeParse(raw);
      if (!parsed.success) throw new VenueError("polymarket", "invalid_response", "Polymarket sent an unexpected position.");
      const item = parsed.data;
      return {
        tokenId: item.token_id, oppositeTokenId: item.opposite_token_id ?? null, conditionId: item.condition_id, title: item.title,
        slug: item.slug, eventSlug: item.event_slug, icon: item.icon, outcome: item.outcome, outcomeIndex: item.outcome_index,
        size: item.current_size, avgPrice: item.avg_price, currentPrice: item.current_price, value: item.current_value,
        cost: item.entry_cost_usdc, pnl: item.total_pnl, percentPnl: item.percent_pnl ?? 0, realizedPnl: item.realized_pnl ?? null,
        redeemable: item.redeemable, negRisk: item.negative_risk === true, endDate: item.end_date
      };
    }),
    nextCursor: result.pagination?.has_more === false ? null : result.pagination?.next_cursor || null
  };
}

/**
 * Positions in resolved markets that can be redeemed now, across every page
 * of the wallet's positions (at most 10 pages of 100). Pass each to
 * `redeemCalls` and have the owner sign the calls as a batch.
 */
export async function redeemablePositions(wallet: string, options: RequestOptions = {}): Promise<Position[]> {
  const found: Position[] = [];
  let cursor: string | undefined;
  for (let pageIndex = 0; pageIndex < 10; pageIndex += 1) {
    const result = await positions(wallet, { status: "OPEN", limit: 100, cursor }, options);
    found.push(...result.positions.filter((item) => item.redeemable && item.size > 0));
    if (!result.nextCursor) break;
    cursor = result.nextCursor;
  }
  return found;
}

export type Activity = {
  type: string;
  timestamp: number;
  transactionHash: `0x${string}` | null;
  conditionId: string | null;
  tokenId: string | null;
  side: "BUY" | "SELL" | null;
  title: string | null;
  outcome: string | null;
  /** Shares. */
  size: number | null;
  /** pUSD. */
  usdcSize: number | null;
  price: number | null;
};

const activitySchema = z.object({
  type: z.string().max(40),
  timestamp: z.number().int().nonnegative(),
  transaction_hash: z.string().regex(/^0x[\da-fA-F]{64}$/).nullish().or(z.literal("")),
  condition_id: z.string().max(80).nullish(),
  token_id: z.string().max(80).nullish(),
  side: z.enum(["BUY", "SELL", ""]).nullish(),
  title: optional,
  outcome: optional,
  size: numeric.nullish(),
  usdc_size: numeric.nullish(),
  price: numeric.nullish()
});

/** Recent wallet activity (trades, redemptions, deposits, withdrawals), newest first. */
export async function activity(wallet: string, input: { limit?: number; cursor?: string } = {}, options: RequestOptions = {}): Promise<{ activity: Activity[]; nextCursor: string | null }> {
  if (input.cursor !== undefined && !cursorPattern.test(input.cursor)) throw new VenueError("polymarket", "invalid_request", "Invalid page.", 400);
  const result = await polymarketRequest({
    service: "data", path: "/v2/activity",
    query: { user: walletAddress(wallet), limit: Math.min(Math.max(Math.trunc(input.limit ?? 25), 1), 100), cursor: input.cursor, exclude_deposits_withdrawals: false },
    schema: page, maxBytes: 2_000_000, fetcher: options.fetcher
  });
  return {
    activity: result.data.map((raw) => {
      const parsed = activitySchema.safeParse(raw);
      if (!parsed.success) throw new VenueError("polymarket", "invalid_response", "Polymarket sent unexpected activity.");
      const item = parsed.data;
      return {
        type: item.type, timestamp: item.timestamp, transactionHash: (item.transaction_hash || null) as `0x${string}` | null,
        conditionId: item.condition_id || null, tokenId: item.token_id || null, side: item.side || null, title: item.title, outcome: item.outcome,
        size: item.size ?? null, usdcSize: item.usdc_size ?? null, price: item.price ?? null
      };
    }),
    nextCursor: result.pagination?.has_more === false ? null : result.pagination?.next_cursor || null
  };
}

const redeemPositionsAbi = [{
  type: "function", name: "redeemPositions", stateMutability: "nonpayable", outputs: [],
  inputs: [{ name: "collateralToken", type: "address" }, { name: "parentCollectionId", type: "bytes32" }, { name: "conditionId", type: "bytes32" }, { name: "indexSets", type: "uint256[]" }]
}] as const;
const routerRedeemAbi = [{
  type: "function", name: "redeem", stateMutability: "nonpayable", outputs: [],
  inputs: [{ name: "conditionId", type: "bytes31" }, { name: "outcomeIndex", type: "uint256" }, { name: "amount", type: "uint256" }]
}] as const;
const balanceOfBatchAbi = [{
  type: "function", name: "balanceOfBatch", stateMutability: "view", outputs: [{ type: "uint256[]" }],
  inputs: [{ name: "accounts", type: "address[]" }, { name: "ids", type: "uint256[]" }]
}] as const;

const V2_RESERVED_BITS = ((1n << 64n) - 1n) << 40n;

/**
 * The calls that redeem a resolved market's outcome tokens to pUSD, as the
 * SDK builds them. A CTF market redeems both index sets through the pUSD
 * collateral adapter (the neg-risk one for neg-risk markets). A protocol v2
 * market redeems each held outcome through the v2 router, with balances read
 * from the position manager. Check `redeemable` first; an unresolved market
 * reverts on chain.
 */
export async function redeemCalls(input: { wallet: string; conditionId: string; negRisk: boolean; tokenIds: [string, string] }, options: ChainOptions = {}): Promise<WalletCall[]> {
  const wallet = walletAddress(input.wallet);
  if (!/^0x[\da-fA-F]{64}$/.test(input.conditionId) || !input.tokenIds.every((id) => /^\d{1,78}$/.test(id))) {
    throw new VenueError("polymarket", "invalid_request", "Unknown market.", 400);
  }
  const ids = input.tokenIds.map(BigInt);
  const v2 = ids.map((id) => (id & V2_RESERVED_BITS) === 0n);
  if (v2[0] !== v2[1]) throw new VenueError("polymarket", "invalid_request", "Unknown market.", 400);
  if (!v2[0]) {
    const adapter = input.negRisk ? POLYMARKET_CONTRACTS.negRiskCollateralAdapter : POLYMARKET_CONTRACTS.collateralAdapter;
    return [{
      target: adapter, value: "0",
      data: encodeFunctionData({ abi: redeemPositionsAbi, functionName: "redeemPositions", args: [POLYMARKET_CONTRACTS.pusd, ZERO_BYTES32, input.conditionId as Hex, [1n, 2n]] })
    }];
  }
  const data = await ethCall(POLYMARKET_CONTRACTS.positionManager, encodeFunctionData({ abi: balanceOfBatchAbi, functionName: "balanceOfBatch", args: [[wallet, wallet], ids] }), options);
  let balances: readonly bigint[];
  try { balances = decodeFunctionResult({ abi: balanceOfBatchAbi, functionName: "balanceOfBatch", data }); } catch {
    throw new VenueError("polymarket", "chain_unavailable", "Polygon sent an unexpected answer.", 503);
  }
  const calls = ids.flatMap((id, index) => {
    const balance = balances[index] ?? 0n;
    if (balance === 0n) return [];
    const hex = id.toString(16).padStart(64, "0");
    const outcomeIndex = BigInt(Number.parseInt(hex.slice(-2), 16));
    if (outcomeIndex > 1n) throw new VenueError("polymarket", "invalid_request", "Unknown market.", 400);
    return [{
      target: POLYMARKET_CONTRACTS.protocolV2Router, value: "0",
      data: encodeFunctionData({ abi: routerRedeemAbi, functionName: "redeem", args: [`0x${hex.slice(0, -2)}`, outcomeIndex, balance] })
    }];
  });
  if (calls.length === 0) throw new VenueError("polymarket", "nothing_to_redeem", "There is nothing to redeem in this market.", 409);
  return calls;
}
