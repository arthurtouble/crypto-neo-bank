import { env } from "cloudflare:workers";
import { z } from "zod";
import { AuthenticationError, requireVerifiedSubject } from "@/lib/auth/server";
import { ensureSubjectProfile } from "@/lib/profile/ensure";
import { writeAuditEvent } from "@/lib/security/audit";

const updateSchema = z.object({
  accountLocked: z.boolean().optional(),
  enforceAddressBook: z.boolean().optional(),
  dailyLimitUsd: z.number().min(100).max(1_000_000).optional(),
  newAddressThresholdUsd: z.number().min(0).max(1_000_000).optional(),
  newAddressDelayHours: z.number().int().min(0).max(168).optional(),
  stepUpThresholdUsd: z.number().min(100).max(1_000_000).optional()
}).refine((value) => Object.keys(value).length > 0);

type PolicyRow = { account_locked: number; enforce_address_book: number; daily_limit_usd: number; new_address_threshold_usd: number; new_address_delay_seconds: number; step_up_threshold_usd: number; updated_at: string };

function serialize(row: PolicyRow) {
  return { accountLocked: Boolean(row.account_locked), enforceAddressBook: Boolean(row.enforce_address_book), dailyLimitUsd: row.daily_limit_usd, newAddressThresholdUsd: row.new_address_threshold_usd, newAddressDelayHours: row.new_address_delay_seconds / 3600, stepUpThresholdUsd: row.step_up_threshold_usd, updatedAt: row.updated_at };
}

export async function GET(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    const subject = await requireVerifiedSubject(request);
    await ensureSubjectProfile(env.PROJECTION_DB, subject.subjectReference);
    const row = await env.PROJECTION_DB.prepare("SELECT * FROM security_profiles WHERE subject_reference = ?").bind(subject.subjectReference).first<PolicyRow>();
    if (!row) throw new Error("Security profile was not initialized.");
    return Response.json({ policy: serialize(row), traceId }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized", message: error.message, traceId }, { status: 401 });
    console.error(JSON.stringify({ level: "error", event: "security.policy.read.failed", traceId, message: error instanceof Error ? error.message : "unknown" }));
    return Response.json({ error: "security_policy_unavailable", traceId }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    const subject = await requireVerifiedSubject(request);
    const input = updateSchema.parse(await request.json());
    await ensureSubjectProfile(env.PROJECTION_DB, subject.subjectReference);
    const current = await env.PROJECTION_DB.prepare("SELECT * FROM security_profiles WHERE subject_reference = ?").bind(subject.subjectReference).first<PolicyRow>();
    if (!current) throw new Error("Security profile was not initialized.");
    const next = {
      accountLocked: input.accountLocked ?? Boolean(current.account_locked),
      enforceAddressBook: input.enforceAddressBook ?? Boolean(current.enforce_address_book),
      dailyLimitUsd: input.dailyLimitUsd ?? current.daily_limit_usd,
      newAddressThresholdUsd: input.newAddressThresholdUsd ?? current.new_address_threshold_usd,
      newAddressDelaySeconds: input.newAddressDelayHours !== undefined ? input.newAddressDelayHours * 3600 : current.new_address_delay_seconds,
      stepUpThresholdUsd: input.stepUpThresholdUsd ?? current.step_up_threshold_usd
    };
    const now = new Date().toISOString();
    await env.PROJECTION_DB.prepare(`UPDATE security_profiles SET account_locked = ?, enforce_address_book = ?, daily_limit_usd = ?, new_address_threshold_usd = ?, new_address_delay_seconds = ?, step_up_threshold_usd = ?, updated_at = ? WHERE subject_reference = ?`)
      .bind(next.accountLocked ? 1 : 0, next.enforceAddressBook ? 1 : 0, next.dailyLimitUsd, next.newAddressThresholdUsd, next.newAddressDelaySeconds, next.stepUpThresholdUsd, now, subject.subjectReference).run();
    await writeAuditEvent(env.PROJECTION_DB, { subjectReference: subject.subjectReference, actorType: "customer", actorReference: subject.subjectReference, action: "security.policy.updated", targetType: "security_profile", targetReference: subject.subjectReference, evidence: { changedFields: Object.keys(input) }, occurredAt: now });
    return Response.json({ policy: { ...next, newAddressDelayHours: next.newAddressDelaySeconds / 3600, updatedAt: now }, traceId });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized", message: error.message, traceId }, { status: 401 });
    if (error instanceof z.ZodError) return Response.json({ error: "invalid_security_policy", issues: error.issues, traceId }, { status: 400 });
    console.error(JSON.stringify({ level: "error", event: "security.policy.update.failed", traceId, message: error instanceof Error ? error.message : "unknown" }));
    return Response.json({ error: "security_policy_update_unavailable", traceId }, { status: 503 });
  }
}
