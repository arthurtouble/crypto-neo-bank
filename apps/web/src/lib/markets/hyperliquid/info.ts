import { decodeFunctionResult, encodeFunctionData, formatUnits, isAddress, parseAbi } from "viem";
import { z } from "zod";
import { readBoundedJson } from "@/lib/http/bounded";
import { localEdgeUrl } from "@/lib/testing/local-edge";
import { VenueError } from "../types";

/**
 * Read-only Hyperliquid info reads. Hyperliquid is the venue of record: every
 * balance, position, and order here is read fresh and handed back as plain data
 * for the caller to wrap in `Observed<T>`. Nothing read here is stored as proof.
 */

const MAINNET_API_URL = "https://api.hyperliquid.xyz";

/** Mainnet, unless e2e points `HYPERLIQUID_API_URL` at a loopback fake. */
export function hyperliquidApiUrl(): string {
  return localEdgeUrl("HYPERLIQUID_API_URL") ?? MAINNET_API_URL;
}

export type InfoOptions = { fetcher?: typeof fetch };

/**
 * Circle's CoreDepositWallet on HyperEVM. It credits CCTP deposits to HyperCore
 * (they appear as a `send` from this address) and burns USDC withdrawn through
 * `sendToEvmWithData`.
 */
export const CORE_DEPOSIT_WALLET = "0x6B9E773128f453f5c2C60935Ee2DE2CBc5390A24";

const decimal = z.string().regex(/^-?\d+(\.\d+)?$/);
const address = z.string().regex(/^0x[\da-fA-F]{40}$/).transform((value) => value.toLowerCase() as `0x${string}`);
const txHash = z.string().regex(/^0x[\da-fA-F]{64}$/);
const timeMs = z.number().int().nonnegative();

async function postInfo<S extends z.ZodType>(body: Record<string, unknown>, schema: S, maxBytes: number,
  options: InfoOptions): Promise<z.output<S>> {
  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(`${hyperliquidApiUrl()}/info`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8_000),
      cache: "no-store"
    });
  } catch {
    throw new VenueError("hyperliquid", "unavailable", "Hyperliquid did not answer.", 503);
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    if (response.status === 429) throw new VenueError("hyperliquid", "rate_limited", "Hyperliquid is busy. Try again shortly.", 503);
    throw new VenueError("hyperliquid", "unavailable", `Hyperliquid answered HTTP ${response.status}.`, 503);
  }
  const json = await readBoundedJson(response, maxBytes).catch(() => {
    throw new VenueError("hyperliquid", "invalid_response", "Hyperliquid sent an unreadable answer.");
  });
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new VenueError("hyperliquid", "invalid_response", "Hyperliquid sent an unexpected answer.");
  return parsed.data;
}

function userAddress(user: string): `0x${string}` {
  if (!isAddress(user, { strict: false })) throw new VenueError("hyperliquid", "invalid_address", "That address is not valid.", 400);
  return user.toLowerCase() as `0x${string}`;
}

// ---------------------------------------------------------------- markets

/** "" is Hyperliquid's own (validator-operated) perp dex; other names are HIP-3 builder-deployed dexes such as "xyz". */
export type PerpDex = { name: string; index: number };

export type PerpMarket = {
  /** Hyperliquid's name. HIP-3 coins carry their dex as a prefix, e.g. "xyz:SPCX". */
  coin: string;
  dex: string;
  /**
   * The `a` in order actions: the position in the dex's universe (delisted assets
   * included) on the main dex, and 100000 + dexIndex × 10000 + position on a HIP-3 dex.
   */
  assetIndex: number;
  szDecimals: number;
  maxLeverage: number;
  /** True when the market does not allow cross margin. */
  onlyIsolated?: true;
  markPx: string;
  /** Null when the book is one-sided or empty. */
  midPx: string | null;
  oraclePx: string;
  prevDayPx: string;
  dayNtlVlm: string;
  funding: string;
  openInterest: string;
};

const universeAsset = z.object({
  name: z.string().min(1).max(60),
  szDecimals: z.number().int().min(0).max(6),
  maxLeverage: z.number().int().positive(),
  onlyIsolated: z.boolean().optional(),
  isDelisted: z.boolean().optional(),
  marginMode: z.string().max(40).optional()
});
const assetCtx = z.object({
  markPx: decimal,
  midPx: decimal.nullable().optional(),
  oraclePx: decimal,
  prevDayPx: decimal,
  dayNtlVlm: decimal,
  funding: decimal,
  openInterest: decimal
});
const metaAndAssetCtxs = z.tuple([z.object({ universe: z.array(universeAsset).max(2_000) }), z.array(assetCtx).max(2_000)])
  .refine(([meta, ctxs]) => meta.universe.length === ctxs.length);
const allPerpMetasSchema = z.array(z.object({
  universe: z.array(universeAsset).max(2_000),
  collateralToken: z.number().int().nonnegative()
})).min(1).max(1_000);

/** USDC's HyperCore token index. Aura only lists dexes margined in USDC, the one balance it deposits and withdraws. */
const USDC_TOKEN = 0;
const DEX_NAME = /^[a-z0-9]{1,12}$/;
/** Aura does not offer sports markets. HIP-3 dexes are permissionless, so screen dex and market names. */
const SPORTS = /sport|\bnfl|\bnba|\bmlb|\bnhl|ncaa|soccer|football|fifa|\bufc|tennis|cricket|olympic|superbowl|worldcup/i;

/** HIP-3 asset ids: 100000 + dex index × 10000 + index in that dex's universe. */
export function perpAssetId(dexIndex: number, indexInDex: number): number {
  if (!Number.isInteger(dexIndex) || dexIndex < 0 || !Number.isInteger(indexInDex) || indexInDex < 0 || indexInDex >= 10_000) {
    throw new VenueError("hyperliquid", "invalid_request", "The market is not valid.", 400);
  }
  return dexIndex === 0 ? indexInDex : 100_000 + dexIndex * 10_000 + indexInDex;
}

/**
 * The perp dexes Aura lists: the main dex and every HIP-3 dex that is margined
 * in USDC, still has a market, and is not a sports dex. One `allPerpMetas`
 * read (weight 20); its order is the dex index used in asset ids.
 */
export async function perpDexs(options: InfoOptions = {}): Promise<PerpDex[]> {
  const metas = await postInfo({ type: "allPerpMetas" }, allPerpMetasSchema, 2_000_000, options);
  const dexes: PerpDex[] = [];
  metas.forEach((meta, index) => {
    if (index === 0) { dexes.push({ name: "", index }); return; }
    const name = meta.universe[0]?.name.split(":")[0] ?? "";
    if (!DEX_NAME.test(name) || SPORTS.test(name) || meta.collateralToken !== USDC_TOKEN) return;
    if (meta.universe.some((asset) => !asset.isDelisted && asset.name.startsWith(`${name}:`))) dexes.push({ name, index });
  });
  return dexes;
}

function dexMarkets(dex: PerpDex, [meta, ctxs]: z.output<typeof metaAndAssetCtxs>): PerpMarket[] {
  const markets: PerpMarket[] = [];
  meta.universe.forEach((asset, position) => {
    if (asset.isDelisted || SPORTS.test(asset.name)) return;
    // A HIP-3 coin must carry its own dex's prefix; anything else is not what we asked for.
    if (dex.name ? !asset.name.startsWith(`${dex.name}:`) : asset.name.includes(":")) return;
    const ctx = ctxs[position];
    const isolatedOnly = asset.onlyIsolated === true || asset.marginMode === "strictIsolated" || asset.marginMode === "noCross";
    markets.push({
      coin: asset.name, dex: dex.name, assetIndex: perpAssetId(dex.index, position), szDecimals: asset.szDecimals,
      maxLeverage: asset.maxLeverage, ...(isolatedOnly ? { onlyIsolated: true as const } : {}),
      markPx: ctx.markPx, midPx: ctx.midPx ?? null, oraclePx: ctx.oraclePx, prevDayPx: ctx.prevDayPx,
      dayNtlVlm: ctx.dayNtlVlm, funding: ctx.funding, openInterest: ctx.openInterest
    });
  });
  return markets;
}

/**
 * Perps that can still be traded. `dexes: "main"` reads only Hyperliquid's own
 * dex (one weight-20 read); the default also lists HIP-3 dexes from
 * `perpDexs` (one more weight-20 read per dex, against Hyperliquid's 1,200 per
 * minute per IP), so callers should cache the answer for a few seconds.
 */
export async function perpMarkets(options: InfoOptions & { dexes?: "main" | "all" | PerpDex[] } = {}): Promise<PerpMarket[]> {
  const dexes = options.dexes === "main" ? [{ name: "", index: 0 }]
    : Array.isArray(options.dexes) ? options.dexes : await perpDexs(options);
  const answers = await Promise.all(dexes.map((dex) =>
    postInfo(dex.name ? { type: "metaAndAssetCtxs", dex: dex.name } : { type: "metaAndAssetCtxs" }, metaAndAssetCtxs, 1_000_000, options)));
  return dexes.flatMap((dex, index) => dexMarkets(dex, answers[index]));
}

const allMidsSchema = z.record(z.string(), decimal);

/** Mid prices by coin for one dex (main by default; spot pairs appear as `@index` keys there). */
export async function allMids(options: InfoOptions & { dex?: string } = {}): Promise<Record<string, string>> {
  return postInfo(options.dex ? { type: "allMids", dex: dexName(options.dex) } : { type: "allMids" }, allMidsSchema, 500_000, options);
}

function dexName(dex: string): string {
  if (dex !== "" && !DEX_NAME.test(dex)) throw new VenueError("hyperliquid", "invalid_request", "The market is not valid.", 400);
  return dex;
}

// ---------------------------------------------------------------- account

export type PerpPosition = {
  coin: string;
  /** Signed: positive is long, negative is short. */
  size: string;
  entryPx: string;
  positionValue: string;
  unrealizedPnl: string;
  returnOnEquity: string;
  liquidationPx: string | null;
  leverage: { type: "cross" | "isolated"; value: number };
  marginUsed: string;
};

/**
 * One dex's margin account. In Hyperliquid's standard account mode each dex has
 * its own USDC balance and cross margin; see `userAbstraction`.
 */
export type PerpAccountState = {
  dex: string;
  accountValue: string;
  totalMarginUsed: string;
  withdrawable: string;
  /** Inputs to the cross liquidation price (see `crossLiquidationPrice`). */
  crossAccountValue: string;
  crossMaintenanceMarginUsed: string;
  positions: PerpPosition[];
  /** Hyperliquid's own timestamp for the snapshot, in ms. */
  time: number;
};

const clearinghouseState = z.object({
  marginSummary: z.object({ accountValue: decimal, totalMarginUsed: decimal }),
  crossMarginSummary: z.object({ accountValue: decimal }),
  crossMaintenanceMarginUsed: decimal,
  withdrawable: decimal,
  time: timeMs,
  assetPositions: z.array(z.object({
    position: z.object({
      coin: z.string().min(1).max(60),
      szi: decimal,
      entryPx: decimal,
      positionValue: decimal,
      unrealizedPnl: decimal,
      returnOnEquity: decimal,
      liquidationPx: decimal.nullable(),
      leverage: z.object({ type: z.enum(["cross", "isolated"]), value: z.number().int().positive() }),
      marginUsed: decimal
    })
  })).max(1_000)
});

/** One dex's account (weight 2). `dex` defaults to the main dex. */
export async function accountState(user: string, options: InfoOptions & { dex?: string } = {}): Promise<PerpAccountState> {
  const dex = dexName(options.dex ?? "");
  const body = dex ? { type: "clearinghouseState", user: userAddress(user), dex } : { type: "clearinghouseState", user: userAddress(user) };
  const state = await postInfo(body, clearinghouseState, 500_000, options);
  return {
    dex,
    accountValue: state.marginSummary.accountValue,
    totalMarginUsed: state.marginSummary.totalMarginUsed,
    withdrawable: state.withdrawable,
    crossAccountValue: state.crossMarginSummary.accountValue,
    crossMaintenanceMarginUsed: state.crossMaintenanceMarginUsed,
    time: state.time,
    positions: state.assetPositions.map(({ position }) => ({
      coin: position.coin, size: position.szi, entryPx: position.entryPx, positionValue: position.positionValue,
      unrealizedPnl: position.unrealizedPnl, returnOnEquity: position.returnOnEquity,
      liquidationPx: position.liquidationPx, leverage: position.leverage, marginUsed: position.marginUsed
    }))
  };
}

/** Every listed dex's account, main first. Cheap: weight 2 per dex. */
export async function accountStates(user: string, dexes: PerpDex[], options: InfoOptions = {}): Promise<PerpAccountState[]> {
  return Promise.all(dexes.map((dex) => accountState(user, { ...options, dex: dex.name })));
}

export type OpenOrder = {
  coin: string;
  side: "buy" | "sell";
  limitPx: string;
  size: string;
  origSize: string;
  oid: number;
  timestamp: number;
  orderType: string;
  reduceOnly: boolean;
  isTrigger: boolean;
  triggerPx: string;
  /** Take-profit or stop-loss attached to a whole position. */
  isPositionTpsl: boolean;
  tif: string | null;
};

const openOrdersSchema = z.array(z.object({
  coin: z.string().min(1).max(60),
  side: z.enum(["A", "B"]),
  limitPx: decimal,
  sz: decimal,
  origSz: decimal,
  oid: z.number().int().nonnegative(),
  timestamp: timeMs,
  orderType: z.string().max(40),
  reduceOnly: z.boolean(),
  isTrigger: z.boolean(),
  triggerPx: decimal,
  isPositionTpsl: z.boolean().optional(),
  tif: z.string().max(20).nullable().optional()
})).max(2_000);

/** One dex's open orders, trigger orders included (weight 20). `dex` defaults to the main dex. */
export async function openOrders(user: string, options: InfoOptions & { dex?: string } = {}): Promise<OpenOrder[]> {
  const dex = dexName(options.dex ?? "");
  const body = dex ? { type: "frontendOpenOrders", user: userAddress(user), dex } : { type: "frontendOpenOrders", user: userAddress(user) };
  const orders = await postInfo(body, openOrdersSchema, 1_000_000, options);
  return orders.map((order) => ({
    coin: order.coin, side: order.side === "B" ? "buy" : "sell", limitPx: order.limitPx, size: order.sz,
    origSize: order.origSz, oid: order.oid, timestamp: order.timestamp, orderType: order.orderType,
    reduceOnly: order.reduceOnly, isTrigger: order.isTrigger, triggerPx: order.triggerPx,
    isPositionTpsl: order.isPositionTpsl ?? false, tif: order.tif ?? null
  }));
}

export type AccountAbstraction = "standard" | "unifiedAccount" | "portfolioMargin" | "dexAbstraction" | "default";
const abstractionSchema = z.enum(["disabled", "unifiedAccount", "portfolioMargin", "dexAbstraction", "default"]);

/**
 * How the account's balances combine. "standard" (Hyperliquid's "disabled"):
 * every dex has its own USDC balance, so HIP-3 margin must be moved there first
 * (`buildAgentSendAssetAction`). "unifiedAccount" / "portfolioMargin": one
 * balance, reported in the spot state, and per-dex account values stop being
 * meaningful. "default" is what Hyperliquid reports for an account that never
 * chose; Aura sets the mode explicitly at setup rather than relying on it.
 */
export async function userAbstraction(user: string, options: InfoOptions = {}): Promise<AccountAbstraction> {
  const mode = await postInfo({ type: "userAbstraction", user: userAddress(user) }, abstractionSchema, 1_000, options);
  return mode === "disabled" ? "standard" : mode;
}

export type ExtraAgent = { name: string; address: `0x${string}`; validUntil: number };

const extraAgentsSchema = z.array(z.object({ name: z.string().max(80), address, validUntil: timeMs })).max(200);

/** Named API wallets the user has approved. The unnamed agent slot is not listed here. */
export async function extraAgents(user: string, options: InfoOptions = {}): Promise<ExtraAgent[]> {
  return postInfo({ type: "extraAgents", user: userAddress(user) }, extraAgentsSchema, 100_000, options);
}

// ---------------------------------------------------------------- history

export type LedgerTransfer = {
  kind: "deposit" | "withdraw";
  /**
   * "bridge": Hyperliquid's own Arbitrum bridge (`deposit` / `withdraw3`).
   * "cctp": Circle's CCTP through the CoreDepositWallet, which credits HyperCore
   * as a `send` from that contract's address (see `cctp.ts`).
   */
  route: "bridge" | "cctp";
  usdc: string;
  /** Hyperliquid's fee for the entry; zero for deposits. */
  fee: string;
  /** "" for the main perp balance, "spot", or a HIP-3 dex name. */
  dex: string;
  /** HyperCore's hash for the ledger entry. It is not the source chain's transaction hash. */
  hash: string;
  time: number;
};

const ledgerSchema = z.array(z.object({
  time: timeMs,
  hash: txHash,
  delta: z.object({ type: z.string().max(60) }).passthrough()
})).max(5_000);
const depositDelta = z.object({ type: z.literal("deposit"), usdc: decimal });
const withdrawDelta = z.object({ type: z.literal("withdraw"), usdc: decimal, fee: decimal.optional() });
const sendDelta = z.object({
  type: z.literal("send"), user: address, destination: address, sourceDex: z.string().max(20),
  destinationDex: z.string().max(20), token: z.string().max(40), amount: decimal, fee: decimal.optional()
});

/**
 * Deposits and withdrawals since `startTime` (ms), through either Hyperliquid's
 * Arbitrum bridge or Circle's CCTP. Other entries (moves between the
 * customer's own dexes, vault and staking transfers) are dropped. Hyperliquid
 * returns at most 2,000 entries per call; page by advancing `startTime`.
 */
export async function nonFundingLedgerUpdates(user: string, startTime: number,
  options: InfoOptions = {}): Promise<LedgerTransfer[]> {
  if (!Number.isSafeInteger(startTime) || startTime < 0) {
    throw new VenueError("hyperliquid", "invalid_request", "The start time is not valid.", 400);
  }
  const owner = userAddress(user);
  const coreDepositWallet = CORE_DEPOSIT_WALLET.toLowerCase();
  const updates = await postInfo({ type: "userNonFundingLedgerUpdates", user: owner, startTime },
    ledgerSchema, 2_000_000, options);
  const transfers: LedgerTransfer[] = [];
  for (const update of updates) {
    const entry = { hash: update.hash, time: update.time };
    const deposit = depositDelta.safeParse(update.delta);
    if (deposit.success) {
      transfers.push({ kind: "deposit", route: "bridge", usdc: deposit.data.usdc, fee: "0", dex: "", ...entry });
      continue;
    }
    const withdraw = withdrawDelta.safeParse(update.delta);
    if (withdraw.success) {
      transfers.push({ kind: "withdraw", route: "bridge", usdc: withdraw.data.usdc, fee: withdraw.data.fee ?? "0", dex: "", ...entry });
      continue;
    }
    const send = sendDelta.safeParse(update.delta);
    if (!send.success || send.data.token !== "USDC") continue;
    if (send.data.user === coreDepositWallet && send.data.destination === owner) {
      transfers.push({ kind: "deposit", route: "cctp", usdc: send.data.amount, fee: "0", dex: send.data.destinationDex, ...entry });
    } else if (send.data.user === owner && send.data.destination === coreDepositWallet) {
      // Assumed shape of a `sendToEvmWithData` withdrawal; not yet seen on a real account.
      transfers.push({ kind: "withdraw", route: "cctp", usdc: send.data.amount, fee: send.data.fee ?? "0",
        dex: send.data.sourceDex, ...entry });
    }
  }
  return transfers;
}

export type Fill = {
  coin: string;
  px: string;
  size: string;
  side: "buy" | "sell";
  time: number;
  /** Hyperliquid's label, e.g. "Open Long" or "Close Short". */
  dir: string;
  closedPnl: string;
  fee: string;
  feeToken: string;
  oid: number;
  tid: number;
  hash: string;
};

const fillsSchema = z.array(z.object({
  coin: z.string().min(1).max(60),
  px: decimal,
  sz: decimal,
  side: z.enum(["A", "B"]),
  time: timeMs,
  dir: z.string().max(60),
  closedPnl: decimal,
  fee: decimal,
  feeToken: z.string().max(20),
  oid: z.number().int().nonnegative(),
  tid: z.number().int().nonnegative(),
  hash: txHash
})).max(2_000);

/** Most recent fills first; Hyperliquid returns up to 2,000, trimmed here to `limit`. */
export async function userFills(user: string, options: InfoOptions & { limit?: number } = {}): Promise<Fill[]> {
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 100), 1), 2_000);
  const fills = await postInfo({ type: "userFills", user: userAddress(user) }, fillsSchema, 2_000_000, options);
  return fills.slice(0, limit).map((fill) => ({
    coin: fill.coin, px: fill.px, size: fill.sz, side: fill.side === "B" ? "buy" : "sell", time: fill.time,
    dir: fill.dir, closedPnl: fill.closedPnl, fee: fill.fee, feeToken: fill.feeToken, oid: fill.oid,
    tid: fill.tid, hash: fill.hash
  }));
}

// ---------------------------------------------------------------- CCTP withdrawal fee

const HYPEREVM_RPC_URL = "https://rpc.hyperliquid.xyz/evm";
const coreDepositWalletAbi = parseAbi(["function cctpForwardFees(uint32 domain) view returns (uint256)"]);
const rpcResult = z.object({ result: z.string().regex(/^0x[\da-fA-F]*$/) });

/**
 * The fixed CCTP forwarding fee (USDC, decimal string) Circle takes from a
 * `sendToEvmWithData` withdrawal to `domain` when forwarding is on (empty hook
 * data). A withdrawal smaller than this reverts on HyperEVM. Hyperliquid's own
 * fee for the action comes on top. Read from the contract, which Circle can change.
 */
export async function cctpForwardFee(domain: number, options: InfoOptions = {}): Promise<string> {
  if (!Number.isInteger(domain) || domain < 0 || domain > 0xffff_ffff) {
    throw new VenueError("hyperliquid", "invalid_request", "The destination is not valid.", 400);
  }
  const data = encodeFunctionData({ abi: coreDepositWalletAbi, functionName: "cctpForwardFees", args: [domain] });
  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(localEdgeUrl("HYPEREVM_RPC_URL") ?? HYPEREVM_RPC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: CORE_DEPOSIT_WALLET, data }, "latest"] }),
      signal: AbortSignal.timeout(8_000),
      cache: "no-store"
    });
  } catch {
    throw new VenueError("hyperliquid", "unavailable", "HyperEVM did not answer.", 503);
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new VenueError("hyperliquid", "unavailable", `HyperEVM answered HTTP ${response.status}.`, 503);
  }
  const parsed = rpcResult.safeParse(await readBoundedJson(response, 10_000).catch(() => null));
  if (!parsed.success) throw new VenueError("hyperliquid", "invalid_response", "HyperEVM sent an unexpected answer.");
  try {
    const fee = decodeFunctionResult({ abi: coreDepositWalletAbi, functionName: "cctpForwardFees",
      data: parsed.data.result as `0x${string}` });
    return formatUnits(fee, 6);
  } catch {
    throw new VenueError("hyperliquid", "invalid_response", "HyperEVM sent an unexpected answer.");
  }
}
