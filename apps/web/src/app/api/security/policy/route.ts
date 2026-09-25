import { env } from "cloudflare:workers";
import { z } from "zod";
import { requireVerifiedSubject } from "@/lib/auth/server";
import { ensureSubjectProfile } from "@/lib/profile/ensure";
import { policyRelaxationReasons } from "@/lib/security/policy-changes";
import { effectiveStepUpThresholdUsd, MAX_STEP_UP_THRESHOLD_USD } from "@/lib/transactions/policy";
import { route } from "@/lib/http/route";

const updateSchema = z.object({
  accountLocked: z.boolean().optional(),
  enforceAddressBook: z.boolean().optional(),
  dailyLimitUsd: z.number().min(100).max(1_000_000).optional(),
  newAddressThresholdUsd: z.number().min(0).max(1_000_000).optional(),
  newAddressDelayHours: z.number().int().min(0).max(168).optional(),
  stepUpThresholdUsd: z.number().min(100).max(MAX_STEP_UP_THRESHOLD_USD).optional()
}).strict().refine((value) => Object.keys(value).length > 0);

type PolicyRow = { account_locked: number; enforce_address_book: number; daily_limit_usd: number; new_address_threshold_usd: number; new_address_delay_seconds: number; step_up_threshold_usd: number; policy_version: number; updated_at: string };

function serialize(row: PolicyRow) {
  return { accountLocked: Boolean(row.account_locked), enforceAddressBook: Boolean(row.enforce_address_book), dailyLimitUsd: row.daily_limit_usd, newAddressThresholdUsd: row.new_address_threshold_usd, newAddressDelayHours: row.new_address_delay_seconds / 3600, stepUpThresholdUsd: effectiveStepUpThresholdUsd(row.step_up_threshold_usd), policyVersion: row.policy_version, updatedAt: row.updated_at };
}

export const GET = route("security.policy.get", { unavailable: "security_policy_unavailable" }, async (request: Request, { traceId }) => {
  const subject = await requireVerifiedSubject(request);
  await ensureSubjectProfile(env.PROJECTION_DB, subject.subjectReference);
  const row = await env.PROJECTION_DB.prepare("SELECT * FROM security_profiles WHERE subject_reference = ?").bind(subject.subjectReference).first<PolicyRow>();
  if (!row) throw new Error("Security profile was not initialized.");
  if (!Number.isSafeInteger(row.policy_version) || row.policy_version < 1) throw new Error("Security policy version is unavailable.");
  return Response.json({ policy: serialize(row), traceId }, { headers: { "Cache-Control": "no-store" } });
});

export const PATCH = route("security.policy.patch", { unavailable: "security_policy_update_unavailable", invalid: "invalid_security_policy" }, async (request: Request, { traceId }) => {
  const subject = await requireVerifiedSubject(request);
  const input = updateSchema.parse(await request.json());
  await ensureSubjectProfile(env.PROJECTION_DB, subject.subjectReference);
  const current = await env.PROJECTION_DB.prepare("SELECT * FROM security_profiles WHERE subject_reference = ?").bind(subject.subjectReference).first<PolicyRow>();
  if (!current) throw new Error("Security profile was not initialized.");
  if (!Number.isSafeInteger(current.policy_version) || current.policy_version < 1) throw new Error("Security policy version is unavailable.");
  const next = {
    accountLocked: input.accountLocked ?? Boolean(current.account_locked),
    enforceAddressBook: input.enforceAddressBook ?? Boolean(current.enforce_address_book),
    dailyLimitUsd: input.dailyLimitUsd ?? current.daily_limit_usd,
    newAddressThresholdUsd: input.newAddressThresholdUsd ?? current.new_address_threshold_usd,
    newAddressDelaySeconds: input.newAddressDelayHours !== undefined ? input.newAddressDelayHours * 3600 : current.new_address_delay_seconds,
    stepUpThresholdUsd: input.stepUpThresholdUsd ?? effectiveStepUpThresholdUsd(current.step_up_threshold_usd)
  };
  const relaxation = policyRelaxationReasons({
    accountLocked: Boolean(current.account_locked), enforceAddressBook: Boolean(current.enforce_address_book),
    dailyLimitUsd: current.daily_limit_usd, newAddressThresholdUsd: current.new_address_threshold_usd,
    newAddressDelaySeconds: current.new_address_delay_seconds,
    stepUpThresholdUsd: effectiveStepUpThresholdUsd(current.step_up_threshold_usd)
  }, next);
  if (relaxation.length) return Response.json({ error: "step_up_unavailable", traceId }, { status: 409, headers: { "Cache-Control": "no-store" } });
  const now = new Date().toISOString();
  const [result] = await env.PROJECTION_DB.batch([
    env.PROJECTION_DB.prepare(`UPDATE security_profiles SET account_locked = ?, enforce_address_book = ?, daily_limit_usd = ?, new_address_threshold_usd = ?, new_address_delay_seconds = ?, step_up_threshold_usd = ?, policy_version = policy_version + 1, updated_at = ?
      WHERE subject_reference = ? AND account_locked IS ? AND enforce_address_book IS ? AND daily_limit_usd IS ?
        AND new_address_threshold_usd IS ? AND new_address_delay_seconds IS ? AND step_up_threshold_usd IS ? AND policy_version IS ?`)
      .bind(next.accountLocked ? 1 : 0, next.enforceAddressBook ? 1 : 0, next.dailyLimitUsd, next.newAddressThresholdUsd, next.newAddressDelaySeconds, next.stepUpThresholdUsd, now,
        subject.subjectReference, current.account_locked, current.enforce_address_book, current.daily_limit_usd,
        current.new_address_threshold_usd, current.new_address_delay_seconds, current.step_up_threshold_usd, current.policy_version),
    env.PROJECTION_DB.prepare(`INSERT INTO audit_events
        (audit_id, subject_reference, actor_type, actor_reference, action, target_type, target_reference, evidence_json, occurred_at)
      SELECT ?, ?, 'customer', ?, 'security.policy.updated', 'security_profile', ?, ?, ? WHERE changes() = 1`)
      .bind(crypto.randomUUID(), subject.subjectReference, subject.subjectReference, subject.subjectReference,
        JSON.stringify({ changedFields: Object.keys(input) }), now)
  ]);
  if (result.meta.changes !== 1) return Response.json({ error: "security_policy_changed", traceId }, { status: 409, headers: { "Cache-Control": "no-store" } });
  try {
    await env.PROJECTION_DB.prepare(`INSERT INTO product_events (event_id, subject_reference, session_reference, event_name, surface, properties_json, occurred_at)
      VALUES (?, ?, ?, 'security_updated', '/app/security', ?, ?)`)
      .bind(crypto.randomUUID(), subject.subjectReference, subject.sessionReference, JSON.stringify({ changedFields: Object.keys(input) }), now).run();
  } catch (error) {
    console.warn(JSON.stringify({ level: "warn", event: "security.policy.analytics.failed", traceId,
      errorName: error instanceof Error ? error.name : "unknown" }));
  }
  return Response.json({ policy: { ...next, newAddressDelayHours: next.newAddressDelaySeconds / 3600, policyVersion: current.policy_version + 1, updatedAt: now }, traceId });
});
