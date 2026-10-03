import type { PrivyClient } from "@privy-io/node";
import { parseUnits } from "viem";
import type { ActionAccount } from "@/lib/auth/wallet";
import { privyClient } from "@/lib/auth/privy";
import { HttpError } from "@/lib/http/errors";
import { markAccountReady, readMarketAccount, recordOperation, savePendingAccount, type MarketAccount } from "./accounts";
import {
  accountState, accountStates, approveAgentAction, buildAgentSendAssetAction, buildAgentSetAbstractionAction, buildCancelAction, buildCloseAction, buildOrderAction, buildPositionTpslAction, buildUpdateLeverageAction, crossLiquidationPrice, extraAgents,
  isolatedLiquidationPrice, sizeFromMargin,
  l1ActionTypedData, openOrders, perpDexs, perpMarkets, sendToEvmWithDataAction, submitExchange, userFills,
  type ApproveAgentAction, type ExchangeResult, type L1Action, type OpenOrder, type PerpAccountState, type PerpMarket, type SendToEvmWithDataAction, type TriggerSpec
} from "./hyperliquid";
import { completeMarketSignature, createMarketSignature, type MarketSignatureRequest } from "./signing";
import { createTradingKey, signWithTradingKey } from "./trading-key";
import { VenueError, type Observed } from "./types";

/**
 * Perps on Hyperliquid, through the customer's own wallet. The wallet owns
 * the Hyperliquid account; it approves Aura's trading key for it once, with
 * its passkey, and signs every withdrawal. The trading key signs orders,
 * cancels, and leverage changes, and Hyperliquid never lets it move money.
 */
export type PerpsDependencies = { privy?: PrivyClient; fetcher?: typeof fetch; now?: () => Date };

const AGENT_NAME = "Aura";
let lastNonce = 0;
/** Hyperliquid refuses a nonce a signer already used; several actions in one request get rising ones. */
const nextNonce = (now: Date) => (lastNonce = Math.max(now.getTime(), lastNonce + 1));
const options = (deps: PerpsDependencies) => ({ fetcher: deps.fetcher });
const clock = (deps: PerpsDependencies) => deps.now?.() ?? new Date();

async function observe<T>(read: () => Promise<T>, now: Date): Promise<Observed<T>> {
  try { return { status: "observed", source: "hyperliquid", observedAt: now.toISOString(), data: await read() }; }
  catch (error) {
    return { status: "unavailable", source: "hyperliquid", observedAt: now.toISOString(),
      reason: error instanceof VenueError ? error.code : "hyperliquid_unavailable" };
  }
}

let cachedMarkets: { at: number; value: Observed<PerpMarket[]> } | null = null;
const MARKETS_TTL_MS = 5_000;

/**
 * Every perp market Hyperliquid lists, stock markets (HIP-3 dexes) included,
 * with its prices. Listing every dex is a dozen reads against Hyperliquid's
 * per-IP budget, so an isolate reuses an answer for 5 seconds.
 */
export async function listPerpMarkets(deps: PerpsDependencies = {}): Promise<Observed<PerpMarket[]>> {
  const now = clock(deps);
  if (!deps.fetcher && cachedMarkets && now.getTime() - cachedMarkets.at < MARKETS_TTL_MS) return cachedMarkets.value;
  const value = await observe(() => perpMarkets(options(deps)), now);
  if (!deps.fetcher && value.status === "observed") cachedMarkets = { at: now.getTime(), value };
  return value;
}

/**
 * The customer's connection, margin, positions, open orders, and recent fills,
 * read from Hyperliquid now. `state` is the main perp dex; `dexStates` adds
 * every listed HIP-3 dex, each with its own balance in Hyperliquid's standard
 * account mode. Open orders are read on the main dex and on HIP-3 dexes that
 * hold funds; fills already cover every dex.
 */
export async function perpsAccount(db: D1Database, subject: string, owner: `0x${string}`, deps: PerpsDependencies = {}) {
  const now = clock(deps);
  const account = await readMarketAccount(db, subject, "hyperliquid", owner);
  const readStates = async (): Promise<PerpAccountState[]> => accountStates(owner, await perpDexs(options(deps)), options(deps));
  const readOrders = async (states: PerpAccountState[]): Promise<OpenOrder[]> => {
    const active = states.filter((item) => item.dex === "" || Number(item.accountValue) > 0);
    return (await Promise.all(active.map((item) => openOrders(owner, { ...options(deps), dex: item.dex })))).flat();
  };
  const [dexStates, fills] = await Promise.all([observe(readStates, now), observe(() => userFills(owner, { ...options(deps), limit: 50 }), now)]);
  const state: Observed<PerpAccountState> = dexStates.status === "observed"
    ? { ...dexStates, data: dexStates.data.find((item) => item.dex === "") ?? dexStates.data[0] }
    : dexStates;
  const orders = dexStates.status === "observed" ? await observe(() => readOrders(dexStates.data), now)
    : await observe(() => openOrders(owner, options(deps)), now);
  return { connection: account ? { status: account.status, tradingKey: account.tradingWalletAddress, approvedAt: account.approvedAt } : null,
    state, dexStates, orders, fills };
}

type ApproveContext = { kind: "approve"; action: ApproveAgentAction };
type WithdrawContext = { kind: "withdraw"; action: SendToEvmWithDataAction };

/**
 * Start connecting the customer's wallet to Hyperliquid: create their trading
 * key (or reuse the one waiting for approval) and ask their wallet to approve
 * it. Hyperliquid only accepts this once the account has a deposit.
 */
export async function startPerpsSetup(db: D1Database, subject: string, account: ActionAccount,
  deps: PerpsDependencies = {}): Promise<{ status: "ready" } | ({ status: "sign" } & MarketSignatureRequest)> {
  const now = clock(deps);
  const existing = await readMarketAccount(db, subject, "hyperliquid", account.address);
  if (existing?.status === "ready") return { status: "ready" };
  let key = existing?.tradingWalletId && existing.tradingWalletAddress ? { walletId: existing.tradingWalletId, address: existing.tradingWalletAddress } : null;
  if (!key) {
    key = await createTradingKey(deps.privy ?? privyClient(), "hyperliquid", subject);
    await savePendingAccount(db, subject, { venue: "hyperliquid", owner: account.address, tradingWalletId: key.walletId, tradingWalletAddress: key.address }, now);
  }
  const { action, typedData } = approveAgentAction({ agentAddress: key.address, agentName: AGENT_NAME, nonce: now.getTime() });
  const context: ApproveContext = { kind: "approve", action };
  return { status: "sign", ...await createMarketSignature(db, subject, account, "hyperliquid", "hyperliquid_approve_agent", typedData, context, now) };
}

/** Ask the customer's wallet to sign a withdrawal of `amount` USDC to its own address on Base, through Circle's CCTP. */
export async function startPerpsWithdrawal(db: D1Database, subject: string, account: ActionAccount, amount: string,
  deps: PerpsDependencies = {}): Promise<MarketSignatureRequest> {
  const now = clock(deps);
  const state = await accountState(account.address, options(deps));
  if (!/^\d+(\.\d{1,6})?$/.test(amount) || parseUnits(amount, 6) <= 0n) throw new HttpError(400, "invalid_amount", "Enter an amount with up to 6 decimal places.");
  if (parseUnits(amount, 6) > parseUnits(state.withdrawable.replace(/(\.\d{6})\d+$/, "$1"), 6))
    throw new HttpError(422, "insufficient_withdrawable", `You can withdraw up to ${state.withdrawable} USDC now.`);
  const { action, typedData } = sendToEvmWithDataAction({ amount, destinationRecipient: account.address, nonce: now.getTime() });
  const context: WithdrawContext = { kind: "withdraw", action };
  return createMarketSignature(db, subject, account, "hyperliquid", "hyperliquid_withdraw", typedData, context, now);
}

/**
 * Finish what the customer's wallet signed: submit it to Hyperliquid and keep
 * its answer. An approval marks the connection ready.
 */
export async function completePerpsSignature(db: D1Database, subject: string, account: ActionAccount, requestId: string, authorization: string,
  deps: PerpsDependencies = {}): Promise<{ status: "accepted"; kind: "setup" | "withdraw" }> {
  const now = clock(deps);
  const signed = await completeMarketSignature<ApproveContext | WithdrawContext>(db, subject, account, "hyperliquid",
    ["hyperliquid_approve_agent", "hyperliquid_withdraw"], requestId, authorization, now, undefined, deps.privy);
  const kind = signed.context.kind === "approve" ? "setup" : "withdraw";
  const summary = signed.context.kind === "approve" ? { agent: signed.context.action.agentAddress }
    : { amount: signed.context.action.amount, destination: signed.context.action.destinationRecipient, network: "Base" };
  try {
    await submitExchange({ action: signed.context.action, nonce: signed.context.action.nonce, signature: signed.signature }, options(deps));
  } catch (error) {
    await recordOperation(db, subject, { venue: "hyperliquid", kind, summary, status: error instanceof VenueError && error.status < 500 ? "rejected" : "failed",
      reason: error instanceof VenueError ? error.code : "unknown" }, now);
    throw error;
  }
  if (kind === "setup") await markAccountReady(db, subject, "hyperliquid", account.address, {}, now);
  await recordOperation(db, subject, { venue: "hyperliquid", kind, summary, status: "accepted" }, now);
  // Standard account mode: each dex keeps its own balance, which Aura moves into a stock market's dex before an order there.
  // A refusal here is recorded and doesn't undo the connection; the account keeps Hyperliquid's default mode.
  if (kind === "setup") await sendWithTradingKey(db, subject, account.address, "setup", buildAgentSetAbstractionAction("i") as unknown as L1Action,
    { step: "account_mode", mode: "standard" }, deps).catch(() => undefined);
  return { status: "accepted", kind };
}

async function readyAccount(db: D1Database, subject: string, owner: string): Promise<MarketAccount & { tradingWalletId: string; tradingWalletAddress: `0x${string}` }> {
  const account = await readMarketAccount(db, subject, "hyperliquid", owner);
  if (account?.status !== "ready" || !account.tradingWalletId || !account.tradingWalletAddress)
    throw new HttpError(409, "perps_not_connected", "Set up perps first.");
  return account as MarketAccount & { tradingWalletId: string; tradingWalletAddress: `0x${string}` };
}

/** Reads only the dex the coin belongs to: HIP-3 coins are named "dex:COIN". */
async function market(coin: string, deps: PerpsDependencies): Promise<PerpMarket> {
  const dex = coin.includes(":") ? coin.slice(0, coin.indexOf(":")) : "";
  const dexes = dex ? (await perpDexs(options(deps))).filter((item) => item.name === dex) : "main" as const;
  const found = (await perpMarkets({ ...options(deps), dexes })).find((item) => item.coin === coin);
  if (!found) throw new HttpError(404, "market_not_found", "This market isn't available.");
  return found;
}

/** Sign an L1 action with the customer's trading key, submit it, and keep Hyperliquid's answer. */
async function sendWithTradingKey(db: D1Database, subject: string, owner: string, kind: "setup" | "order" | "cancel" | "leverage",
  action: L1Action, summary: Record<string, unknown>, deps: PerpsDependencies): Promise<ExchangeResult> {
  const now = clock(deps);
  const account = await readyAccount(db, subject, owner);
  const nonce = nextNonce(now);
  const signature = await signWithTradingKey(deps.privy ?? privyClient(), { walletId: account.tradingWalletId, address: account.tradingWalletAddress },
    l1ActionTypedData(action, nonce));
  let result: ExchangeResult;
  try { result = await submitExchange({ action, nonce, signature }, options(deps)); }
  catch (error) {
    await recordOperation(db, subject, { venue: "hyperliquid", kind, summary, status: error instanceof VenueError && error.status < 500 ? "rejected" : "failed",
      reason: error instanceof VenueError ? error.code : "unknown" }, now);
    // An approval the customer revoked at Hyperliquid leaves the key unknown there: ask them to set up again.
    if (error instanceof VenueError && error.code === "account_not_found") throw new HttpError(409, "perps_not_connected", "Set up perps again to keep trading.");
    throw error;
  }
  const first = result.statuses[0];
  const externalId = first && "oid" in first ? String(first.oid) : null;
  await recordOperation(db, subject, { venue: "hyperliquid", kind, summary: { ...summary, statuses: result.statuses }, externalId, status: "accepted" }, now);
  return result;
}

export type PerpsOrderInput = { coin: string; side: "buy" | "sell"; size: string; type: "market" | "limit"; limitPrice?: string; reduceOnly?: boolean };

export async function placePerpsOrder(db: D1Database, subject: string, owner: string, input: PerpsOrderInput, deps: PerpsDependencies = {}) {
  const action = buildOrderAction({ market: await market(input.coin, deps), ...input });
  return sendWithTradingKey(db, subject, owner, "order", action as unknown as L1Action, { ...input }, deps);
}

/** Close a whole position at market. */
export async function closePerpsPosition(db: D1Database, subject: string, owner: `0x${string}`, coin: string, deps: PerpsDependencies = {}) {
  const found = await market(coin, deps);
  const state = await accountState(owner, { ...options(deps), dex: found.dex });
  const position = state.positions.find((item) => item.coin === coin);
  if (!position) throw new HttpError(404, "position_not_found", "You don't have a position in this market.");
  return sendWithTradingKey(db, subject, owner, "order", buildCloseAction(position, found) as unknown as L1Action,
    { coin, close: true, size: position.size }, deps);
}

export async function cancelPerpsOrder(db: D1Database, subject: string, owner: string, coin: string, oid: number, deps: PerpsDependencies = {}) {
  const found = await market(coin, deps);
  return sendWithTradingKey(db, subject, owner, "cancel", buildCancelAction(found.assetIndex, oid) as unknown as L1Action, { coin, oid }, deps);
}

/** Leverage up to the market's own maximum. Aura sets no cap of its own. */
export async function setPerpsLeverage(db: D1Database, subject: string, owner: string, coin: string, isCross: boolean, leverage: number,
  deps: PerpsDependencies = {}) {
  const found = await market(coin, deps);
  return sendWithTradingKey(db, subject, owner, "leverage", buildUpdateLeverageAction(found, isCross, leverage) as unknown as L1Action,
    { coin, isCross, leverage }, deps);
}

/** Whether Hyperliquid still lists the customer's trading key as approved. */
export async function tradingKeyApproved(owner: string, key: string, deps: PerpsDependencies = {}): Promise<boolean> {
  return (await extraAgents(owner, options(deps))).some((agent) => agent.address.toLowerCase() === key.toLowerCase() && agent.validUntil > clock(deps).getTime());
}

export type PerpsTradeInput = { coin: string; side: "long" | "short"; marginUsd: string; leverage: number; isCross: boolean;
  type: "market" | "limit"; limitPrice?: string; takeProfit?: TriggerSpec; stopLoss?: TriggerSpec };

/** What a trade would open: size, notional, margin, and an estimated liquidation price. Nothing is sent. */
export async function previewPerpsTrade(owner: `0x${string}`, input: PerpsTradeInput, deps: PerpsDependencies = {}) {
  const found = await market(input.coin, deps);
  const price = input.type === "limit" ? input.limitPrice : found.midPx ?? undefined;
  if (!price) throw new VenueError("hyperliquid", "no_liquidity", "This market has no price right now.", 409);
  const sized = sizeFromMargin({ marginUsd: input.marginUsd, leverage: input.leverage, price, market: found });
  const side = input.side;
  let liquidationPrice: string | null;
  if (input.isCross) {
    const state = await accountState(owner, { ...options(deps), dex: found.dex });
    liquidationPrice = crossLiquidationPrice({ side, size: sized.size, price, maxLeverage: found.maxLeverage,
      accountValue: String(Number(state.crossAccountValue) + Number(sized.margin)), maintenanceMarginUsed: state.crossMaintenanceMarginUsed });
  } else {
    liquidationPrice = isolatedLiquidationPrice({ side, entryPx: price, leverage: input.leverage, maxLeverage: found.maxLeverage });
  }
  return { market: found, price, ...sized, liquidationPrice };
}

/** Bring a stock market's dex up to `margin` from the main perps balance, with the trading key (it can only move funds within the account). */
async function fundDex(db: D1Database, subject: string, owner: `0x${string}`, dex: string, margin: string, deps: PerpsDependencies) {
  if (!dex) return;
  const [main, target] = await Promise.all([accountState(owner, options(deps)), accountState(owner, { ...options(deps), dex })]);
  const short = Math.ceil((Number(margin) * 1.01 - Number(target.withdrawable)) * 100) / 100;
  if (short <= 0) return;
  if (short > Number(main.withdrawable)) throw new HttpError(422, "insufficient_margin", "You don't have enough in your perps balance for this order.");
  const action = buildAgentSendAssetAction({ owner, sourceDex: "", destinationDex: dex, amount: short.toFixed(2), nonce: nextNonce(clock(deps)) });
  await sendWithTradingKey(db, subject, owner, "order", action as unknown as L1Action, { step: "move_margin", dex, amount: short.toFixed(2) }, deps);
}

/**
 * Open or add to a position from a dollar margin: set the market's leverage
 * and margin mode, move margin into a stock market's dex if needed, then
 * place the order with any take-profit and stop-loss attached.
 */
export async function placePerpsTrade(db: D1Database, subject: string, owner: `0x${string}`, input: PerpsTradeInput, deps: PerpsDependencies = {}) {
  await readyAccount(db, subject, owner);
  const preview = await previewPerpsTrade(owner, input, deps);
  const found = preview.market;
  await sendWithTradingKey(db, subject, owner, "leverage", buildUpdateLeverageAction(found, input.isCross, input.leverage) as unknown as L1Action,
    { coin: input.coin, isCross: input.isCross, leverage: input.leverage }, deps);
  await fundDex(db, subject, owner, found.dex, preview.margin, deps);
  const action = buildOrderAction({ market: found, side: input.side === "long" ? "buy" : "sell", size: preview.size, type: input.type,
    limitPrice: input.limitPrice, takeProfit: input.takeProfit, stopLoss: input.stopLoss });
  const result = await sendWithTradingKey(db, subject, owner, "order", action as unknown as L1Action,
    { ...input, size: preview.size, margin: preview.margin, notional: preview.notional }, deps);
  return { statuses: result.statuses, size: preview.size, margin: preview.margin, notional: preview.notional, liquidationPrice: preview.liquidationPrice };
}

/** Set auto-close (take profit and/or stop loss) on a whole open position. */
export async function setPerpsPositionTpsl(db: D1Database, subject: string, owner: `0x${string}`,
  input: { coin: string; takeProfit?: TriggerSpec; stopLoss?: TriggerSpec }, deps: PerpsDependencies = {}) {
  const found = await market(input.coin, deps);
  const state = await accountState(owner, { ...options(deps), dex: found.dex });
  const position = state.positions.find((item) => item.coin === input.coin);
  if (!position) throw new HttpError(404, "position_not_found", "You don't have a position in this market.");
  const action = buildPositionTpslAction({ position, market: found, takeProfit: input.takeProfit, stopLoss: input.stopLoss });
  return sendWithTradingKey(db, subject, owner, "order", action as unknown as L1Action, { ...input, autoClose: true }, deps);
}
