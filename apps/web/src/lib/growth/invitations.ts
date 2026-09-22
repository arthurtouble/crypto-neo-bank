export async function hashInviteCode(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value.trim().toUpperCase()));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createInviteCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return `AUREL-${[...bytes].map((byte) => byte.toString(36).padStart(2, "0")).join("").toUpperCase()}`;
}

export function growthAllowedCountries() {
  return (process.env.GROWTH_ALLOWED_COUNTRIES ?? "").split(",").map((value) => value.trim().toUpperCase()).filter(Boolean);
}
