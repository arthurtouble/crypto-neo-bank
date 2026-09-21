import { env } from "cloudflare:workers";
import { z } from "zod";
import { AuthenticationError, requireVerifiedSubject } from "@/lib/auth/server";
import { enforceRateLimit, RateLimitError } from "@/lib/security/rate-limit";

const caseSchema = z.object({
  category: z.enum(["transaction", "account", "security", "product", "other"]),
  priority: z.enum(["normal", "urgent"]).default("normal"),
  summary: z.string().trim().min(10).max(1000),
  intentId: z.string().uuid().optional()
});

export async function GET(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    const subject = await requireVerifiedSubject(request);
    const rows = await env.PROJECTION_DB.prepare("SELECT case_id, intent_id, category, priority, status, summary, created_at, updated_at FROM support_cases WHERE subject_reference = ? ORDER BY created_at DESC LIMIT 20").bind(subject.subjectReference).all();
    return Response.json({ cases: rows.results, traceId }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized", traceId }, { status: 401 });
    console.error(JSON.stringify({ level: "error", event: "support.cases.read.failed", traceId, message: error instanceof Error ? error.message : "unknown" }));
    return Response.json({ error: "support_unavailable", traceId }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    const subject = await requireVerifiedSubject(request);
    await enforceRateLimit(env.PROJECTION_DB, { namespace: "support", subject: subject.subjectReference, limit: 5, windowSeconds: 3600 });
    const input = caseSchema.parse(await request.json());
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
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized", traceId }, { status: 401 });
    if (error instanceof RateLimitError) return Response.json({ error: "rate_limited", message: "Too many cases were opened. Use an existing case for follow-up.", traceId }, { status: 429 });
    if (error instanceof z.ZodError) return Response.json({ error: "invalid_case", issues: error.issues, traceId }, { status: 400 });
    console.error(JSON.stringify({ level: "error", event: "support.cases.create.failed", traceId, message: error instanceof Error ? error.message : "unknown" }));
    return Response.json({ error: "support_unavailable", traceId }, { status: 503 });
  }
}
