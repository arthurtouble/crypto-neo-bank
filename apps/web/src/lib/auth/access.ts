import { AuthenticationError, AuthorizationError } from "@/lib/http/errors";
import { base64UrlToBytes } from "@/lib/platform/encoding";
import { localEdgeUrl } from "@/lib/testing/local-edge";

/**
 * Operators sign in to the operations app (`apps/ops`) through Cloudflare
 * Access, which puts a signed token in `Cf-Access-Jwt-Assertion` on every
 * request it lets through. The operator APIs check that token here, whoever
 * forwarded it: the signature against the team's published keys, the ops
 * application's audience, the issuer, and the expiry. A customer session is
 * never an operator.
 */
export type Operator = { email: string; subject: string };

const KEY_CACHE_MS = 10 * 60_000;
const CLOCK_SKEW_S = 60;
let cached: { url: string; keys: Map<string, CryptoKey>; at: number } | null = null;

/** The team domain, e.g. https://aura.cloudflareaccess.com. Only local end-to-end tests may use http, on localhost. */
function teamDomain(): string | null {
  const value = process.env.CF_ACCESS_TEAM_DOMAIN?.replace(/\/$/, "");
  if (!value) return null;
  if (value.startsWith("https://")) return value;
  return localEdgeUrl("CF_ACCESS_TEAM_DOMAIN");
}

const json = (value: string) => JSON.parse(new TextDecoder().decode(base64UrlToBytes(value))) as Record<string, unknown>;

async function signingKeys(team: string, refresh = false): Promise<Map<string, CryptoKey>> {
  const url = `${team}/cdn-cgi/access/certs`;
  if (!refresh && cached?.url === url && Date.now() - cached.at < KEY_CACHE_MS) return cached.keys;
  const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error(`Cloudflare Access keys unavailable (${response.status}).`);
  const { keys } = await response.json() as { keys?: Array<JsonWebKey & { kid?: string }> };
  const imported = new Map<string, CryptoKey>();
  for (const key of keys ?? []) {
    if (!key.kid || key.kty !== "RSA") continue;
    imported.set(key.kid, await crypto.subtle.importKey("jwk", key, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]));
  }
  cached = { url, keys: imported, at: Date.now() };
  return imported;
}

/** Check a Cloudflare Access token for the operations app and return who it is. Throws on anything wrong. */
export async function verifyAccessToken(token: string, nowMs = Date.now()): Promise<Operator> {
  const team = teamDomain();
  const audience = process.env.CF_ACCESS_AUD;
  if (!team || !audience) throw new AuthorizationError("Operations sign-in isn't configured.");
  const parts = token.split(".");
  if (parts.length !== 3) throw new AuthenticationError("Sign in to operations through Cloudflare Access.");
  let header: Record<string, unknown>, claims: Record<string, unknown>;
  try { header = json(parts[0]); claims = json(parts[1]); } catch { throw new AuthenticationError("Sign in to operations through Cloudflare Access."); }
  if (header.alg !== "RS256" || typeof header.kid !== "string") throw new AuthenticationError("Sign in to operations through Cloudflare Access.");
  // Access rotates its keys; an unknown key ID means fetching them again once.
  const key = (await signingKeys(team)).get(header.kid) ?? (await signingKeys(team, true)).get(header.kid);
  const signed = key && await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, base64UrlToBytes(parts[2]) as BufferSource, new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!signed) throw new AuthenticationError("Sign in to operations through Cloudflare Access.");
  const now = Math.floor(nowMs / 1000);
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss !== team || !audiences.includes(audience)) throw new AuthorizationError("This sign-in isn't for the operations app.");
  if (typeof claims.exp !== "number" || claims.exp + CLOCK_SKEW_S < now || (typeof claims.nbf === "number" && claims.nbf - CLOCK_SKEW_S > now)) {
    throw new AuthenticationError("Your operations sign-in expired. Sign in again.");
  }
  if (typeof claims.email !== "string" || !claims.email.includes("@") || typeof claims.sub !== "string") {
    throw new AuthorizationError("Operations needs a person's sign-in, not a service token.");
  }
  return { email: claims.email.toLowerCase(), subject: claims.sub };
}

/** The operator making this request, from Cloudflare Access. */
export async function requireOperator(request: Request): Promise<Operator> {
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) throw new AuthenticationError("Sign in to operations through Cloudflare Access.");
  return verifyAccessToken(token);
}

/** For tests: forget the cached keys. */
export function resetAccessKeys() { cached = null; }
