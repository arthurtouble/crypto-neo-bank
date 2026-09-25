import { AuthenticationError } from "@/lib/http/errors";
import { privyClient } from "./privy";

export type VerifiedSubject = {
  subjectReference: string;
  sessionReference: string;
  expiresAt: number;
};

export { AuthenticationError };

export async function requireVerifiedSubject(request: Request): Promise<VerifiedSubject> {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new AuthenticationError();
  const client = privyClient();
  try {
    const claims = await client.utils().auth().verifyAccessToken(token);
    return { subjectReference: claims.user_id, sessionReference: claims.session_id, expiresAt: claims.expiration };
  } catch {
    throw new AuthenticationError("The Privy session is invalid or expired.");
  }
}

