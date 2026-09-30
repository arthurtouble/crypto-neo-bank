import { bytesToBase64Url, hmacSha256 } from "@/lib/platform/encoding";

/**
 * Support runs on Intercom: its Messenger (chat, with the Fin AI agent
 * answering first), tickets, and the team inbox. Aura identifies a signed-in
 * customer to the Messenger with a short-lived JWT signed by the server
 * (Intercom's Messenger security), so a conversation can't be opened as
 * someone else, and agents see who they're helping without asking. The token
 * carries only the Privy user ID and, when the account has one, the verified
 * email. The signing secret never leaves the server.
 */
const INTERCOM_TOKEN_TTL_SECONDS = 3600;

const encode = (value: unknown) => bytesToBase64Url(new TextEncoder().encode(JSON.stringify(value)));

type MessengerIdentity = { userId: string; email: string | null };

/** An HS256 JWT for Intercom's `intercom_user_jwt`, valid for an hour. */
export async function intercomUserToken(identity: MessengerIdentity, secret: string, now = new Date()): Promise<{ token: string; expiresAt: string }> {
  const issuedAt = Math.floor(now.getTime() / 1000);
  const expires = issuedAt + INTERCOM_TOKEN_TTL_SECONDS;
  const payload = { user_id: identity.userId, ...(identity.email ? { email: identity.email } : {}), iat: issuedAt, exp: expires };
  const input = `${encode({ alg: "HS256", typ: "JWT" })}.${encode(payload)}`;
  return { token: `${input}.${bytesToBase64Url(await hmacSha256(secret, input))}`, expiresAt: new Date(expires * 1000).toISOString() };
}

/** Intercom is on only where both its app ID and identity secret are configured. */
export function intercomConfig(): { appId: string; secret: string } | null {
  const appId = process.env.INTERCOM_APP_ID;
  const secret = process.env.INTERCOM_IDENTITY_SECRET;
  return appId && secret ? { appId, secret } : null;
}
