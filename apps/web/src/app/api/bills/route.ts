import { env } from "cloudflare:workers";
import { z } from "zod";
import { AuthenticationError, requireVerifiedSubject } from "@/lib/auth/server";
const updateSchema = z.object({ billId: z.string().uuid(), action: z.literal("archive") });
type BillRow = { bill_id: string; name: string; category: string; expected_amount: string | null; currency: string; frequency: string; next_due_date: string; status: string; created_at: string; updated_at: string };
type SubscriptionRow = { subscription_reference: string; provider: string; merchant_name: string; category: string | null; expected_amount: string | null; currency: string | null; cadence: string | null; next_expected_at: string | null; status: string; observed_at: string };

export async function GET(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    const subject = await requireVerifiedSubject(request);
    const [bills, subscriptions] = await env.PROJECTION_DB.batch([
      env.PROJECTION_DB.prepare(`SELECT bill_id, name, category, expected_amount, currency, frequency, next_due_date, status, created_at, updated_at FROM bill_reminder_plans
        WHERE subject_reference = ? AND status != 'archived' ORDER BY next_due_date`).bind(subject.subjectReference),
      env.PROJECTION_DB.prepare(`SELECT subscription_reference, provider, merchant_name, category, expected_amount, currency, cadence, next_expected_at, status, observed_at FROM subscription_projections
        WHERE subject_reference = ? AND status NOT IN ('cancelled','ended') ORDER BY next_expected_at`).bind(subject.subjectReference)
    ]);
    return Response.json({
      reminders: (bills.results as unknown as BillRow[]).map((row) => ({ billId: row.bill_id, name: row.name, category: row.category, expectedAmount: row.expected_amount ?? undefined, currency: row.currency, frequency: row.frequency, nextDueDate: row.next_due_date, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at })),
      observedSubscriptions: (subscriptions.results as unknown as SubscriptionRow[]).map((row) => ({ subscriptionReference: row.subscription_reference, provider: row.provider, merchantName: row.merchant_name, category: row.category ?? undefined, expectedAmount: row.expected_amount ?? undefined, currency: row.currency ?? undefined, cadence: row.cadence ?? undefined, nextExpectedAt: row.next_expected_at ?? undefined, status: row.status, observedAt: row.observed_at })),
      authority: "Reminders do not authorize payment; observed subscriptions come from the named provider", traceId
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized", message: error.message, traceId }, { status: 401 });
    return Response.json({ error: "bills_unavailable", traceId }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    await requireVerifiedSubject(request);
    return Response.json({ error: "bill_planning_retired", traceId }, { status: 410, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized", message: error.message, traceId }, { status: 401 });
    return Response.json({ error: "bills_unavailable", traceId }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    const subject = await requireVerifiedSubject(request);
    const input = updateSchema.parse(await request.json());
    const now = new Date().toISOString();
    const auditId = crypto.randomUUID();
    const [updated] = await env.PROJECTION_DB.batch([
      env.PROJECTION_DB.prepare("UPDATE bill_reminder_plans SET status = 'archived', updated_at = ? WHERE bill_id = ? AND subject_reference = ? AND status != 'archived'")
        .bind(now, input.billId, subject.subjectReference),
      env.PROJECTION_DB.prepare(`INSERT INTO audit_events (audit_id, subject_reference, actor_type, actor_reference, action, target_type, target_reference, evidence_json, occurred_at)
        SELECT ?, ?, 'customer', ?, 'bill.reminder.archived', 'bill_reminder', ?, '{}', ? WHERE changes() = 1`)
        .bind(auditId, subject.subjectReference, subject.subjectReference, input.billId, now)
    ]);
    if (!updated.meta.changes) return Response.json({ error: "bill_not_found", traceId }, { status: 404, headers: { "Cache-Control": "no-store" } });
    return Response.json({ updated: true, status: "archived", traceId }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized", message: error.message, traceId }, { status: 401 });
    if (error instanceof z.ZodError) return Response.json({ error: "invalid_bill_update", issues: error.issues, traceId }, { status: 400 });
    return Response.json({ error: "bill_update_unavailable", traceId }, { status: 503 });
  }
}
