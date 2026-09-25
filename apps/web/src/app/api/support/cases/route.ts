import { env } from "cloudflare:workers";
import { z } from "zod";
import { requireVerifiedSubject } from "@/lib/auth/server";
import { enforceRateLimit, RateLimitError } from "@/lib/security/rate-limit";
import { verifyTurnstile } from "@/lib/security/turnstile";
import { route, errorResponse } from "@/lib/http/route";

const caseSchema = z.object({
  category: z.enum(["transaction", "account", "security", "product", "other"]),
  priority: z.enum(["normal", "urgent"]).default("normal"),
  summary: z.string().trim().min(10).max(1000),
  intentId: z.string().uuid().optional(),
  turnstileToken: z.string().max(2048).optional()
});

export const GET = route("support.cases.get", { unavailable: "support_unavailable" }, async (request: Request, { traceId }) => {
  const subject = await requireVerifiedSubject(request);
  const rows = await env.PROJECTION_DB.prepare("SELECT case_id, intent_id, category, priority, status, summary, created_at, updated_at FROM support_cases WHERE subject_reference = ? ORDER BY created_at DESC LIMIT 20").bind(subject.subjectReference).all();
  return Response.json({ cases: rows.results, traceId }, { headers: { "Cache-Control": "no-store" } });
});

export const POST = route("support.cases.post", { unavailable: "support_unavailable", invalid: "invalid_case", onError: (error, context) => error instanceof RateLimitError ? errorResponse(429, "rate_limited", context, { message: "Too many cases were opened. Use an existing case for follow-up." }, error.headers) : undefined }, async (request: Request, { traceId }) => {
  const subject = await requireVerifiedSubject(request);
  await enforceRateLimit(env.PROJECTION_DB, { namespace: "support", subject: subject.subjectReference, limit: 5, windowSeconds: 3600 });
  const input = caseSchema.parse(await request.json());
  const turnstile = await verifyTurnstile({ token: input.turnstileToken, remoteIp: request.headers.get("CF-Connecting-IP"), expectedAction: "support_case" });
  if (!turnstile.valid) return Response.json({ error: "bot_verification_failed", message: "Please complete the verification and try again.", traceId }, { status: 403 });
  if (input.intentId) {
    const owned = await env.PROJECTION_DB.prepare("SELECT intent_id FROM transaction_intents WHERE intent_id = ? AND subject_reference = ?").bind(input.intentId, subject.subjectReference).first();
    if (!owned) return Response.json({ error: "intent_not_found", traceId }, { status: 404 });
  }
  const caseId = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.PROJECTION_DB.batch([
    env.PROJECTION_DB.prepare(`INSERT INTO support_cases (case_id, subject_reference, intent_id, category, priority, status, summary, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?)`)
      .bind(caseId, subject.subjectReference, input.intentId ?? null, input.category, input.priority, input.summary, now, now),
    env.PROJECTION_DB.prepare(`INSERT INTO operational_issues (issue_id, subject_reference, issue_type, severity, source_name, source_reference, summary, status, opened_at)
      VALUES (?, ?, 'customer_support', ?, 'customer', ?, ?, 'open', ?)`)
      .bind(crypto.randomUUID(), subject.subjectReference, input.priority === "urgent" ? "high" : "warning", caseId, input.summary.slice(0, 240), now)
  ]);
  return Response.json({ caseId, status: "open", createdAt: now, traceId }, { status: 201 });
});
