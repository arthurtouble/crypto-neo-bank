import { activeBridgeCustomer, bridgeClient, FAILED_PAYOUT_STATES, listBankDeposits, readTransferState, TERMINAL_PAYOUT_STATES, type BankDeposit } from "@/lib/providers/bridge";

/**
 * What Bridge knows about the customer's bank money, for Transactions: which
 * incoming USDC was a bank deposit, and how far each bank payout has got.
 * Bridge's webhooks are the usual path for payout states; these reads fill
 * the gap when a webhook is late or missing. Nothing here decides a balance.
 */

/** Bank deposits keyed by the Base transaction that delivered them. Empty when bank accounts are off or unreadable. */
export async function readBankDeposits(db: D1Database, subject: string): Promise<Map<string, BankDeposit>> {
  try {
    const bridge = await bridgeClient(db);
    const customer = bridge && await activeBridgeCustomer(db, subject);
    return bridge && customer ? await listBankDeposits(bridge, customer) : new Map();
  } catch (error) {
    console.error(JSON.stringify({ level: "warn", event: "bank.deposits.read_failed", message: error instanceof Error ? error.message : "unknown" }));
    return new Map();
  }
}

type OpenPayout = { action_id: string; subject_reference: string; transfer_id: string; bank_state: string | null };
const WINDOW_MS = 30 * 24 * 3600_000;

/**
 * Read Bridge's state for payouts whose funding reached Base and that Bridge
 * hasn't finished, and record each new state once (the same record a webhook
 * makes). Tells the customer when a payout arrives or comes back.
 */
export async function refreshBankPayouts(db: D1Database, options: { subject?: string; limit?: number; now?: Date; read?: (transferId: string) => Promise<string> } = {}): Promise<number> {
  const now = options.now ?? new Date();
  const bridge = options.read ? null : await bridgeClient(db);
  const read = options.read ?? (bridge ? (id: string) => readTransferState(bridge, id) : null);
  if (!read) return 0;
  const rows = await db.prepare(`SELECT a.action_id, a.subject_reference, json_extract(a.summary_json, '$.bankPayout.transferId') AS transfer_id,
      (SELECT json_extract(e.evidence_json, '$.state') FROM action_events e WHERE e.action_id = a.action_id AND e.event_type = 'bank_payout'
        ORDER BY e.occurred_at DESC LIMIT 1) AS bank_state
    FROM actions a WHERE a.status IN ('settling', 'confirmed') AND json_extract(a.summary_json, '$.bankPayout.transferId') IS NOT NULL
      AND a.created_at > ?1 ${options.subject ? "AND a.subject_reference = ?2" : ""} ORDER BY a.created_at DESC LIMIT 200`)
    .bind(new Date(now.getTime() - WINDOW_MS).toISOString(), ...(options.subject ? [options.subject] : [])).all<OpenPayout>();
  const open = rows.results.filter((row) => !row.bank_state || !TERMINAL_PAYOUT_STATES.has(row.bank_state)).slice(0, options.limit ?? 20);
  let changed = 0;
  for (const payout of open) {
    const state = await read(payout.transfer_id).catch(() => null);
    if (!state || state === payout.bank_state) continue;
    const inserted = await db.prepare(`INSERT OR IGNORE INTO action_events (event_id, action_id, event_type, evidence_json, occurred_at)
      VALUES (?, ?, 'bank_payout', ?, ?)`).bind(`bank_payout:${payout.transfer_id}:${state}`, payout.action_id,
      JSON.stringify({ provider: "bridge", state, observedBy: "read" }), now.toISOString()).run();
    if (!inserted.meta.changes) continue;
    changed += 1;
    if (state === "payment_processed" || FAILED_PAYOUT_STATES.has(state)) {
      const [{ announce }, { bankPayoutNotice }, { getAction }] = await Promise.all([import("@/lib/notifications/deliver"),
        import("@/lib/notifications/store"), import("@/lib/actions/store")]);
      const action = await getAction(db, payout.subject_reference, payout.action_id);
      if (action) await announce(db, payout.subject_reference, bankPayoutNotice(action, state), now);
    }
  }
  return changed;
}
