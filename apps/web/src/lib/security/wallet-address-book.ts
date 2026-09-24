import { getAddress } from "viem";

export class AddressStepUpUnavailableError extends Error {}

export async function saveWalletAddress(database: D1Database, subjectReference: string, rawAddress: string, label: string, now = new Date()) {
  const address = getAddress(rawAddress).toLowerCase();
  const timestamp = now.toISOString();
  const [saved] = await database.batch([
    database.prepare(`INSERT INTO address_book_entries (entry_id, subject_reference, chain_family, address, label, created_at, available_at)
      SELECT ?, p.subject_reference, 'evm', ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', ?, '+' || p.new_address_delay_seconds || ' seconds')
      FROM security_profiles p WHERE p.subject_reference = ? AND p.new_address_delay_seconds BETWEEN 0 AND 604800
        AND (p.enforce_address_book = 0 OR EXISTS (SELECT 1 FROM address_book_entries e
          WHERE e.subject_reference = p.subject_reference AND e.chain_family = 'evm' AND e.address = ?))
      ON CONFLICT(subject_reference, chain_family, address) DO UPDATE SET label = excluded.label`)
      .bind(crypto.randomUUID(), address, label, timestamp, timestamp, subjectReference, address),
    database.prepare(`INSERT INTO audit_events
        (audit_id, subject_reference, actor_type, actor_reference, action, target_type, target_reference, evidence_json, occurred_at)
      SELECT ?, ?, 'customer', ?, 'security.address.saved', 'wallet_address', ?,
        json_object('label', e.label, 'availableAt', e.available_at), ?
      FROM address_book_entries e WHERE e.subject_reference = ? AND e.chain_family = 'evm' AND e.address = ? AND changes() = 1`)
      .bind(crypto.randomUUID(), subjectReference, subjectReference, address, timestamp, subjectReference, address)
  ]);
  if (saved.meta.changes !== 1) {
    const profile = await database.prepare("SELECT enforce_address_book FROM security_profiles WHERE subject_reference = ?")
      .bind(subjectReference).first<{ enforce_address_book: number }>();
    if (profile?.enforce_address_book === 1) throw new AddressStepUpUnavailableError("Adding an allowed destination requires step-up.");
    throw new Error("Wallet address could not be saved.");
  }
  const row = await database.prepare(`SELECT entry_id, address, label, created_at, available_at FROM address_book_entries
    WHERE subject_reference = ? AND chain_family = 'evm' AND address = ?`)
    .bind(subjectReference, address).first<{ entry_id: string; address: string; label: string; created_at: string; available_at: string }>();
  if (!row) throw new Error("Saved wallet address could not be read.");
  return row;
}

export async function removeWalletAddress(database: D1Database, subjectReference: string, entryId: string, address: string, now = new Date()) {
  const timestamp = now.toISOString();
  const [removed] = await database.batch([
    database.prepare("DELETE FROM address_book_entries WHERE entry_id = ? AND subject_reference = ? AND chain_family = 'evm' AND address = ?")
      .bind(entryId, subjectReference, address),
    database.prepare(`INSERT INTO audit_events
        (audit_id, subject_reference, actor_type, actor_reference, action, target_type, target_reference, evidence_json, occurred_at)
      SELECT ?, ?, 'customer', ?, 'security.address.removed', 'wallet_address', ?, '{}', ? WHERE changes() = 1`)
      .bind(crypto.randomUUID(), subjectReference, subjectReference, address, timestamp)
  ]);
  return removed.meta.changes === 1;
}
