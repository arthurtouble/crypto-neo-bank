/** A published projection is unreadable while any pre-upgrade chain evidence remains. */
export const CURRENT_PUBLICATION_SQL = `SELECT calculation_version FROM portfolio_publications
  WHERE subject_reference = ? AND status = 'published'
    AND NOT EXISTS (SELECT 1 FROM portfolio_rebuild_holds h WHERE h.subject_reference = portfolio_publications.subject_reference)
    AND NOT EXISTS (SELECT 1 FROM portfolio_events e
      WHERE e.subject_reference = portfolio_publications.subject_reference AND e.source_id = 'blockscout:8453'
        AND (CASE WHEN json_valid(e.evidence_json) THEN json_extract(e.evidence_json, '$.sourceEvidenceVersion') ELSE NULL END) IS NOT 3)
    AND NOT EXISTS (SELECT 1 FROM portfolio_events e
      WHERE e.subject_reference = portfolio_publications.subject_reference AND e.source_id = 'aave:v3:8453'
        AND ((CASE WHEN json_valid(e.evidence_json) THEN json_extract(e.evidence_json, '$.sourceEvidenceVersion') ELSE NULL END) IS NOT 2
          OR (CASE WHEN json_valid(e.evidence_json) THEN json_extract(e.evidence_json, '$.effectProof') ELSE NULL END) IS NOT 'canonical_aave_pool_log'))`;

export async function currentPortfolioPublication(db: D1Database, subjectReference: string): Promise<number> {
  const row = await db.prepare(CURRENT_PUBLICATION_SQL).bind(subjectReference).first<{ calculation_version: number }>();
  return row?.calculation_version ?? 0;
}
