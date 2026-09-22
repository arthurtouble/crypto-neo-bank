import { env } from "cloudflare:workers";
import { z } from "zod";
import { AuthenticationError, AuthorizationError, requireOperationsAdmin } from "@/lib/auth/admin";

const querySchema = z.object({ from: z.string().datetime().optional(), to: z.string().datetime().optional(), campaign: z.string().max(120).optional(), country: z.string().regex(/^[A-Z]{2}$/).optional(), primaryJob: z.string().max(30).optional(), cohort: z.string().max(60).optional() });

export async function GET(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    await requireOperationsAdmin(request);
    const input = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const to = input.to ?? new Date().toISOString(); const from = input.from ?? new Date(Date.now() - 30 * 86_400_000).toISOString();
    const filters = ["a.submitted_at >= ?", "a.submitted_at < ?"]; const values: unknown[] = [from, to];
    if (input.country) { filters.push("a.country_code = ?"); values.push(input.country); }
    if (input.primaryJob) { filters.push("a.primary_job = ?"); values.push(input.primaryJob); }
    if (input.campaign) { filters.push("EXISTS (SELECT 1 FROM growth_attribution fa WHERE fa.application_id = a.application_id AND fa.utm_campaign = ?)"); values.push(input.campaign); }
    if (input.cohort) { filters.push("EXISTS (SELECT 1 FROM growth_invite_links gl JOIN beta_invites bi ON bi.code_hash = gl.invite_hash WHERE gl.application_id = a.application_id AND bi.cohort = ?)"); values.push(input.cohort); }
    const selected = `SELECT a.application_id FROM growth_applications a WHERE ${filters.join(" AND ")}`;
    const row = await env.PROJECTION_DB.prepare(`WITH selected AS (${selected}) SELECT
      (SELECT COUNT(DISTINCT ge.anonymous_session_id) FROM growth_events ge WHERE ge.event_name = 'landing_viewed' AND ge.occurred_at >= ? AND ge.occurred_at < ?) AS visitors,
      (SELECT COUNT(*) FROM selected) AS submitted,
      (SELECT COUNT(*) FROM growth_applications a JOIN selected s ON s.application_id = a.application_id WHERE a.status IN ('qualified','waitlisted','invited')) AS qualified,
      (SELECT COUNT(*) FROM growth_invite_links gil JOIN selected s ON s.application_id = gil.application_id) AS invites_issued,
      (SELECT COUNT(*) FROM growth_subject_links gsl JOIN selected s ON s.application_id = gsl.application_id) AS invites_redeemed,
      (SELECT COUNT(DISTINCT ge.subject_reference) FROM growth_events ge JOIN growth_subject_links gsl ON gsl.subject_reference = ge.subject_reference JOIN selected s ON s.application_id = gsl.application_id WHERE ge.event_name = 'account_secured') AS account_secured,
      (SELECT COUNT(DISTINCT ge.subject_reference) FROM growth_events ge JOIN growth_subject_links gsl ON gsl.subject_reference = ge.subject_reference JOIN selected s ON s.application_id = gsl.application_id WHERE ge.event_name = 'wallet_ready') AS wallet_ready,
      (SELECT COUNT(DISTINCT ge.subject_reference) FROM growth_events ge JOIN growth_subject_links gsl ON gsl.subject_reference = ge.subject_reference JOIN selected s ON s.application_id = gsl.application_id WHERE ge.event_name = 'first_value_completed') AS first_value,
      (SELECT COUNT(DISTINCT ge.subject_reference) FROM growth_events ge JOIN growth_subject_links gsl ON gsl.subject_reference = ge.subject_reference JOIN selected s ON s.application_id = gsl.application_id WHERE ge.event_name = 'retained_30d') AS retained_30d,
      (SELECT COUNT(*) FROM support_cases sc JOIN growth_subject_links gsl ON gsl.subject_reference = sc.subject_reference JOIN selected s ON s.application_id = gsl.application_id) AS support_cases,
      (SELECT COUNT(*) FROM transaction_intents ti JOIN growth_subject_links gsl ON gsl.subject_reference = ti.subject_reference JOIN selected s ON s.application_id = gsl.application_id WHERE ti.status IN ('failed','stale')) AS failed_or_stale
    `).bind(...values, from, to).first<Record<string, number | null>>();
    const timingRows = await env.PROJECTION_DB.prepare(`WITH selected AS (${selected}) SELECT
      (julianday(a.reviewed_at) - julianday(a.submitted_at)) * 24 AS review_hours,
      (julianday(gil.issued_at) - julianday(a.submitted_at)) * 24 AS invite_hours
      FROM growth_applications a JOIN selected s ON s.application_id = a.application_id
      LEFT JOIN growth_invite_links gil ON gil.application_id = a.application_id
      WHERE a.reviewed_at IS NOT NULL ORDER BY review_hours`).bind(...values).all<{ review_hours: number; invite_hours: number | null }>();
    const breakdown = await env.PROJECTION_DB.prepare(`WITH selected AS (${selected}) SELECT COALESCE(ga.utm_source, 'direct') AS source, a.primary_job, COUNT(DISTINCT a.application_id) AS submitted,
      SUM(CASE WHEN a.status IN ('qualified','waitlisted','invited') THEN 1 ELSE 0 END) AS qualified
      FROM growth_applications a JOIN selected s ON s.application_id = a.application_id LEFT JOIN growth_attribution ga ON ga.application_id = a.application_id AND ga.touch_type = 'conversion'
      GROUP BY source, a.primary_job ORDER BY submitted DESC`).bind(...values).all<{ source: string; primary_job: string; submitted: number; qualified: number }>();
    const counts = { visitors: Number(row?.visitors ?? 0), submitted: Number(row?.submitted ?? 0), qualified: Number(row?.qualified ?? 0), invitesIssued: Number(row?.invites_issued ?? 0), invitesRedeemed: Number(row?.invites_redeemed ?? 0), accountSecured: Number(row?.account_secured ?? 0), walletReady: Number(row?.wallet_ready ?? 0), firstValue: Number(row?.first_value ?? 0), retained30d: Number(row?.retained_30d ?? 0) };
    const median = (items: number[]) => { const sorted = items.filter(Number.isFinite).sort((a, b) => a - b); if (!sorted.length) return null; const middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; };
    return Response.json({ range: { from, to }, counts, denominators: { applicationRate: counts.visitors, qualifiedRate: counts.submitted, inviteAcceptance: counts.invitesIssued, securedRate: counts.invitesRedeemed, walletReadyRate: counts.invitesRedeemed, firstValueRate: counts.invitesRedeemed, retentionRate: counts.firstValue }, timing: { reviewHours: median(timingRows.results.map((item) => Number(item.review_hours))), inviteHours: median(timingRows.results.filter((item) => item.invite_hours != null).map((item) => Number(item.invite_hours))) }, guardrails: { supportCases: Number(row?.support_cases ?? 0), failedOrStaleActions: Number(row?.failed_or_stale ?? 0), activatedUsers: counts.invitesRedeemed }, breakdown: breakdown.results.map((item) => Number(item.submitted) < 5 ? { source: "small cohort", primaryJob: "grouped", submitted: Number(item.submitted), qualified: Number(item.qualified), suppressed: true } : { source: item.source, primaryJob: item.primary_job, submitted: Number(item.submitted), qualified: Number(item.qualified), suppressed: false }), traceId }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized", traceId }, { status: 401 });
    if (error instanceof AuthorizationError) return Response.json({ error: "forbidden", traceId }, { status: 403 });
    if (error instanceof z.ZodError) return Response.json({ error: "invalid_funnel_query", traceId }, { status: 400 });
    return Response.json({ error: "growth_funnel_unavailable", traceId }, { status: 503 });
  }
}
