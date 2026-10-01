import { STUCK_SETTLING_MS, STUCK_SUBMITTED_MS } from "@aurel/provider-projections";
import { callSchema, effectSchema, type ActionKind, type Call, type Effect } from "./types";
import type { Verification } from "./verify";

export const ACTION_TTL_MS = 10 * 60_000;

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

/** Any customer's action, for operators. */
export async function getActionForOperator(db: D1Database, id: string): Promise<StoredAction | null> {
  const row = await db.prepare(`${ACTIONS} WHERE action_id = ?`).bind(id).first<ActionRow>();
  return row ? fromRow(row) : null;
}

type ActionFilter = { status?: StoredAction["status"]; kind?: ActionKind; subject?: string; stuck?: boolean; before?: string; limit?: number };

/** Every customer's actions, newest first, for operators. Prepared actions nobody signed are left out. */
export async function listActionsForOperator(db: D1Database, filter: ActionFilter, now = new Date()): Promise<StoredAction[]> {
  const where = ["status != 'prepared'"];
  const values: unknown[] = [];
  if (filter.status) { where.push("status = ?"); values.push(filter.status); }
  if (filter.kind) { where.push("kind = ?"); values.push(filter.kind); }
  if (filter.subject) { where.push("subject_reference = ?"); values.push(filter.subject); }
  if (filter.before) { where.push("created_at < ?"); values.push(filter.before); }
  if (filter.stuck) {
    where.push("((status = 'submitted' AND submitted_at < ?) OR (status = 'settling' AND submitted_at < ?))");
    values.push(new Date(now.getTime() - STUCK_SUBMITTED_MS).toISOString(), new Date(now.getTime() - STUCK_SETTLING_MS).toISOString());
  }
  const rows = await db.prepare(`${ACTIONS} WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT ?`)
    .bind(...values, Math.min(filter.limit ?? 50, 100)).all<ActionRow>();
  return rows.results.map(fromRow);
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

/**
 * Record, once, evidence that explains why an open action hasn't moved:
 * Privy reported its relay as failed (`relay_failed`), or the hash Privy
 * reported is already linked to another action (`hash_in_use`).
 */
export async function appendEvidenceOnce(db: D1Database, actionId: string, type: "relay_failed" | "hash_in_use", evidence: Record<string, unknown>, now: Date) {
  await appendMilestone(db, actionId, type, now, evidence);
}

/** Record a milestone once, the first time it's reached. */
async function appendMilestone(db: D1Database, actionId: string, type: "source_final" | "delivered" | "relay_failed" | "hash_in_use", now: Date, evidence: Record<string, unknown> = {}) {
  await db.prepare(`INSERT INTO action_events (event_id, action_id, event_type, evidence_json, occurred_at)
      SELECT ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM action_events WHERE action_id = ? AND event_type = ?)`)
    .bind(crypto.randomUUID(), actionId, type, JSON.stringify(evidence), now.toISOString(), actionId, type).run();
}

type SubmitResult = "submitted" | "already_submitted" | "hash_in_use" | "not_submittable";

/**
 * Bind a reported transaction hash to a prepared action, once, within its
 * signing window. The caller first checks on the chain that the hash is the
 * wallet's own operation with these calls (`checkReportedTransaction`). An
 * expired action stays expired.
 */
export async function recordSubmission(db: D1Database, action: StoredAction, hash: string, now: Date): Promise<SubmitResult> {
  const normalized = hash.toLowerCase();
  if (action.transactionHash) return action.transactionHash === normalized ? "already_submitted" : "not_submittable";
  if (action.status !== "prepared") return "not_submittable";
  try {
    const result = await db.prepare(`UPDATE actions SET status = 'submitted', transaction_hash = ?, submitted_at = ?, updated_at = ?
      WHERE action_id = ? AND subject_reference = ? AND transaction_hash IS NULL AND status = 'prepared' AND expires_at > ?`)
      .bind(normalized, now.toISOString(), now.toISOString(), action.id, action.subject, now.toISOString()).run();
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

/**
 * Attach the chain hash Privy reported for a relayed action. When another
 * action already holds that hash, nothing is attached: the conflict is
 * recorded once as evidence (`hash_in_use`) for operators, and the action
 * stays open without a hash instead of failing every later check.
 */
export async function attachRelayHash(db: D1Database, action: StoredAction, hash: string, now: Date): Promise<StoredAction> {
  const normalized = hash.toLowerCase();
  try {
    await db.prepare("UPDATE actions SET transaction_hash = ?, updated_at = ? WHERE action_id = ? AND transaction_hash IS NULL")
      .bind(normalized, now.toISOString(), action.id).run();
  } catch (error) {
    if (!String(error).includes("UNIQUE")) throw error;
    await appendEvidenceOnce(db, action.id, "hash_in_use", { transactionHash: normalized }, now);
    return action;
  }
  return { ...action, transactionHash: normalized };
}

export async function expireIfStale(db: D1Database, action: StoredAction, now: Date): Promise<StoredAction> {
  if (action.status !== "prepared" || action.expiresAt > now.toISOString()) return action;
  await db.prepare("UPDATE actions SET status = 'expired', updated_at = ? WHERE action_id = ? AND status = 'prepared'")
    .bind(now.toISOString(), action.id).run();
  return { ...action, status: "expired" };
}

/**
 * Persist a verification outcome. Pending results only record that a check ran. If another check already moved the
 * action on from the status this one read, nothing is written and the action is returned as read.
 */
export async function applyVerification(db: D1Database, action: StoredAction, result: Verification, now: Date): Promise<StoredAction> {
  const at = now.toISOString();
  const next: StoredAction["status"] = result.status === "pending" ? action.status : result.status;
  const destinationHash = "destinationHash" in result && result.destinationHash ? result.destinationHash.toLowerCase() : action.destinationTransactionHash;
  const failure = result.status === "failed" ? result.reason : null;
  const settledAt = result.status === "confirmed" || result.status === "failed" ? at : null;
  // Only from the status this check read: a slower check that started earlier can't move the action backwards or record twice.
  const updated = await db.prepare(`UPDATE actions SET status = ?, destination_transaction_hash = COALESCE(destination_transaction_hash, ?),
      failure_reason = COALESCE(?, failure_reason), settled_at = COALESCE(settled_at, ?), checked_at = ?, updated_at = ?
    WHERE action_id = ? AND status = ?`).bind(next, destinationHash, failure, settledAt, at, at, action.id, action.status).run();
  if ((updated.meta.changes ?? 0) === 0) return action;
  // A route to another network has two milestones before it's complete: final on the source network, then delivered.
  if (action.destinationChainId && (result.status === "confirmed" || (result.status === "settling" && result.reason !== "finality")))
    await appendMilestone(db, action.id, "source_final", now);
  if (action.destinationChainId && destinationHash) await appendMilestone(db, action.id, "delivered", now, { destinationHash });
  if (next !== action.status) await appendEvent(db, action.id, next, { ...result }, now);
  return { ...action, status: next, destinationTransactionHash: destinationHash, failureReason: failure ?? action.failureReason,
    settledAt: action.settledAt ?? settledAt, checkedAt: at };
}
