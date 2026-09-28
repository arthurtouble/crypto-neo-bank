/**
 * Support runs on Intercom: its Messenger (chat, with the Fin AI agent
 * answering first), tickets, and the team inbox. Aura identifies a signed-in
 * customer to the Messenger with a short-lived JWT signed by the server
 * (Intercom's Messenger security), so a conversation can't be opened as
 * someone else, and agents see who they're helping without asking. The token
 * carries only the Privy user ID and, when the account has one, the verified
 * email. The signing secret never leaves the server.
 */
export const INTERCOM_TOKEN_TTL_SECONDS = 3600;

const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const encode = (value: unknown) => base64url(new TextEncoder().encode(JSON.stringify(value)));

export type MessengerIdentity = { userId: string; email: string | null };

/** An HS256 JWT for Intercom's `intercom_user_jwt`, valid for an hour. */
export async function intercomUserToken(identity: MessengerIdentity, secret: string, now = new Date()): Promise<{ token: string; expiresAt: string }> {
  const issuedAt = Math.floor(now.getTime() / 1000);
  const expires = issuedAt + INTERCOM_TOKEN_TTL_SECONDS;
  const payload = { user_id: identity.userId, ...(identity.email ? { email: identity.email } : {}), iat: issuedAt, exp: expires };
  const input = `${encode({ alg: "HS256", typ: "JWT" })}.${encode(payload)}`;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(input)));
  return { token: `${input}.${base64url(signature)}`, expiresAt: new Date(expires * 1000).toISOString() };
}

/** Intercom is on only where both its app ID and identity secret are configured. */
export function intercomConfig(): { appId: string; secret: string } | null {
  const appId = process.env.INTERCOM_APP_ID;
  const secret = process.env.INTERCOM_IDENTITY_SECRET;
  return appId && secret ? { appId, secret } : null;
}
