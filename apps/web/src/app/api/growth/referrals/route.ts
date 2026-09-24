import { env } from "cloudflare:workers";
import { AuthenticationError, requireVerifiedSubject } from "@/lib/auth/server";
import { createInviteCode, growthAllowedCountries, hashInviteCode } from "@/lib/growth/invitations";
import { referralEligibility } from "@/lib/growth/referrals";
import { writeAuditEvent } from "@/lib/security/audit";

async function evidence(subjectReference: string) {
  const [access, events, issues, invites] = await env.PROJECTION_DB.batch([
    env.PROJECTION_DB.prepare("SELECT status, country_code, activated_at FROM beta_access WHERE subject_reference = ?").bind(subjectReference),
    env.PROJECTION_DB.prepare("SELECT event_name FROM growth_events WHERE subject_reference = ? AND event_name IN ('account_secured','first_value_completed','retained_30d') GROUP BY event_name").bind(subjectReference),
    env.PROJECTION_DB.prepare("SELECT COUNT(*) AS count FROM operational_issues WHERE subject_reference = ? AND severity IN ('critical','high') AND status != 'resolved'").bind(subjectReference),
    env.PROJECTION_DB.prepare("SELECT COUNT(*) AS count FROM growth_referrals WHERE referrer_subject_reference = ? AND status = 'active' AND expires_at > ?").bind(subjectReference, new Date().toISOString())
  ]);
  const account = access.results[0] as { status?: string; country_code?: string; activated_at?: string } | undefined; const names = new Set((events.results as Array<{ event_name: string }>).map((row) => row.event_name)); const limit = Number(process.env.GROWTH_REFERRAL_LIMIT ?? 1);
  return referralEligibility({ accessActive: account?.status === "active", accountSecured: names.has("account_secured"), firstValueCompleted: names.has("first_value_completed"), retained: names.has("retained_30d"), accountAgeDays: account?.activated_at ? (Date.now() - Date.parse(account.activated_at)) / 86_400_000 : 0, criticalIssueOpen: Number((issues.results[0] as { count?: number } | undefined)?.count ?? 0) > 0, countryAllowed: Boolean(account?.country_code && growthAllowedCountries().includes(account.country_code)), featureEnabled: process.env.GROWTH_REFERRALS_ENABLED === "true", activeInvites: Number((invites.results[0] as { count?: number } | undefined)?.count ?? 0), inviteLimit: limit });
}

export async function GET(request: Request) { const traceId = crypto.randomUUID(); try { const subject = await requireVerifiedSubject(request); return Response.json({ ...await evidence(subject.subjectReference), traceId }, { headers: { "Cache-Control": "no-store" } }); } catch (error) { if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized", traceId }, { status: 401 }); return Response.json({ error: "referrals_unavailable", traceId }, { status: 503 }); } }

export async function POST(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    const subject = await requireVerifiedSubject(request); const eligibility = await evidence(subject.subjectReference); if (!eligibility.eligible) return Response.json({ error: "referral_locked", reasons: eligibility.reasons, traceId }, { status: 409 });
    const code = createInviteCode(); const hash = await hashInviteCode(code); const now = new Date().toISOString(); const expiryDays = Number(process.env.GROWTH_REFERRAL_EXPIRY_DAYS ?? 14); const expiresAt = new Date(Date.now() + expiryDays * 86_400_000).toISOString();
    await env.PROJECTION_DB.batch([
      env.PROJECTION_DB.prepare(`INSERT INTO beta_invites (code_hash, label, cohort, status, max_redemptions, redemption_count, allowed_countries_json, expires_at, created_at, created_by) VALUES (?, 'Customer referral', 'referral', 'disabled', 1, 0, ?, ?, ?, ?)`).bind(hash, JSON.stringify(growthAllowedCountries()), expiresAt, now, subject.subjectReference),
      env.PROJECTION_DB.prepare(`INSERT INTO growth_invite_links (invite_hash, campaign_id, referrer_subject_reference, invitation_type, issued_by, issued_at) VALUES (?, NULL, ?, 'customer_referral', ?, ?)`).bind(hash, subject.subjectReference, subject.subjectReference, now),
      env.PROJECTION_DB.prepare(`INSERT INTO growth_referrals (referral_id, referrer_subject_reference, invite_hash, status, issued_at, expires_at) VALUES (?, ?, ?, 'active', ?, ?)`).bind(crypto.randomUUID(), subject.subjectReference, hash, now, expiresAt),
      env.PROJECTION_DB.prepare(`INSERT INTO growth_events (event_id, subject_reference, anonymous_session_id, event_name, surface, campaign_id, content_id, properties_json, occurred_at) VALUES (?, ?, NULL, 'referral_issued', 'referrals', NULL, NULL, '{}', ?)`).bind(crypto.randomUUID(), subject.subjectReference, now)
    ]);
    await writeAuditEvent(env.PROJECTION_DB, { subjectReference: subject.subjectReference, actorType: "customer", actorReference: subject.subjectReference, action: "growth_referral_issued", targetType: "growth_referral", targetReference: hash, evidence: { expiresAt }, occurredAt: now });
    return Response.json({ referralUrl: `${new URL(request.url).origin}/waitlist?referral=${encodeURIComponent(code)}`, expiresAt, traceId }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized", traceId }, { status: 401 }); return Response.json({ error: "referral_unavailable", traceId }, { status: 503 }); }
}
