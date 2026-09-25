import { z } from "zod";
import type { ProjectionDatabase } from "./database";
import type { ApplyResult, ProjectionSource } from "./source";

export const bankPayoutEventSchema = z.object({ transferId: z.string().min(1).max(200), state: z.string().min(1).max(40) }).strict();

/**
 * Bridge's side of a bank payout (funds received, sent, processed, returned).
 * It is appended to the funding action's history; the action's own status
 * still comes from the chain.
 */
export async function applyBankPayout(db: ProjectionDatabase, subjectReference: string, data: unknown, source: ProjectionSource): Promise<ApplyResult> {
  const parsed = bankPayoutEventSchema.safeParse(data);
  if (!parsed.success) return { status: "ignored", reason: "invalid_payload", detail: parsed.error.issues[0]?.message };
  // One entry per payout state, so a replayed webhook adds nothing.
  const result = await db.prepare(`INSERT OR IGNORE INTO action_events (event_id, action_id, event_type, evidence_json, occurred_at)
    SELECT ?, action_id, 'bank_payout', ?, ? FROM actions
    WHERE subject_reference = ? AND json_extract(summary_json, '$.bankPayout.transferId') = ?`)
    .bind(`bank_payout:${parsed.data.transferId}:${parsed.data.state}`, JSON.stringify({ provider: source.provider, state: parsed.data.state }), source.observedAt,
      subjectReference, parsed.data.transferId).run();
  return result.meta.changes ? { status: "applied", projection: "action_events" } : { status: "ignored", reason: "unknown_subject", detail: "no matching payout" };
}
