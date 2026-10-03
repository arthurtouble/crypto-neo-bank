import { findSubject } from "@/lib/account/closure";
import { privyEmail } from "@/lib/auth/privy";
import { freezeCardForLock } from "@/lib/cards/service";
import { announce } from "@/lib/notifications/deliver";
import { securityNotice } from "@/lib/notifications/store";
import { ensureSubjectProfile } from "@/lib/profile/ensure";

/**
 * What an operator sees about one customer: account state, controls, the
 * partners they're set up with, and how active they are. Everything here is
 * a projection or a record; balances come from the chain (the closure check).
 */
type CustomerProfile = {
  subjectReference: string;
  /** Read from Privy on each lookup (Aura keeps no copy); null when they have none or Privy can't be read. */
  email: string | null;
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
  /** The latest notices and how each was delivered, so support can see an email that bounced or failed. */
  notices: { recent: NoticeDelivery[]; emailFailed: number };
};
type NoticeDelivery = { id: string; kind: string; title: string; createdAt: string; email: string; push: string };

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

/** The customer's email from Privy, or null when they have none or Privy can't be read. Never stops the page. */
async function emailOf(subject: string): Promise<string | null> {
  try { return await privyEmail(subject); } catch { return null; }
}

/** Emails for a page of customers, a few Privy reads at a time so a page never bursts past its rate limit. */
async function emailsOf(subjects: string[], batch = 10): Promise<Array<string | null>> {
  const out: Array<string | null> = [];
  for (let index = 0; index < subjects.length; index += batch) out.push(...await Promise.all(subjects.slice(index, index + batch).map(emailOf)));
  return out;
}

type CustomerRow = { subjectReference: string; email: string | null; createdAt: string; closedAt: string | null; accountLocked: boolean; auraTag: string | null;
  bankStatus: string | null; cardStatus: string | null; actions: number; lastActivityAt: string | null };

/**
 * Every customer, newest sign-up first, a page at a time. The cursor is the
 * last row's sign-up time and ID, so customers who signed up in the same
 * instant are never skipped or repeated.
 */
export async function listCustomers(db: D1Database, options: { limit?: number; after?: { createdAt: string; subject: string } } = {}): Promise<{ customers: CustomerRow[]; next: string | null }> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
  const after = options.after;
  const rows = await db.prepare(`SELECT p.subject_reference, p.created_at, p.closed_at,
      COALESCE(s.account_locked, 0) AS account_locked,
      (SELECT tag FROM aura_tags t WHERE t.subject_reference = p.subject_reference AND t.active = 1) AS aura_tag,
      (SELECT status FROM provider_customer_links l WHERE l.subject_reference = p.subject_reference AND l.provider = 'bridge') AS bank_status,
      (SELECT status FROM card_account_projections c WHERE c.subject_reference = p.subject_reference ORDER BY c.observed_at DESC LIMIT 1) AS card_status,
      (SELECT COUNT(*) FROM actions a WHERE a.subject_reference = p.subject_reference AND a.status != 'prepared') AS actions,
      (SELECT MAX(created_at) FROM actions a WHERE a.subject_reference = p.subject_reference AND a.status != 'prepared') AS last_activity_at
    FROM subject_profiles p LEFT JOIN security_profiles s ON s.subject_reference = p.subject_reference
    ${after ? "WHERE (p.created_at < ?1 OR (p.created_at = ?1 AND p.subject_reference < ?2))" : ""}
    ORDER BY p.created_at DESC, p.subject_reference DESC LIMIT ${after ? "?3" : "?1"}`)
    .bind(...(after ? [after.createdAt, after.subject, limit + 1] : [limit + 1]))
    .all<{ subject_reference: string; created_at: string; closed_at: string | null; account_locked: number; aura_tag: string | null; bank_status: string | null;
      card_status: string | null; actions: number; last_activity_at: string | null }>();
  const page = rows.results.slice(0, limit);
  const last = page.at(-1);
  const emails = await emailsOf(page.map((row) => row.subject_reference));
  return {
    customers: page.map((row, index) => ({ subjectReference: row.subject_reference, email: emails[index], createdAt: row.created_at, closedAt: row.closed_at, accountLocked: Boolean(row.account_locked),
      auraTag: row.aura_tag, bankStatus: row.bank_status, cardStatus: row.card_status, actions: row.actions, lastActivityAt: row.last_activity_at })),
    next: rows.results.length > limit && last ? btoa(JSON.stringify([last.created_at, last.subject_reference])) : null
  };
}

/** Read a cursor from `listCustomers`; anything else is null. */
export function readCustomerCursor(cursor: string | null): { createdAt: string; subject: string } | null {
  if (!cursor) return null;
  try {
    const [createdAt, subject] = JSON.parse(atob(cursor)) as unknown[];
    return typeof createdAt === "string" && typeof subject === "string" && subject.length <= 200 ? { createdAt, subject } : null;
  } catch { return null; }
}

export async function customerProfile(db: D1Database, subject: string): Promise<CustomerProfile> {
  const [email, profile, controls, tag, bank, card, actions, notices, failed] = await Promise.all([
    emailOf(subject),
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
      .first<{ total: number; completed: number | null; failed: number | null; open: number | null; last_at: string | null }>(),
    db.prepare("SELECT notification_id, kind, title, created_at, email_status, push_status FROM notifications WHERE subject_reference = ? ORDER BY created_at DESC LIMIT 10")
      .bind(subject).all<{ notification_id: string; kind: string; title: string; created_at: string; email_status: string; push_status: string }>(),
    db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE subject_reference = ? AND email_status = 'failed'").bind(subject).first<{ n: number }>()
  ]);
  return {
    subjectReference: subject, email, createdAt: profile?.created_at ?? null, closedAt: profile?.closed_at ?? null, closedReason: profile?.closed_reason ?? null,
    controls: { accountLocked: Boolean(controls?.account_locked), dailyLimitUsd: controls?.daily_limit_cents ? controls.daily_limit_cents / 100 : null,
      enforceAddressBook: Boolean(controls?.enforce_address_book), updatedAt: controls?.updated_at ?? null },
    auraTag: tag?.tag ?? null,
    bank: bank ? { status: bank.status, kycStatus: bank.kyc_status, observedAt: bank.observed_at } : null,
    card: card ? { status: card.status, lastFour: card.last_four, observedAt: card.observed_at } : null,
    actions: { total: actions?.total ?? 0, completed: actions?.completed ?? 0, failed: actions?.failed ?? 0, open: actions?.open ?? 0, lastAt: actions?.last_at ?? null },
    intercomUserId: subject,
    notices: { emailFailed: failed?.n ?? 0, recent: notices.results.map((row) => ({ id: row.notification_id, kind: row.kind, title: row.title, createdAt: row.created_at,
      email: row.email_status, push: row.push_status })) }
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
