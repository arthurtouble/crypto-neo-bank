import { env } from "cloudflare:workers";
import { AuthenticationError, requireVerifiedSubject } from "@/lib/auth/server";
import { BetaAccessError, configuredCountries, requireBetaAccess } from "@/lib/beta/access";
import { FeatureUnavailableError, requireFeature } from "@/lib/features/flags";
import { enforceRateLimit, RateLimitError } from "@/lib/security/rate-limit";
import { materializeDueSwapReminders } from "@/lib/swap/reminder-store";

const noStore = { "Cache-Control": "no-store" };
export async function GET(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    const subject = await requireVerifiedSubject(request);
    const beta = await requireBetaAccess(env.PROJECTION_DB, subject.subjectReference);
    const countries = configuredCountries();
    if (countries.length && (!beta.countryCode || !countries.includes(beta.countryCode))) return Response.json({ error: "country_unavailable", traceId }, { status: 403, headers: noStore });
    await requireFeature(env.PROJECTION_DB, "swaps");
    await enforceRateLimit(env.PROJECTION_DB, { namespace: "swap_reminder_due", subject: subject.subjectReference, limit: 30, windowSeconds: 600 });
    const occurrences = await materializeDueSwapReminders(env.PROJECTION_DB, subject.subjectReference);
    const lock = await env.PROJECTION_DB.prepare("SELECT account_locked FROM security_profiles WHERE subject_reference = ?").bind(subject.subjectReference).first<{ account_locked: number }>();
    return Response.json({ occurrences, canReview: Boolean(lock && !lock.account_locked), execution: "customer_review_required", observedAt: new Date().toISOString(), traceId }, { headers: noStore });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized", traceId }, { status: 401, headers: noStore });
    if (error instanceof BetaAccessError) return Response.json({ error: error.code, traceId }, { status: 403, headers: noStore });
    if (error instanceof FeatureUnavailableError) return Response.json({ error: "feature_unavailable", traceId }, { status: 503, headers: noStore });
    if (error instanceof RateLimitError) return Response.json({ error: "rate_limited", traceId }, { status: 429, headers: { ...noStore, "Retry-After": String(error.retryAfterSeconds) } });
    console.error(JSON.stringify({ level: "error", event: "swap.reminders.due.failed", traceId, message: error instanceof Error ? error.message : "unknown" }));
    return Response.json({ error: "reminders_unavailable", traceId }, { status: 503, headers: noStore });
  }
}
