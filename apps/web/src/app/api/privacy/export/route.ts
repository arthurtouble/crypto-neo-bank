import { env } from "cloudflare:workers";
import { requireVerifiedSubject } from "@/lib/auth/server";
import { route } from "@/lib/http/route";
import { exportSubjectData } from "@/lib/privacy/subject-data";
import { ensureSubjectProfile } from "@/lib/profile/ensure";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { writeAuditEvent } from "@/lib/security/audit";

/** The customer's data, as a JSON download, straight away. Also works for a closed account. */
export const GET = route("privacy.export", { unavailable: "export_unavailable" }, async (request: Request) => {
  const subject = await requireVerifiedSubject(request, { allowClosed: true });
  await enforceRateLimit(env.PROJECTION_DB, { namespace: "data_export", subject: subject.subjectReference, limit: 5, windowSeconds: 86_400 });
  await ensureSubjectProfile(env.PROJECTION_DB, subject.subjectReference);
  const now = new Date().toISOString();
  const data = await exportSubjectData(env.PROJECTION_DB, subject.subjectReference);
  await writeAuditEvent(env.PROJECTION_DB, { subjectReference: subject.subjectReference, actorType: "customer", actorReference: subject.subjectReference,
    action: "data_exported", targetType: "subject", targetReference: subject.subjectReference, occurredAt: now });
  return new Response(JSON.stringify({ exportedAt: now, subjectReference: subject.subjectReference, data }, null, 2), { headers: {
    "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="aura-data-${now.slice(0, 10)}.json"`, "Cache-Control": "no-store" } });
});
