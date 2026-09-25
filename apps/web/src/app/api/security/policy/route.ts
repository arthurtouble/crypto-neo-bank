import { env } from "cloudflare:workers";
import { readWalletPolicies } from "@aurel/provider-projections";
import { z } from "zod";
import { requireVerifiedSubject } from "@/lib/auth/server";
import { errorResponse, route } from "@/lib/http/route";
import { ensureSubjectProfile } from "@/lib/profile/ensure";

const updateSchema = z.strictObject({
  accountLocked: z.boolean().optional(),
  enforceAddressBook: z.boolean().optional(),
  /** Null removes the limit. */
  dailyLimitUsd: z.number().int().min(1).max(10_000_000).nullable().optional(),
  newAddressDelayHours: z.number().int().min(0).max(168).optional()
}).refine((value) => Object.keys(value).length > 0);

type PolicyRow = { account_locked: number; enforce_address_book: number; daily_limit_cents: number | null;
  new_address_delay_seconds: number; policy_version: number; updated_at: string };

function serialize(row: PolicyRow) {
  return { accountLocked: Boolean(row.account_locked), enforceAddressBook: Boolean(row.enforce_address_book),
    dailyLimitUsd: row.daily_limit_cents === null ? null : row.daily_limit_cents / 100,
    newAddressDelayHours: row.new_address_delay_seconds / 3600, policyVersion: row.policy_version, updatedAt: row.updated_at,
    // Aura enforces these on the actions it prepares. They do not bind a key exported and used elsewhere.
    enforcement: "aura" as const };
}

async function readPolicy(db: D1Database, subject: string): Promise<PolicyRow> {
  const row = await db.prepare(`SELECT account_locked, enforce_address_book, daily_limit_cents, new_address_delay_seconds, policy_version, updated_at
    FROM security_profiles WHERE subject_reference = ?`).bind(subject).first<PolicyRow>();
  if (!row) throw new Error("Security profile was not initialized.");
  return row;
}

export const GET = route("security.policy.get", { unavailable: "security_policy_unavailable" }, async (request, { traceId }) => {
  const subject = await requireVerifiedSubject(request);
  await ensureSubjectProfile(env.PROJECTION_DB, subject.subjectReference);
  const row = await readPolicy(env.PROJECTION_DB, subject.subjectReference);
  // Rules enforced by the wallet provider itself, shown alongside Aura's controls.
  const walletPolicies = await readWalletPolicies(env.PROJECTION_DB, subject.subjectReference);
  return Response.json({ policy: serialize(row), walletPolicies, traceId });
});

/** Change the customer's controls. Every change is audited; a concurrent change is rejected, not merged. */
export const PATCH = route("security.policy.patch", { unavailable: "security_policy_update_unavailable", invalid: "invalid_security_policy" }, async (request, context) => {
  const subject = await requireVerifiedSubject(request);
  const input = updateSchema.parse(await request.json());
  await ensureSubjectProfile(env.PROJECTION_DB, subject.subjectReference);
  const current = await readPolicy(env.PROJECTION_DB, subject.subjectReference);
  const next = {
    accountLocked: input.accountLocked ?? Boolean(current.account_locked),
    enforceAddressBook: input.enforceAddressBook ?? Boolean(current.enforce_address_book),
    dailyLimitCents: input.dailyLimitUsd === undefined ? current.daily_limit_cents : input.dailyLimitUsd === null ? null : input.dailyLimitUsd * 100,
    newAddressDelaySeconds: input.newAddressDelayHours === undefined ? current.new_address_delay_seconds : input.newAddressDelayHours * 3600
  };
  const now = new Date().toISOString();
  const [result] = await env.PROJECTION_DB.batch([
    env.PROJECTION_DB.prepare(`UPDATE security_profiles SET account_locked = ?, enforce_address_book = ?, daily_limit_cents = ?,
        new_address_delay_seconds = ?, policy_version = policy_version + 1, updated_at = ?
      WHERE subject_reference = ? AND policy_version = ?`)
      .bind(next.accountLocked ? 1 : 0, next.enforceAddressBook ? 1 : 0, next.dailyLimitCents, next.newAddressDelaySeconds, now,
        subject.subjectReference, current.policy_version),
    env.PROJECTION_DB.prepare(`INSERT INTO audit_events
        (audit_id, subject_reference, actor_type, actor_reference, action, target_type, target_reference, evidence_json, occurred_at)
      SELECT ?, ?, 'customer', ?, 'security.policy.updated', 'security_profile', ?, ?, ? WHERE changes() = 1`)
      .bind(crypto.randomUUID(), subject.subjectReference, subject.subjectReference, subject.subjectReference,
        JSON.stringify({ changes: input, sessionReference: subject.sessionReference }), now)
  ]);
  if (result.meta.changes !== 1) return errorResponse(409, "security_policy_changed", context, { message: "Your controls changed in another session. Refresh and try again." });
  return Response.json({ policy: serialize(await readPolicy(env.PROJECTION_DB, subject.subjectReference)), traceId: context.traceId });
});
