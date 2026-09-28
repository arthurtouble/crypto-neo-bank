import { env } from "cloudflare:workers";
import { z } from "zod";
import { requireVerifiedSubject } from "@/lib/auth/server";
import { requireActionAccount, requireMoneyMfa } from "@/lib/auth/wallet";
import { errorResponse, route } from "@/lib/http/route";
import { ensureSubjectProfile } from "@/lib/profile/ensure";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { announce } from "@/lib/notifications/deliver";
import { securityNotice } from "@/lib/notifications/store";
import { loosening } from "@/lib/security/policy";
import { completeStepUp, createStepUp } from "@/lib/security/step-up";

const changesSchema = z.strictObject({
  accountLocked: z.boolean().optional(),
  enforceAddressBook: z.boolean().optional(),
  /** Null removes the limit. */
  dailyLimitUsd: z.number().int().min(1).max(10_000_000).nullable().optional(),
  newAddressDelayHours: z.number().int().min(0).max(168).optional()
});
const updateSchema = changesSchema.extend({
  /** The passkey confirmation a loosening change needs (`lib/security/step-up.ts`). */
  confirmation: z.strictObject({ challengeId: z.string().uuid(), signature: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/).min(40).max(400) }).optional()
}).refine((value) => Object.keys(value).some((key) => key !== "confirmation"));


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
  return Response.json({ policy: serialize(row), traceId });
});

/** Change the customer's controls. Every change is audited; a concurrent change is rejected, not merged. */
export const PATCH = route("security.policy.patch", { unavailable: "security_policy_update_unavailable", invalid: "invalid_security_policy" }, async (request, context) => {
  const subject = await requireVerifiedSubject(request);
  await enforceRateLimit(env.PROJECTION_DB, { namespace: "security_policy", subject: subject.subjectReference, limit: 30, windowSeconds: 600 });
  const { confirmation, ...input } = updateSchema.parse(await request.json());
  await ensureSubjectProfile(env.PROJECTION_DB, subject.subjectReference);
  const current = await readPolicy(env.PROJECTION_DB, subject.subjectReference);
  const next = {
    accountLocked: input.accountLocked ?? Boolean(current.account_locked),
    enforceAddressBook: input.enforceAddressBook ?? Boolean(current.enforce_address_book),
    dailyLimitCents: input.dailyLimitUsd === undefined ? current.daily_limit_cents : input.dailyLimitUsd === null ? null : input.dailyLimitUsd * 100,
    newAddressDelaySeconds: input.newAddressDelayHours === undefined ? current.new_address_delay_seconds : input.newAddressDelayHours * 3600
  };
  const reasons = loosening({ accountLocked: Boolean(current.account_locked), enforceAddressBook: Boolean(current.enforce_address_book),
    dailyLimitCents: current.daily_limit_cents, newAddressDelaySeconds: current.new_address_delay_seconds }, next);
  if (reasons.length) {
    // Only a passkey (or authenticator app) makes the confirmation meaningful.
    await requireMoneyMfa(subject.subjectReference);
    const account = await requireActionAccount(subject.subjectReference);
    // The confirmation covers this exact change from this exact version of the controls.
    const payload = { changes: input, from: current.policy_version };
    if (!confirmation) {
      const summary = `confirm you want to ${reasons.join(", ")}`;
      const challenge = await createStepUp(env.PROJECTION_DB, subject.subjectReference, account, "security_policy", payload, summary);
      return Response.json({ error: "confirmation_required", message: `Confirm with your passkey to ${reasons.join(", ")}.`, ...challenge, traceId: context.traceId }, { status: 428 });
    }
    await completeStepUp(env.PROJECTION_DB, subject.subjectReference, account, "security_policy", payload, confirmation);
  }
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
        JSON.stringify({ changes: input, confirmedWithPasskey: reasons.length > 0, sessionReference: subject.sessionReference }), now)
  ]);
  if (result.meta.changes !== 1) return errorResponse(409, "security_policy_changed", context, { message: "Your controls changed in another session. Refresh and try again." });
  // Locking and loosening are security events: the customer always hears about them.
  const version = String(current.policy_version + 1);
  const notice = !current.account_locked && next.accountLocked ? securityNotice("locked", "Your Aura account was locked. Nothing can be sent until you unlock it with your passkey.", version)
    : reasons.length ? securityNotice("loosened", `Your controls were changed to ${reasons.join(", ")}, confirmed with your passkey.`, version) : null;
  if (notice) await announce(env.PROJECTION_DB, subject.subjectReference, notice);
  return Response.json({ policy: serialize(await readPolicy(env.PROJECTION_DB, subject.subjectReference)), traceId: context.traceId });
});
