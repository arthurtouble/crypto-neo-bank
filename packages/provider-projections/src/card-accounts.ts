import { z } from "zod";
import { subjectExists, type ProjectionDatabase } from "./database";
import type { ApplyResult, ProjectionSource } from "./source";

const decimal = z.string().regex(/^\d{1,12}(?:\.\d{1,2})?$/);

/** Issuer card state as reported through a provider event (`card.account.updated`). */
export const cardAccountEventSchema = z.object({
  cardReference: z.string().min(1).max(160),
  customerReference: z.string().min(1).max(160),
  status: z.enum(["eligible", "pending", "active", "frozen", "closed", "restricted"]),
  formFactor: z.enum(["virtual", "physical"]).optional(),
  network: z.enum(["visa", "mastercard"]).optional(),
  lastFour: z.string().regex(/^\d{4}$/).optional(),
  dailyLimit: decimal.optional(),
  monthlyLimit: decimal.optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).default("USD")
}).strict();
export type CardAccountEvent = z.infer<typeof cardAccountEventSchema>;

export type CardAccountProjection = CardAccountEvent & ProjectionSource;

type CardRow = {
  card_reference: string; provider: string; provider_customer_reference: string; status: CardAccountEvent["status"];
  form_factor: CardAccountEvent["formFactor"] | null; network: CardAccountEvent["network"] | null; last_four: string | null;
  daily_limit: string | null; monthly_limit: string | null; currency: string; observed_at: string;
};

/** Upsert one card; an event older than the stored observation never overwrites it. */
export async function applyCardAccount(db: ProjectionDatabase, subjectReference: string, data: unknown, source: ProjectionSource): Promise<ApplyResult> {
  const parsed = cardAccountEventSchema.safeParse(data);
  if (!parsed.success) return { status: "ignored", reason: "invalid_payload", detail: parsed.error.issues[0]?.message };
  if (!await subjectExists(db, subjectReference)) return { status: "ignored", reason: "unknown_subject" };
  const card = parsed.data;
  const result = await db.prepare(`INSERT INTO card_account_projections
    (card_reference, subject_reference, provider, provider_customer_reference, status, form_factor, network, last_four,
     daily_limit, monthly_limit, currency, observed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(card_reference) DO UPDATE SET
      status = excluded.status, form_factor = excluded.form_factor, network = excluded.network,
      last_four = excluded.last_four, daily_limit = excluded.daily_limit, monthly_limit = excluded.monthly_limit,
      currency = excluded.currency, provider_customer_reference = excluded.provider_customer_reference,
      observed_at = excluded.observed_at
    WHERE card_account_projections.subject_reference = excluded.subject_reference
      AND card_account_projections.provider = excluded.provider
      AND excluded.observed_at > card_account_projections.observed_at`)
    .bind(card.cardReference, subjectReference, source.provider, card.customerReference, card.status,
      card.formFactor ?? null, card.network ?? null, card.lastFour ?? null, card.dailyLimit ?? null,
      card.monthlyLimit ?? null, card.currency, source.observedAt).run();
  return { status: result.meta.changes ? "applied" : "stale", projection: "card_account_projections" };
}

/** The customer's most recently observed card that is not closed, or null. */
export async function readCurrentCardAccount(db: ProjectionDatabase, subjectReference: string): Promise<CardAccountProjection | null> {
  const row = await db.prepare(`SELECT card_reference, provider, provider_customer_reference, status, form_factor, network,
      last_four, daily_limit, monthly_limit, currency, observed_at
    FROM card_account_projections WHERE subject_reference = ? AND status != 'closed'
    ORDER BY observed_at DESC LIMIT 1`).bind(subjectReference).first<CardRow>();
  if (!row) return null;
  return {
    cardReference: row.card_reference, customerReference: row.provider_customer_reference, status: row.status,
    formFactor: row.form_factor ?? undefined, network: row.network ?? undefined, lastFour: row.last_four ?? undefined,
    dailyLimit: row.daily_limit ?? undefined, monthlyLimit: row.monthly_limit ?? undefined, currency: row.currency,
    provider: row.provider, observedAt: row.observed_at
  };
}
