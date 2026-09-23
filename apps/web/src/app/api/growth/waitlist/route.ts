import { env } from "cloudflare:workers";
import { z } from "zod";
import { countryFromRequest, persistWaitlist, waitlistSchema } from "@/lib/growth/waitlist";
import { abuseKey } from "@/lib/growth/crypto";
import { enforceRateLimit, RateLimitError } from "@/lib/security/rate-limit";
import { verifyTurnstile } from "@/lib/security/turnstile";

const noStore = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  try {
    if ((process.env.GROWTH_WAITLIST_MODE ?? "closed") !== "open") {
      return Response.json({ received: false, message: "The waitlist is paused right now." }, { status: 503, headers: noStore });
    }
    const input = waitlistSchema.parse(await request.json());
    if (input.privacyNoticeVersion !== process.env.GROWTH_PRIVACY_NOTICE_VERSION) {
      return Response.json({ received: false, message: "Please refresh to review the latest privacy notice." }, { status: 409, headers: noStore });
    }
    const secret = process.env.GROWTH_EMAIL_LOOKUP_KEY;
    if (!secret || !process.env.GROWTH_EMAIL_ENCRYPTION_KEY || !env.PROJECTION_DB) throw new Error("waitlist_configuration");
    const turnstile = await verifyTurnstile({ token: input.turnstileToken, remoteIp: request.headers.get("CF-Connecting-IP"), expectedAction: "waitlist_signup" });
    if (!turnstile.valid || (process.env.PRODUCT_ENVIRONMENT === "production" && !turnstile.configured)) {
      return Response.json({ received: false, message: "Please complete verification and try again." }, { status: 403, headers: noStore });
    }
    const remoteKey = await abuseKey(request.headers.get("CF-Connecting-IP") ?? "unknown", `${secret}:waitlist:${new Date().toISOString().slice(0, 10)}`);
    await enforceRateLimit(env.PROJECTION_DB, { namespace: "growth-waitlist-ip", subject: remoteKey, limit: 8, windowSeconds: 3600 });
    await persistWaitlist(env.PROJECTION_DB, input, countryFromRequest(request));
    return Response.json({ received: true }, { status: 202, headers: noStore });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ received: false, message: "Enter a valid email address." }, { status: 400, headers: noStore });
    if (error instanceof RateLimitError) return Response.json({ received: false, message: "Too many attempts. Please try again later." }, { status: 429, headers: { ...noStore, "Retry-After": String(error.retryAfterSeconds) } });
    console.error(JSON.stringify({ event: "growth_waitlist.failed", code: "unavailable" }));
    return Response.json({ received: false, message: "We couldn't add you right now. Please try again later." }, { status: 503, headers: noStore });
  }
}
