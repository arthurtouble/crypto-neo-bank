/** Clear source ingestion for a replay without tearing down the last published
 * analytics version. A hold hides it until a fresh atomic publication commits. */
export async function rebuildPortfolioAnalytics(db: D1Database, subjectReference: string): Promise<void> {
  if (!subjectReference) throw new Error("Subject is required for analytics rebuild.");
  await db.batch([
    db.prepare("DELETE FROM portfolio_source_checkpoints WHERE subject_reference = ?").bind(subjectReference),
    db.prepare("DELETE FROM portfolio_events WHERE subject_reference = ?").bind(subjectReference),
    db.prepare(`INSERT INTO portfolio_rebuild_holds (subject_reference, rebuild_id, started_at)
      VALUES (?, ?, ?) ON CONFLICT(subject_reference) DO UPDATE SET rebuild_id = excluded.rebuild_id, started_at = excluded.started_at`)
      .bind(subjectReference, crypto.randomUUID(), new Date().toISOString())
  ]);
}

/** A changed canonical block invalidates all dependent daily calculations. */
export async function invalidateFromBlock(db: D1Database, subjectReference: string, chainId: number, blockNumber: string): Promise<void> {
  if (!subjectReference || !Number.isSafeInteger(chainId) || !/^(0|[1-9]\d*)$/.test(blockNumber)) throw new Error("Invalid reorganization boundary.");
  const day = `(SELECT substr(MIN(occurred_at), 1, 10) FROM portfolio_events
    WHERE subject_reference = ? AND chain_id = ? AND CAST(block_number AS INTEGER) >= CAST(? AS INTEGER))`;
  const statements = [
    db.prepare(`UPDATE portfolio_events SET finality = 'reorged', completeness = 'partial'
      WHERE subject_reference = ? AND chain_id = ? AND CAST(block_number AS INTEGER) >= CAST(? AS INTEGER)`).bind(subjectReference, chainId, blockNumber),
    db.prepare(`DELETE FROM portfolio_daily_results WHERE subject_reference = ? AND day >= ${day}`).bind(subjectReference, subjectReference, chainId, blockNumber),
    db.prepare(`DELETE FROM portfolio_daily_quantities WHERE subject_reference = ? AND day >= ${day}`).bind(subjectReference, subjectReference, chainId, blockNumber),
    db.prepare("DELETE FROM portfolio_lots WHERE subject_reference = ?").bind(subjectReference),
    db.prepare("DELETE FROM portfolio_disposals WHERE subject_reference = ?").bind(subjectReference),
    db.prepare(`UPDATE portfolio_source_checkpoints SET cursor = NULL, covered_through =
      CASE WHEN covered_through IS NOT NULL AND covered_through < (${day}) THEN covered_through ELSE (${day}) END,
      last_finalized_block = NULL, last_finalized_hash = NULL, status = 'partial', reason = 'reorg_replay_required', updated_at = ?
      WHERE subject_reference = ? AND account_id LIKE ?`).bind(subjectReference, chainId, blockNumber, subjectReference, chainId, blockNumber, new Date().toISOString(), subjectReference, `${chainId}:%`)
  ];
  await db.batch(statements);
}
