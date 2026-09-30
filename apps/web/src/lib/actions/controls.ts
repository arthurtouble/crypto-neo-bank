import { HttpError } from "@/lib/http/errors";
import { ACTION_TTL_MS } from "./store";
import type { ActionKind, BuiltAction, Call, Effect } from "./types";
import type { Valuation } from "./valuation";

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
 * so parallel requests cannot both pass a limit. Returns "quote_used" when
 * another action already took the route quote.
 */
export async function insertAction(db: D1Database, action: NewAction, now: Date): Promise<string | "quote_used" | null> {
  const id = crypto.randomUUID();
  const created = now.toISOString();
  const insert = db.prepare(`INSERT INTO actions (action_id, subject_reference, wallet_address, kind, chain_id,
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
      new Date(now.getTime() + ACTION_TTL_MS).toISOString());
  let result: D1Result;
  try { result = await insert.run(); }
  catch (error) {
    // Two requests raced to turn one quote into an action; the other one has it.
    if (action.routeQuoteId && /UNIQUE/i.test(String(error)) && /route_quote_id/i.test(String(error))) return "quote_used";
    throw error;
  }
  return result.meta.changes === 1 ? id : null;
}

export type Block = { code: string; message: string };

/** The customer's own controls, applied to an action Aura prepares. Returns why it is blocked, or null. */
export function checkControls(action: BuiltAction, valuation: Valuation, controls: Controls): Block | null {
  if (controls.accountLocked) return { code: "account_locked", message: "Your account is locked. Unlock it in Settings to continue." };
  // Cooling only matters when sending is limited to saved recipients.
  if (action.recipient && controls.enforceAddressBook) {
    if (controls.recipient === "cooling") return { code: "recipient_cooling", message: "This saved recipient is still in its waiting period." };
    if (controls.recipient !== "saved") return { code: "recipient_not_saved", message: "Your settings only allow sending to saved recipients." };
  }
  if (action.countsTowardLimit && controls.dailyLimitCents !== null) {
    if (valuation.usdCents === null) return { code: "value_unavailable", message: "We couldn't value this amount, so we can't check it against your daily limit." };
    if (controls.spentUnknown) return { code: "recent_value_unavailable", message: "A recent transaction has no value, so we can't check your daily limit." };
    if (controls.spentCents + valuation.usdCents > controls.dailyLimitCents) return { code: "daily_limit", message: "This would go over your daily limit." };
  }
  return null;
}

/**
 * Stop here when the customer has locked their account. A lock also stops
 * actions prepared before it, card creation, and unfreezing a card.
 */
export async function requireUnlocked(db: D1Database, subject: string, now = new Date(),
  message = "Your account is locked. Unlock it in Settings to continue."): Promise<void> {
  if ((await loadControls(db, subject, null, now)).accountLocked) throw new HttpError(409, "account_locked", message);
}
