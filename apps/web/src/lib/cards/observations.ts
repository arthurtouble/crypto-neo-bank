import type { CardActivity } from "./service";

/**
 * Keep what Stripe reported about each card payment, hold, decline, and
 * refund, so operators can see card spending across every customer
 * (`card_observations`). A projection, never a balance: Stripe is the
 * authority and its history rebuilds this. A settled transaction replaces the
 * hold it came from, so a purchase is listed once. Best effort; a failure
 * here never breaks the read or webhook that found the activity.
 */
export type CardObservation = Pick<CardActivity, "id" | "kind" | "status" | "amountUsd" | "merchant" | "createdAt" | "transactionHash"> & {
  authorizationId: string | null; cardId?: string | null; disputeStatus?: string | null };

export async function recordCardActivity(db: D1Database, subject: string, items: CardObservation[], now = new Date()): Promise<void> {
  if (!items.length) return;
  const at = now.toISOString();
  try {
    await db.batch(items.flatMap((item) => {
      const settled = item.id.startsWith("ipi_");
      const upsert = db.prepare(`INSERT INTO card_observations (activity_id, subject_reference, card_reference, authorization_id, kind, status, amount_usd, merchant,
          transaction_hash, dispute_status, occurred_at, observed_at)
        SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12 WHERE EXISTS (SELECT 1 FROM subject_profiles WHERE subject_reference = ?2)
          ${settled ? "" : "AND NOT EXISTS (SELECT 1 FROM card_observations WHERE authorization_id = ?1 AND activity_id != ?1)"}
        ON CONFLICT (activity_id) DO UPDATE SET status = excluded.status, amount_usd = excluded.amount_usd, merchant = COALESCE(excluded.merchant, merchant),
          transaction_hash = COALESCE(excluded.transaction_hash, transaction_hash), dispute_status = COALESCE(excluded.dispute_status, dispute_status),
          card_reference = COALESCE(excluded.card_reference, card_reference), observed_at = excluded.observed_at`)
        .bind(item.id, subject, item.cardId ?? null, item.authorizationId, item.kind, item.status, item.amountUsd, item.merchant, item.transactionHash,
          item.disputeStatus ?? null, item.createdAt, at);
      // Once settled, the hold it came from is the same purchase.
      return settled && item.authorizationId
        ? [upsert, db.prepare("DELETE FROM card_observations WHERE activity_id = ? AND subject_reference = ?").bind(item.authorizationId, subject)]
        : [upsert];
    }));
  } catch (error) {
    console.error(JSON.stringify({ level: "warn", event: "cards.record_failed", message: error instanceof Error ? error.message : "unknown" }));
  }
}
