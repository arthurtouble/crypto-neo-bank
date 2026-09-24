import { env } from "cloudflare:workers";
import { z } from "zod";
import { AuthenticationError, AuthorizationError, requireOperationsAdmin } from "@/lib/auth/admin";
import { createInviteCode, growthAllowedCountries, hashInviteCode } from "@/lib/growth/invitations";

const inputSchema = z.object({
  verifiedCountry: z.string().regex(/^[A-Z]{2}$/),
  eligibilityEvidence: z.string().trim().min(3).max(200)
}).strict();

export async function POST(request: Request, context: { params: Promise<{ waitlistId: string }> }) {
  try {
    const admin = await requireOperationsAdmin(request);
    const { waitlistId } = await context.params;
    z.string().uuid().parse(waitlistId);
    const input = inputSchema.parse(await request.json());
    const row = await env.PROJECTION_DB.prepare("SELECT waitlist_id, status FROM growth_waitlist WHERE waitlist_id = ?").bind(waitlistId).first<{ waitlist_id: string; status: string }>();
    if (!row) return Response.json({ error: "not_found" }, { status: 404 });
    if (row.status !== "waiting") return Response.json({ error: "not_invitable" }, { status: 409 });
    const allowed = growthAllowedCountries();
    if (!allowed.includes(input.verifiedCountry)) return Response.json({ error: "country_not_enabled" }, { status: 409 });
    const existing = await env.PROJECTION_DB.prepare("SELECT invite_hash FROM growth_waitlist_invites WHERE waitlist_id = ?").bind(waitlistId).first();
    if (existing) return Response.json({ error: "invitation_already_issued" }, { status: 409 });

    const code = createInviteCode();
    const hash = await hashInviteCode(code);
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 14 * 86_400_000).toISOString();
    await env.PROJECTION_DB.batch([
      env.PROJECTION_DB.prepare(`INSERT INTO beta_invites
        (code_hash, label, cohort, status, max_redemptions, redemption_count, allowed_countries_json, expires_at, created_at, created_by)
        VALUES (?, ?, 'global-waitlist', 'active', 1, 0, ?, ?, ?, ?)`)
        .bind(hash, `Waitlist ${waitlistId.slice(0, 8)}`, JSON.stringify([input.verifiedCountry]), expiresAt, now, admin.subjectReference),
      env.PROJECTION_DB.prepare(`INSERT INTO growth_waitlist_invites
        (waitlist_id, invite_hash, verified_country, eligibility_evidence, issued_at) VALUES (?, ?, ?, ?, ?)`)
        .bind(waitlistId, hash, input.verifiedCountry, input.eligibilityEvidence, now),
      env.PROJECTION_DB.prepare("UPDATE growth_waitlist SET status = 'invited', updated_at = ? WHERE waitlist_id = ? AND status = 'waiting'").bind(now, waitlistId),
      env.PROJECTION_DB.prepare(`INSERT INTO audit_events
        (audit_id, subject_reference, actor_type, actor_reference, action, target_type, target_reference, evidence_json, occurred_at)
        VALUES (?, NULL, 'operator', ?, 'waitlist_invite_issued', 'growth_waitlist', ?, ?, ?)`)
        .bind(crypto.randomUUID(), admin.subjectReference, waitlistId, JSON.stringify({ verifiedCountry: input.verifiedCountry, eligibilityEvidence: input.eligibilityEvidence }), now)
    ]);
    return Response.json({ code, expiresAt }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized" }, { status: 401 });
    if (error instanceof AuthorizationError) return Response.json({ error: "forbidden" }, { status: 403 });
    if (error instanceof z.ZodError) return Response.json({ error: "invalid_invite" }, { status: 400 });
    return Response.json({ error: "invitation_unavailable" }, { status: 503 });
  }
}
