import { base64ToBytes, bytesToBase64Url, base64UrlToBytes } from "@/lib/platform/encoding";

/**
 * Venue API credentials kept for a customer (Polymarket's order-book key) are
 * encrypted with AES-GCM under the `MARKETS_CREDENTIAL_KEY` secret (32 bytes,
 * base64). They can't move funds or sign orders, but they can cancel the
 * customer's orders, so D1 never holds them in the clear.
 */
const VERSION = "v1";

async function key(secret = process.env.MARKETS_CREDENTIAL_KEY): Promise<CryptoKey> {
  if (!secret) throw new Error("Market credential encryption is not configured.");
  const raw = base64ToBytes(secret);
  if (raw.byteLength !== 32) throw new Error("MARKETS_CREDENTIAL_KEY must be 32 bytes, base64.");
  return crypto.subtle.importKey("raw", raw as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** Encrypt `value` for one customer and venue; the context is authenticated, so a row can't be moved to another. */
export async function sealCredentials(value: unknown, context: string, secret?: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(context) },
    await key(secret), new TextEncoder().encode(JSON.stringify(value)));
  return `${VERSION}.${bytesToBase64Url(iv)}.${bytesToBase64Url(new Uint8Array(sealed))}`;
}

export async function openCredentials<T>(sealed: string, context: string, secret?: string): Promise<T> {
  const [version, iv, data] = sealed.split(".");
  if (version !== VERSION || !iv || !data) throw new Error("Unknown credential format.");
  const opened = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64UrlToBytes(iv) as BufferSource, additionalData: new TextEncoder().encode(context) },
    await key(secret), base64UrlToBytes(data) as BufferSource);
  return JSON.parse(new TextDecoder().decode(opened)) as T;
}
