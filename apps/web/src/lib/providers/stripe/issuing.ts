import { z } from "zod";
import type { StripeClient } from "./client";

/**
 * Stripe Issuing, for cards Bridge backs with the customer's own USDC on Base.
 * Stripe is the authority for the card, its controls, authorizations,
 * transactions, and disputes. Amounts are integer cents.
 */

const limitSchema = z.object({ amount: z.number().int().nonnegative(), interval: z.string(), categories: z.array(z.string()).nullable().optional() }).passthrough();
export const cardSchema = z.object({
  id: z.string().startsWith("ic_"),
  brand: z.string().optional(),
  status: z.enum(["active", "inactive", "canceled"]),
  type: z.enum(["virtual", "physical"]),
  last4: z.string().regex(/^\d{4}$/),
  exp_month: z.number().int(),
  exp_year: z.number().int(),
  currency: z.string(),
  cancellation_reason: z.string().nullable().optional(),
  crypto_wallet: z.object({ address: z.string(), chain: z.string(), currency: z.string(), type: z.string() }).passthrough().nullable().optional(),
  spending_controls: z.object({ spending_limits: z.array(limitSchema).nullable().optional() }).passthrough().optional(),
  wallets: z.object({
    apple_pay: z.object({ eligible: z.boolean(), ineligible_reason: z.string().nullable().optional() }).passthrough().optional(),
    google_pay: z.object({ eligible: z.boolean(), ineligible_reason: z.string().nullable().optional() }).passthrough().optional()
  }).passthrough().nullable().optional()
}).passthrough();
export type IssuingCard = z.infer<typeof cardSchema>;

const merchantSchema = z.object({ name: z.string().nullable().optional(), city: z.string().nullable().optional(), country: z.string().nullable().optional(),
  category: z.string().nullable().optional() }).passthrough();
export const authorizationSchema = z.object({
  id: z.string().startsWith("iauth_"),
  amount: z.number().int(),
  currency: z.string(),
  approved: z.boolean(),
  status: z.enum(["pending", "closed", "reversed", "expired"]),
  created: z.number().int(),
  merchant_data: merchantSchema.optional(),
  wallet: z.string().nullable().optional(),
  crypto_transactions: z.array(z.object({ crypto_transaction_confirmed: z.object({ transaction_hash: z.string(), amount: z.string() }).passthrough().nullable().optional() }).passthrough()).optional()
}).passthrough();
export type IssuingAuthorization = z.infer<typeof authorizationSchema>;

export const transactionSchema = z.object({
  id: z.string().startsWith("ipi_"),
  type: z.enum(["capture", "refund"]),
  amount: z.number().int(),
  currency: z.string(),
  created: z.number().int(),
  authorization: z.string().nullable().optional(),
  dispute: z.string().nullable().optional(),
  merchant_data: merchantSchema.optional()
}).passthrough();
export type IssuingTransaction = z.infer<typeof transactionSchema>;

export const disputeSchema = z.object({
  id: z.string().startsWith("idp_"),
  status: z.enum(["unsubmitted", "submitted", "won", "lost", "expired"]),
  transaction: z.string(),
  amount: z.number().int(),
  created: z.number().int(),
  evidence: z.object({ reason: z.string() }).passthrough().optional()
}).passthrough();
export type IssuingDispute = z.infer<typeof disputeSchema>;

const list = <T extends z.ZodTypeAny>(item: T) => z.object({ data: z.array(item), has_more: z.boolean().optional() }).passthrough();

/** A virtual card that spends the customer's USDC on Base through Bridge (a non-custodial "standard" wallet). */
export function createCard(stripe: StripeClient, input: { cardholderId: string; wallet: string; dailyLimitCents: number; requestId: string }) {
  return stripe.request("/v1/issuing/cards", cardSchema, { method: "POST", idempotencyKey: `card:${input.requestId}`, form: {
    cardholder: input.cardholderId, currency: "usd", type: "virtual", status: "active",
    crypto_wallet: { chain: "base", currency: "usdc", type: "standard", address: input.wallet },
    spending_controls: { spending_limits: [{ amount: input.dailyLimitCents, interval: "daily" }] }
  } });
}

export const getCard = (stripe: StripeClient, cardId: string) => stripe.request(`/v1/issuing/cards/${encodeURIComponent(cardId)}`, cardSchema);

/** Freeze (inactive), unfreeze (active), or change the daily limit. */
export function updateCard(stripe: StripeClient, cardId: string, change: { status?: "active" | "inactive"; dailyLimitCents?: number }, requestId: string) {
  return stripe.request(`/v1/issuing/cards/${encodeURIComponent(cardId)}`, cardSchema, { method: "POST", idempotencyKey: `card-update:${requestId}`, form: {
    status: change.status,
    spending_controls: change.dailyLimitCents === undefined ? undefined : { spending_limits: [{ amount: change.dailyLimitCents, interval: "daily" }] }
  } });
}

/** A card's newest items, optionally only those created in [since, until). Stripe's limit is 100 per page. */
export type ListWindow = { limit?: number; since?: Date; until?: Date };
const windowQuery = (cardId: string, { limit = 30, since, until }: ListWindow) => ({ card: cardId, limit: String(limit),
  ...(since ? { "created[gte]": String(Math.floor(since.getTime() / 1000)) } : {}), ...(until ? { "created[lt]": String(Math.floor(until.getTime() / 1000)) } : {}) });

export async function listAuthorizationPage(stripe: StripeClient, cardId: string, window: ListWindow = {}) {
  const page = await stripe.request("/v1/issuing/authorizations", list(authorizationSchema), { query: windowQuery(cardId, window) });
  return { data: page.data, hasMore: page.has_more === true };
}

export async function listTransactionPage(stripe: StripeClient, cardId: string, window: ListWindow = {}) {
  const page = await stripe.request("/v1/issuing/transactions", list(transactionSchema), { query: windowQuery(cardId, window) });
  return { data: page.data, hasMore: page.has_more === true };
}

export const listAuthorizations = async (stripe: StripeClient, cardId: string, limit = 30) => (await listAuthorizationPage(stripe, cardId, { limit })).data;
export const listTransactions = async (stripe: StripeClient, cardId: string, limit = 30) => (await listTransactionPage(stripe, cardId, { limit })).data;

export async function listDisputes(stripe: StripeClient, limit = 100) {
  return (await stripe.request("/v1/issuing/disputes", list(disputeSchema), { query: { limit: String(limit) } })).data;
}

/**
 * A 15-minute key that lets the customer's browser show this one card's
 * details in Stripe's own frames. The nonce comes from Stripe.js in that browser.
 */
export async function createEphemeralKey(stripe: StripeClient, cardId: string, nonce: string) {
  return (await stripe.request("/v1/ephemeral_keys", z.object({ secret: z.string().min(1) }).passthrough(), {
    method: "POST", form: { issuing_card: cardId, nonce }, version: "2026-08-26.dahlia" })).secret;
}

export type DisputeReason = "fraudulent" | "not_received" | "duplicate" | "canceled" | "other";

/** Open and submit a dispute for a settled card transaction. A dispute can be submitted only once. */
export async function openDispute(stripe: StripeClient, input: { transactionId: string; reason: DisputeReason; explanation: string; requestId: string }) {
  const evidence = input.reason === "not_received" ? { reason: "merchandise_not_as_described", merchandise_not_as_described: { explanation: input.explanation } }
    : input.reason === "fraudulent" ? { reason: "fraudulent", fraudulent: { explanation: input.explanation } }
      : input.reason === "duplicate" ? { reason: "duplicate", duplicate: { explanation: input.explanation } }
        : input.reason === "canceled" ? { reason: "canceled", canceled: { explanation: input.explanation } }
          : { reason: "other", other: { explanation: input.explanation } };
  const dispute = await stripe.request("/v1/issuing/disputes", disputeSchema, { method: "POST", idempotencyKey: `dispute:${input.requestId}`,
    form: { transaction: input.transactionId, evidence } });
  return stripe.request(`/v1/issuing/disputes/${encodeURIComponent(dispute.id)}/submit`, disputeSchema, { method: "POST", idempotencyKey: `dispute-submit:${input.requestId}` });
}
