import { erc20Abi, formatUnits, isAddress } from "viem";
import { baseClient } from "@/lib/assets/prices";
import { featureEnabled } from "@/lib/features/flags";
import { activeBridgeCustomer, bridgeClient } from "@/lib/providers/bridge";
import { cardsApplicationLink, readCardsApproval } from "@/lib/providers/bridge/cards";
import { StripeClient } from "@/lib/providers/stripe/client";
import { getCard, listAuthorizations, listDisputes, listTransactions, type IssuingCard } from "@/lib/providers/stripe/issuing";

/**
 * The Aura card: a Visa card issued by Stripe for Bridge, spending the
 * customer's own USDC on Base. Nothing is prefunded. The customer approves
 * Bridge's card contract to pull USDC, and Bridge pulls each purchase from
 * the wallet when it's authorized. Stripe is the authority for the card, its
 * controls, and its transactions; the chain for the balance and allowance.
 * D1 keeps only which card is the customer's.
 */
export const BASE_USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
/** Stripe's default is 500 USD a day; Aura starts cards there and lets the customer change it. */
export const DEFAULT_DAILY_LIMIT_USD = 500;
export const MAX_DAILY_LIMIT_USD = 10_000;

export type CardView = { id: string; lastFour: string; brand: string; status: "active" | "frozen" | "canceled"; expMonth: number; expYear: number;
  dailyLimitUsd: number | null; wallets: { applePay: boolean; googlePay: boolean } };
export type Allowance = { status: "available"; allowanceUsd: string; balanceUsd: string; spender: string; observedAt: string } | { status: "unavailable"; observedAt: string };
export type CardActivity = { id: string; kind: "payment" | "refund"; status: "pending" | "completed" | "declined" | "reversed"; amountUsd: string;
  merchant: string | null; createdAt: string; transactionId: string | null; disputable: boolean; dispute: { id: string; status: string } | null };

export type CardState =
  | { state: "unavailable" }
  | { state: "verify_first" }
  | { state: "apply"; approval: "none" | "incomplete" | "revoked"; issues: string[] }
  | { state: "ready_to_create" }
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

/** Keep the customer's card mapping in step with what Stripe reports. */
export async function recordCard(db: D1Database, subject: string, cardholderId: string, card: IssuingCard, now = new Date()) {
  const view = cardView(card);
  await db.prepare(`INSERT INTO card_account_projections (card_reference, subject_reference, provider, provider_customer_reference, status, form_factor, network,
      last_four, daily_limit, currency, observed_at) VALUES (?, ?, 'stripe', ?, ?, ?, 'visa', ?, ?, 'USD', ?)
    ON CONFLICT(card_reference) DO UPDATE SET status = excluded.status, last_four = excluded.last_four, daily_limit = excluded.daily_limit, observed_at = excluded.observed_at`)
    .bind(card.id, subject, cardholderId, view.status === "frozen" ? "frozen" : view.status === "canceled" ? "closed" : "active", card.type, card.last4,
      view.dailyLimitUsd === null ? null : view.dailyLimitUsd.toFixed(2), now.toISOString()).run();
}

/** How much USDC Bridge's card contract may pull, and how much the account holds, read from Base. */
export async function readAllowance(wallet: `0x${string}`, spender: `0x${string}`, now = new Date()): Promise<Allowance> {
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
const cents = (amount: number) => (Math.abs(amount) / 100).toFixed(2);

/** The card's recent spending: holds still pending, and settled payments and refunds, with any dispute. */
export async function readCardActivity(stripe: StripeClient, cardId: string, now = new Date()): Promise<CardActivity[]> {
  const [authorizations, transactions, disputes] = await Promise.all([listAuthorizations(stripe, cardId), listTransactions(stripe, cardId), listDisputes(stripe)]);
  const disputeFor = new Map(disputes.map((dispute) => [dispute.transaction, dispute]));
  const settled = new Set(transactions.map((transaction) => transaction.authorization).filter(Boolean));
  const holds: CardActivity[] = authorizations.filter((auth) => !settled.has(auth.id) && (auth.status === "pending" || !auth.approved || auth.status === "reversed"))
    .map((auth) => ({ id: auth.id, kind: "payment", status: !auth.approved ? "declined" : auth.status === "reversed" ? "reversed" : "pending", amountUsd: cents(auth.amount),
      merchant: auth.merchant_data?.name ?? null, createdAt: new Date(auth.created * 1000).toISOString(), transactionId: null, disputable: false, dispute: null }));
  const posted: CardActivity[] = transactions.map((transaction) => {
    const dispute = disputeFor.get(transaction.id);
    return { id: transaction.id, kind: transaction.type === "refund" ? "refund" : "payment", status: "completed", amountUsd: cents(transaction.amount),
      merchant: transaction.merchant_data?.name ?? null, createdAt: new Date(transaction.created * 1000).toISOString(), transactionId: transaction.id,
      disputable: transaction.type === "capture" && !dispute && now.getTime() - transaction.created * 1000 < DISPUTE_WINDOW_MS,
      dispute: dispute ? { id: dispute.id, status: dispute.status } : null };
  });
  return [...holds, ...posted].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

/** Everything the card screen needs, in one read. */
export async function readCardState(db: D1Database, subject: string, wallet: `0x${string}`, now = new Date()): Promise<CardState> {
  const provider = await cardsProvider(db);
  const bridge = await bridgeClient(db);
  if (!provider || !bridge) return { state: "unavailable" };
  const customer = await activeBridgeCustomer(db, subject);
  if (!customer) return { state: "verify_first" };
  const cardId = await storedCardId(db, subject);
  if (cardId) {
    const [card, allowance, activity] = await Promise.all([getCard(provider.stripe, cardId), readAllowance(wallet, provider.spender, now),
      readCardActivity(provider.stripe, cardId, now).then((items) => ({ items, status: "available" as const }), () => ({ items: [], status: "unavailable" as const }))]);
    const row = await db.prepare("SELECT provider_customer_reference FROM card_account_projections WHERE card_reference = ?").bind(cardId).first<{ provider_customer_reference: string }>();
    await recordCard(db, subject, row?.provider_customer_reference ?? "", card, now);
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
    const row = await db.prepare("SELECT provider_customer_reference FROM card_account_projections WHERE card_reference = ?").bind(cardId).first<{ provider_customer_reference: string }>();
    await recordCard(db, subject, row?.provider_customer_reference ?? "", card, now);
  } catch (error) {
    console.error(JSON.stringify({ level: "warn", event: "cards.lock_freeze_failed", message: error instanceof Error ? error.message : "unknown" }));
  }
}
