import { env } from "cloudflare:workers";
import { z } from "zod";
import { requireVerifiedSubject } from "@/lib/auth/server";
import { ensureSubjectProfile } from "@/lib/profile/ensure";
import { route, readJsonBody } from "@/lib/http/route";

const updateSchema = z.object({
  networkGuideRead: z.boolean().optional(),
  riskGuideRead: z.boolean().optional()
}).refine((value) => value.networkGuideRead !== undefined || value.riskGuideRead !== undefined);

type ProgressRow = { network_guide_read_at: string | null; risk_guide_read_at: string | null; first_seen_at: string };
type CountRow = { count: number };

export const GET = route("profile.get", { unavailable: "profile_unavailable" }, async (request: Request, { traceId }) => {
  const subject = await requireVerifiedSubject(request);
  await ensureSubjectProfile(env.PROJECTION_DB, subject.subjectReference);
  const [progress, submitted, earn] = await env.PROJECTION_DB.batch([
    env.PROJECTION_DB.prepare("SELECT network_guide_read_at, risk_guide_read_at, first_seen_at FROM onboarding_progress WHERE subject_reference = ?").bind(subject.subjectReference),
    env.PROJECTION_DB.prepare("SELECT COUNT(*) AS count FROM actions WHERE subject_reference = ? AND status IN ('submitted', 'settling', 'confirmed')").bind(subject.subjectReference),
    env.PROJECTION_DB.prepare("SELECT COUNT(*) AS count FROM actions WHERE subject_reference = ? AND kind = 'earn' AND status IN ('submitted', 'settling', 'confirmed')").bind(subject.subjectReference)
  ]);
  const row = progress.results[0] as unknown as ProgressRow;
  return Response.json({
    progress: {
      networkGuideRead: Boolean(row?.network_guide_read_at),
      riskGuideRead: Boolean(row?.risk_guide_read_at),
      hasSubmittedTransaction: Number((submitted.results[0] as unknown as CountRow)?.count ?? 0) > 0,
      hasEarnPosition: Number((earn.results[0] as unknown as CountRow)?.count ?? 0) > 0,
      firstSeenAt: row?.first_seen_at
    },
    traceId
  }, { headers: { "Cache-Control": "no-store" } });
});

export const PATCH = route("profile.patch", { unavailable: "profile_update_unavailable", invalid: "invalid_profile_update" }, async (request: Request, { traceId }) => {
  const subject = await requireVerifiedSubject(request);
  const input = updateSchema.parse(await readJsonBody(request));
  await ensureSubjectProfile(env.PROJECTION_DB, subject.subjectReference);
  const now = new Date().toISOString();
  await env.PROJECTION_DB.batch([env.PROJECTION_DB.prepare(`UPDATE onboarding_progress SET
    network_guide_read_at = CASE WHEN ? = 1 THEN COALESCE(network_guide_read_at, ?) ELSE network_guide_read_at END,
    risk_guide_read_at = CASE WHEN ? = 1 THEN COALESCE(risk_guide_read_at, ?) ELSE risk_guide_read_at END,
    updated_at = ? WHERE subject_reference = ?`)
    .bind(input.networkGuideRead ? 1 : 0, now, input.riskGuideRead ? 1 : 0, now, now, subject.subjectReference),
    env.PROJECTION_DB.prepare(`INSERT INTO product_events (event_id, subject_reference, session_reference, event_name, surface, properties_json, occurred_at)
      VALUES (?, ?, ?, 'activation_viewed', '/app', ?, ?)`)
      .bind(crypto.randomUUID(), subject.subjectReference, subject.sessionReference, JSON.stringify({ guideAcknowledged: true }), now)
  ]);
  return Response.json({ updated: true, traceId });
});
