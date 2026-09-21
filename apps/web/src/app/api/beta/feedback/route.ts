import { env } from "cloudflare:workers";
import { z } from "zod";
import { AuthenticationError, requireVerifiedSubject } from "@/lib/auth/server";
import { enforceRateLimit, RateLimitError } from "@/lib/security/rate-limit";
import { ensureSubjectProfile } from "@/lib/profile/ensure";

const schema = z.object({ surface: z.string().min(1).max(120), sentiment: z.enum(["positive", "neutral", "negative"]), category: z.enum(["usability", "trust", "missing_feature", "bug", "other"]), message: z.string().trim().min(10).max(1500) });

export async function POST(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    const subject = await requireVerifiedSubject(request);
    await enforceRateLimit(env.PROJECTION_DB, { namespace: "feedback", subject: subject.subjectReference, limit: 10, windowSeconds: 3600 });
    const input = schema.parse(await request.json());
    await ensureSubjectProfile(env.PROJECTION_DB, subject.subjectReference);
    const feedbackId = crypto.randomUUID();
    await env.PROJECTION_DB.prepare(`INSERT INTO customer_feedback
      (feedback_id, subject_reference, surface, sentiment, category, message, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'new', ?)`)
      .bind(feedbackId, subject.subjectReference, input.surface, input.sentiment, input.category, input.message, new Date().toISOString()).run();
    return Response.json({ feedbackId, traceId }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized", traceId }, { status: 401 });
    if (error instanceof RateLimitError) return Response.json({ error: "rate_limited", traceId }, { status: 429 });
    if (error instanceof z.ZodError) return Response.json({ error: "invalid_feedback", issues: error.issues, traceId }, { status: 400 });
    return Response.json({ error: "feedback_unavailable", traceId }, { status: 503 });
  }
}

