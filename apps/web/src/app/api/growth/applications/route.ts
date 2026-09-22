import { env } from "cloudflare:workers";
import { z } from "zod";
import { growthApplicationSchema, persistGrowthApplication } from "@/lib/growth/applications";
import { abuseKey } from "@/lib/growth/crypto";
import { enforceRateLimit, RateLimitError } from "@/lib/security/rate-limit";
import { verifyTurnstile } from "@/lib/security/turnstile";

function genericSuccess(traceId: string) {
  return Response.json({ received: true, applicationReference: crypto.randomUUID(), traceId }, { status: 202, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    if ((process.env.GROWTH_APPLICATION_MODE ?? "closed") !== "open") return Response.json({ received: false, message: "Applications are paused right now. Please check back soon.", traceId }, { status: 503, headers: { "Cache-Control": "no-store" } });
    const input = growthApplicationSchema.parse(await request.json());
    if (input.privacyNoticeVersion !== process.env.GROWTH_PRIVACY_NOTICE_VERSION || input.applicationVersion !== process.env.GROWTH_APPLICATION_VERSION) {
      return Response.json({ received: false, message: "The application changed. Refresh and review the latest version.", traceId }, { status: 409, headers: { "Cache-Control": "no-store" } });
    }
    const turnstile = await verifyTurnstile({ token: input.turnstileToken, remoteIp: request.headers.get("CF-Connecting-IP"), expectedAction: "private_access_application" });
    if (!turnstile.valid || (process.env.PRODUCT_ENVIRONMENT === "production" && !turnstile.configured)) return Response.json({ received: false, message: "Please complete the verification and try again.", traceId }, { status: 403, headers: { "Cache-Control": "no-store" } });
    const abuseSecret = process.env.GROWTH_EMAIL_LOOKUP_KEY;
    if (!abuseSecret) throw new Error("Growth abuse controls are not configured.");
    const remoteKey = await abuseKey(request.headers.get("CF-Connecting-IP") ?? "unknown", `${abuseSecret}:ip:${new Date().toISOString().slice(0, 10)}`);
    await Promise.all([
      enforceRateLimit(env.PROJECTION_DB, { namespace: "growth-application-ip", subject: remoteKey, limit: 8, windowSeconds: 3600 }),
      enforceRateLimit(env.PROJECTION_DB, { namespace: "growth-application-session", subject: input.attribution.anonymousSessionId, limit: 4, windowSeconds: 3600 })
    ]);
    if (input.attribution.partnerCode) {
      const campaign = await env.PROJECTION_DB.prepare("SELECT approved_countries_json FROM growth_campaigns WHERE slug = ? AND status = 'active'").bind(input.attribution.partnerCode).first<{ approved_countries_json: string }>();
      const countries = campaign ? JSON.parse(campaign.approved_countries_json) as string[] : [];
      if (!campaign || (countries.length && !countries.includes(input.countryCode))) input.attribution.partnerCode = undefined;
    }
    const registeredContent = new Set(["landing-private-access-v1", "product-tour-v1", "control-before-yield-01"]);
    if (input.attribution.contentId && !registeredContent.has(input.attribution.contentId)) input.attribution.contentId = undefined;
    await persistGrowthApplication(env.PROJECTION_DB, input);
    return genericSuccess(traceId);
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ received: false, message: "Check the highlighted fields and try again.", issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })), traceId }, { status: 400, headers: { "Cache-Control": "no-store" } });
    if (error instanceof RateLimitError) return Response.json({ received: false, message: "Too many attempts. Please try again later.", traceId }, { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds), "Cache-Control": "no-store" } });
    console.error(JSON.stringify({ event: "growth_application.failed", traceId, message: error instanceof Error ? error.message : "unknown" }));
    return Response.json({ received: false, message: "We could not receive the application right now.", traceId }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
