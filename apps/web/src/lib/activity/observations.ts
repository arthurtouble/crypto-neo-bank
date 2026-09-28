import type { IncomingTransfer } from "./incoming";

/**
 * Keep what the chain showed about money a customer received without an Aura
 * action, so operators can see money movement across every customer
 * (`incoming_observations`). A projection, never a balance: re-reading the
 * chain can always rebuild it. Best effort; a failure here never breaks the
 * read that found the transfers.
 */
export async function recordIncoming(db: D1Database, subject: string, wallet: string, transfers: IncomingTransfer[], now = new Date()): Promise<void> {
  if (!transfers.length) return;
  const at = now.toISOString();
  try {
    await db.batch(transfers.map((transfer) => db.prepare(`INSERT INTO incoming_observations (transfer_id, subject_reference, wallet_address, chain_id, transaction_hash,
        from_address, asset_id, symbol, decimals, amount_raw, amount, final, source, received_at, observed_at)
      SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15 WHERE EXISTS (SELECT 1 FROM subject_profiles WHERE subject_reference = ?2)
      ON CONFLICT (transfer_id) DO UPDATE SET final = MAX(final, excluded.final), observed_at = excluded.observed_at`)
      .bind(transfer.id, subject, wallet.toLowerCase(), transfer.chainId, transfer.transactionHash.toLowerCase(), transfer.from.toLowerCase(), transfer.assetId,
        transfer.symbol, transfer.decimals, transfer.amountRaw, transfer.amount, transfer.final ? 1 : 0, transfer.source, transfer.receivedAt, at)));
  } catch (error) {
    console.error(JSON.stringify({ level: "warn", event: "incoming.record_failed", message: error instanceof Error ? error.message : "unknown" }));
  }
}
