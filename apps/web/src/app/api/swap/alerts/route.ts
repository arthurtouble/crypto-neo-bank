import { env } from "cloudflare:workers";
import { z } from "zod";
import { AuthenticationError, requireVerifiedSubject } from "@/lib/auth/server";
import { BetaAccessError, configuredCountries, requireBetaAccess } from "@/lib/beta/access";
import { FeatureUnavailableError, featureEnabled, requireFeature } from "@/lib/features/flags";
import { REVIEWED_PRICE_ALERT_PAIR as pair } from "@/lib/markets/alert-mapping";
import { ensureSubjectProfile } from "@/lib/profile/ensure";
import { enforceRateLimit, RateLimitError } from "@/lib/security/rate-limit";
import { CATALOG_REGISTRY } from "@/lib/swap/catalog-registry";
import { resolveCatalogAsset } from "@/lib/swap/catalog";

const noStore = { "Cache-Control": "no-store" };
const threshold = z.string().regex(/^(?:0|[1-9]\d{0,59})(?:\.\d{1,18})?$/).refine((value) => /[1-9]/.test(value));
const create = z.object({ pairId: z.literal(pair.pairId), direction: z.enum(["above", "below"]), threshold,
  hysteresisBps: z.number().int().min(0).max(1000).optional(), cooldownSeconds: z.number().int().min(0).max(604800).optional() }).strict();
const change = z.object({ alertId: z.string().uuid(), version: z.number().int().positive(), action: z.enum(["pause", "resume", "cancel", "edit"]),
  direction: z.enum(["above", "below"]).optional(), threshold: threshold.optional(),
  hysteresisBps: z.number().int().min(0).max(1000).optional(), cooldownSeconds: z.number().int().min(0).max(604800).optional() })
  .strict().refine((value) => value.action === "edit"
    ? [value.direction, value.threshold, value.hysteresisBps, value.cooldownSeconds].some((field) => field !== undefined)
    : [value.direction, value.threshold, value.hysteresisBps, value.cooldownSeconds].every((field) => field === undefined));

type AlertRow = { alert_id: string; pair_id: string; base_asset_id: string; quote_asset_id: string; quote_currency: string; mapping_version: string;
  direction: "above" | "below"; threshold_decimal: string; hysteresis_bps: number; cooldown_seconds: number;
  status: "active" | "paused" | "cancelled"; threshold_version: number; created_at: string; updated_at: string };

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { ...noStore, ...headers } });
}
function present(row: AlertRow) {
  return { alertId: row.alert_id, pairId: row.pair_id, baseAssetId: row.base_asset_id, quoteAssetId: row.quote_asset_id,
    quoteCurrency: row.quote_currency, mappingVersion: row.mapping_version, direction: row.direction, threshold: row.threshold_decimal,
    hysteresisBps: row.hysteresis_bps, cooldownSeconds: row.cooldown_seconds, status: row.status,
    thresholdVersion: row.threshold_version, createdAt: row.created_at, updatedAt: row.updated_at };
}
function instruction(row: AlertRow) {
  return { pairId: row.pair_id, baseAssetId: row.base_asset_id, quoteAssetId: row.quote_asset_id,
    quoteCurrency: row.quote_currency, mappingVersion: row.mapping_version, direction: row.direction,
    threshold: row.threshold_decimal, hysteresisBps: row.hysteresis_bps, cooldownSeconds: row.cooldown_seconds,
    status: row.status, version: row.threshold_version };
}
type Eligibility = { status: "eligible"; mode: "preview" | "invite"; countryCode: string | null } | { status: "account_locked" | "asset_unavailable" };
async function eligible(subjectReference: string): Promise<Eligibility> {
  const beta = await requireBetaAccess(env.PROJECTION_DB, subjectReference);
  const countries = configuredCountries();
  if (countries.length && (!beta.countryCode || !countries.includes(beta.countryCode))) throw new BetaAccessError("country_unavailable", "This feature is unavailable in your country.");
  await requireFeature(env.PROJECTION_DB, "swaps");
  await ensureSubjectProfile(env.PROJECTION_DB, subjectReference);
  const security = await env.PROJECTION_DB.prepare("SELECT account_locked FROM security_profiles WHERE subject_reference = ?")
    .bind(subjectReference).first<{ account_locked: number }>();
  if (!security || security.account_locked) return { status: "account_locked" };
  if (!CATALOG_REGISTRY.verified.has(pair.baseAssetId) || CATALOG_REGISTRY.denied.has(pair.baseAssetId)
    || CATALOG_REGISTRY.regulated.has(pair.baseAssetId)) return { status: "asset_unavailable" };
  const asset = await resolveCatalogAsset(pair.baseAssetId).catch(() => null);
  if (asset?.verification !== "verified" || asset.eligibility !== "eligible") return { status: "asset_unavailable" };
  return { status: "eligible", mode: beta.mode, countryCode: beta.countryCode ?? null };
}

export async function GET(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    const subject = await requireVerifiedSubject(request);
    const rows = await env.PROJECTION_DB.prepare("SELECT * FROM price_alerts WHERE subject_reference = ? AND status != 'cancelled' ORDER BY created_at DESC LIMIT 100")
      .bind(subject.subjectReference).all<AlertRow>();
    const planningAvailable = await featureEnabled(env.PROJECTION_DB, "swaps");
    return json({ alerts: rows.results.map(present), planningAvailable, execution: "customer_review_required", delivery: "not_active", traceId });
  } catch (error) { return failure(error, traceId, "read"); }
}

export async function POST(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    const subject = await requireVerifiedSubject(request);
    await enforceRateLimit(env.PROJECTION_DB, { namespace: "price_alert_mutation", subject: subject.subjectReference, limit: 12, windowSeconds: 3600 });
    const input = create.parse(await request.json());
    const eligibility = await eligible(subject.subjectReference);
    if (eligibility.status !== "eligible") return json({ error: eligibility.status, traceId }, eligibility.status === "account_locked" ? 423 : 400);
    const id = crypto.randomUUID(), auditId = crypto.randomUUID(), now = new Date().toISOString();
    const after = { ...pair, direction: input.direction, threshold: input.threshold,
      hysteresisBps: input.hysteresisBps ?? 100, cooldownSeconds: input.cooldownSeconds ?? 3600,
      status: "active", version: 1 };
    const [inserted] = await env.PROJECTION_DB.batch([
      env.PROJECTION_DB.prepare(`INSERT INTO price_alerts
        (alert_id, subject_reference, pair_id, base_asset_id, quote_asset_id, quote_currency, mapping_version,
         direction, threshold_decimal, hysteresis_bps, cooldown_seconds, status, threshold_version, created_at, updated_at)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 1, ?, ?
        WHERE (SELECT COUNT(*) FROM price_alerts WHERE subject_reference = ? AND status != 'cancelled') < 100
          AND EXISTS (SELECT 1 FROM security_profiles WHERE subject_reference = ? AND account_locked = 0)
          AND EXISTS (SELECT 1 FROM feature_flags WHERE flag_key = 'swaps' AND enabled = 1)
          AND (? = 'preview' OR EXISTS (SELECT 1 FROM beta_access WHERE subject_reference = ? AND status = 'active' AND country_code = ?))`)
        .bind(id, subject.subjectReference, pair.pairId, pair.baseAssetId, pair.quoteAssetId, pair.quoteCurrency, pair.mappingVersion,
          input.direction, input.threshold, input.hysteresisBps ?? 100, input.cooldownSeconds ?? 3600, now, now,
          subject.subjectReference, subject.subjectReference, eligibility.mode, subject.subjectReference, eligibility.countryCode),
      env.PROJECTION_DB.prepare(`INSERT INTO audit_events (audit_id, subject_reference, actor_type, actor_reference, action, target_type, target_reference, evidence_json, occurred_at)
        SELECT ?, ?, 'customer', ?, 'swap.alert.created', 'price_alert', ?, ?, ? WHERE changes() = 1`)
        .bind(auditId, subject.subjectReference, subject.subjectReference, id, JSON.stringify({ before: null, after }), now)
    ]);
    if (inserted.meta.changes !== 1) return json({ error: "alert_changed", traceId }, 409);
    const row = await env.PROJECTION_DB.prepare("SELECT * FROM price_alerts WHERE alert_id = ? AND subject_reference = ?")
      .bind(id, subject.subjectReference).first<AlertRow>();
    if (!row) throw new Error("Created alert could not be read.");
    return json({ alert: present(row), execution: "customer_review_required", delivery: "not_active", traceId }, 201);
  } catch (error) { return failure(error, traceId, "create"); }
}

export async function PATCH(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    const subject = await requireVerifiedSubject(request);
    await enforceRateLimit(env.PROJECTION_DB, { namespace: "price_alert_mutation", subject: subject.subjectReference, limit: 24, windowSeconds: 3600 });
    const input = change.parse(await request.json());
    const current = await env.PROJECTION_DB.prepare("SELECT * FROM price_alerts WHERE alert_id = ? AND subject_reference = ?")
      .bind(input.alertId, subject.subjectReference).first<AlertRow>();
    if (!current) return json({ error: "alert_not_found", traceId }, 404);
    if (current.threshold_version !== input.version || current.status === "cancelled"
      || input.action === "pause" && current.status !== "active"
      || input.action === "resume" && current.status !== "paused"
      || input.action === "edit" && current.status !== "active") return json({ error: "alert_changed", traceId }, 409);
    let activation: Extract<Eligibility, { status: "eligible" }> | null = null;
    if (input.action === "resume" || input.action === "edit") {
      const eligibility = await eligible(subject.subjectReference);
      if (eligibility.status !== "eligible") return json({ error: eligibility.status, traceId }, eligibility.status === "account_locked" ? 423 : 400);
      activation = eligibility;
      if (current.pair_id !== pair.pairId || current.base_asset_id !== pair.baseAssetId || current.quote_asset_id !== pair.quoteAssetId || current.mapping_version !== pair.mappingVersion) return json({ error: "asset_unavailable", traceId }, 400);
    }
    const status = input.action === "pause" ? "paused" : input.action === "cancel" ? "cancelled" : "active";
    const auditId = crypto.randomUUID(), now = new Date().toISOString();
    const before = instruction(current);
    const after = { ...before, direction: input.direction ?? current.direction, threshold: input.threshold ?? current.threshold_decimal,
      hysteresisBps: input.hysteresisBps ?? current.hysteresis_bps, cooldownSeconds: input.cooldownSeconds ?? current.cooldown_seconds,
      status, version: input.version + 1 };
    const [updated] = await env.PROJECTION_DB.batch([
      env.PROJECTION_DB.prepare(`UPDATE price_alerts SET direction = ?, threshold_decimal = ?, hysteresis_bps = ?, cooldown_seconds = ?, status = ?,
        threshold_version = threshold_version + 1, armed = 0, last_triggered_at = NULL, updated_at = ?
        WHERE alert_id = ? AND subject_reference = ? AND threshold_version = ? AND status = ?
          AND (? = 0 OR (EXISTS (SELECT 1 FROM security_profiles WHERE subject_reference = ? AND account_locked = 0)
            AND EXISTS (SELECT 1 FROM feature_flags WHERE flag_key = 'swaps' AND enabled = 1)
            AND (? = 'preview' OR EXISTS (SELECT 1 FROM beta_access WHERE subject_reference = ? AND status = 'active' AND country_code = ?))))`)
        .bind(input.direction ?? current.direction, input.threshold ?? current.threshold_decimal,
          input.hysteresisBps ?? current.hysteresis_bps, input.cooldownSeconds ?? current.cooldown_seconds,
          status, now, input.alertId, subject.subjectReference, input.version, current.status,
          activation ? 1 : 0, subject.subjectReference, activation?.mode ?? "invite", subject.subjectReference, activation?.countryCode ?? null),
      env.PROJECTION_DB.prepare(`INSERT INTO audit_events (audit_id, subject_reference, actor_type, actor_reference, action, target_type, target_reference, evidence_json, occurred_at)
        SELECT ?, ?, 'customer', ?, ?, 'price_alert', ?, ?, ? WHERE changes() = 1`)
        .bind(auditId, subject.subjectReference, subject.subjectReference, `swap.alert.${input.action}`, input.alertId,
          JSON.stringify({ before, after }), now),
      env.PROJECTION_DB.prepare(`UPDATE swap_reminder_occurrences SET reminder_state = 'superseded', updated_at = ?
        WHERE alert_id = ? AND subject_reference = ? AND threshold_version = ? AND reminder_state = 'due'
          AND EXISTS (SELECT 1 FROM audit_events WHERE audit_id = ?)`)
        .bind(now, input.alertId, subject.subjectReference, input.version, auditId)
    ]);
    if (updated.meta.changes !== 1) return json({ error: "alert_changed", traceId }, 409);
    return json({ updated: true, thresholdVersion: input.version + 1, execution: "customer_review_required", delivery: "not_active", traceId });
  } catch (error) { return failure(error, traceId, "update"); }
}

function failure(error: unknown, traceId: string, event: string) {
  if (error instanceof AuthenticationError) return json({ error: "unauthorized", traceId }, 401);
  if (error instanceof BetaAccessError) return json({ error: error.code, traceId }, 403);
  if (error instanceof FeatureUnavailableError) return json({ error: "feature_unavailable", traceId }, 503);
  if (error instanceof RateLimitError) return json({ error: "rate_limited", traceId }, 429, { "Retry-After": String(error.retryAfterSeconds) });
  if (error instanceof z.ZodError) return json({ error: "invalid_alert", issues: error.issues, traceId }, 400);
  console.error(JSON.stringify({ level: "error", event: `swap.alerts.${event}.failed`, traceId, message: error instanceof Error ? error.message : "unknown" }));
  return json({ error: "alerts_unavailable", traceId }, 503);
}
