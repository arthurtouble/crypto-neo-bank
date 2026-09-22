import { env } from "cloudflare:workers";
import { z } from "zod";
import { AuthenticationError, AuthorizationError, requireOperationsAdmin } from "@/lib/auth/admin";
import { createInviteCode, growthAllowedCountries, hashInviteCode } from "@/lib/growth/invitations";

export async function POST(request: Request, context: { params: Promise<{ applicationId: string }> }) {
  const traceId = crypto.randomUUID();
  try {
    const admin = await requireOperationsAdmin(request); const { applicationId } = await context.params; z.string().uuid().parse(applicationId);
    const application = await env.PROJECTION_DB.prepare("SELECT country_code, status FROM growth_applications WHERE application_id = ?").bind(applicationId).first<{ country_code: string; status: string }>();
    if (!application) return Response.json({ error: "not_found", traceId }, { status: 404 });
    if (!["qualified", "waitlisted"].includes(application.status)) return Response.json({ error: "application_not_invitable", traceId }, { status: 409 });
    const allowed = growthAllowedCountries();
    if (!allowed.length || !allowed.includes(application.country_code)) return Response.json({ error: "country_not_enabled", traceId }, { status: 409 });
    const existing = await env.PROJECTION_DB.prepare("SELECT invite_hash, invitation_type FROM growth_invite_links WHERE application_id = ?").bind(applicationId).first<{ invite_hash: string; invitation_type: string }>();
    if (existing?.invitation_type === "customer_referral") {
      const now = new Date().toISOString();
      await env.PROJECTION_DB.batch([
        env.PROJECTION_DB.prepare("UPDATE beta_invites SET status = 'active' WHERE code_hash = ? AND status = 'disabled'").bind(existing.invite_hash),
        env.PROJECTION_DB.prepare("UPDATE growth_applications SET status = 'invited', updated_at = ? WHERE application_id = ?").bind(now, applicationId),
        env.PROJECTION_DB.prepare(`INSERT INTO growth_events (event_id, application_id, subject_reference, anonymous_session_id, event_name, surface, campaign_id, content_id, properties_json, occurred_at) VALUES (?, ?, NULL, NULL, 'invite_issued', 'operations', NULL, NULL, '{"type":"customer_referral"}', ?)`).bind(crypto.randomUUID(), applicationId, now),
        env.PROJECTION_DB.prepare(`INSERT INTO audit_events (audit_id, subject_reference, actor_type, actor_reference, action, target_type, target_reference, evidence_json, occurred_at) VALUES (?, NULL, 'operator', ?, 'growth_referral_approved', 'growth_application', ?, ?, ?)`).bind(crypto.randomUUID(), admin.subjectReference, applicationId, JSON.stringify({ invitationType: "customer_referral" }), now)
      ]);
      return Response.json({ activated: true, message: "The original referral code is now active.", traceId }, { status: 200, headers: { "Cache-Control": "no-store" } });
    }
    if (existing) return Response.json({ error: "invitation_already_issued", traceId }, { status: 409, headers: { "Cache-Control": "no-store" } });
    const code = createInviteCode(); const hash = await hashInviteCode(code); const now = new Date().toISOString();
    await env.PROJECTION_DB.batch([
      env.PROJECTION_DB.prepare(`INSERT INTO beta_invites (code_hash, label, cohort, status, max_redemptions, redemption_count, allowed_countries_json, expires_at, created_at, created_by) VALUES (?, ?, 'growth-private-access', 'active', 1, 0, ?, ?, ?, ?)`).bind(hash, `Private access ${applicationId.slice(0, 8)}`, JSON.stringify([application.country_code]), new Date(Date.now() + 14 * 86_400_000).toISOString(), now, admin.subjectReference),
      env.PROJECTION_DB.prepare(`INSERT INTO growth_invite_links (invite_hash, application_id, campaign_id, referrer_subject_reference, invitation_type, issued_by, issued_at) VALUES (?, ?, NULL, NULL, 'operator', ?, ?)`).bind(hash, applicationId, admin.subjectReference, now),
      env.PROJECTION_DB.prepare("UPDATE growth_applications SET status = 'invited', updated_at = ? WHERE application_id = ? AND status IN ('qualified','waitlisted')").bind(now, applicationId),
      env.PROJECTION_DB.prepare(`INSERT INTO growth_events (event_id, application_id, subject_reference, anonymous_session_id, event_name, surface, campaign_id, content_id, properties_json, occurred_at) VALUES (?, ?, NULL, NULL, 'invite_issued', 'operations', NULL, NULL, '{}', ?)`).bind(crypto.randomUUID(), applicationId, now),
      env.PROJECTION_DB.prepare(`INSERT INTO audit_events (audit_id, subject_reference, actor_type, actor_reference, action, target_type, target_reference, evidence_json, occurred_at) VALUES (?, NULL, 'operator', ?, 'growth_invite_issued', 'growth_application', ?, ?, ?)`).bind(crypto.randomUUID(), admin.subjectReference, applicationId, JSON.stringify({ invitationType: "operator", countryCode: application.country_code }), now)
    ]);
    return Response.json({ code, expiresAt: new Date(Date.now() + 14 * 86_400_000).toISOString(), message: "Copy this code now. Only its hash is stored.", traceId }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized", traceId }, { status: 401 });
    if (error instanceof AuthorizationError) return Response.json({ error: "forbidden", traceId }, { status: 403 });
    if (error instanceof z.ZodError) return Response.json({ error: "invalid_application", traceId }, { status: 400 });
    return Response.json({ error: "invitation_unavailable", traceId }, { status: 503 });
  }
}
