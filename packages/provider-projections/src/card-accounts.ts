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
type CardAccountEvent = z.infer<typeof cardAccountEventSchema>;

const statusRank = (column: string) => `(CASE ${column} WHEN 'eligible' THEN 0 WHEN 'pending' THEN 1 WHEN 'active' THEN 2
  WHEN 'restricted' THEN 3 WHEN 'frozen' THEN 4 WHEN 'closed' THEN 5 ELSE 0 END)`;

/**
 * SQL for an upsert's WHERE: the incoming card observation (`excluded`)
 * replaces the stored one only if it is newer. Stripe reports event times to
 * the second, so two updates can share a timestamp; then the more restrictive
 * status wins (closed, frozen, restricted, active, pending, eligible) and the
 * same status is applied, so the outcome doesn't depend on arrival order.
 */
export const cardObservationSupersedes = (stored = "card_account_projections", incoming = "excluded") =>
  `(${incoming}.observed_at > ${stored}.observed_at OR (${incoming}.observed_at = ${stored}.observed_at
    AND ${statusRank(`${incoming}.status`)} >= ${statusRank(`${stored}.status`)}))`;

/** Upsert one card; an event older than the stored observation never overwrites it (`cardObservationSupersedes`). */
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
      AND ${cardObservationSupersedes()}`)
    .bind(card.cardReference, subjectReference, source.provider, card.customerReference, card.status,
      card.formFactor ?? null, card.network ?? null, card.lastFour ?? null, card.dailyLimit ?? null,
      card.monthlyLimit ?? null, card.currency, source.observedAt).run();
  return { status: result.meta.changes ? "applied" : "stale", projection: "card_account_projections" };
}
