import { z } from "zod";
import { subjectExists, type ProjectionDatabase } from "./database";
import type { ApplyResult, ProjectionSource } from "./source";

const timestamp = z.string().datetime();

/**
 * A membership qualification result (`membership.updated`). It is rebuildable
 * from Aura policy plus provider inputs and never grants money by itself.
 */
export const membershipEventSchema = z.object({
  tier: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
  score: z.number().int().min(0).max(1_000_000),
  qualification: z.record(z.string(), z.unknown()).default({}),
  qualifyingSince: timestamp.optional(),
  renewalAt: timestamp
}).strict();

/** A provider-issued benefit allowance for one period (`benefit.entitlement.updated`). */
export const benefitEntitlementEventSchema = z.object({
  entitlementId: z.string().min(1).max(160),
  benefitKey: z.string().regex(/^[a-z][a-z0-9_.]{0,79}$/),
  status: z.enum(["active", "paused", "expired", "revoked"]),
  allowance: z.number().int().min(0).nullable().optional(),
  consumed: z.number().int().min(0).default(0),
  periodStart: timestamp,
  periodEnd: timestamp,
  providerReference: z.string().min(1).max(200).optional()
}).strict().refine((value) => value.periodEnd > value.periodStart, { message: "The benefit period must end after it starts." });

export type Membership = z.infer<typeof membershipEventSchema> & ProjectionSource;
export type BenefitEntitlement = z.infer<typeof benefitEntitlementEventSchema> & { provider: string };

export async function applyMembership(db: ProjectionDatabase, subjectReference: string, data: unknown, source: ProjectionSource): Promise<ApplyResult> {
  const parsed = membershipEventSchema.safeParse(data);
  if (!parsed.success) return { status: "ignored", reason: "invalid_payload", detail: parsed.error.issues[0]?.message };
  if (!await subjectExists(db, subjectReference)) return { status: "ignored", reason: "unknown_subject" };
  const membership = parsed.data;
  const result = await db.prepare(`INSERT INTO membership_projections
    (subject_reference, tier, score, qualification_json, qualifying_since, renewal_at, observed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(subject_reference) DO UPDATE SET tier = excluded.tier, score = excluded.score,
      qualification_json = excluded.qualification_json, qualifying_since = excluded.qualifying_since,
      renewal_at = excluded.renewal_at, observed_at = excluded.observed_at
    WHERE excluded.observed_at > membership_projections.observed_at`)
    .bind(subjectReference, membership.tier, membership.score, JSON.stringify(membership.qualification),
      membership.qualifyingSince ?? null, membership.renewalAt, source.observedAt).run();
  return { status: result.meta.changes ? "applied" : "stale", projection: "membership_projections" };
}

/** Consumption only moves forward, so a delayed event cannot hand a used benefit back. */
export async function applyBenefitEntitlement(db: ProjectionDatabase, subjectReference: string, data: unknown, source: ProjectionSource): Promise<ApplyResult> {
  const parsed = benefitEntitlementEventSchema.safeParse(data);
  if (!parsed.success) return { status: "ignored", reason: "invalid_payload", detail: parsed.error.issues[0]?.message };
  if (!await subjectExists(db, subjectReference)) return { status: "ignored", reason: "unknown_subject" };
  const benefit = parsed.data;
  const result = await db.prepare(`INSERT INTO benefit_entitlements
    (entitlement_id, subject_reference, benefit_key, provider, status, allowance, consumed, period_start, period_end, provider_reference)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(subject_reference, benefit_key, period_start) DO UPDATE SET
      status = excluded.status, allowance = excluded.allowance,
      consumed = MAX(benefit_entitlements.consumed, excluded.consumed),
      period_end = excluded.period_end, provider_reference = excluded.provider_reference
    WHERE benefit_entitlements.provider = excluded.provider`)
    .bind(benefit.entitlementId, subjectReference, benefit.benefitKey, source.provider, benefit.status,
      benefit.allowance ?? null, benefit.consumed, benefit.periodStart, benefit.periodEnd, benefit.providerReference ?? null).run();
  return { status: result.meta.changes ? "applied" : "stale", projection: "benefit_entitlements" };
}

export async function readMembership(db: ProjectionDatabase, subjectReference: string): Promise<Membership | null> {
  const row = await db.prepare(`SELECT tier, score, qualification_json, qualifying_since, renewal_at, observed_at
    FROM membership_projections WHERE subject_reference = ?`).bind(subjectReference)
    .first<{ tier: string; score: number; qualification_json: string; qualifying_since: string | null; renewal_at: string; observed_at: string }>();
  if (!row) return null;
  let qualification: Record<string, unknown> = {};
  try { qualification = JSON.parse(row.qualification_json) as Record<string, unknown>; } catch { /* keep an empty, clearly partial record */ }
  return { tier: row.tier, score: row.score, qualification, qualifyingSince: row.qualifying_since ?? undefined,
    renewalAt: row.renewal_at, observedAt: row.observed_at, provider: "aura-policy" };
}

/** Entitlements whose period includes `now`, newest period first. */
export async function readCurrentEntitlements(db: ProjectionDatabase, subjectReference: string, now = new Date().toISOString()): Promise<BenefitEntitlement[]> {
  const rows = await db.prepare(`SELECT entitlement_id, benefit_key, provider, status, allowance, consumed, period_start, period_end, provider_reference
    FROM benefit_entitlements WHERE subject_reference = ? AND period_start <= ? AND period_end > ?
    ORDER BY period_start DESC, benefit_key`).bind(subjectReference, now, now)
    .all<{ entitlement_id: string; benefit_key: string; provider: string; status: BenefitEntitlement["status"]; allowance: number | null;
      consumed: number; period_start: string; period_end: string; provider_reference: string | null }>();
  return rows.results.map((row) => ({ entitlementId: row.entitlement_id, benefitKey: row.benefit_key, provider: row.provider,
    status: row.status, allowance: row.allowance, consumed: row.consumed, periodStart: row.period_start, periodEnd: row.period_end,
    providerReference: row.provider_reference ?? undefined }));
}
