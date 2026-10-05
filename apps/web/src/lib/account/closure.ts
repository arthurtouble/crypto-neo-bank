import { requireActionWallet } from "@/lib/auth/wallet";
import { privyClient } from "@/lib/auth/privy";
import { announce } from "@/lib/notifications/deliver";
import { securityNotice } from "@/lib/notifications/store";
import { readOverview, type Overview } from "@/lib/overview/read";

/**
 * Closing an account. Customers ask support; an operator closes it, only when
 * the account holds nothing and nothing is on its way. Aura keeps the
 * account's records (they are financial, security, and consent evidence) and
 * never deletes them on request. A closed account is locked, its Aura tag is
 * unpublished, and every customer route but support and the data export
 * refuses it (`requireVerifiedSubject`). An operator can reopen it.
 */
type ClosureCheck = {
  subjectReference: string;
  wallet: string;
  closedAt: string | null;
  closedReason: string | null;
  eligible: boolean;
  /** Why the account can't be closed yet, in words an operator can pass on. */
  blockers: string[];
  /** Each balance as the chain showed it, with its value when a price was read, so support can answer "where is my money". */
  holdings: Array<{ label: string; symbol: string; decimals: number; amountRaw: string | null; usdCents: number | null; status: string }>;
  observedAt: string;
};

type Deps = { wallet?: (subject: string) => Promise<string>; overview?: (wallet: string) => Promise<Overview> };

/** Resolve an operator's search (a Privy user ID, an email, or a wallet address) to a customer. */
export async function findSubject(query: string): Promise<string | null> {
  const value = query.trim();
  const users = privyClient().users();
  try {
    if (value.startsWith("did:privy:")) return (await users._get(value)).id;
    if (/^0x[0-9a-fA-F]{40}$/.test(value)) return (await users.getByWalletAddress({ address: value })).id;
    if (value.includes("@")) return (await users.getByEmailAddress({ address: value })).id;
  } catch (error) {
    if ((error as { status?: number }).status === 404) return null;
    throw error;
  }
  return null;
}

export async function checkClosure(db: D1Database, subject: string, deps: Deps = {}): Promise<ClosureCheck> {
  const wallet = await (deps.wallet ?? requireActionWallet)(subject);
  const [overview, profile, open] = await Promise.all([
    (deps.overview ?? readOverview)(wallet),
    db.prepare("SELECT closed_at, closed_reason FROM subject_profiles WHERE subject_reference = ?").bind(subject).first<{ closed_at: string | null; closed_reason: string | null }>(),
    db.prepare(`SELECT COUNT(*) AS n FROM actions WHERE subject_reference = ?1
      AND (status IN ('submitted', 'settling') OR (status = 'prepared' AND expires_at > ?2))`).bind(subject, new Date().toISOString()).first<{ n: number }>()
  ]);
  const blockers: string[] = [];
  for (const holding of overview.holdings) {
    if (holding.status !== "observed") blockers.push(`${holding.label} couldn't be read, so we can't confirm it's empty`);
    else if (holding.amountRaw !== "0") blockers.push(`It still holds ${holding.label}`);
  }
  if ((open?.n ?? 0) > 0) blockers.push("A transaction is still in progress");
  return {
    subjectReference: subject, wallet, closedAt: profile?.closed_at ?? null, closedReason: profile?.closed_reason ?? null,
    eligible: blockers.length === 0, blockers,
    holdings: overview.holdings.map((holding) => ({ label: holding.label, symbol: holding.symbol, decimals: holding.decimals, amountRaw: holding.amountRaw,
      usdCents: holding.usdCents, status: holding.status })),
    observedAt: overview.observedAt
  };
}

function audit(db: D1Database, subject: string, operator: string, action: string, reason: string, now: string) {
  return db.prepare(`INSERT INTO audit_events (audit_id, subject_reference, actor_type, actor_reference, action, target_type, target_reference, evidence_json, occurred_at)
    SELECT ?, ?, 'operator', ?, ?, 'subject', ?, ?, ? WHERE changes() = 1`)
    .bind(crypto.randomUUID(), subject, operator, action, subject, JSON.stringify({ reason }), now);
}

/** Close the account. The caller has checked it is empty. Returns false if it was already closed. */
export async function closeAccount(db: D1Database, subject: string, operator: string, reason: string, now = new Date()): Promise<boolean> {
  const at = now.toISOString();
  const [closed] = await db.batch([
    db.prepare("UPDATE subject_profiles SET closed_at = ?, closed_by = ?, closed_reason = ?, updated_at = ? WHERE subject_reference = ? AND closed_at IS NULL")
      .bind(at, operator, reason, at, subject),
    audit(db, subject, operator, "account.closed", reason, at),
    db.prepare("UPDATE security_profiles SET account_locked = 1, policy_version = policy_version + 1, updated_at = ? WHERE subject_reference = ?").bind(at, subject),
    db.prepare("UPDATE aura_tags SET public_enabled = 0, public_bank_enabled = 0, updated_at = ? WHERE subject_reference = ?").bind(at, subject)
  ]);
  if ((closed.meta.changes ?? 0) !== 1) return false;
  await announce(db, subject, securityNotice("closed", "Your Aura account was closed at your request. You can still download your data.", at));
  return true;
}

/** Reopen a closed account. It stays locked until the customer unlocks it with their passkey. */
export async function reopenAccount(db: D1Database, subject: string, operator: string, reason: string, now = new Date()): Promise<boolean> {
  const at = now.toISOString();
  const [reopened] = await db.batch([
    db.prepare("UPDATE subject_profiles SET closed_at = NULL, closed_by = NULL, closed_reason = NULL, updated_at = ? WHERE subject_reference = ? AND closed_at IS NOT NULL")
      .bind(at, subject),
    audit(db, subject, operator, "account.reopened", reason, at)
  ]);
  if ((reopened.meta.changes ?? 0) !== 1) return false;
  await announce(db, subject, securityNotice("reopened", "Your Aura account was reopened. It stays locked until you unlock it in Settings with your passkey.", at));
  return true;
}
