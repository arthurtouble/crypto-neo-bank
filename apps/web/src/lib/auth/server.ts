import { PrivyClient } from "@privy-io/node";
import { PRIVY_APP_ID } from "@/config/client";

export type VerifiedSubject = {
  subjectReference: string;
  sessionReference: string;
  expiresAt: number;
};

export class AuthenticationError extends Error {
  constructor(message = "A valid Privy session is required.") {
    super(message);
    this.name = "AuthenticationError";
  }
}

export async function requireVerifiedSubject(request: Request): Promise<VerifiedSubject> {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new AuthenticationError();
  if (!process.env.PRIVY_APP_SECRET) throw new Error("Privy server authentication is not configured.");

  try {
    const client = new PrivyClient({ appId: PRIVY_APP_ID, appSecret: process.env.PRIVY_APP_SECRET });
    const claims = await client.utils().auth().verifyAccessToken(token);
    return { subjectReference: claims.user_id, sessionReference: claims.session_id, expiresAt: claims.expiration };
  } catch {
    throw new AuthenticationError("The Privy session is invalid or expired.");
  }
}

