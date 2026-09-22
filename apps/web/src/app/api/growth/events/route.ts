import { env } from "cloudflare:workers";
import { z } from "zod";
import { publicEventsBatchSchema, recordPublicEvents } from "@/lib/growth/events";
import { abuseKey } from "@/lib/growth/crypto";
import { enforceRateLimit, RateLimitError } from "@/lib/security/rate-limit";

export async function POST(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    const length = Number(request.headers.get("content-length") ?? 0);
    if (length > 10_240) return Response.json({ accepted: false, traceId }, { status: 413 });
    const text = await request.text(); if (text.length > 10_240) return Response.json({ accepted: false, traceId }, { status: 413 });
    const input = publicEventsBatchSchema.parse(JSON.parse(text));
    const secret = process.env.GROWTH_EMAIL_LOOKUP_KEY; if (!secret) throw new Error("Growth abuse controls are not configured.");
    const remoteKey = await abuseKey(request.headers.get("CF-Connecting-IP") ?? "unknown", `${secret}:events:${new Date().toISOString().slice(0, 10)}`);
    await Promise.all([
      enforceRateLimit(env.PROJECTION_DB, { namespace: "growth-events-ip", subject: remoteKey, limit: 60, windowSeconds: 3600 }),
      ...[...new Set(input.events.map((event) => event.anonymousSessionId))].map((session) => enforceRateLimit(env.PROJECTION_DB, { namespace: "growth-events-session", subject: session, limit: 30, windowSeconds: 3600 }))
    ]);
    await recordPublicEvents(env.PROJECTION_DB, input.events);
    return Response.json({ accepted: true, traceId }, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) return Response.json({ accepted: false, traceId }, { status: 400 });
    if (error instanceof RateLimitError) return Response.json({ accepted: false, traceId }, { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds) } });
    return Response.json({ accepted: false, traceId }, { status: 503 });
  }
}
