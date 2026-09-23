import { env } from "cloudflare:workers";
import { z } from "zod";
import { AuthenticationError, requireVerifiedSubject } from "@/lib/auth/server";
import { BetaAccessError, configuredCountries, requireBetaAccess } from "@/lib/beta/access";
import { FeatureUnavailableError, requireFeature } from "@/lib/features/flags";
import { ensureSubjectProfile } from "@/lib/profile/ensure";
import { enforceRateLimit, RateLimitError } from "@/lib/security/rate-limit";
import { parseAssetId } from "@/lib/swap/assets";
import { CATALOG_REGISTRY } from "@/lib/swap/catalog-registry";
import { changeSwapReminderPlan, createSwapReminderPlan, listSwapReminderPlans } from "@/lib/swap/reminder-store";

const noStore = { "Cache-Control": "no-store" };
const asset = z.string().max(96).refine((value) => parseAssetId(value) !== null && CATALOG_REGISTRY.verified.has(value as `${number}:${string}`));
const amount = z.string().regex(/^(?:0|[1-9]\d{0,59})(?:\.\d{1,18})?$/).refine((value) => /[1-9]/.test(value));
const schedule = z.object({
  fromAssetId: asset, toAssetId: asset, amount,
  scheduleType: z.enum(["one_time", "weekly", "monthly"]),
  timeZone: z.string().min(1).max(100),
  anchorLocal: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
}).strict().refine((value) => value.fromAssetId !== value.toAssetId);
const change = z.object({
  planId: z.string().uuid(), version: z.number().int().positive(), action: z.enum(["pause", "resume", "cancel", "edit"]),
  fromAssetId: asset.optional(), toAssetId: asset.optional(), amount: amount.optional(),
  scheduleType: z.enum(["one_time", "weekly", "monthly"]).optional(),
  timeZone: z.string().min(1).max(100).optional(), anchorLocal: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).optional()
}).strict().refine((value) => value.action === "edit" || !["fromAssetId", "toAssetId", "amount", "scheduleType", "timeZone", "anchorLocal"].some((key) => key in value));

function json(body: unknown, status = 200, headers: Record<string, string> = {}) { return Response.json(body, { status, headers: { ...noStore, ...headers } }); }
async function eligible(subjectReference: string) {
  const beta = await requireBetaAccess(env.PROJECTION_DB, subjectReference);
  const countries = configuredCountries();
  if (countries.length && (!beta.countryCode || !countries.includes(beta.countryCode))) throw new BetaAccessError("country_unavailable", "This feature is unavailable in your country.");
  await requireFeature(env.PROJECTION_DB, "swaps");
  await ensureSubjectProfile(env.PROJECTION_DB, subjectReference);
  const profile = await env.PROJECTION_DB.prepare("SELECT account_locked FROM security_profiles WHERE subject_reference = ?").bind(subjectReference).first<{ account_locked: number }>();
  if (!profile || profile.account_locked) return false;
  return true;
}
function validPair(fromAssetId: string, toAssetId: string) {
  const from = parseAssetId(fromAssetId), to = parseAssetId(toAssetId);
  return from && to && fromAssetId !== toAssetId && CATALOG_REGISTRY.verified.has(fromAssetId) && CATALOG_REGISTRY.verified.has(toAssetId);
}

export async function GET(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    const subject = await requireVerifiedSubject(request);
    return json({ plans: await listSwapReminderPlans(env.PROJECTION_DB, subject.subjectReference), execution: "customer_review_required", traceId });
  } catch (error) {
    if (error instanceof AuthenticationError) return json({ error: "unauthorized", traceId }, 401);
    console.error(JSON.stringify({ level: "error", event: "swap.reminders.read.failed", traceId, message: error instanceof Error ? error.message : "unknown" }));
    return json({ error: "reminders_unavailable", traceId }, 503);
  }
}

export async function POST(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    const subject = await requireVerifiedSubject(request);
    await enforceRateLimit(env.PROJECTION_DB, { namespace: "swap_reminder_mutation", subject: subject.subjectReference, limit: 12, windowSeconds: 3600 });
    const input = schedule.parse(await request.json());
    if (!await eligible(subject.subjectReference)) return json({ error: "account_locked", traceId }, 423);
    if (!validPair(input.fromAssetId, input.toAssetId)) return json({ error: "invalid_pair", traceId }, 400);
    const from = parseAssetId(input.fromAssetId)!, to = parseAssetId(input.toAssetId)!;
    if (from.chainId !== to.chainId) await requireFeature(env.PROJECTION_DB, "cross_chain");
    const plan = await createSwapReminderPlan(env.PROJECTION_DB, subject.subjectReference, input);
    return json({ plan, execution: "customer_review_required", traceId }, 201);
  } catch (error) { return failure(error, traceId, "create"); }
}

export async function PATCH(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    const subject = await requireVerifiedSubject(request);
    await enforceRateLimit(env.PROJECTION_DB, { namespace: "swap_reminder_mutation", subject: subject.subjectReference, limit: 24, windowSeconds: 3600 });
    const input = change.parse(await request.json());
    const exists = await env.PROJECTION_DB.prepare("SELECT base_asset_id, quote_asset_id FROM swap_reminder_plans WHERE plan_id = ? AND subject_reference = ?").bind(input.planId, subject.subjectReference).first<{ base_asset_id: string; quote_asset_id: string }>();
    if (!exists) return json({ error: "reminder_not_found", traceId }, 404);
    if (input.action === "resume" || input.action === "edit") {
      if (!await eligible(subject.subjectReference)) return json({ error: "account_locked", traceId }, 423);
      const fromId = input.fromAssetId ?? exists.base_asset_id, toId = input.toAssetId ?? exists.quote_asset_id;
      if (!validPair(fromId, toId)) return json({ error: "invalid_pair", traceId }, 400);
      if (parseAssetId(fromId)!.chainId !== parseAssetId(toId)!.chainId) await requireFeature(env.PROJECTION_DB, "cross_chain");
    }
    const updated = await changeSwapReminderPlan(env.PROJECTION_DB, subject.subjectReference, input);
    if (!updated) return json({ error: "reminder_changed", traceId }, 409);
    return json({ updated: true, planVersion: input.version + 1, execution: "customer_review_required", traceId });
  } catch (error) { return failure(error, traceId, "update"); }
}

function failure(error: unknown, traceId: string, event: string) {
  if (error instanceof AuthenticationError) return json({ error: "unauthorized", traceId }, 401);
  if (error instanceof BetaAccessError) return json({ error: error.code, traceId }, 403);
  if (error instanceof FeatureUnavailableError) return json({ error: "feature_unavailable", traceId }, 503);
  if (error instanceof RateLimitError) return json({ error: "rate_limited", traceId }, 429, { "Retry-After": String(error.retryAfterSeconds) });
  if (error instanceof z.ZodError) return json({ error: "invalid_reminder", issues: error.issues, traceId }, 400);
  if (error instanceof Error && /^(Invalid|The reminder time)/.test(error.message)) return json({ error: "invalid_reminder_time", traceId }, 400);
  console.error(JSON.stringify({ level: "error", event: `swap.reminders.${event}.failed`, traceId, message: error instanceof Error ? error.message : "unknown" }));
  return json({ error: "reminder_unavailable", traceId }, 503);
}
