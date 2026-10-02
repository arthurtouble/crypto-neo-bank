import { env } from "cloudflare:workers";
import { AccountClosedError, AuthenticationError, TermsRequiredError } from "@/lib/http/errors";
import { legalDocuments } from "@/lib/legal/documents";
import { privyClient } from "./privy";

type VerifiedSubject = {
  subjectReference: string;
  sessionReference: string;
  expiresAt: number;
};

export { AccountClosedError, AuthenticationError, TermsRequiredError };

/**
 * The signed-in customer, from their Privy session. A closed account is
 * refused everywhere except where `allowClosed` is set: support and the data
 * export. So is a customer who hasn't accepted the current terms and privacy
 * notice, except where `beforeTerms` is set: the terms themselves, support,
 * the data export, and the session check. The app shows the terms first
 * (components/terms-gate.tsx); this makes sure the server agrees.
 */
export async function requireVerifiedSubject(request: Request, options: { allowClosed?: boolean; beforeTerms?: boolean } = {}): Promise<VerifiedSubject> {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new AuthenticationError();
  const client = privyClient();
  let subject: VerifiedSubject;
  try {
    const claims = await client.utils().auth().verifyAccessToken(token);
    subject = { subjectReference: claims.user_id, sessionReference: claims.session_id, expiresAt: claims.expiration };
  } catch {
    throw new AuthenticationError("The Privy session is invalid or expired.");
  }
  if (options.allowClosed && options.beforeTerms) return subject;
  const { terms, privacy } = legalDocuments;
  // One read for both checks. A customer seen for the first time has no profile row yet: not closed, nothing accepted.
  const account = await env.PROJECTION_DB.prepare(`SELECT
      (SELECT closed_at FROM subject_profiles WHERE subject_reference = ?1) AS closed_at,
      (SELECT COUNT(DISTINCT document_key) FROM consent_evidence WHERE subject_reference = ?1
        AND ((document_key = ?2 AND document_version = ?3) OR (document_key = ?4 AND document_version = ?5))) AS accepted`)
    .bind(subject.subjectReference, terms.key, terms.version, privacy.key, privacy.version)
    .first<{ closed_at: string | null; accepted: number }>();
  if (!options.allowClosed && account?.closed_at) throw new AccountClosedError();
  if (!options.beforeTerms && (account?.accepted ?? 0) < 2) throw new TermsRequiredError();
  return subject;
}

