/**
 * Numbers for operators: customers, activity, volume, and how far new
 * customers get. Read from D1 records only; the volume is the US dollar
 * value recorded when each action was prepared, and money that arrived
 * without an action (read from the chain) isn't counted.
 */
type StatsDay = { day: string; signups: number; active: number; completed: number; volumeUsd: number };
export type Stats = {
  days: number;
  customers: { total: number; new: number; closed: number };
  actions: { completed: number; failed: number; stuck: number };
  volumeByKind: Array<{ kind: string; count: number; volumeUsd: number }>;
  funnel: Array<{ step: string; customers: number }>;
  daily: StatsDay[];
  observedAt: string;
};

/** What customers did, in words, from the action's kind and summary. */
const KIND = `CASE
  WHEN json_extract(summary_json, '$.bankPayout') IS NOT NULL THEN 'Sent to bank'
  WHEN json_extract(summary_json, '$.cardAllowance') IS NOT NULL THEN 'Card allowance'
  WHEN kind = 'transfer' THEN 'Sent'
  WHEN kind = 'earn' AND json_extract(summary_json, '$.direction') = 'withdraw' THEN 'Earn withdrawal'
  WHEN kind = 'earn' THEN 'Earn deposit'
  WHEN json_extract(summary_json, '$.external') = 1 THEN 'Sent to another network'
  WHEN destination_chain_id IS NOT NULL THEN 'Moved between networks'
  ELSE 'Swap' END`;
const DONE = "status IN ('settling', 'confirmed')";

export async function readStats(db: D1Database, days: number, now = new Date(), stuckBefore: { submitted: string; settling: string }): Promise<Stats> {
  const since = new Date(now.getTime() - days * 86_400_000).toISOString();
  const [customers, actions, byKind, funnel, signups, active, completed] = await db.batch([
    db.prepare("SELECT COUNT(*) AS total, SUM(created_at >= ?) AS new, SUM(closed_at IS NOT NULL) AS closed FROM subject_profiles").bind(since),
    db.prepare(`SELECT SUM(${DONE}) AS completed, SUM(status = 'failed') AS failed,
      SUM((status = 'submitted' AND submitted_at < ?) OR (status = 'settling' AND submitted_at < ?)) AS stuck FROM actions WHERE created_at >= ?`)
      .bind(stuckBefore.submitted, stuckBefore.settling, since),
    db.prepare(`SELECT ${KIND} AS kind, COUNT(*) AS count, COALESCE(SUM(usd_cents), 0) AS cents FROM actions
      WHERE ${DONE} AND created_at >= ? GROUP BY 1 ORDER BY cents DESC`).bind(since),
    // Of the customers who signed up in the period: how many moved money, verified with Bridge, and got a card.
    db.prepare(`SELECT COUNT(*) AS signed_up,
      SUM(EXISTS (SELECT 1 FROM actions a WHERE a.subject_reference = p.subject_reference AND a.${DONE})) AS moved_money,
      SUM(EXISTS (SELECT 1 FROM provider_customer_links l WHERE l.subject_reference = p.subject_reference AND l.status = 'active')) AS verified,
      SUM(EXISTS (SELECT 1 FROM card_account_projections c WHERE c.subject_reference = p.subject_reference)) AS carded
      FROM subject_profiles p WHERE p.created_at >= ?`).bind(since),
    db.prepare("SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS n FROM subject_profiles WHERE created_at >= ? GROUP BY 1").bind(since),
    db.prepare("SELECT substr(occurred_at, 1, 10) AS day, COUNT(DISTINCT subject_reference) AS n FROM product_events WHERE occurred_at >= ? GROUP BY 1").bind(since),
    db.prepare(`SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS n, COALESCE(SUM(usd_cents), 0) AS cents FROM actions
      WHERE ${DONE} AND created_at >= ? GROUP BY 1`).bind(since)
  ]);
  const first = <T>(result: D1Result) => (result.results[0] ?? {}) as T;
  const byDay = (result: D1Result) => new Map((result.results as Array<{ day: string; n: number; cents?: number }>).map((row) => [row.day, row]));
  const [signupDays, activeDays, completedDays] = [byDay(signups), byDay(active), byDay(completed)];
  const daily: StatsDay[] = [];
  for (let at = Date.parse(since.slice(0, 10)); at <= now.getTime(); at += 86_400_000) {
    const day = new Date(at).toISOString().slice(0, 10);
    daily.push({ day, signups: signupDays.get(day)?.n ?? 0, active: activeDays.get(day)?.n ?? 0, completed: completedDays.get(day)?.n ?? 0,
      volumeUsd: (completedDays.get(day)?.cents ?? 0) / 100 });
  }
  const customerRow = first<{ total: number; new: number | null; closed: number | null }>(customers);
  const actionRow = first<{ completed: number | null; failed: number | null; stuck: number | null }>(actions);
  const funnelRow = first<{ signed_up: number; moved_money: number | null; verified: number | null; carded: number | null }>(funnel);
  return {
    days,
    customers: { total: customerRow.total ?? 0, new: customerRow.new ?? 0, closed: customerRow.closed ?? 0 },
    actions: { completed: actionRow.completed ?? 0, failed: actionRow.failed ?? 0, stuck: actionRow.stuck ?? 0 },
    volumeByKind: (byKind.results as Array<{ kind: string; count: number; cents: number }>).map((row) => ({ kind: row.kind, count: row.count, volumeUsd: row.cents / 100 })),
    funnel: [
      { step: "Signed up", customers: funnelRow.signed_up ?? 0 },
      { step: "Moved money", customers: funnelRow.moved_money ?? 0 },
      { step: "Verified with Bridge", customers: funnelRow.verified ?? 0 },
      { step: "Got a card", customers: funnelRow.carded ?? 0 }
    ],
    daily,
    observedAt: now.toISOString()
  };
}
