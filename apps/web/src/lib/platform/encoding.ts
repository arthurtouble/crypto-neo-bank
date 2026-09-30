/** Byte, hex, base64, and hash helpers shared by signing, webhooks, and fingerprints. Web Crypto only. */

const encoder = new TextEncoder();

/** Lowercase hex, two digits per byte, no prefix. */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** SHA-256 of a UTF-8 string, as lowercase hex without a prefix. */
export async function sha256Hex(value: string): Promise<string> {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}

/** HMAC-SHA256 of a UTF-8 message under a raw key (a UTF-8 string or bytes). */
export async function hmacSha256(key: string | Uint8Array, message: string): Promise<Uint8Array> {
  const raw = typeof key === "string" ? encoder.encode(key) : key;
  const imported = await crypto.subtle.importKey("raw", raw as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", imported, encoder.encode(message)));
}

/** HMAC-SHA256 as lowercase hex. */
export async function hmacSha256Hex(key: string | Uint8Array, message: string): Promise<string> {
  return bytesToHex(await hmacSha256(key, message));
}

/** Standard base64 to bytes. Throws on invalid input. */
export function base64ToBytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

/** Base64url (padding optional) to bytes. Throws on invalid input. */
export function base64UrlToBytes(value: string): Uint8Array {
  return base64ToBytes(value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "="));
}

/** Bytes to unpadded base64url. */
export function bytesToBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
