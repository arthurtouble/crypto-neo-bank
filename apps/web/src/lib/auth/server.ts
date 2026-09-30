import { env } from "cloudflare:workers";
import { AccountClosedError, AuthenticationError } from "@/lib/http/errors";
import { privyClient } from "./privy";

type VerifiedSubject = {
  subjectReference: string;
  sessionReference: string;
  expiresAt: number;
};

export { AccountClosedError, AuthenticationError };

/**
 * The signed-in customer, from their Privy session. A closed account is
 * refused everywhere except where `allowClosed` is set: support and the data
 * export.
 */
export async function requireVerifiedSubject(request: Request, options: { allowClosed?: boolean } = {}): Promise<VerifiedSubject> {
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
  if (!options.allowClosed) {
    const profile = await env.PROJECTION_DB.prepare("SELECT closed_at FROM subject_profiles WHERE subject_reference = ?")
      .bind(subject.subjectReference).first<{ closed_at: string | null }>();
    if (profile?.closed_at) throw new AccountClosedError();
  }
  return subject;
}

