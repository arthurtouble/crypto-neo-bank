import { env } from "cloudflare:workers";
import { z } from "zod";
import { AuthenticationError, requireVerifiedSubject } from "@/lib/auth/server";
import { ensureSubjectProfile } from "@/lib/profile/ensure";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { writeAuditEvent } from "@/lib/security/audit";

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  category: z.enum(["housing", "utilities", "communications", "insurance", "subscriptions", "taxes", "other"]),
  expectedAmount: z.string().regex(/^\d+(\.\d{1,2})?$/).refine((value) => Number(value) > 0).optional(),
  currency: z.enum(["USD", "EUR", "GBP"]),
  frequency: z.enum(["monthly", "quarterly", "yearly"]),
  nextDueDate: z.string().date()
});
const updateSchema = z.object({ billId: z.string().uuid(), action: z.enum(["pause", "resume", "archive"]) });
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
    const subject = await requireVerifiedSubject(request);
    await enforceRateLimit(env.PROJECTION_DB, { namespace: "bill_create", subject: subject.subjectReference, limit: 20, windowSeconds: 3600 });
    const input = createSchema.parse(await request.json());
    const due = new Date(`${input.nextDueDate}T23:59:59Z`);
    if (due.getTime() < Date.now() - 86_400_000 || due.getTime() > Date.now() + 731 * 86_400_000) return Response.json({ error: "invalid_due_date", message: "Choose a date within the next two years.", traceId }, { status: 400 });
    await ensureSubjectProfile(env.PROJECTION_DB, subject.subjectReference);
    const billId = crypto.randomUUID(); const now = new Date().toISOString();
    await env.PROJECTION_DB.prepare(`INSERT INTO bill_reminder_plans (bill_id, subject_reference, name, category, expected_amount, currency, frequency, next_due_date, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`).bind(billId, subject.subjectReference, input.name, input.category, input.expectedAmount ?? null, input.currency, input.frequency, input.nextDueDate, now, now).run();
    await writeAuditEvent(env.PROJECTION_DB, { subjectReference: subject.subjectReference, actorType: "customer", actorReference: subject.subjectReference, action: "bill.reminder.created", targetType: "bill_reminder", targetReference: billId, evidence: { frequency: input.frequency, nextDueDate: input.nextDueDate, paymentAuthority: false } });
    return Response.json({ reminder: { billId, ...input, status: "active", createdAt: now, updatedAt: now }, traceId }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized", message: error.message, traceId }, { status: 401 });
    if (error instanceof z.ZodError) return Response.json({ error: "invalid_bill", issues: error.issues, traceId }, { status: 400 });
    return Response.json({ error: "bill_create_unavailable", traceId }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    const subject = await requireVerifiedSubject(request);
    const input = updateSchema.parse(await request.json());
    const row = await env.PROJECTION_DB.prepare("SELECT status FROM bill_reminder_plans WHERE bill_id = ? AND subject_reference = ?").bind(input.billId, subject.subjectReference).first<{ status: string }>();
    if (!row) return Response.json({ error: "bill_not_found", traceId }, { status: 404 });
    if ((input.action === "pause" && row.status !== "active") || (input.action === "resume" && row.status !== "paused")) return Response.json({ error: "invalid_bill_transition", traceId }, { status: 409 });
    const status = input.action === "archive" ? "archived" : input.action === "pause" ? "paused" : "active";
    await env.PROJECTION_DB.prepare("UPDATE bill_reminder_plans SET status = ?, updated_at = ? WHERE bill_id = ? AND subject_reference = ?").bind(status, new Date().toISOString(), input.billId, subject.subjectReference).run();
    await writeAuditEvent(env.PROJECTION_DB, { subjectReference: subject.subjectReference, actorType: "customer", actorReference: subject.subjectReference, action: `bill.reminder.${input.action}`, targetType: "bill_reminder", targetReference: input.billId });
    return Response.json({ updated: true, status, traceId }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized", message: error.message, traceId }, { status: 401 });
    if (error instanceof z.ZodError) return Response.json({ error: "invalid_bill_update", issues: error.issues, traceId }, { status: 400 });
    return Response.json({ error: "bill_update_unavailable", traceId }, { status: 503 });
  }
}

