import { env } from "cloudflare:workers";
import { z } from "zod";
import { requireVerifiedSubject } from "@/lib/auth/server";
import { route } from "@/lib/http/route";
import { legalDocuments } from "@/lib/legal/documents";
import { ensureSubjectProfile } from "@/lib/profile/ensure";
import { writeAuditEvent } from "@/lib/security/audit";

const acceptSchema = z.object({ termsVersion: z.string().min(1).max(40), privacyVersion: z.string().min(1).max(40) }).strict();
const current = [legalDocuments.terms, legalDocuments.privacy];

async function acceptedVersions(subjectReference: string) {
  const rows = await env.PROJECTION_DB.prepare("SELECT document_key, document_version FROM consent_evidence WHERE subject_reference = ?")
    .bind(subjectReference).all<{ document_key: string; document_version: string }>();
  return new Set(rows.results.map((row) => `${row.document_key}@${row.document_version}`));
}

/** Whether the signed-in customer has accepted the current terms and seen the current privacy notice. */
export const GET = route("terms.get", { unavailable: "terms_unavailable" }, async (request: Request, { traceId }) => {
  const subject = await requireVerifiedSubject(request);
  const accepted = await acceptedVersions(subject.subjectReference);
  return Response.json({ accepted: current.every((doc) => accepted.has(`${doc.key}@${doc.version}`)),
    documents: current.map((doc) => ({ key: doc.key, version: doc.version, path: doc.path })), traceId });
});

/** Record acceptance of exactly the versions the customer was shown. */
export const POST = route("terms.post", { unavailable: "terms_unavailable", invalid: "invalid_terms_acceptance" }, async (request: Request, context) => {
  const subject = await requireVerifiedSubject(request);
  const input = acceptSchema.parse(await request.json());
  if (input.termsVersion !== legalDocuments.terms.version || input.privacyVersion !== legalDocuments.privacy.version)
    return Response.json({ error: "terms_changed", documents: current, traceId: context.traceId }, { status: 409 });
  await ensureSubjectProfile(env.PROJECTION_DB, subject.subjectReference);
  const now = new Date().toISOString();
  const evidence = JSON.stringify({ sessionReference: subject.sessionReference, userAgent: request.headers.get("user-agent")?.slice(0, 200) ?? null });
  await env.PROJECTION_DB.batch(current.map((doc) => env.PROJECTION_DB.prepare(`INSERT OR IGNORE INTO consent_evidence
    (consent_id, subject_reference, document_key, document_version, accepted_at, evidence_json) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), subject.subjectReference, doc.key, doc.version, now, evidence)));
  await writeAuditEvent(env.PROJECTION_DB, { subjectReference: subject.subjectReference, actorType: "customer", actorReference: subject.subjectReference,
    action: "terms_accepted", targetType: "legal_document", targetReference: `${legalDocuments.terms.key}@${legalDocuments.terms.version}`,
    evidence: { privacyVersion: legalDocuments.privacy.version }, occurredAt: now });
  return Response.json({ accepted: true, traceId: context.traceId });
});
