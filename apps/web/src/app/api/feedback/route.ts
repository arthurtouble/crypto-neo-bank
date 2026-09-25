import { env } from "cloudflare:workers";
import { z } from "zod";
import { requireVerifiedSubject } from "@/lib/auth/server";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { ensureSubjectProfile } from "@/lib/profile/ensure";
import { route } from "@/lib/http/route";

const schema = z.object({ surface: z.string().min(1).max(120), sentiment: z.enum(["positive", "neutral", "negative"]), category: z.enum(["usability", "trust", "missing_feature", "bug", "other"]), message: z.string().trim().min(10).max(1500) });

export const POST = route("feedback.post", { unavailable: "feedback_unavailable", invalid: "invalid_feedback" }, async (request: Request, { traceId }) => {
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
});

