import type { PrivyClient } from "@privy-io/node";
import { isAddress, parseUnits, recoverTypedDataAddress } from "viem";
import type { ActionAccount } from "@/lib/auth/wallet";
import { HttpError } from "@/lib/http/errors";
import { markAccountReady, readMarketAccount, recordOperation, savePendingAccount, saveTradingKey, type MarketAccount } from "./accounts";
import {
  accountState, accountStates, approveAgentAction, buildAgentSendAssetAction, buildAgentSetAbstractionAction, buildCancelAction, buildCloseAction, buildOrderAction, buildPositionTpslAction, buildUpdateLeverageAction, crossLiquidationPrice, extraAgents,
  isolatedLiquidationPrice, sizeFromMargin,
  candles, l1ActionTypedData, l2Book, openOrders, perpDexs, perpMarkets, sendToEvmWithDataAction, submitExchange, userFees, userFills,
  type BookGrouping, type BookLevel, type Candle, type CandleRange,
  type ApproveAgentAction, type ExchangeResult, type ExtraAgent, type L1Action, type OpenOrder, type PerpAccountState, type PerpMarket, type SendToEvmWithDataAction, type TriggerSpec
} from "./hyperliquid";
import {
  claimDeviceSignature, completeMarketSignature, createDeviceSignature, createMarketSignature, type DeviceSignRequest, type MarketSignatureRequest
} from "./signing";
import { VenueError, type Observed, type TypedData } from "./types";

/**
 * Perps on Hyperliquid, through the customer's own wallet. The wallet owns
 * the Hyperliquid account and signs every withdrawal. Trading is signed by a
 * trading key the customer's browser makes and keeps: their wallet approves
 * it once per device, with the passkey. Aura never has that key, so Aura
 * can't place, change, or close anything on its own. Aura builds each action
 * (sizing, checks, place rules), the browser signs it, and Aura relays exactly
 * what it built. Hyperliquid never lets a trading key move money out.
 */
export type PerpsDependencies = { privy?: PrivyClient; fetcher?: typeof fetch; now?: () => Date };

/** Hyperliquid keeps 3 named trading keys per account; Aura names its own per device. */
const AGENT_SLOTS = ["Aura 1", "Aura 2", "Aura 3"];
const NAMED_AGENT_LIMIT = 3;
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
 * The name to approve a device's trading key under. A key Aura's server used
 * to hold gives up its name, so approving the device key retires it. Then a
 * free Aura slot; with all 3 named slots taken, Aura's oldest key is replaced.
 * Hyperliquid drops a key when another is approved under its name.
 */
function agentName(agents: ExtraAgent[], legacy: string | null): string {
  const retired = legacy ? agents.find((item) => item.address.toLowerCase() === legacy) : undefined;
  if (retired) return retired.name;
  const free = AGENT_SLOTS.find((name) => !agents.some((item) => item.name === name));
  if (free && agents.length < NAMED_AGENT_LIMIT) return free;
  const oldest = agents.filter((item) => item.name.startsWith("Aura")).sort((a, b) => a.validUntil - b.validUntil)[0];
  if (!oldest) throw new HttpError(409, "perps_keys_full", "Your Hyperliquid account already has 3 connected apps. Remove one on Hyperliquid, then try again.");
  return oldest.name;
}

/**
 * Connect this device to the customer's Hyperliquid account: if Hyperliquid
 * already lists the device's trading key (`agent`), it's ready; otherwise ask
 * the customer's wallet to approve it. Hyperliquid only accepts this once the
 * account has a deposit.
 */
export async function startPerpsSetup(db: D1Database, subject: string, account: ActionAccount, agent: string,
  deps: PerpsDependencies = {}): Promise<{ status: "ready" } | ({ status: "sign" } & MarketSignatureRequest)> {
  const now = clock(deps);
  if (!isAddress(agent) || agent.toLowerCase() === account.address.toLowerCase()) throw new HttpError(400, "invalid_agent", "This device's trading key isn't valid.");
  const key = agent.toLowerCase() as `0x${string}`;
  const existing = await readMarketAccount(db, subject, "hyperliquid", account.address);
  const agents = (await extraAgents(account.address, options(deps))).filter((item) => item.validUntil > now.getTime());
  if (!existing) await savePendingAccount(db, subject, { venue: "hyperliquid", owner: account.address, tradingWalletAddress: key }, now);
  if (agents.some((item) => item.address.toLowerCase() === key)) {
    await saveTradingKey(db, subject, "hyperliquid", account.address, key, now);
    if (existing?.status !== "ready") await markAccountReady(db, subject, "hyperliquid", account.address, {}, now);
    return { status: "ready" };
  }
  const legacy = existing?.tradingWalletId ? existing.tradingWalletAddress : null;
  const { action, typedData } = approveAgentAction({ agentAddress: key, agentName: agentName(agents, legacy), nonce: now.getTime() });
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
  deps: PerpsDependencies = {}): Promise<{ status: "accepted"; kind: "setup" | "withdraw"; next?: DeviceSignRequest }> {
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
  if (signed.context.kind === "approve") {
    await saveTradingKey(db, subject, "hyperliquid", account.address, signed.context.action.agentAddress, now);
    await markAccountReady(db, subject, "hyperliquid", account.address, {}, now);
  }
  await recordOperation(db, subject, { venue: "hyperliquid", kind, summary, status: "accepted" }, now);
  if (kind === "withdraw") return { status: "accepted", kind };
  // Standard account mode: each dex keeps its own balance, which Aura moves into a stock market's dex before an order there.
  // The device signs it next; a refusal is recorded and doesn't undo the connection (the account keeps Hyperliquid's default mode).
  const next = await prepareDeviceActions(db, subject, account.address,
    [{ kind: "setup", action: buildAgentSetAbstractionAction("i") as unknown as L1Action, summary: { step: "account_mode", mode: "standard" } }], {}, deps);
  return { status: "accepted", kind, next };
}

async function readyAccount(db: D1Database, subject: string, owner: string): Promise<MarketAccount> {
  const account = await readMarketAccount(db, subject, "hyperliquid", owner);
  if (account?.status !== "ready") throw new HttpError(409, "perps_not_connected", "Set up perps first.");
  return account;
}

/** Reads only the dex the coin belongs to: HIP-3 coins are named "dex:COIN". */
async function market(coin: string, deps: PerpsDependencies): Promise<PerpMarket> {
  const dex = coin.includes(":") ? coin.slice(0, coin.indexOf(":")) : "";
  const dexes = dex ? (await perpDexs(options(deps))).filter((item) => item.name === dex) : "main" as const;
  const found = (await perpMarkets({ ...options(deps), dexes })).find((item) => item.coin === coin);
  if (!found) throw new HttpError(404, "market_not_found", "This market isn't available.");
  return found;
}

type DeviceStep = { kind: "setup" | "order" | "cancel" | "leverage"; action: L1Action; summary: Record<string, unknown> };
type DeviceContext = { steps: Array<DeviceStep & { nonce: number }>; result: Record<string, unknown> };

/**
 * Build the actions for the customer's device key to sign, in order, each
 * with a rising nonce. `result` is returned with the venue's answer once
 * they're relayed.
 */
async function prepareDeviceActions(db: D1Database, subject: string, owner: string, steps: DeviceStep[], result: Record<string, unknown>,
  deps: PerpsDependencies): Promise<DeviceSignRequest> {
  const now = clock(deps);
  await readyAccount(db, subject, owner);
  const numbered = steps.map((step) => ({ ...step, nonce: nextNonce(now) }));
  const context: DeviceContext = { steps: numbered, result };
  return createDeviceSignature(db, subject, owner.toLowerCase() as `0x${string}`, "hyperliquid", "hyperliquid_agent_actions",
    numbered.map((step) => l1ActionTypedData(step.action, step.nonce)), context, now);
}

/**
 * Send what the customer's device signed to Hyperliquid, in order, and keep
 * each answer. Only actions Aura built for this request are sent, all signed
 * by one key; Hyperliquid checks that key is one the customer's wallet approved.
 * Returns the last answer's statuses with what the request was built with.
 */
export async function relayPerpsActions(db: D1Database, subject: string, owner: string, requestId: string, signatures: string[],
  deps: PerpsDependencies = {}): Promise<{ statuses: ExchangeResult["statuses"] } & Record<string, unknown>> {
  const now = clock(deps);
  await readyAccount(db, subject, owner);
  const { typedData, context } = await claimDeviceSignature<DeviceContext>(db, subject, "hyperliquid", "hyperliquid_agent_actions", requestId, now);
  const invalid = new HttpError(400, "invalid_signature", "This device's signature isn't valid. Try again.");
  if (signatures.length !== typedData.length || !signatures.every((item) => /^0x[0-9a-fA-F]{130}$/.test(item))) throw invalid;
  const signers = await Promise.all(typedData.map((data, index) => signer(data, signatures[index] as `0x${string}`)));
  if (signers.some((item) => item !== signers[0])) throw invalid;
  let result: ExchangeResult = { statuses: [] } as unknown as ExchangeResult;
  for (const [index, step] of context.steps.entries()) {
    try { result = await submitExchange({ action: step.action, nonce: step.nonce, signature: signatures[index] }, options(deps)); }
    catch (error) {
      await recordOperation(db, subject, { venue: "hyperliquid", kind: step.kind, summary: step.summary,
        status: error instanceof VenueError && error.status < 500 ? "rejected" : "failed", reason: error instanceof VenueError ? error.code : "unknown" }, now);
      // A key Hyperliquid doesn't know (replaced by another device, or revoked): this device sets up again.
      if (error instanceof VenueError && error.code === "account_not_found") throw new HttpError(409, "perps_not_connected", "Connect this device to keep trading.");
      throw error;
    }
    const first = result.statuses[0];
    const externalId = first && "oid" in first ? String(first.oid) : null;
    await recordOperation(db, subject, { venue: "hyperliquid", kind: step.kind, summary: { ...step.summary, signer: signers[0], statuses: result.statuses },
      externalId, status: "accepted" }, now);
  }
  return { ...context.result, statuses: result.statuses };
}

async function signer(typedData: TypedData, signature: `0x${string}`): Promise<string> {
  try { return (await recoverTypedDataAddress({ ...(typedData as Parameters<typeof recoverTypedDataAddress>[0]), signature })).toLowerCase(); }
  catch { throw new HttpError(400, "invalid_signature", "This device's signature isn't valid. Try again."); }
}

export type PerpsOrderInput = { coin: string; side: "buy" | "sell"; size: string; type: "market" | "limit"; limitPrice?: string; reduceOnly?: boolean };

export async function placePerpsOrder(db: D1Database, subject: string, owner: string, input: PerpsOrderInput, deps: PerpsDependencies = {}) {
  const action = buildOrderAction({ market: await market(input.coin, deps), ...input });
  return prepareDeviceActions(db, subject, owner, [{ kind: "order", action: action as unknown as L1Action, summary: { ...input } }], {}, deps);
}

/** Close a whole position at market. */
export async function closePerpsPosition(db: D1Database, subject: string, owner: `0x${string}`, coin: string, deps: PerpsDependencies = {}) {
  const found = await market(coin, deps);
  const state = await accountState(owner, { ...options(deps), dex: found.dex });
  const position = state.positions.find((item) => item.coin === coin);
  if (!position) throw new HttpError(404, "position_not_found", "You don't have a position in this market.");
  return prepareDeviceActions(db, subject, owner, [{ kind: "order", action: buildCloseAction(position, found) as unknown as L1Action,
    summary: { coin, close: true, size: position.size } }], {}, deps);
}

export async function cancelPerpsOrder(db: D1Database, subject: string, owner: string, coin: string, oid: number, deps: PerpsDependencies = {}) {
  const found = await market(coin, deps);
  return prepareDeviceActions(db, subject, owner, [{ kind: "cancel", action: buildCancelAction(found.assetIndex, oid) as unknown as L1Action,
    summary: { coin, oid } }], {}, deps);
}

/** Leverage up to the market's own maximum. Aura sets no cap of its own. */
export async function setPerpsLeverage(db: D1Database, subject: string, owner: string, coin: string, isCross: boolean, leverage: number,
  deps: PerpsDependencies = {}) {
  const found = await market(coin, deps);
  return prepareDeviceActions(db, subject, owner, [{ kind: "leverage", action: buildUpdateLeverageAction(found, isCross, leverage) as unknown as L1Action,
    summary: { coin, isCross, leverage } }], {}, deps);
}

/** Whether Hyperliquid still lists a trading key as approved for the customer. */
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
    // Margin for a cross position comes out of money already in the account, so it adds no value;
    // only what has to come in first (a one-tap deposit, or a move into a stock market's dex) does.
    const free = Math.max(0, Number(state.accountValue) - Number(state.totalMarginUsed));
    const added = Math.max(0, Number(sized.margin) - free);
    liquidationPrice = crossLiquidationPrice({ side, size: sized.size, price, maxLeverage: found.maxLeverage,
      accountValue: String(Number(state.crossAccountValue) + added), maintenanceMarginUsed: state.crossMaintenanceMarginUsed });
  } else {
    liquidationPrice = isolatedLiquidationPrice({ side, entryPx: price, leverage: input.leverage, maxLeverage: found.maxLeverage });
  }
  const feeRate = await estimatedTakerRate(owner, found, deps);
  return { market: found, price, ...sized, liquidationPrice,
    feeRate: feeRate === null ? null : feeRate.toFixed(6), fee: feeRate === null ? null : (Number(sized.notional) * feeRate).toFixed(4) };
}

/** A stock (HIP-3) market charges twice the main dex's rate; half goes to its deployer. */
const HIP3_FEE_MULTIPLIER = 2;

/** The rate a market order would pay, from the account's own fee tier; null if Hyperliquid didn't say. */
async function estimatedTakerRate(owner: `0x${string}`, found: PerpMarket, deps: PerpsDependencies): Promise<number | null> {
  try {
    const { takerRate } = await userFees(owner, options(deps));
    return takerRate * (found.dex ? HIP3_FEE_MULTIPLIER : 1);
  } catch {
    return null;
  }
}

/** A market from the shared, briefly cached list, so charts and the book polling every few seconds cost one Hyperliquid read each. */
async function listedMarket(coin: string, deps: PerpsDependencies): Promise<PerpMarket> {
  const listed = await listPerpMarkets(deps);
  if (listed.status !== "observed") return market(coin, deps);
  const found = listed.data.find((item) => item.coin === coin);
  if (!found) throw new HttpError(404, "market_not_found", "This market isn't available.");
  return found;
}

/** Price candles for a chart range, read now. */
export async function perpCandles(coin: string, range: CandleRange, deps: PerpsDependencies = {}): Promise<Observed<{ coin: string; interval: string; candles: Candle[] }>> {
  const now = clock(deps);
  const found = await listedMarket(coin, deps);
  return observe(async () => ({ coin: found.coin, ...await candles(found.coin, range, now, options(deps)) }), now);
}

/** The order book now, with the spread between the best bid and ask. */
export async function perpBook(coin: string, deps: PerpsDependencies & { grouping?: BookGrouping } = {}): Promise<Observed<{ coin: string; bids: BookLevel[]; asks: BookLevel[];
  spread: string | null; spreadPercent: string | null }>> {
  const now = clock(deps);
  const found = await listedMarket(coin, deps);
  return observe(async () => {
    const book = await l2Book(found.coin, { ...options(deps), grouping: deps.grouping });
    const bid = book.bids[0] ? Number(book.bids[0].price) : null;
    const ask = book.asks[0] ? Number(book.asks[0].price) : null;
    const spread = bid !== null && ask !== null ? ask - bid : null;
    return { coin: found.coin, bids: book.bids, asks: book.asks,
      spread: spread === null ? null : String(Number(spread.toPrecision(8))),
      spreadPercent: spread === null || ask === null ? null : (spread / ((ask + bid!) / 2) * 100).toFixed(4) };
  }, now);
}

/** The move that brings a stock market's dex up to `margin` from the main perps balance, if one is needed (a trading key can only move funds within the account). */
async function fundDex(owner: `0x${string}`, dex: string, margin: string, deps: PerpsDependencies): Promise<DeviceStep | null> {
  if (!dex) return null;
  const [main, target] = await Promise.all([accountState(owner, options(deps)), accountState(owner, { ...options(deps), dex })]);
  const short = Math.ceil((Number(margin) * 1.01 - Number(target.withdrawable)) * 100) / 100;
  if (short <= 0) return null;
  if (short > Number(main.withdrawable)) throw new HttpError(422, "insufficient_margin", "You don't have enough in your perps balance for this order.");
  const action = buildAgentSendAssetAction({ owner, sourceDex: "", destinationDex: dex, amount: short.toFixed(2), nonce: nextNonce(clock(deps)) });
  return { kind: "order", action: action as unknown as L1Action, summary: { step: "move_margin", dex, amount: short.toFixed(2) } };
}

/**
 * Open or add to a position from a dollar margin: set the market's leverage
 * and margin mode, move margin into a stock market's dex if needed, then
 * place the order with any take-profit and stop-loss attached. All three are
 * built now and signed together on the customer's device.
 */
export async function placePerpsTrade(db: D1Database, subject: string, owner: `0x${string}`, input: PerpsTradeInput, deps: PerpsDependencies = {}) {
  await readyAccount(db, subject, owner);
  const preview = await previewPerpsTrade(owner, input, deps);
  const found = preview.market;
  const leverage: DeviceStep = { kind: "leverage", action: buildUpdateLeverageAction(found, input.isCross, input.leverage) as unknown as L1Action,
    summary: { coin: input.coin, isCross: input.isCross, leverage: input.leverage } };
  const move = await fundDex(owner, found.dex, preview.margin, deps);
  const action = buildOrderAction({ market: found, side: input.side === "long" ? "buy" : "sell", size: preview.size, type: input.type,
    limitPrice: input.limitPrice, takeProfit: input.takeProfit, stopLoss: input.stopLoss });
  const order: DeviceStep = { kind: "order", action: action as unknown as L1Action,
    summary: { ...input, size: preview.size, margin: preview.margin, notional: preview.notional } };
  return prepareDeviceActions(db, subject, owner, [leverage, ...(move ? [move] : []), order],
    { size: preview.size, margin: preview.margin, notional: preview.notional, liquidationPrice: preview.liquidationPrice }, deps);
}

/** Set auto-close (take profit and/or stop loss) on a whole open position. */
export async function setPerpsPositionTpsl(db: D1Database, subject: string, owner: `0x${string}`,
  input: { coin: string; takeProfit?: TriggerSpec; stopLoss?: TriggerSpec }, deps: PerpsDependencies = {}) {
  const found = await market(input.coin, deps);
  const state = await accountState(owner, { ...options(deps), dex: found.dex });
  const position = state.positions.find((item) => item.coin === input.coin);
  if (!position) throw new HttpError(404, "position_not_found", "You don't have a position in this market.");
  const action = buildPositionTpslAction({ position, market: found, takeProfit: input.takeProfit, stopLoss: input.stopLoss });
  return prepareDeviceActions(db, subject, owner, [{ kind: "order", action: action as unknown as L1Action, summary: { ...input, autoClose: true } }], {}, deps);
}
