import { callSchema, effectSchema, type ActionKind, type Call, type Effect } from "./types";
import type { Verification } from "./verify";

export const ACTION_TTL_MS = 10 * 60_000;
const DAY_MS = 86_400_000;

export type Controls = {
  accountLocked: boolean;
  enforceAddressBook: boolean;
  dailyLimitCents: number | null;
  /** Rolling 24-hour value of outgoing actions that are prepared (and unexpired), submitted, or settled. */
  spentCents: number;
  /** An outgoing action in the window has no value, so a limit cannot be checked. */
  spentUnknown: boolean;
  recipient: "saved" | "cooling" | "unsaved" | null;
};

type ControlsRow = { account_locked: number | null; enforce_address_book: number | null; daily_limit_cents: number | null;
  spent_cents: number; unknown_values: number; recipient_available_at: string | null };

const OPEN_OUTGOING = `subject_reference = ?1 AND counts_toward_limit = 1 AND created_at >= ?2
  AND (status IN ('submitted', 'settling', 'confirmed') OR (status = 'prepared' AND expires_at > ?3))`;

export async function loadControls(db: D1Database, subject: string, recipient: string | null, now: Date): Promise<Controls> {
  const row = await db.prepare(`SELECT
      (SELECT account_locked FROM security_profiles WHERE subject_reference = ?1) AS account_locked,
      (SELECT enforce_address_book FROM security_profiles WHERE subject_reference = ?1) AS enforce_address_book,
      (SELECT daily_limit_cents FROM security_profiles WHERE subject_reference = ?1) AS daily_limit_cents,
      (SELECT COALESCE(SUM(usd_cents), 0) FROM actions WHERE ${OPEN_OUTGOING}) AS spent_cents,
      (SELECT COUNT(*) FROM actions WHERE ${OPEN_OUTGOING} AND usd_cents IS NULL) AS unknown_values,
      (SELECT available_at FROM address_book_entries WHERE subject_reference = ?1 AND chain_family = 'evm' AND address = ?4) AS recipient_available_at`)
    .bind(subject, new Date(now.getTime() - DAY_MS).toISOString(), now.toISOString(), recipient?.toLowerCase() ?? "")
    .first<ControlsRow>();
  return {
    accountLocked: Boolean(row?.account_locked),
    enforceAddressBook: Boolean(row?.enforce_address_book),
    dailyLimitCents: row?.daily_limit_cents ?? null,
    spentCents: row?.spent_cents ?? 0,
    spentUnknown: (row?.unknown_values ?? 0) > 0,
    recipient: recipient === null ? null
      : !row?.recipient_available_at ? "unsaved"
        : row.recipient_available_at <= now.toISOString() ? "saved" : "cooling"
  };
}

export type NewAction = {
  subject: string; wallet: string; kind: ActionKind; chainId: number; summary: Record<string, unknown>;
  calls: Call[]; callsFingerprint: string; effects: Effect[]; countsTowardLimit: boolean;
  usdCents: number | null; valuationSource: string | null; routeQuoteId: string | null; destinationChainId: number | null;
};

/**
 * Insert a prepared action only if the account is unlocked and, when a daily
 * limit is set, the action still fits. The check and insert are one statement,
 * so parallel requests cannot both pass a limit.
 */
export async function insertAction(db: D1Database, action: NewAction, now: Date): Promise<string | null> {
  const id = crypto.randomUUID();
  const created = now.toISOString();
  const result = await db.prepare(`INSERT INTO actions (action_id, subject_reference, wallet_address, kind, chain_id,
      summary_json, calls_json, calls_fingerprint, effects_json, counts_toward_limit, usd_cents, valuation_source,
      route_quote_id, destination_chain_id, status, created_at, expires_at, updated_at)
    SELECT ?5, ?1, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, 'prepared', ?3, ?18, ?3
    WHERE COALESCE((SELECT account_locked FROM security_profiles WHERE subject_reference = ?1), 0) = 0
      AND (?13 = 0 OR (SELECT daily_limit_cents FROM security_profiles WHERE subject_reference = ?1) IS NULL
        OR (?14 IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM actions WHERE ${OPEN_OUTGOING} AND usd_cents IS NULL)
          AND (SELECT COALESCE(SUM(usd_cents), 0) FROM actions WHERE ${OPEN_OUTGOING}) + ?14
            <= (SELECT daily_limit_cents FROM security_profiles WHERE subject_reference = ?1)))`)
    .bind(action.subject, new Date(now.getTime() - DAY_MS).toISOString(), created, null, id,
      action.wallet.toLowerCase(), action.kind, action.chainId, JSON.stringify(action.summary), JSON.stringify(action.calls),
      action.callsFingerprint, JSON.stringify(action.effects), action.countsTowardLimit ? 1 : 0, action.usdCents,
      action.valuationSource, action.routeQuoteId, action.destinationChainId,
      new Date(now.getTime() + ACTION_TTL_MS).toISOString())
    .run();
  return result.meta.changes === 1 ? id : null;
}

type ActionRow = { action_id: string; subject_reference: string; wallet_address: string; kind: ActionKind; chain_id: number;
  summary_json: string; calls_json: string; effects_json: string; usd_cents: number | null; status: string;
  transaction_hash: string | null; relay_reference: string | null; destination_chain_id: number | null; destination_transaction_hash: string | null;
  failure_reason: string | null; created_at: string; expires_at: string; submitted_at: string | null;
  settled_at: string | null; checked_at: string | null; bank_state?: string | null };

/**
 * Actions, with the latest state Bridge reported for a bank payout (from its
 * webhooks or a read of the transfer). Only a payout's funding action has one.
 */
const ACTIONS = `SELECT actions.*, (SELECT json_extract(e.evidence_json, '$.state') FROM action_events e
  WHERE e.action_id = actions.action_id AND e.event_type = 'bank_payout' ORDER BY e.occurred_at DESC LIMIT 1) AS bank_state FROM actions`;

export type StoredAction = {
  id: string; subject: string; wallet: string; kind: ActionKind; chainId: number; summary: Record<string, unknown>;
  calls: Call[]; effects: Effect[]; usdCents: number | null; status: "prepared" | "submitted" | "settling" | "confirmed" | "failed" | "expired";
  transactionHash: string | null; relayReference: string | null; destinationChainId: number | null; destinationTransactionHash: string | null;
  failureReason: string | null; createdAt: string; expiresAt: string; submittedAt: string | null; settledAt: string | null; checkedAt: string | null;
  /** Bridge's latest state for a bank payout; null for every other action. */
  bankState: string | null;
};

function fromRow(row: ActionRow): StoredAction {
  return {
    id: row.action_id, subject: row.subject_reference, wallet: row.wallet_address, kind: row.kind, chainId: row.chain_id,
    summary: JSON.parse(row.summary_json) as Record<string, unknown>,
    calls: callSchema.array().parse(JSON.parse(row.calls_json)), effects: effectSchema.array().parse(JSON.parse(row.effects_json)),
    usdCents: row.usd_cents, status: row.status as StoredAction["status"], transactionHash: row.transaction_hash, relayReference: row.relay_reference,
    destinationChainId: row.destination_chain_id, destinationTransactionHash: row.destination_transaction_hash,
    failureReason: row.failure_reason, createdAt: row.created_at, expiresAt: row.expires_at, submittedAt: row.submitted_at,
    settledAt: row.settled_at, checkedAt: row.checked_at, bankState: row.bank_state ?? null
  };
}

export async function getAction(db: D1Database, subject: string, id: string): Promise<StoredAction | null> {
  const row = await db.prepare(`${ACTIONS} WHERE action_id = ? AND subject_reference = ?`).bind(id, subject).first<ActionRow>();
  return row ? fromRow(row) : null;
}

export async function listActions(db: D1Database, subject: string, limit = 50): Promise<StoredAction[]> {
  const rows = await db.prepare(`${ACTIONS} WHERE subject_reference = ? AND status != 'prepared' ORDER BY created_at DESC LIMIT ?`)
    .bind(subject, limit).all<ActionRow>();
  return rows.results.map(fromRow);
}

/** Every transaction hash the customer's actions produced, on either network, lowercased. */
export async function listActionHashes(db: D1Database, subject: string): Promise<string[]> {
  const rows = await db.prepare(`SELECT transaction_hash AS hash FROM actions WHERE subject_reference = ?1 AND transaction_hash IS NOT NULL
    UNION SELECT destination_transaction_hash FROM actions WHERE subject_reference = ?1 AND destination_transaction_hash IS NOT NULL`)
    .bind(subject).all<{ hash: string }>();
  return rows.results.map((row) => row.hash.toLowerCase());
}

/** Settled or submitted actions created in [start, end), oldest first. */
export async function listActionsBetween(db: D1Database, subject: string, start: Date, end: Date): Promise<StoredAction[]> {
  const rows = await db.prepare(`${ACTIONS} WHERE subject_reference = ? AND status NOT IN ('prepared', 'expired')
    AND created_at >= ? AND created_at < ? ORDER BY created_at ASC LIMIT 5000`).bind(subject, start.toISOString(), end.toISOString()).all<ActionRow>();
  return rows.results.map(fromRow);
}

/** Submitted or settling actions not checked since `checkedBefore`, least recently checked first, across all customers. */
export async function listDueActions(db: D1Database, checkedBefore: Date, limit: number): Promise<StoredAction[]> {
  const rows = await db.prepare(`${ACTIONS} WHERE status IN ('submitted', 'settling') AND (transaction_hash IS NOT NULL OR relay_reference IS NOT NULL)
    AND (checked_at IS NULL OR checked_at < ?) ORDER BY COALESCE(checked_at, '') ASC, created_at ASC LIMIT ?`)
    .bind(checkedBefore.toISOString(), limit).all<ActionRow>();
  return rows.results.map(fromRow);
}

/** Expire every prepared action whose signing window has passed. Returns how many. */
export async function expireStalePrepared(db: D1Database, now: Date): Promise<number> {
  const result = await db.prepare("UPDATE actions SET status = 'expired', updated_at = ?1 WHERE status = 'prepared' AND expires_at <= ?1")
    .bind(now.toISOString()).run();
  return result.meta.changes ?? 0;
}

export type ActionEvent = { type: string; evidence: Record<string, unknown>; occurredAt: string };

/** An action's history: submission, status changes, and provider updates such as bank payout states. */
export async function listActionEvents(db: D1Database, actionId: string): Promise<ActionEvent[]> {
  const rows = await db.prepare("SELECT event_type, evidence_json, occurred_at FROM action_events WHERE action_id = ? ORDER BY occurred_at, rowid")
    .bind(actionId).all<{ event_type: string; evidence_json: string; occurred_at: string }>();
  return rows.results.map((row) => ({ type: row.event_type, evidence: JSON.parse(row.evidence_json) as Record<string, unknown>, occurredAt: row.occurred_at }));
}

async function appendEvent(db: D1Database, actionId: string, type: string, evidence: Record<string, unknown>, now: Date) {
  await db.prepare("INSERT INTO action_events (event_id, action_id, event_type, evidence_json, occurred_at) VALUES (?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), actionId, type, JSON.stringify(evidence), now.toISOString()).run();
}

/** Record a milestone once, the first time it's reached. */
async function appendMilestone(db: D1Database, actionId: string, type: "source_final" | "delivered", now: Date, evidence: Record<string, unknown> = {}) {
  await db.prepare(`INSERT INTO action_events (event_id, action_id, event_type, evidence_json, occurred_at)
      SELECT ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM action_events WHERE action_id = ? AND event_type = ?)`)
    .bind(crypto.randomUUID(), actionId, type, JSON.stringify(evidence), now.toISOString(), actionId, type).run();
}

export type SubmitResult = "submitted" | "already_submitted" | "hash_in_use" | "not_submittable";

/** Bind a reported transaction hash to an action, once. A late report after expiry is accepted; the chain decides. */
export async function recordSubmission(db: D1Database, action: StoredAction, hash: string, now: Date): Promise<SubmitResult> {
  const normalized = hash.toLowerCase();
  if (action.transactionHash) return action.transactionHash === normalized ? "already_submitted" : "not_submittable";
  if (action.status !== "prepared" && action.status !== "expired") return "not_submittable";
  try {
    const result = await db.prepare(`UPDATE actions SET status = 'submitted', transaction_hash = ?, submitted_at = ?, updated_at = ?
      WHERE action_id = ? AND subject_reference = ? AND transaction_hash IS NULL AND status IN ('prepared', 'expired')`)
      .bind(normalized, now.toISOString(), now.toISOString(), action.id, action.subject).run();
    if (result.meta.changes !== 1) return "not_submittable";
  } catch (error) {
    if (String(error).includes("UNIQUE")) return "hash_in_use";
    throw error;
  }
  await appendEvent(db, action.id, "submitted", { transactionHash: normalized }, now);
  return "submitted";
}

/**
 * Record that Aura relayed a prepared action to Privy, which returned
 * `reference`. The chain hash is attached later, once the operation lands.
 */
export async function recordRelay(db: D1Database, action: StoredAction, reference: string, now: Date): Promise<boolean> {
  const at = now.toISOString();
  const result = await db.prepare(`UPDATE actions SET status = 'submitted', relay_reference = ?, submitted_at = ?, updated_at = ?
    WHERE action_id = ? AND subject_reference = ? AND status = 'prepared' AND relay_reference IS NULL AND transaction_hash IS NULL`)
    .bind(reference, at, at, action.id, action.subject).run();
  if (result.meta.changes !== 1) return false;
  await appendEvent(db, action.id, "submitted", { relayReference: reference }, now);
  return true;
}

/** Attach the chain hash Privy reported for a relayed action. */
export async function attachRelayHash(db: D1Database, action: StoredAction, hash: string, now: Date): Promise<StoredAction> {
  const normalized = hash.toLowerCase();
  await db.prepare("UPDATE actions SET transaction_hash = ?, updated_at = ? WHERE action_id = ? AND transaction_hash IS NULL")
    .bind(normalized, now.toISOString(), action.id).run();
  return { ...action, transactionHash: normalized };
}

export async function expireIfStale(db: D1Database, action: StoredAction, now: Date): Promise<StoredAction> {
  if (action.status !== "prepared" || action.expiresAt > now.toISOString()) return action;
  await db.prepare("UPDATE actions SET status = 'expired', updated_at = ? WHERE action_id = ? AND status = 'prepared'")
    .bind(now.toISOString(), action.id).run();
  return { ...action, status: "expired" };
}

/** Persist a verification outcome. Pending results only record that a check ran. */
export async function applyVerification(db: D1Database, action: StoredAction, result: Verification, now: Date): Promise<StoredAction> {
  const at = now.toISOString();
  const next: StoredAction["status"] = result.status === "pending" ? action.status : result.status;
  const destinationHash = "destinationHash" in result && result.destinationHash ? result.destinationHash.toLowerCase() : action.destinationTransactionHash;
  const failure = result.status === "failed" ? result.reason : null;
  const settledAt = result.status === "confirmed" || result.status === "failed" ? at : null;
  await db.prepare(`UPDATE actions SET status = ?, destination_transaction_hash = COALESCE(destination_transaction_hash, ?),
      failure_reason = COALESCE(?, failure_reason), settled_at = COALESCE(settled_at, ?), checked_at = ?, updated_at = ?
    WHERE action_id = ?`).bind(next, destinationHash, failure, settledAt, at, at, action.id).run();
  // A route to another network has two milestones before it's complete: final on the source network, then delivered.
  if (action.destinationChainId && (result.status === "confirmed" || (result.status === "settling" && result.reason !== "finality")))
    await appendMilestone(db, action.id, "source_final", now);
  if (action.destinationChainId && destinationHash) await appendMilestone(db, action.id, "delivered", now, { destinationHash });
  if (next !== action.status) await appendEvent(db, action.id, next, { ...result }, now);
  return { ...action, status: next, destinationTransactionHash: destinationHash, failureReason: failure ?? action.failureReason,
    settledAt: action.settledAt ?? settledAt, checkedAt: at };
}
