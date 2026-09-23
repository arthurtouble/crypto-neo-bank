import { nextOccurrence, type ScheduleType } from "@/lib/schedules/recurrence";

export type PriceAlert = { pairId: string; baseAssetId: string; quoteAssetId: string; quoteCurrency: string; mappingVersion: string; thresholdVersion: number; direction: "above" | "below"; threshold: string; hysteresisBps: number; cooldownSeconds: number; status: "active" | "paused" | "cancelled" };
export type PriceObservation = { pairId: string; baseAssetId: string; quoteAssetId: string; quoteCurrency: string; mappingVersion: string; price: string; sourceObservedAt: string; fetchedAt: string; observationId: string; mappingReviewed: boolean; assetEligible: boolean; depegged: boolean };
export type AlertCursor = { sourceObservedAt: string; observationId: string; thresholdVersion: number; armed: boolean; lastTriggeredAt: string | null };
export type AlertDecision = { accepted: boolean; trigger: boolean; next: AlertCursor | null; reason?: "inactive" | "untrusted" | "stale" | "out_of_order" };

const DECIMAL_SCALE = 10n ** 18n;
function decimal(value: string): bigint {
  if (!/^(?:0|[1-9]\d{0,59})(?:\.\d{1,18})?$/.test(value)) throw new Error("Invalid decimal price or amount.");
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * DECIMAL_SCALE + BigInt(fraction.padEnd(18, "0"));
}

/** Evaluate a provider-observed edge. Persist `next` and its occurrence in one DB transaction. */
export function decidePriceAlert(alert: PriceAlert, cursor: AlertCursor | null, observation: PriceObservation, now: Date, maxSourceAgeMs = 300_000): AlertDecision {
  const threshold = decimal(alert.threshold);
  if (threshold <= 0n || !Number.isSafeInteger(alert.thresholdVersion) || alert.thresholdVersion <= 0 || !Number.isInteger(alert.hysteresisBps) || alert.hysteresisBps < 0 || alert.hysteresisBps > 1000 || !Number.isInteger(alert.cooldownSeconds) || alert.cooldownSeconds < 0 || alert.cooldownSeconds > 604800) throw new Error("Invalid price alert.");
  if (!Number.isFinite(now.getTime()) || !Number.isFinite(maxSourceAgeMs) || maxSourceAgeMs <= 0) throw new Error("Invalid observation clock.");
  if (alert.status !== "active") return { accepted: false, trigger: false, next: cursor, reason: "inactive" };
  const observedAt = Date.parse(observation.sourceObservedAt);
  const fetchedAt = Date.parse(observation.fetchedAt);
  if (!observation.mappingReviewed || !observation.assetEligible || observation.depegged || !observation.observationId || observation.pairId !== alert.pairId || observation.baseAssetId !== alert.baseAssetId || observation.quoteAssetId !== alert.quoteAssetId || observation.quoteCurrency !== alert.quoteCurrency || observation.mappingVersion !== alert.mappingVersion || !Number.isFinite(fetchedAt) || !Number.isFinite(observedAt) || observedAt > fetchedAt || fetchedAt > now.getTime() + 60_000) return { accepted: false, trigger: false, next: cursor, reason: "untrusted" };
  if (observedAt > now.getTime() + 60_000 || now.getTime() - observedAt > maxSourceAgeMs) return { accepted: false, trigger: false, next: cursor, reason: "stale" };
  // Provider IDs identify observations but need not sort chronologically.
  if (cursor && observedAt <= Date.parse(cursor.sourceObservedAt)) return { accepted: false, trigger: false, next: cursor, reason: "out_of_order" };
  let price: bigint;
  try { price = decimal(observation.price); } catch { return { accepted: false, trigger: false, next: cursor, reason: "untrusted" }; }
  if (price <= 0n) return { accepted: false, trigger: false, next: cursor, reason: "untrusted" };
  const crossed = alert.direction === "above" ? price >= threshold : price <= threshold;
  const rearmed = alert.direction === "above"
    ? alert.hysteresisBps === 0 ? price < threshold : price * 10_000n <= threshold * BigInt(10_000 - alert.hysteresisBps)
    : alert.hysteresisBps === 0 ? price > threshold : price * 10_000n >= threshold * BigInt(10_000 + alert.hysteresisBps);
  const currentVersion = cursor?.thresholdVersion === alert.thresholdVersion ? cursor : null;
  const armed = currentVersion ? currentVersion.armed || rearmed : rearmed;
  const outsideCooldown = !currentVersion?.lastTriggeredAt || observedAt - Date.parse(currentVersion.lastTriggeredAt) >= alert.cooldownSeconds * 1000;
  const trigger = Boolean(currentVersion && armed && crossed && outsideCooldown);
  return { accepted: true, trigger, next: { sourceObservedAt: new Date(observedAt).toISOString(), observationId: observation.observationId, thresholdVersion: alert.thresholdVersion, armed: crossed ? false : armed, lastTriggeredAt: trigger ? new Date(observedAt).toISOString() : currentVersion?.lastTriggeredAt ?? null } };
}

export type SwapReminderPlan = { scheduleType: ScheduleType; timeZone: string; anchorLocal: string; status: "active" | "paused" | "cancelled" };
/** Only occurrences within the last 24 hours remain actionable; never create an execution mandate. */
export function dueSwapReminders(plan: SwapReminderPlan, after: Date, now: Date): { due: Date[]; nextDueAt: Date | null } {
  if (!Number.isFinite(after.getTime()) || !Number.isFinite(now.getTime())) throw new Error("Invalid reminder clock.");
  if (plan.status !== "active") return { due: [], nextDueAt: null };
  const lowerBound = new Date(Math.max(after.getTime(), now.getTime() - 86_400_000 - 1));
  const due: Date[] = [];
  let next = nextOccurrence({ ...plan, after: lowerBound });
  while (next && next <= now && due.length < 3) {
    due.push(next);
    next = nextOccurrence({ ...plan, after: next });
  }
  return { due, nextDueAt: next };
}
