import { erc20Abi, formatUnits, isAddress } from "viem";
import { cardObservationSupersedes } from "@aurel/provider-projections";
import { baseClient } from "@/lib/assets/prices";
import { BASE_USDC } from "@/lib/assets/registry";
import { featureEnabled } from "@/lib/features/flags";
import { formatCents } from "@/lib/money/format";
import { activeBridgeCustomer, bridgeClient } from "@/lib/providers/bridge";
import { cardsApplicationLink, readCardsApproval } from "@/lib/providers/bridge/cards";
import { StripeClient } from "@/lib/providers/stripe/client";
import { cardProjectionStatus, getCard, listAuthorizationPage, listDisputes, listTransactionPage, type IssuingAuthorization, type IssuingCard, type IssuingDispute,
  type IssuingTransaction, type ListWindow } from "@/lib/providers/stripe/issuing";

/**
 * The Aura card: a Visa card issued by Stripe for Bridge, spending the
 * customer's own USDC on Base. Nothing is prefunded. The customer approves
 * Bridge's card contract to pull USDC, and Bridge pulls each purchase from
 * the wallet when it's authorized. Stripe is the authority for the card, its
 * controls, and its transactions; the chain for the balance and allowance.
 * D1 keeps only which card is the customer's.
 */
/** Stripe's default is 500 USD a day; Aura starts cards there and lets the customer change it. */
export const DEFAULT_DAILY_LIMIT_USD = 500;
export const MAX_DAILY_LIMIT_USD = 10_000;

export type CardView = { id: string; lastFour: string; brand: string; status: "active" | "frozen" | "canceled"; expMonth: number; expYear: number;
  dailyLimitUsd: number | null; wallets: { applePay: boolean; googlePay: boolean } };
export type Allowance = { status: "available"; allowanceUsd: string; balanceUsd: string; spender: string; observedAt: string } | { status: "unavailable"; observedAt: string };
export type CardActivity = { id: string; kind: "payment" | "refund"; status: "pending" | "completed" | "declined" | "reversed"; amountUsd: string;
  merchant: string | null; createdAt: string; transactionId: string | null; disputable: boolean; dispute: { id: string; status: string } | null;
  /** The Base transaction in which Bridge took the USDC for it, once Stripe reports one. */
  transactionHash: string | null;
  /** The hold a settled payment or refund came from. */
  authorizationId: string | null };

export type CardState =
  | { state: "unavailable" }
  | { state: "verify_first" }
  | { state: "apply"; approval: "none" | "incomplete" | "revoked"; issues: string[] }
  | { state: "ready_to_create" }
  /** The customer has a card but Stripe couldn't be read: nothing about it is shown as current, and Freeze still works. */
  | { state: "card_unavailable"; lastFour: string | null; observedAt: string }
  | { state: "card"; card: CardView; allowance: Allowance; activity: CardActivity[]; activityStatus: "available" | "unavailable";
      publishableKey: string | null; walletsEnabled: boolean; observedAt: string };

/** Cards are on only when the switch is on and Bridge, Stripe, and the card contract are configured. */
export async function cardsProvider(db: D1Database): Promise<{ stripe: StripeClient; spender: `0x${string}` } | null> {
  const key = process.env.STRIPE_SECRET_KEY;
  const spender = process.env.BRIDGE_CARDS_SPENDER;
  if (!key || !spender || !isAddress(spender) || !await featureEnabled(db, "payment_cards")) return null;
  return { stripe: new StripeClient(key), spender: spender.toLowerCase() as `0x${string}` };
}

export async function storedCardId(db: D1Database, subject: string): Promise<string | null> {
  const row = await db.prepare(`SELECT card_reference FROM card_account_projections WHERE subject_reference = ? AND provider = 'stripe' AND status != 'closed'
    ORDER BY observed_at DESC LIMIT 1`).bind(subject).first<{ card_reference: string }>();
  return row?.card_reference ?? null;
}

const statusOf = (card: IssuingCard): CardView["status"] => card.status === "inactive" ? "frozen" : card.status === "canceled" ? "canceled" : "active";

export function cardView(card: IssuingCard): CardView {
  const daily = card.spending_controls?.spending_limits?.find((limit) => limit.interval === "daily" && !(limit.categories?.length));
  return { id: card.id, lastFour: card.last4, brand: card.brand ?? "Visa", status: statusOf(card), expMonth: card.exp_month, expYear: card.exp_year,
    dailyLimitUsd: daily ? daily.amount / 100 : null,
    wallets: { applePay: card.wallets?.apple_pay?.eligible === true, googlePay: card.wallets?.google_pay?.eligible === true } };
}

/** Keep the customer's card mapping in step with what Stripe reports; an older read never overwrites a newer one, and another customer's card is never touched. */
export async function recordCard(db: D1Database, subject: string, cardholderId: string, card: IssuingCard, now = new Date()) {
  const view = cardView(card);
  await db.prepare(`INSERT INTO card_account_projections (card_reference, subject_reference, provider, provider_customer_reference, status, form_factor, network,
      last_four, daily_limit, currency, observed_at) VALUES (?, ?, 'stripe', ?, ?, ?, 'visa', ?, ?, 'USD', ?)
    ON CONFLICT(card_reference) DO UPDATE SET status = excluded.status, last_four = excluded.last_four, daily_limit = excluded.daily_limit, observed_at = excluded.observed_at
    WHERE card_account_projections.subject_reference = excluded.subject_reference AND card_account_projections.provider = excluded.provider
      AND ${cardObservationSupersedes()}`)
    .bind(card.id, subject, cardholderId, cardProjectionStatus(card.status), card.type, card.last4,
      view.dailyLimitUsd === null ? null : view.dailyLimitUsd.toFixed(2), now.toISOString()).run();
}

/** Record what Stripe just reported for a card Aura already maps to the customer, keeping its cardholder. */
export async function refreshCardProjection(db: D1Database, subject: string, card: IssuingCard, now = new Date()) {
  const row = await db.prepare("SELECT provider_customer_reference FROM card_account_projections WHERE card_reference = ?").bind(card.id).first<{ provider_customer_reference: string }>();
  await recordCard(db, subject, row?.provider_customer_reference ?? "", card, now);
}

/** How much USDC Bridge's card contract may pull, and how much the account holds, read from Base. */
async function readAllowance(wallet: `0x${string}`, spender: `0x${string}`, now = new Date()): Promise<Allowance> {
  try {
    const client = baseClient();
    const [allowance, balance] = await Promise.all([
      client.readContract({ address: BASE_USDC, abi: erc20Abi, functionName: "allowance", args: [wallet, spender] }),
      client.readContract({ address: BASE_USDC, abi: erc20Abi, functionName: "balanceOf", args: [wallet] })
    ]);
    return { status: "available", allowanceUsd: formatUnits(allowance, 6), balanceUsd: formatUnits(balance, 6), spender, observedAt: now.toISOString() };
  } catch { return { status: "unavailable", observedAt: now.toISOString() }; }
}

const DISPUTE_WINDOW_MS = 110 * 24 * 3600_000;
const cents = (amount: number) => formatCents(Math.abs(amount));

const hashOf = (auth: IssuingAuthorization | undefined) => auth?.crypto_transactions?.map((item) => item.crypto_transaction_confirmed?.transaction_hash)
  .find((hash): hash is string => typeof hash === "string" && /^0x[0-9a-fA-F]{64}$/.test(hash))?.toLowerCase() ?? null;

/** Holds still pending (or declined, or reversed), and settled payments and refunds with any dispute, newest first. */
function cardActivity(authorizations: IssuingAuthorization[], transactions: IssuingTransaction[], disputes: IssuingDispute[], now = new Date()): CardActivity[] {
  const disputeFor = new Map(disputes.map((dispute) => [dispute.transaction, dispute]));
  const authorizationFor = new Map(authorizations.map((auth) => [auth.id, auth]));
  const settled = new Set(transactions.map((transaction) => transaction.authorization).filter(Boolean));
  const holds: CardActivity[] = authorizations.filter((auth) => !settled.has(auth.id) && (auth.status === "pending" || !auth.approved || auth.status === "reversed"))
    .map((auth) => ({ id: auth.id, kind: "payment", status: !auth.approved ? "declined" : auth.status === "reversed" ? "reversed" : "pending", amountUsd: cents(auth.amount),
      merchant: auth.merchant_data?.name ?? null, createdAt: new Date(auth.created * 1000).toISOString(), transactionId: null, disputable: false, dispute: null,
      transactionHash: hashOf(auth), authorizationId: auth.id }));
  const posted: CardActivity[] = transactions.map((transaction) => {
    const dispute = disputeFor.get(transaction.id);
    return { id: transaction.id, kind: transaction.type === "refund" ? "refund" : "payment", status: "completed", amountUsd: cents(transaction.amount),
      merchant: transaction.merchant_data?.name ?? null, createdAt: new Date(transaction.created * 1000).toISOString(), transactionId: transaction.id,
      disputable: transaction.type === "capture" && !dispute && now.getTime() - transaction.created * 1000 < DISPUTE_WINDOW_MS,
      dispute: dispute ? { id: dispute.id, status: dispute.status } : null,
      transactionHash: transaction.authorization ? hashOf(authorizationFor.get(transaction.authorization)) : null,
      authorizationId: transaction.authorization ?? null };
  });
  return [...holds, ...posted].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

/**
 * One card's spending, read from Stripe, with the disputes on its own
 * transactions. `disputes` is read once per call for every card.
 * `partial` means Stripe had more than one page for the window.
 */
async function readOneCard(stripe: StripeClient, cardId: string, window: ListWindow, now: Date, disputes: Promise<IssuingDispute[]>) {
  const [authorizations, transactions, allDisputes] = await Promise.all([listAuthorizationPage(stripe, cardId, window), listTransactionPage(stripe, cardId, window), disputes]);
  const own = new Set(transactions.data.map((transaction) => transaction.id));
  return { items: cardActivity(authorizations.data, transactions.data, allDisputes.filter((dispute) => own.has(dispute.transaction)), now),
    partial: authorizations.hasMore || transactions.hasMore };
}

/** The card's recent spending, for the card screen. */
export async function readCardActivity(stripe: StripeClient, cardId: string, now = new Date()): Promise<CardActivity[]> {
  return (await readOneCard(stripe, cardId, {}, now, listDisputes(stripe))).items;
}

export type CardHistory = { status: "available" | "unavailable"; partial: boolean; items: CardActivity[] };

/**
 * Every card payment, hold, decline, and refund on the customer's cards, for
 * Transactions, statements, and Insights. Stripe is the source. A customer
 * with a card whose history can't be read gets "unavailable", never an empty list.
 */
export async function readCardHistory(db: D1Database, subject: string, window: ListWindow = {}, now = new Date()): Promise<CardHistory> {
  const { results } = await db.prepare("SELECT card_reference FROM card_account_projections WHERE subject_reference = ? AND provider = 'stripe' ORDER BY observed_at DESC LIMIT 5")
    .bind(subject).all<{ card_reference: string }>();
  if (!results.length) return { status: "available", partial: false, items: [] };
  const provider = await cardsProvider(db);
  if (!provider) return { status: "unavailable", partial: false, items: [] };
  try {
    const disputes = listDisputes(provider.stripe, { since: window.since });
    disputes.catch(() => undefined);
    const cards = await Promise.all(results.map((row) => readOneCard(provider.stripe, row.card_reference, { limit: 100, ...window }, now, disputes)));
    const { recordCardActivity } = await import("./observations");
    await recordCardActivity(db, subject, cards.flatMap((card, index) => card.items.map((item) => ({ ...item, cardId: results[index].card_reference,
      disputeStatus: item.dispute?.status ?? null }))), now);
    return { status: "available", partial: cards.some((card) => card.partial), items: cards.flatMap((card) => card.items) };
  } catch { return { status: "unavailable", partial: false, items: [] }; }
}

/** Everything the card screen needs, in one read. */
export async function readCardState(db: D1Database, subject: string, wallet: `0x${string}`, now = new Date()): Promise<CardState> {
  const [provider, bridge] = await Promise.all([cardsProvider(db), bridgeClient(db)]);
  if (!provider || !bridge) return { state: "unavailable" };
  const [customer, cardId] = await Promise.all([activeBridgeCustomer(db, subject), storedCardId(db, subject)]);
  if (!customer) return { state: "verify_first" };
  if (cardId) {
    let card: IssuingCard;
    try { card = await getCard(provider.stripe, cardId); }
    catch {
      const row = await db.prepare("SELECT last_four FROM card_account_projections WHERE card_reference = ?").bind(cardId).first<{ last_four: string | null }>();
      return { state: "card_unavailable", lastFour: row?.last_four ?? null, observedAt: now.toISOString() };
    }
    const [allowance, activity] = await Promise.all([readAllowance(wallet, provider.spender, now),
      readCardActivity(provider.stripe, cardId, now).then((items) => ({ items, status: "available" as const }), () => ({ items: [], status: "unavailable" as const }))]);
    await refreshCardProjection(db, subject, card, now);
    if (card.status !== "canceled") return { state: "card", card: cardView(card), allowance, activity: activity.items, activityStatus: activity.status,
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY ?? null, walletsEnabled: await featureEnabled(db, "card_wallets"), observedAt: now.toISOString() };
  }
  const approval = await readCardsApproval(bridge, customer);
  if (approval.status === "approved" && approval.cardholderId) return { state: "ready_to_create" };
  return { state: "apply", approval: approval.status === "approved" ? "incomplete" : approval.status, issues: approval.issues };
}

export async function applicationLink(db: D1Database, subject: string): Promise<string | null> {
  const bridge = await bridgeClient(db);
  const customer = bridge && await activeBridgeCustomer(db, subject);
  return bridge && customer ? cardsApplicationLink(bridge, customer) : null;
}

/** Locking the account freezes the card too, so a lock stops card spending as well. Best effort; Stripe stays the authority. */
export async function freezeCardForLock(db: D1Database, subject: string, now = new Date()): Promise<void> {
  try {
    const provider = await cardsProvider(db);
    const cardId = provider && await storedCardId(db, subject);
    if (!provider || !cardId) return;
    const { updateCard } = await import("@/lib/providers/stripe/issuing");
    const card = await updateCard(provider.stripe, cardId, { status: "inactive" }, `lock:${cardId}:${now.toISOString()}`);
    await refreshCardProjection(db, subject, card, now);
  } catch (error) {
    console.error(JSON.stringify({ level: "warn", event: "cards.lock_freeze_failed", message: error instanceof Error ? error.message : "unknown" }));
  }
}
