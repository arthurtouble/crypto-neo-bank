import { encodeFunctionData, erc20Abi, parseUnits } from "viem";
import type { PrivyClient } from "@privy-io/node";
import type { BuiltAction } from "@/lib/actions/types";
import { ActionInputError } from "@/lib/actions/transfer";
import { BASE_CHAIN_ID, BASE_USDC } from "@/lib/assets/registry";
import type { ActionAccount } from "@/lib/auth/wallet";
import { HttpError } from "@/lib/http/errors";
import { listOperations, markAccountReady, readMarketAccount, recordOperation, savePendingAccount, type MarketOperationKind } from "./accounts";
import { openCredentials, sealCredentials } from "./credentials";
import {
  approvalCalls, baseUsdcDepositMinimum, batchDeadline, buildDollarBuy, buildOrder, cancelOrder, clobAuthTypedData, createOrDeriveApiKey,
  depositAddress, depositWalletAddress, deployDepositWallet, fetchWalletNonce, getMarket, isDeployed, openOrders, orderBook, orderMarketInfo, positions, postOrder,
  pusdBalance, pusdTransferCall, redeemCalls, relayerTransaction, submitWalletBatch, syncClobAllowance, tradingApprovalsState,
  walletBatchTypedData, withdrawAddress, builderCode,
  type ApiCredentials, type BuiltOrder, type ClobSession, type WalletBatch
} from "./polymarket";
import { completeMarketSignature, createMarketSignature, type MarketSignaturePurpose, type MarketSignatureRequest } from "./signing";
import { VenueError, type Observed } from "./types";

/**
 * Predictions on Polymarket, through the customer's own wallet. Their Privy
 * wallet owns a Polymarket Deposit Wallet; it signs the wallet's approvals,
 * its order-book sign-in, every order, and every withdrawal or redemption.
 * Aura's builder key only pays the gas for the wallet's transactions and
 * can't move what's in it. Sports markets are not offered.
 */
export type PredictionsDependencies = { privy?: PrivyClient; fetcher?: typeof fetch; now?: () => Date; secret?: string };

const opts = (deps: PredictionsDependencies) => ({ fetcher: deps.fetcher });
const clock = (deps: PredictionsDependencies) => deps.now?.() ?? new Date();
const sealContext = (subject: string) => `${subject}:polymarket`;

async function observe<T>(read: () => Promise<T>, now: Date): Promise<Observed<T>> {
  try { return { status: "observed", source: "polymarket", observedAt: now.toISOString(), data: await read() }; }
  catch (error) {
    return { status: "unavailable", source: "polymarket", observedAt: now.toISOString(), reason: error instanceof VenueError ? error.code : "polymarket_unavailable" };
  }
}

type BatchContext = { kind: "batch"; operation: MarketOperationKind; batch: WalletBatch; summary: Record<string, unknown> };
type AuthContext = { kind: "clob_auth"; timestamp: number; wallet: `0x${string}` };
type OrderContext = { kind: "order"; built: BuiltOrder; summary: Record<string, unknown> };
type Context = BatchContext | AuthContext | OrderContext;
const PURPOSES: readonly MarketSignaturePurpose[] = ["polymarket_approvals", "polymarket_clob_auth", "polymarket_order", "polymarket_withdraw", "polymarket_redeem"];

/** The customer's open relayer transaction, if one is still on its way. */
async function pendingRelay(db: D1Database, subject: string, deps: PredictionsDependencies): Promise<string | null> {
  const latest = (await listOperations(db, subject, "polymarket", 10)).find((item) => item.status === "submitted" && item.externalId);
  if (!latest?.externalId) return null;
  const tx = await relayerTransaction(latest.externalId, opts(deps));
  return tx.outcome === "pending" ? latest.externalId : null;
}

async function sign(db: D1Database, subject: string, account: ActionAccount, purpose: MarketSignaturePurpose, typedData: Parameters<typeof createMarketSignature>[5],
  context: Context, now: Date): Promise<{ status: "sign" } & MarketSignatureRequest> {
  return { status: "sign", ...await createMarketSignature(db, subject, account, "polymarket", purpose, typedData, context, now) };
}

export type PredictionsSetup = { status: "ready"; wallet: `0x${string}` } | { status: "waiting"; wallet: `0x${string}`; transactionId: string }
  | ({ status: "sign"; wallet?: undefined } & MarketSignatureRequest);

/**
 * Take the customer's Polymarket connection one step further: deploy their
 * Deposit Wallet, have their wallet approve Polymarket's contracts, then sign
 * in to the order book. Call again after each step until it is ready.
 */
export async function startPredictionsSetup(db: D1Database, subject: string, account: ActionAccount, deps: PredictionsDependencies = {}): Promise<PredictionsSetup> {
  const now = clock(deps);
  const owner = account.address;
  const wallet = depositWalletAddress(owner).toLowerCase() as `0x${string}`;
  const existing = await readMarketAccount(db, subject, "polymarket", owner);
  if (existing?.status === "ready") return { status: "ready", wallet };
  if (!existing) await savePendingAccount(db, subject, { venue: "polymarket", owner, venueWalletAddress: wallet }, now);
  const pending = await pendingRelay(db, subject, deps);
  if (pending) return { status: "waiting", wallet, transactionId: pending };
  if (!await isDeployed(wallet, opts(deps))) {
    const submitted = await deployDepositWallet(owner, opts(deps));
    await recordOperation(db, subject, { venue: "polymarket", kind: "setup", summary: { step: "deploy", wallet }, externalId: submitted.transactionId, status: "submitted" }, now);
    return { status: "waiting", wallet, transactionId: submitted.transactionId };
  }
  const approvals = await tradingApprovalsState(wallet, opts(deps));
  if (!approvals.ready) {
    const batch: WalletBatch = { wallet, nonce: await fetchWalletNonce(owner, opts(deps)), deadline: batchDeadline(now), calls: approvals.missing.length ? approvals.missing : approvalCalls() };
    return sign(db, subject, account, "polymarket_approvals", walletBatchTypedData(batch),
      { kind: "batch", operation: "setup", batch, summary: { step: "approvals", calls: batch.calls.length } }, now);
  }
  const timestamp = Math.floor(now.getTime() / 1000);
  return sign(db, subject, account, "polymarket_clob_auth", clobAuthTypedData(owner, timestamp), { kind: "clob_auth", timestamp, wallet }, now);
}

async function session(db: D1Database, subject: string, owner: string, deps: PredictionsDependencies): Promise<ClobSession & { wallet: `0x${string}` }> {
  const account = await readMarketAccount(db, subject, "polymarket", owner);
  if (account?.status !== "ready" || !account.credentialsCiphertext || !account.venueWalletAddress)
    throw new HttpError(409, "predictions_not_connected", "Set up predictions first.");
  const credentials = await openCredentials<ApiCredentials>(account.credentialsCiphertext, sealContext(subject), deps.secret);
  return { credentials, ownerAddress: owner, wallet: account.venueWalletAddress };
}

/** Finish what the customer's wallet signed and send it to Polymarket. */
export async function completePredictionsSignature(db: D1Database, subject: string, account: ActionAccount, requestId: string, authorization: string,
  deps: PredictionsDependencies = {}) {
  const now = clock(deps);
  const signed = await completeMarketSignature<Context>(db, subject, account, "polymarket", PURPOSES, requestId, authorization, now, undefined, deps.privy);
  const { context } = signed;
  const kind: MarketOperationKind = context.kind === "batch" ? context.operation : context.kind === "order" ? "order" : "setup";
  const summary = context.kind === "clob_auth" ? { step: "sign_in" } : context.summary;
  try {
    if (context.kind === "batch") {
      const submitted = await submitWalletBatch({ ...context.batch, owner: account.address, signature: signed.signature }, opts(deps));
      await recordOperation(db, subject, { venue: "polymarket", kind, summary, externalId: submitted.transactionId, status: "submitted" }, now);
      return { status: "submitted" as const, kind, transactionId: submitted.transactionId };
    }
    if (context.kind === "clob_auth") {
      const credentials = await createOrDeriveApiKey({ ownerAddress: account.address, signature: signed.signature, timestamp: context.timestamp }, opts(deps));
      await syncClobAllowance({ credentials, ownerAddress: account.address }, { type: "COLLATERAL" }, opts(deps));
      await markAccountReady(db, subject, "polymarket", account.address,
        { credentialsCiphertext: await sealCredentials(credentials, sealContext(subject), deps.secret), venueWalletAddress: context.wallet }, now);
      await recordOperation(db, subject, { venue: "polymarket", kind, summary, status: "accepted" }, now);
      return { status: "accepted" as const, kind };
    }
    const clob = await session(db, subject, account.address, deps);
    const posted = await postOrderFor(clob, context.built, signed.signature, deps);
    await recordOperation(db, subject, { venue: "polymarket", kind, summary: { ...summary, status: posted.status, makingAmount: posted.makingAmount,
      takingAmount: posted.takingAmount }, externalId: posted.orderId, status: "accepted" }, now);
    return { status: "accepted" as const, kind, order: posted };
  } catch (error) {
    if (error instanceof VenueError || error instanceof HttpError)
      await recordOperation(db, subject, { venue: "polymarket", kind, summary, status: error.status < 500 ? "rejected" : "failed", reason: error.code }, now);
    throw error;
  }
}

function postOrderFor(clob: ClobSession, built: BuiltOrder, signature: string, deps: PredictionsDependencies) {
  return postOrder({ session: clob, built, signature }, opts(deps));
}

/** A market that can be traded: listed, not sports, open, and with this outcome. */
async function tradable(marketId: string, outcome: 0 | 1, deps: PredictionsDependencies) {
  const market = await getMarket({ id: marketId }, opts(deps));
  if (market.closed || !market.acceptingOrders) throw new HttpError(409, "market_closed", "This market isn't taking orders.");
  return { market, tokenId: market.outcomes[outcome].tokenId };
}

const code = (): `0x${string}` | undefined => { try { return builderCode(); } catch { return undefined; } };

/** Buy an outcome for `amountUsd` at the current book; the customer's wallet signs it. */
export async function startPredictionBuy(db: D1Database, subject: string, account: ActionAccount, input: { marketId: string; outcome: 0 | 1; amountUsd: number },
  deps: PredictionsDependencies = {}) {
  const now = clock(deps);
  const clob = await session(db, subject, account.address, deps);
  const { market, tokenId } = await tradable(input.marketId, input.outcome, deps);
  const [book, info] = await Promise.all([orderBook(tokenId, opts(deps)), orderMarketInfo(tokenId, opts(deps))]);
  const fee = info.fee.rate > 0 ? { rate: info.fee.rate, exponent: info.fee.exponent } : undefined;
  const build = (amountUsd: number) => buildDollarBuy({ wallet: clob.wallet, book, amountUsd, negRisk: market.negRisk, fee, builderCode: code(), now });
  // Polymarket charges its taker fee on top of what's spent on shares, so the amount asked for covers both:
  // price the whole amount, then spend it less that fee (a smaller buy's fee is no larger).
  const first = build(input.amountUsd);
  const buy = first.fee ? build(Math.floor((input.amountUsd - first.fee) * 100) / 100) : first;
  const summary = { marketId: market.id, question: market.question, outcome: market.outcomes[input.outcome].name, side: "BUY", amount: buy.amount, fee: buy.fee,
    estimatedShares: buy.estimatedShares, minimumShares: buy.minimumShares, averagePrice: buy.averagePrice };
  return { ...await sign(db, subject, account, "polymarket_order", buy.built.typedData, { kind: "order", built: buy.built, summary }, now),
    quote: { amount: buy.amount, fee: buy.fee, estimatedShares: buy.estimatedShares, payoutIfWins: buy.payoutIfWins, minimumPayoutIfWins: buy.minimumPayoutIfWins,
      averagePrice: buy.averagePrice } };
}

/** Sell `shares` of an outcome at the current best bid, less slippage; the customer's wallet signs it. */
export async function startPredictionSell(db: D1Database, subject: string, account: ActionAccount, input: { marketId: string; outcome: 0 | 1; shares: number },
  deps: PredictionsDependencies = {}) {
  const now = clock(deps);
  const clob = await session(db, subject, account.address, deps);
  const { market, tokenId } = await tradable(input.marketId, input.outcome, deps);
  const book = await orderBook(tokenId, opts(deps));
  const best = book.bids[0]?.price;
  if (!best) throw new HttpError(409, "no_buyers", "No one is buying this outcome right now.");
  const price = Math.max(market.tickSize, Math.floor((best * 0.98) / market.tickSize) * market.tickSize);
  const built = buildOrder({ wallet: clob.wallet, tokenId, side: "SELL", price, size: input.shares, orderType: "FAK", negRisk: market.negRisk,
    tickSize: market.tickSize, builderCode: code(), now });
  await syncClobAllowance(clob, { type: "CONDITIONAL", tokenId }, opts(deps));
  const summary = { marketId: market.id, question: market.question, outcome: market.outcomes[input.outcome].name, side: "SELL", shares: input.shares, price };
  return sign(db, subject, account, "polymarket_order", built.typedData, { kind: "order", built, summary }, now);
}

export async function cancelPredictionOrder(db: D1Database, subject: string, owner: string, orderId: string, deps: PredictionsDependencies = {}) {
  const result = await cancelOrder({ session: await session(db, subject, owner, deps), orderId }, opts(deps));
  await recordOperation(db, subject, { venue: "polymarket", kind: "cancel", summary: { orderId }, externalId: orderId,
    status: result.canceled ? "accepted" : "rejected", reason: result.reason }, clock(deps));
  return result;
}

/** Withdraw `amount` pUSD to the account's own address on Base, through Polymarket's bridge. */
export async function startPredictionsWithdrawal(db: D1Database, subject: string, account: ActionAccount, amount: string, deps: PredictionsDependencies = {}) {
  const now = clock(deps);
  const clob = await session(db, subject, account.address, deps);
  if (!/^\d+(\.\d{1,6})?$/.test(amount) || parseUnits(amount, 6) <= 0n) throw new ActionInputError("invalid_amount", "Enter an amount with up to 6 decimal places.");
  const balance = await pusdBalance(clob.wallet, opts(deps));
  if (parseUnits(amount, 6) > BigInt(balance.raw)) throw new ActionInputError("insufficient_balance", `You can withdraw up to ${balance.amount} USDC.`);
  const bridge = await withdrawAddress({ wallet: clob.wallet, recipient: account.address }, opts(deps));
  const batch: WalletBatch = { wallet: clob.wallet, nonce: await fetchWalletNonce(account.address, opts(deps)), deadline: batchDeadline(now),
    calls: [pusdTransferCall(bridge, parseUnits(amount, 6))] };
  return sign(db, subject, account, "polymarket_withdraw", walletBatchTypedData(batch),
    { kind: "batch", operation: "withdraw", batch, summary: { amount, destination: account.address, network: "Base", bridge } }, now);
}

/** Collect a resolved market's winnings into the Deposit Wallet. */
export async function startPredictionRedeem(db: D1Database, subject: string, account: ActionAccount, marketId: string, deps: PredictionsDependencies = {}) {
  const now = clock(deps);
  const clob = await session(db, subject, account.address, deps);
  const market = await getMarket({ id: marketId }, opts(deps));
  const calls = await redeemCalls({ wallet: clob.wallet, conditionId: market.conditionId, negRisk: market.negRisk, tokenIds: [market.yesTokenId, market.noTokenId] }, opts(deps));
  const batch: WalletBatch = { wallet: clob.wallet, nonce: await fetchWalletNonce(account.address, opts(deps)), deadline: batchDeadline(now), calls };
  return sign(db, subject, account, "polymarket_redeem", walletBatchTypedData(batch),
    { kind: "batch", operation: "redeem", batch, summary: { marketId, question: market.question } }, now);
}

/** The customer's Polymarket account as Polymarket and Polygon report it now. */
export async function predictionsAccount(db: D1Database, subject: string, owner: `0x${string}`, deps: PredictionsDependencies = {}) {
  const now = clock(deps);
  const account = await readMarketAccount(db, subject, "polymarket", owner);
  const wallet = depositWalletAddress(owner).toLowerCase() as `0x${string}`;
  const ready = account?.status === "ready";
  const [balance, held, orders] = await Promise.all([
    observe(() => pusdBalance(wallet, opts(deps)), now),
    observe(async () => (await positions(wallet, {}, opts(deps))).positions, now),
    ready ? observe(async () => openOrders({ session: await session(db, subject, owner, deps) }, opts(deps)), now) : Promise.resolve(null)
  ]);
  return { connection: account ? { status: account.status, wallet, approvedAt: account.approvedAt } : null, balance, positions: held, orders };
}

/**
 * A transfer of Base USDC from the account to the customer's own Polymarket
 * bridge address, which credits it to their Deposit Wallet as pUSD. It moves
 * money between the customer's own accounts, so it doesn't count toward the
 * daily limit; the predictions switch gates it.
 */
export async function buildPredictionsDeposit(db: D1Database, subject: string, owner: string, amount: string, deps: PredictionsDependencies = {}): Promise<BuiltAction> {
  const clob = await session(db, subject, owner, deps);
  if (!/^\d+(\.\d{1,6})?$/.test(amount)) throw new ActionInputError("invalid_amount", "Enter an amount with up to 6 decimal places.");
  const raw = parseUnits(amount, 6);
  const minimum = await baseUsdcDepositMinimum(opts(deps));
  if (Number(amount) < minimum) throw new ActionInputError("amount_too_small", `Add at least ${minimum} USDC.`);
  const to = (await depositAddress(clob.wallet, opts(deps))).toLowerCase() as `0x${string}`;
  const assetId = `${BASE_CHAIN_ID}:${BASE_USDC}`;
  return {
    kind: "transfer", chainId: BASE_CHAIN_ID,
    calls: [{ to: BASE_USDC, value: "0", data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, raw] }) }],
    effects: [{ type: "erc20_transfer", token: BASE_USDC, to, amountRaw: raw.toString() }],
    summary: { assetId, symbol: "USDC", decimals: 6, amount, amountRaw: raw.toString(), to, market: "polymarket", wallet: clob.wallet },
    countsTowardLimit: false, valuation: { assetId, amountRaw: raw.toString(), decimals: 6 }
  };
}
