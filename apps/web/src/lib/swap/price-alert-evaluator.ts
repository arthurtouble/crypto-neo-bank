import { decidePriceAlert, type AlertCursor, type PriceAlert, type PriceObservation } from "@/lib/swap/reminder-decisions";

type AlertRow = {
  alert_id: string; subject_reference: string; pair_id: string; base_asset_id: string; quote_asset_id: string;
  quote_currency: string; mapping_version: string; direction: "above" | "below"; threshold_decimal: string;
  hysteresis_bps: number; cooldown_seconds: number; status: "active" | "paused" | "cancelled";
  threshold_version: number; last_source_observed_at: string | null; last_observation_id: string | null;
  armed: number; last_triggered_at: string | null;
};

export type PersistedAlertDecision = { accepted: boolean; triggered: boolean; reason?: string };

/**
 * Persist one already-authenticated, provider-sourced observation. This module
 * does not fetch prices, enumerate subjects, send notifications, quote, or sign.
 * The caller must supply a fresh reviewed observation and enforce current
 * customer, asset, country, feature, and incident eligibility before invoking.
 */
export async function evaluateAlertObservation(
  db: D1Database, subjectReference: string, alertId: string, observation: PriceObservation, now = new Date()
): Promise<PersistedAlertDecision | null> {
  const row = await db.prepare("SELECT * FROM price_alerts WHERE alert_id = ? AND subject_reference = ?")
    .bind(alertId, subjectReference).first<AlertRow>();
  if (!row) return null;
  if (row.last_source_observed_at !== null && row.last_observation_id === null) throw new Error("Corrupt alert cursor.");
  const alert: PriceAlert = {
    pairId: row.pair_id, baseAssetId: row.base_asset_id, quoteAssetId: row.quote_asset_id,
    quoteCurrency: row.quote_currency, mappingVersion: row.mapping_version, direction: row.direction,
    threshold: row.threshold_decimal, thresholdVersion: row.threshold_version,
    hysteresisBps: row.hysteresis_bps, cooldownSeconds: row.cooldown_seconds, status: row.status
  };
  const cursor: AlertCursor | null = row.last_source_observed_at === null ? null : {
    sourceObservedAt: row.last_source_observed_at, observationId: row.last_observation_id!,
    thresholdVersion: row.threshold_version, armed: row.armed === 1, lastTriggeredAt: row.last_triggered_at
  };
  const decision = decidePriceAlert(alert, cursor, observation, now);
  if (!decision.accepted || !decision.next) return { accepted: false, triggered: false, reason: decision.reason };

  const next = decision.next;
  const timestamp = now.toISOString();
  const statements = [
    db.prepare(`UPDATE price_alerts SET last_source_observed_at = ?, last_observation_id = ?, armed = ?, last_triggered_at = ?, updated_at = ?
      WHERE alert_id = ? AND subject_reference = ? AND status = 'active' AND threshold_version = ?
      AND last_source_observed_at IS ? AND last_observation_id IS ? AND armed = ? AND last_triggered_at IS ?`)
      .bind(next.sourceObservedAt, next.observationId, next.armed ? 1 : 0, next.lastTriggeredAt, timestamp,
        alertId, subjectReference, row.threshold_version, row.last_source_observed_at, row.last_observation_id, row.armed, row.last_triggered_at)
  ];
  if (decision.trigger) {
    const occurrenceId = crypto.randomUUID();
    const auditId = crypto.randomUUID();
    statements.push(
      db.prepare(`INSERT INTO swap_reminder_occurrences
        (occurrence_id, subject_reference, kind, alert_id, threshold_version, crossing_observation_id, observed_price_decimal, source_observed_at, created_at)
        SELECT ?, subject_reference, 'alert', alert_id, threshold_version, ?, ?, ?, ? FROM price_alerts
        WHERE alert_id = ? AND subject_reference = ? AND threshold_version = ? AND last_source_observed_at = ? AND last_observation_id = ? AND changes() = 1`)
        .bind(occurrenceId, observation.observationId, observation.price, observation.sourceObservedAt, timestamp,
          alertId, subjectReference, row.threshold_version, next.sourceObservedAt, next.observationId),
      db.prepare(`INSERT INTO audit_events (audit_id, subject_reference, actor_type, actor_reference, action, target_type, target_reference, evidence_json, occurred_at)
        SELECT ?, ?, 'system', 'price-alert-evaluator', 'swap.alert.triggered', 'swap_reminder_occurrence', ?, ?, ? WHERE changes() = 1`)
        .bind(auditId, subjectReference, occurrenceId,
          JSON.stringify({ alertId, thresholdVersion: row.threshold_version, observationId: observation.observationId }), timestamp)
    );
  }
  const [updated, inserted] = await db.batch(statements);
  if (updated.meta.changes !== 1) return { accepted: false, triggered: false, reason: "concurrent_change" };
  if (decision.trigger && inserted?.meta.changes !== 1) throw new Error("Alert occurrence was not committed.");
  return { accepted: true, triggered: decision.trigger };
}
