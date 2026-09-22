const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function aesKey(secret: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase().normalize("NFKC");
}

export async function emailLookupHmac(email: string, secret: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(normalizeEmail(email)));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function encryptEmail(email: string, secret: string) {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, await aesKey(secret), encoder.encode(normalizeEmail(email)));
  return { ciphertext: bytesToBase64(new Uint8Array(ciphertext)), nonce: bytesToBase64(nonce) };
}

export async function decryptEmail(ciphertext: string, nonce: string, secret: string) {
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(nonce) }, await aesKey(secret), base64ToBytes(ciphertext));
  return decoder.decode(plaintext);
}

export async function abuseKey(value: string, secret: string) {
  return emailLookupHmac(value, secret);
}

export function growthSecrets() {
  const encryptionKey = process.env.GROWTH_EMAIL_ENCRYPTION_KEY;
  const lookupKey = process.env.GROWTH_EMAIL_LOOKUP_KEY;
  if (!encryptionKey || !lookupKey) throw new Error("Growth privacy secrets are not configured.");
  return { encryptionKey, lookupKey };
}
