import { env } from "cloudflare:workers";
import { AuthenticationError, requireVerifiedSubject } from "@/lib/auth/server";
import { writeAuditEvent } from "@/lib/security/audit";

export async function POST(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    const subject = await requireVerifiedSubject(request);
    const row = await env.PROJECTION_DB.prepare(`SELECT ba.invite_hash, gil.application_id FROM beta_access ba JOIN growth_invite_links gil ON gil.invite_hash = ba.invite_hash WHERE ba.subject_reference = ? AND ba.status = 'active'`).bind(subject.subjectReference).first<{ invite_hash: string; application_id: string | null }>();
    if (!row?.application_id) return Response.json({ linked: false, traceId }, { status: 404, headers: { "Cache-Control": "no-store" } });
    const now = new Date().toISOString();
    const existing = await env.PROJECTION_DB.prepare("SELECT application_id FROM growth_subject_links WHERE application_id = ? AND subject_reference = ?").bind(row.application_id, subject.subjectReference).first();
    if (!existing) {
      await env.PROJECTION_DB.batch([
        env.PROJECTION_DB.prepare("INSERT INTO growth_subject_links (application_id, subject_reference, invite_hash, linked_at) VALUES (?, ?, ?, ?)").bind(row.application_id, subject.subjectReference, row.invite_hash, now),
        env.PROJECTION_DB.prepare("UPDATE growth_attribution SET subject_reference = ? WHERE application_id = ? AND subject_reference IS NULL").bind(subject.subjectReference, row.application_id),
        env.PROJECTION_DB.prepare("UPDATE growth_events SET subject_reference = ? WHERE application_id = ? AND subject_reference IS NULL").bind(subject.subjectReference, row.application_id),
        env.PROJECTION_DB.prepare(`INSERT INTO growth_events (event_id, application_id, subject_reference, anonymous_session_id, event_name, surface, campaign_id, content_id, properties_json, occurred_at) VALUES (?, ?, ?, NULL, 'invite_redeemed', 'authenticated-link', NULL, NULL, '{}', ?)`).bind(crypto.randomUUID(), row.application_id, subject.subjectReference, now),
        env.PROJECTION_DB.prepare("UPDATE growth_referrals SET status = 'redeemed', redeemed_subject_reference = ?, redeemed_at = ? WHERE invite_hash = ? AND status = 'active'").bind(subject.subjectReference, now, row.invite_hash)
      ]);
      await writeAuditEvent(env.PROJECTION_DB, { subjectReference: subject.subjectReference, actorType: "customer", actorReference: subject.subjectReference, action: "growth_application_linked", targetType: "growth_application", targetReference: row.application_id, evidence: { inviteHashLinked: true }, occurredAt: now });
    }
    return Response.json({ linked: true, traceId }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized", traceId }, { status: 401 });
    return Response.json({ error: "growth_link_unavailable", traceId }, { status: 503 });
  }
}
