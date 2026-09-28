import { findSubject } from "@/lib/account/closure";
import { freezeCardForLock } from "@/lib/cards/service";
import { announce } from "@/lib/notifications/deliver";
import { securityNotice } from "@/lib/notifications/store";
import { ensureSubjectProfile } from "@/lib/profile/ensure";

/**
 * What an operator sees about one customer: account state, controls, the
 * partners they're set up with, and how active they are. Everything here is
 * a projection or a record; balances come from the chain (the closure check).
 */
export type CustomerProfile = {
  subjectReference: string;
  createdAt: string | null;
  closedAt: string | null;
  closedReason: string | null;
  controls: { accountLocked: boolean; dailyLimitUsd: number | null; enforceAddressBook: boolean; updatedAt: string | null };
  auraTag: string | null;
  bank: { status: string; kycStatus: string | null; observedAt: string | null } | null;
  card: { status: string; lastFour: string | null; observedAt: string } | null;
  actions: { total: number; completed: number; failed: number; open: number; lastAt: string | null };
  /** Intercom identifies the customer by this user ID (the Messenger JWT's `user_id`). */
  intercomUserId: string;
};

/** Find a customer by Privy user ID, email, wallet address, or Aura tag. */
export async function findCustomer(db: D1Database, query: string): Promise<string | null> {
  const value = query.trim();
  const tag = /^@?([a-z0-9_]{3,32})$/i.exec(value);
  if (tag && !value.startsWith("did:") && !value.startsWith("0x")) {
    const row = await db.prepare("SELECT subject_reference FROM aura_tags WHERE tag = ? AND active = 1").bind(tag[1].toLowerCase()).first<{ subject_reference: string }>();
    if (row) return row.subject_reference;
  }
  return findSubject(value);
}

export async function customerProfile(db: D1Database, subject: string): Promise<CustomerProfile> {
  const [profile, controls, tag, bank, card, actions] = await Promise.all([
    db.prepare("SELECT created_at, closed_at, closed_reason FROM subject_profiles WHERE subject_reference = ?").bind(subject)
      .first<{ created_at: string; closed_at: string | null; closed_reason: string | null }>(),
    db.prepare("SELECT account_locked, daily_limit_cents, enforce_address_book, updated_at FROM security_profiles WHERE subject_reference = ?").bind(subject)
      .first<{ account_locked: number; daily_limit_cents: number | null; enforce_address_book: number; updated_at: string }>(),
    db.prepare("SELECT tag FROM aura_tags WHERE subject_reference = ? AND active = 1").bind(subject).first<{ tag: string }>(),
    db.prepare("SELECT status, kyc_status, observed_at FROM provider_customer_links WHERE subject_reference = ? AND provider = 'bridge'").bind(subject)
      .first<{ status: string; kyc_status: string | null; observed_at: string | null }>(),
    db.prepare("SELECT status, last_four, observed_at FROM card_account_projections WHERE subject_reference = ? ORDER BY observed_at DESC LIMIT 1").bind(subject)
      .first<{ status: string; last_four: string | null; observed_at: string }>(),
    db.prepare(`SELECT COUNT(*) AS total, SUM(status = 'confirmed' OR status = 'settling') AS completed, SUM(status = 'failed') AS failed,
      SUM(status = 'submitted') AS open, MAX(created_at) AS last_at FROM actions WHERE subject_reference = ? AND status != 'prepared'`).bind(subject)
      .first<{ total: number; completed: number | null; failed: number | null; open: number | null; last_at: string | null }>()
  ]);
  return {
    subjectReference: subject, createdAt: profile?.created_at ?? null, closedAt: profile?.closed_at ?? null, closedReason: profile?.closed_reason ?? null,
    controls: { accountLocked: Boolean(controls?.account_locked), dailyLimitUsd: controls?.daily_limit_cents ? controls.daily_limit_cents / 100 : null,
      enforceAddressBook: Boolean(controls?.enforce_address_book), updatedAt: controls?.updated_at ?? null },
    auraTag: tag?.tag ?? null,
    bank: bank ? { status: bank.status, kycStatus: bank.kyc_status, observedAt: bank.observed_at } : null,
    card: card ? { status: card.status, lastFour: card.last_four, observedAt: card.observed_at } : null,
    actions: { total: actions?.total ?? 0, completed: actions?.completed ?? 0, failed: actions?.failed ?? 0, open: actions?.open ?? 0, lastAt: actions?.last_at ?? null },
    intercomUserId: subject
  };
}

/**
 * Lock an account for its customer's protection, for example when someone
 * else may be using it. Sending stops at once and the card is frozen. Only
 * the customer unlocks it, in Settings with their passkey. Returns false if it
 * was already locked.
 */
export async function lockAccount(db: D1Database, subject: string, operator: string, reason: string, now = new Date()): Promise<boolean> {
  const at = now.toISOString();
  await ensureSubjectProfile(db, subject);
  const [locked] = await db.batch([
    db.prepare("UPDATE security_profiles SET account_locked = 1, policy_version = policy_version + 1, updated_at = ? WHERE subject_reference = ? AND account_locked = 0")
      .bind(at, subject),
    db.prepare(`INSERT INTO audit_events (audit_id, subject_reference, actor_type, actor_reference, action, target_type, target_reference, evidence_json, occurred_at)
      SELECT ?, ?, 'operator', ?, 'account.locked', 'subject', ?, ?, ? WHERE changes() = 1`)
      .bind(crypto.randomUUID(), subject, operator, subject, JSON.stringify({ reason }), at)
  ]);
  if ((locked.meta.changes ?? 0) !== 1) return false;
  await freezeCardForLock(db, subject, now);
  await announce(db, subject, securityNotice("locked", "Our team locked your Aura account to protect it. Nothing can be sent until you unlock it in Settings with your passkey.", `operator:${at}`), now);
  return true;
}
